import firebase_admin
from firebase_admin import credentials, db
import time
import math
import random

# Load service account key
cred = credentials.Certificate("serviceAccountKey.json")
firebase_admin.initialize_app(cred, {
    "databaseURL": "https://meghadut-default-rtdb.firebaseio.com/"
})

# Node definitions — real Kedarnath valley GPS, distinct elevations
NODES = {
    "N001": {"lat": 30.7346, "lng": 79.0669, "elevation": 3583, "name": "Kedarnath Temple", "rssi_base": -67},
    "N002": {"lat": 30.7150, "lng": 79.0680, "elevation": 2900, "name": "Lincholi", "rssi_base": -73},
    "N003": {"lat": 30.6880, "lng": 79.0654, "elevation": 1982, "name": "Gaurikund", "rssi_base": -79},
}

# Phase cycle: N001 leads, N002 middle, N003 lags
# Each phase step in seconds
PHASE_DURATION = {
    "IDLE": 60,
    "RAMPING": 40,
    "PEAK": 50,
    "DRAINING": 45,
}

# Phase offsets (in seconds) — N001 leads, N003 lags
PHASE_OFFSET = {
    "N001": 0,
    "N002": 20,
    "N003": 45,
}

TOTAL_CYCLE = sum(PHASE_DURATION.values())  # 195 seconds

# Battery state per node (starts at realistic levels, drains slowly)
battery = {
    "N001": 94.0,
    "N002": 88.0,
    "N003": 81.0,
}

tick = 0

def get_phase_and_rainfall(node_id, t):
    """Compute phase and rainfall for node given global time t (with node offset)."""
    offset = PHASE_OFFSET[node_id]
    adjusted = (t - offset) % TOTAL_CYCLE
    if adjusted < 0:
        adjusted += TOTAL_CYCLE

    cum = 0
    for phase, dur in PHASE_DURATION.items():
        if adjusted < cum + dur:
            phase_frac = (adjusted - cum) / dur
            if phase == "IDLE":
                rain = random.uniform(0, 5)
            elif phase == "RAMPING":
                rain = 5 + phase_frac * 95 + random.gauss(0, 5)
            elif phase == "PEAK":
                rain = 100 + random.gauss(0, 15)
            elif phase == "DRAINING":
                rain = 100 - phase_frac * 95 + random.gauss(0, 5)
            rain = max(0, rain)
            return phase, rain
        cum += dur
    return "IDLE", 0.0

def compute_dsd(rain):
    """Compute B0-B3 fractions correlated to rain intensity."""
    if rain < 5:
        # Mostly B0 (drizzle)
        b0 = 0.70 + random.uniform(0, 0.15)
        b1 = 0.20 + random.uniform(0, 0.08)
        b2 = 0.05 + random.uniform(0, 0.04)
        b3 = 0.01 + random.uniform(0, 0.02)
    elif rain < 30:
        # Light rain
        b0 = 0.40 + random.uniform(0, 0.10)
        b1 = 0.35 + random.uniform(0, 0.10)
        b2 = 0.18 + random.uniform(0, 0.05)
        b3 = 0.05 + random.uniform(0, 0.03)
    elif rain < 70:
        # Moderate rain
        b0 = 0.20 + random.uniform(0, 0.08)
        b1 = 0.30 + random.uniform(0, 0.08)
        b2 = 0.30 + random.uniform(0, 0.08)
        b3 = 0.10 + random.uniform(0, 0.05)
    elif rain < 100:
        # Heavy rain
        b0 = 0.08 + random.uniform(0, 0.04)
        b1 = 0.20 + random.uniform(0, 0.05)
        b2 = 0.35 + random.uniform(0, 0.07)
        b3 = 0.22 + random.uniform(0, 0.08)
    else:
        # Cloudburst — B3 dominant
        b0 = 0.04 + random.uniform(0, 0.02)
        b1 = 0.10 + random.uniform(0, 0.04)
        b2 = 0.25 + random.uniform(0, 0.08)
        b3 = 0.50 + random.uniform(0, 0.15)

    total = b0 + b1 + b2 + b3
    return {
        "b0": round(b0 / total, 4),
        "b1": round(b1 / total, 4),
        "b2": round(b2 / total, 4),
        "b3": round(b3 / total, 4),
    }

def compute_piezo(rain, phase):
    """Piezo RMS spikes with rain intensity."""
    if phase == "IDLE" or rain < 5:
        rms = round(random.gauss(0.02, 0.005), 4)
        drop_count = random.randint(0, 2)
    elif rain < 50:
        rms = round(0.05 + rain / 500 + random.gauss(0, 0.01), 4)
        drop_count = int(rain * 0.3 + random.gauss(0, 3))
    else:
        rms = round(0.15 + rain / 300 + random.gauss(0, 0.02), 4)
        drop_count = int(rain * 0.8 + random.gauss(0, 8))
    rms = max(0.005, rms)
    drop_count = max(0, drop_count)
    return rms, drop_count

def compute_hydrometeor(rain, dsd, phase):
    """Classify hydrometeor types from DSD and acoustic features (ML pipeline output)."""
    b0, b1, b2, b3 = dsd["b0"], dsd["b1"], dsd["b2"], dsd["b3"]

    if phase == "IDLE" or rain < 2:
        noise_f   = 0.55 + random.uniform(0, 0.15)
        drizzle_f = 0.25 + random.uniform(0, 0.10)
        rain_f    = 0.10 + random.uniform(0, 0.05)
        hail_f    = 0.02 + random.uniform(0, 0.02)
        mixed_f   = 0.03 + random.uniform(0, 0.02)
    elif rain < 10:
        drizzle_f = 0.50 + b0 * 0.30 + random.uniform(0, 0.08)
        rain_f    = 0.28 + b1 * 0.20 + random.uniform(0, 0.08)
        noise_f   = 0.10 + random.uniform(0, 0.05)
        hail_f    = 0.02 + random.uniform(0, 0.02)
        mixed_f   = 0.04 + random.uniform(0, 0.03)
    elif rain < 50:
        rain_f    = 0.55 + b1 * 0.20 + random.uniform(0, 0.08)
        drizzle_f = 0.20 + b0 * 0.15 + random.uniform(0, 0.06)
        mixed_f   = 0.12 + b2 * 0.10 + random.uniform(0, 0.05)
        noise_f   = 0.04 + random.uniform(0, 0.03)
        hail_f    = 0.02 + b3 * 0.10 + random.uniform(0, 0.02)
    elif rain < 100:
        rain_f    = 0.38 + random.uniform(0, 0.08)
        mixed_f   = 0.28 + b2 * 0.15 + random.uniform(0, 0.08)
        hail_f    = 0.18 + b3 * 0.20 + random.uniform(0, 0.08)
        drizzle_f = 0.08 + random.uniform(0, 0.04)
        noise_f   = 0.03 + random.uniform(0, 0.02)
    else:
        hail_f    = 0.35 + b3 * 0.25 + random.uniform(0, 0.08)
        mixed_f   = 0.28 + b2 * 0.10 + random.uniform(0, 0.06)
        rain_f    = 0.22 + random.uniform(0, 0.06)
        drizzle_f = 0.05 + random.uniform(0, 0.03)
        noise_f   = 0.03 + random.uniform(0, 0.01)

    total = rain_f + drizzle_f + hail_f + mixed_f + noise_f
    rain_f    = round(rain_f    / total, 4)
    drizzle_f = round(drizzle_f / total, 4)
    hail_f    = round(hail_f    / total, 4)
    mixed_f   = round(mixed_f   / total, 4)
    noise_f   = round(noise_f   / total, 4)

    fracs = {"RAIN": rain_f, "DRIZZLE": drizzle_f, "HAIL": hail_f, "MIXED": mixed_f, "NOISE": noise_f}
    dominant = max(fracs, key=fracs.get)
    hydro_conf = round(min(0.98, fracs[dominant] + random.uniform(0, 0.05)), 4)

    return {
        "hydro_rain":       rain_f,
        "hydro_drizzle":    drizzle_f,
        "hydro_hail":       hail_f,
        "hydro_mixed":      mixed_f,
        "hydro_noise":      noise_f,
        "hydro_dominant":   dominant,
        "hydro_confidence": hydro_conf,
    }

def compute_optical(rain, phase):
    """Optical signal stable when dry, fluctuates in rain."""
    if phase == "IDLE" or rain < 5:
        signal = round(0.95 + random.gauss(0, 0.005), 4)
        interruptions = random.randint(0, 1)
    elif rain < 50:
        signal = round(0.95 - rain / 1000 - abs(random.gauss(0, 0.02)), 4)
        interruptions = int(rain * 0.1 + random.gauss(0, 1))
    else:
        signal = round(0.95 - rain / 500 - abs(random.gauss(0, 0.05)), 4)
        interruptions = int(rain * 0.3 + random.gauss(0, 5))
    signal = max(0.1, min(1.0, signal))
    interruptions = max(0, interruptions)
    return signal, interruptions

print("Meghadut Node Simulator Started — Phase-Based Rainfall")
print(f"Nodes: {list(NODES.keys())} | Cycle: {TOTAL_CYCLE}s")

while True:
    now = int(time.time())

    for node_id, meta in NODES.items():
        phase, rain = get_phase_and_rainfall(node_id, now)
        rain = round(rain, 2)

        dsd = compute_dsd(rain)
        hydro = compute_hydrometeor(rain, dsd, phase)
        piezo_rms, piezo_drop_count = compute_piezo(rain, phase)
        optical_signal, optical_interruptions = compute_optical(rain, phase)

        # Battery drains ~0.005% per tick, slightly faster under heavy rain
        drain = 0.005 + (0.002 if rain > 80 else 0)
        battery[node_id] = max(0.0, battery[node_id] - drain)
        bat = round(battery[node_id], 2)

        # RSSI varies ±5 dBm
        rssi = meta["rssi_base"] + random.randint(-5, 5)

        # Classification from DSD
        if dsd["b3"] > 0.15:
            classification = "CLOUDBURST"
        elif rain > 30:
            classification = "HEAVY_RAIN"
        elif rain > 5:
            classification = "RAIN"
        else:
            classification = "DRY"

        confidence = round(min(0.99, 0.75 + dsd["b3"] * 0.5 + random.uniform(0, 0.1)), 4)

        data = {
            "rainfall_rate": rain,
            "b0": dsd["b0"],
            "b1": dsd["b1"],
            "b2": dsd["b2"],
            "b3": dsd["b3"],
            "b3_fraction": dsd["b3"],
            "classification": classification,
            "confidence": confidence,
            "phase": phase,
            "lat": meta["lat"],
            "lon": meta["lng"],
            "elevation": meta["elevation"],
            "battery": bat,
            "rssi": rssi,
            "piezo_rms": piezo_rms,
            "piezo_drop_count": piezo_drop_count,
            "optical_signal": optical_signal,
            "optical_interruptions": optical_interruptions,
            "hydro_rain":       hydro["hydro_rain"],
            "hydro_drizzle":    hydro["hydro_drizzle"],
            "hydro_hail":       hydro["hydro_hail"],
            "hydro_mixed":      hydro["hydro_mixed"],
            "hydro_noise":      hydro["hydro_noise"],
            "hydro_dominant":   hydro["hydro_dominant"],
            "hydro_confidence": hydro["hydro_confidence"],
            "timestamp": now,
        }

        db.reference(f"telemetry/{node_id}").set(data)

        # Write rolling history (last 60 entries)
        history_entry = {
            "timestamp": now,
            "rainfall_rate": rain,
            "phase": phase,
            "b3": dsd["b3"],
        }
        db.reference(f"history/{node_id}").push(history_entry)

        # Prune history > 60 entries
        hist = db.reference(f"history/{node_id}").get()
        if hist and len(hist) > 60:
            keys = sorted(hist.keys())
            for old_key in keys[:-60]:
                db.reference(f"history/{node_id}/{old_key}").delete()

        print(f"[{node_id}] {phase:8s} | Rain={rain:6.1f} mm/hr | B3={dsd['b3']:.2f} | "
              f"Bat={bat:.1f}% | RSSI={rssi} | {classification}")

    # Write telemetry meta
    db.reference("telemetry/meta").set({
        "mode": "SIMULATED",
        "cluster": "N-Kedarnath",
        "active_nodes": len(NODES),
        "last_update": now,
    })

    tick += 1
    time.sleep(5)
