import firebase_admin
from firebase_admin import credentials, db
import time
import threading

# Initialize Firebase
cred = credentials.Certificate("serviceAccountKey.json")
firebase_admin.initialize_app(cred, {
    "databaseURL": "https://meghadut-default-rtdb.firebaseio.com/"
})

telemetry_ref = db.reference("telemetry")
alerts_ref = db.reference("alerts/current")
cascade_ref = db.reference("cascade/active")
events_ref = db.reference("events/log")

WINDOW_SECONDS = 90
WATCH_THRESHOLD = 50    # mm/hr — 1 node triggers WATCH
WARNING_THRESHOLD = 100  # mm/hr — 2+ nodes trigger WARNING

# Node elevations (m) and GPS — used for kinematic wave formula
NODE_META = {
    "N001": {"elev": 3583, "lat": 30.7346, "lng": 79.0669},
    "N002": {"elev": 2900, "lat": 30.7150, "lng": 79.0680},
    "N003": {"elev": 1982, "lat": 30.6880, "lng": 79.0654},
}

# Kinematic wave parameters
MANNING_N = 0.04       # Manning roughness for mountain stream
SLOPE = 0.08           # Average channel slope (8%) for Kedarnath gorge
HYDRAULIC_RADIUS = 1.2 # meters

latest_data = {}
current_status = "NORMAL"
warning_fired_at = None

print("Meghadut Consensus Engine Started...")


def kinematic_wave_arrival(source_elev, dest_elev, rain_mm_hr):
    """
    Estimate flood wave travel time using kinematic wave approximation.
    v = (1/n) * R^(2/3) * S^(1/2)  [Manning's equation for wave celerity]
    Distance estimated from elevation drop.
    Returns seconds.
    """
    elev_diff = abs(source_elev - dest_elev)
    if elev_diff == 0:
        return 0

    # Manning's wave celerity (m/s)
    wave_celerity = (1.0 / MANNING_N) * (HYDRAULIC_RADIUS ** (2.0 / 3.0)) * (SLOPE ** 0.5)

    # Channel distance ~ 1.3x elevation difference / slope
    channel_distance = (elev_diff / SLOPE) * 1.3

    # Rain intensity scales celerity (more rain = faster flow)
    intensity_factor = 1.0 + (rain_mm_hr / 200.0)

    travel_time = channel_distance / (wave_celerity * intensity_factor)
    return max(60, int(travel_time))


def push_event(node_id, status, rainfall, b3):
    """Push a status change event to events/log."""
    now = int(time.time())
    event = {
        "timestamp": now,
        "node_id": node_id,
        "event": status,
        "rainfall": round(rainfall, 2),
        "b3": round(b3, 4),
        "status": status,
    }
    events_ref.push(event)

    # Prune to last 200 events
    events = events_ref.get()
    if events and len(events) > 200:
        keys = sorted(events.keys())
        for old_key in keys[:-200]:
            events_ref.child(old_key).delete()


def evaluate_consensus():
    global current_status, warning_fired_at
    now = int(time.time())

    if not latest_data:
        return

    watch_nodes = []
    warning_nodes = []

    for node_id, data in latest_data.items():
        if node_id == "meta" or not data or not isinstance(data, dict):
            continue

        rainfall = data.get("rainfall_rate", 0)
        timestamp = data.get("timestamp", 0)

        if (now - timestamp) > WINDOW_SECONDS:
            continue  # stale data

        if rainfall >= WARNING_THRESHOLD:
            warning_nodes.append((node_id, rainfall, data.get("b3_fraction", data.get("b3", 0))))
        elif rainfall >= WATCH_THRESHOLD:
            watch_nodes.append((node_id, rainfall, data.get("b3_fraction", data.get("b3", 0))))

    # Determine new status
    if len(warning_nodes) >= 2:
        new_status = "WARNING"
    elif len(warning_nodes) == 1 or len(watch_nodes) >= 1:
        new_status = "WATCH"
    else:
        new_status = "NORMAL"

    # Handle WARNING logic
    if new_status == "WARNING":
        # Compute cascade delays
        source_node = warning_nodes[0][0]
        source_rain = warning_nodes[0][1]
        source_elev = NODE_META[source_node]["elev"]

        cascade = {}
        for node_id, meta in NODE_META.items():
            if node_id == source_node:
                continue
            if meta["elev"] < source_elev:
                delay_s = kinematic_wave_arrival(source_elev, meta["elev"], source_rain)
                delay_min = round(delay_s / 60.0, 2)
                cascade[node_id] = {
                    "source_node": source_node,
                    "fired_at": now,
                    "delay_minutes": delay_min,
                    "arrival_epoch": now + delay_s,
                    "dest_elev": meta["elev"],
                }

        if current_status != "WARNING":
            warning_fired_at = now
            cascade_ref.set(cascade)
            all_votes = [n[0] for n in warning_nodes]
            avg_rain = sum(n[1] for n in warning_nodes) / len(warning_nodes)
            avg_b3 = sum(n[2] for n in warning_nodes) / len(warning_nodes)
            push_event(",".join(all_votes), "WARNING", avg_rain, avg_b3)
            print(f"WARNING CONFIRMED: {all_votes} | cascade: {list(cascade.keys())}")

        alerts_ref.set({
            "status": "WARNING",
            "votes": [n[0] for n in warning_nodes],
            "timestamp": now,
            "max_rainfall": max(n[1] for n in warning_nodes),
            "warning_since": warning_fired_at or now,
        })

    elif new_status == "WATCH":
        all_watch = watch_nodes + warning_nodes
        trigger_node = all_watch[0][0]
        trigger_rain = all_watch[0][1]
        trigger_b3 = all_watch[0][2]

        if current_status == "WARNING":
            # Clearing warning — clear cascade
            cascade_ref.delete()
            warning_fired_at = None
            push_event(trigger_node, "WATCH", trigger_rain, trigger_b3)
            print(f"WATCH (downgrade from WARNING) | trigger: {trigger_node}")
        elif current_status == "NORMAL":
            push_event(trigger_node, "WATCH", trigger_rain, trigger_b3)
            print(f"WATCH DECLARED: {trigger_node} | {trigger_rain:.1f} mm/hr")

        alerts_ref.set({
            "status": "WATCH",
            "votes": [n[0] for n in all_watch],
            "timestamp": now,
            "max_rainfall": max(n[1] for n in all_watch),
        })

    else:
        if current_status != "NORMAL":
            # Clearing alert — clear cascade
            cascade_ref.delete()
            warning_fired_at = None
            push_event("SYS", "NORMAL", 0, 0)
            print("Status returned to NORMAL. Cascade cleared.")

        alerts_ref.set({
            "status": "NORMAL",
            "votes": [],
            "timestamp": now,
            "max_rainfall": 0,
        })

    current_status = new_status


def telemetry_listener(event):
    global latest_data
    latest_data = telemetry_ref.get() or {}
    evaluate_consensus()


# Start listener
telemetry_ref.listen(telemetry_listener)
