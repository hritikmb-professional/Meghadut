import { useEffect, useState, useRef, useMemo } from "react";
import { ref, onValue } from "firebase/database";
import { db } from "./firebase";

import { MapContainer, TileLayer, Circle, CircleMarker, Popup, Tooltip as MapTooltip } from "react-leaflet";
import "leaflet/dist/leaflet.css";

import {
  ComposedChart,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  ReferenceArea,
  Legend,
  BarChart,
  Bar,
  Cell,
  PieChart,
  Pie,
} from "recharts";

import {
  AlertTriangle,
  CloudRain,
  Activity,
  MapPin,
  Radio,
  BarChart2,
  Droplets,
  Cpu,
  ShieldAlert,
  CheckCircle2,
  Eye,
  Waves,
  TrendingUp,
  Zap,
  Aperture,
  Users,
  FlaskConical,
  ScrollText,
  Layers,
  Timer,
  Volume2,
  VolumeX,
  Send,
  MessageSquare,
  Mail,
  Phone,
  CheckCircle,
  XCircle,
  Loader,
  Wind,
  Thermometer,
  RefreshCw,
} from "lucide-react";

import alertSound from "./alert.mp3";

const STATUS_CONFIG = {
  WARNING: { color: "#ef4444", bg: "#450a0a", border: "#b91c1c", icon: ShieldAlert, label: "Warning" },
  WATCH:   { color: "#f59e0b", bg: "#451a03", border: "#b45309", icon: Eye,         label: "Watch"   },
  NORMAL:  { color: "#22c55e", bg: "#052e16", border: "#15803d", icon: CheckCircle2, label: "Normal" },
};

const NODE_COLORS = { N001: "#38bdf8", N002: "#818cf8", N003: "#34d399" };
const NODE_IDS = ["N001", "N002", "N003"];

// ── Chikmagalur district villages for flood risk table + map
const VILLAGES = [
  { name: "Mudigere",    distKm: 5.2,  nearestNode: "N001", baseMins: 20,
    phone: "+917418244774", email: "hritikmb66@gmail.com",
    lat: 13.1312, lon: 75.6379,
    riskByStatus: { NORMAL: "MONITOR", WATCH: "PREPARE",      WARNING: "EVACUATE NOW" } },
  { name: "Kottigehara", distKm: 8.7,  nearestNode: "N002", baseMins: 28,
    phone: "+917418244774", email: "hritikmb66@gmail.com",
    lat: 13.0508, lon: 75.6048,
    riskByStatus: { NORMAL: "MONITOR", WATCH: "MONITOR",       WARNING: "EVACUATE NOW" } },
  { name: "Koppa",       distKm: 12.3, nearestNode: "N002", baseMins: 40,
    phone: "+917418244774", email: "hritikmb66@gmail.com",
    lat: 13.1854, lon: 75.3613,
    riskByStatus: { NORMAL: "MONITOR", WATCH: "MONITOR",       WARNING: "PREPARE" } },
  { name: "Sringeri",    distKm: 18.5, nearestNode: "N003", baseMins: 55,
    phone: "+917418244774", email: "hritikmb66@gmail.com",
    lat: 13.4157, lon: 75.2563,
    riskByStatus: { NORMAL: "MONITOR", WATCH: "MONITOR",       WARNING: "PREPARE" } },
  { name: "Balehonnur",  distKm: 22.1, nearestNode: "N003", baseMins: 70,
    phone: "+917418244774", email: "hritikmb66@gmail.com",
    lat: 13.3369, lon: 75.4166,
    riskByStatus: { NORMAL: "MONITOR", WATCH: "MONITOR",       WARNING: "MONITOR" } },
];

// ── Village risk colour helpers (used on both table and map)
const getVillageRiskColor = (risk) => {
  if (risk === "EVACUATE NOW") return "#ef4444";
  if (risk === "PREPARE")      return "#f59e0b";
  return "#22c55e";
};

const getRainfallColor = (rainfall = 0) => {
  if (rainfall > 100) return "#ef4444";
  if (rainfall > 20)  return "#f59e0b";
  return "#22c55e";
};

const getRainfallBg = (rainfall = 0) => {
  if (rainfall > 100) return "rgba(239,68,68,0.08)";
  if (rainfall > 20)  return "rgba(245,158,11,0.08)";
  return "rgba(34,197,94,0.08)";
};

// ── RSSI bars: 4 bars, fill based on dBm thresholds -65/-75/-85/-95
function RssiBars({ rssi }) {
  const dbm = rssi ?? -999;
  const filled = dbm >= -65 ? 4 : dbm >= -75 ? 3 : dbm >= -85 ? 2 : dbm >= -95 ? 1 : 0;
  const color = filled >= 3 ? "#22c55e" : filled === 2 ? "#f59e0b" : "#ef4444";
  return (
    <div className="rssi-bars" title={`${dbm} dBm`}>
      {[1, 2, 3, 4].map((bar) => (
        <div
          key={bar}
          className="rssi-bar"
          style={{
            height: `${bar * 4 + 4}px`,
            background: bar <= filled ? color : "var(--border)",
          }}
        />
      ))}
      <span className="rssi-label">{dbm} dBm</span>
    </div>
  );
}

// ── Battery bar
function BatteryBar({ pct }) {
  const val = pct ?? 0;
  const color = val > 60 ? "#22c55e" : val > 30 ? "#f59e0b" : "#ef4444";
  return (
    <div className="battery-row">
      <div className="battery-track">
        <div
          className="battery-fill"
          style={{ width: `${Math.min(100, val)}%`, background: color }}
        />
      </div>
      <span className="battery-pct" style={{ color }}>{val.toFixed(1)}%</span>
    </div>
  );
}

// ── "Updated Xs ago" label
function UpdatedAgo({ timestamp }) {
  const [ago, setAgo] = useState(0);

  useEffect(() => {
    const calc = () => setAgo(Math.floor(Date.now() / 1000) - (timestamp ?? 0));
    calc();
    const id = setInterval(calc, 1000);
    return () => clearInterval(id);
  }, [timestamp]);

  const color = ago > 30 ? "#ef4444" : ago > 15 ? "#f59e0b" : "var(--text-dim)";
  return (
    <div className="updated-ago" style={{ color }}>
      Updated {ago}s ago
    </div>
  );
}

function StatBadge({ icon: Icon, label, value, color }) {
  return (
    <div className="stat-badge" style={{ borderColor: color + "33" }}>
      <div className="stat-icon" style={{ color }}>
        <Icon size={16} />
      </div>
      <div>
        <div className="stat-label">{label}</div>
        <div className="stat-value" style={{ color }}>{value}</div>
      </div>
    </div>
  );
}

function NodeCard({ nodeId, data }) {
  const color = getRainfallColor(data.rainfall_rate);
  const bg    = getRainfallBg(data.rainfall_rate);
  return (
    <div className="node-card" style={{ borderColor: color + "44", background: bg }}>
      <div className="node-card-header">
        <div className="node-id-badge" style={{ color, background: color + "18" }}>
          <Radio size={12} />
          <span>{nodeId}</span>
        </div>
        {data.elevation != null && (
          <span className="elevation-label">▲ {data.elevation}m</span>
        )}
        <div className="node-dot" style={{ background: color }} />
      </div>

      <div className="node-rainfall">
        <Droplets size={20} style={{ color }} />
        <span className="node-rainfall-value" style={{ color }}>
          {data.rainfall_rate ?? "—"}
        </span>
        <span className="node-rainfall-unit">mm/hr</span>
      </div>

      <div className="node-stats">
        <StatBadge icon={Activity}   label="B3 Fraction"  value={data.b3_fraction ?? "—"}      color="#60a5fa" />
        <StatBadge icon={Cpu}        label="Class"        value={data.classification ?? "—"}    color="#a78bfa" />
        <StatBadge icon={BarChart2}  label="Confidence"   value={data.confidence ?? "—"}        color="#34d399" />
      </div>

      <BatteryBar pct={data.battery} />

      <div className="node-card-footer">
        <RssiBars rssi={data.rssi} />
        <UpdatedAgo timestamp={data.timestamp} />
      </div>

      <SensorAgreementBadge data={data} />
    </div>
  );
}

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload?.length) {
    return (
      <div className="chart-tooltip">
        <div className="chart-tooltip-time">{label}</div>
        {payload.map((p) => (
          <div key={p.dataKey} style={{ color: p.color }}>
            {p.name}: <strong>{typeof p.value === "number" ? p.value.toFixed(1) : p.value}</strong> mm/hr
          </div>
        ))}
      </div>
    );
  }
  return null;
};

// ── DSD bin metadata
const DSD_BINS = [
  { key: "b0", label: "B0 <0.5mm",    meaning: "Drizzle / fog droplets",    color: "#38bdf8" },
  { key: "b1", label: "B1 0.5–2mm",   meaning: "Light rain drops",           color: "#818cf8" },
  { key: "b2", label: "B2 2–3.5mm",   meaning: "Moderate rain drops",        color: "#f59e0b" },
  { key: "b3", label: "B3 >3.5mm",    meaning: "Large / cloudburst drops",   color: "#ef4444" },
];

// ── DSD Tooltip
function DSDTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const p = payload[0];
  const bin = DSD_BINS.find((b) => b.key === p.dataKey) ?? {};
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-time" style={{ color: p.fill }}>{bin.label}</div>
      <div style={{ color: "var(--text)", marginTop: 2 }}>{bin.meaning}</div>
      <div style={{ color: p.fill, fontWeight: 700, marginTop: 4 }}>
        {(p.value * 100).toFixed(1)}%
      </div>
    </div>
  );
}

// ── Single-node DSD card
function DSDNodeCard({ nodeId, data }) {
  const b3 = data?.b3_fraction ?? data?.b3 ?? 0;
  const cloudburst  = b3 > 0.15;
  const pulsing     = b3 > 0.35;
  const nodeColor   = NODE_COLORS[nodeId] ?? "#94a3b8";

  const chartData = DSD_BINS.map((bin) => ({
    name: bin.label,
    [bin.key]: data?.[bin.key] ?? 0,
  }));

  return (
    <div
      className={`dsd-node-card${pulsing ? " dsd-pulse" : ""}`}
      style={{ borderColor: pulsing ? "#ef4444" : nodeColor + "44" }}
    >
      {/* card header */}
      <div className="dsd-node-header">
        <span className="dsd-node-id" style={{ color: nodeColor }}>{nodeId}</span>
        {cloudburst && (
          <span className="dsd-cloudburst-badge">★ Cloudburst Signature</span>
        )}
      </div>

      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={chartData} barCategoryGap="28%">
          <XAxis
            dataKey="name"
            tick={{ fill: "#94a3b8", fontSize: 10 }}
            axisLine={{ stroke: "#1e2d45" }}
            tickLine={false}
          />
          <YAxis
            domain={[0, 1]}
            tick={{ fill: "#94a3b8", fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            width={28}
          />
          <Tooltip content={<DSDTooltip />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
          {DSD_BINS.map((bin) => (
            <Bar key={bin.key} dataKey={bin.key} fill={bin.color} radius={[3, 3, 0, 0]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── DSD section (all 3 nodes)
function DSDSection({ telemetry }) {
  return (
    <section className="section">
      <div className="section-heading">
        <BarChart2 size={16} />
        <span>Drop Size Distribution — All Nodes</span>
      </div>
      <div className="dsd-grid">
        {NODE_IDS.map((id) => (
          <DSDNodeCard key={id} nodeId={id} data={telemetry[id]} />
        ))}
      </div>
    </section>
  );
}

// ── Hydrometeor type metadata (Rain/Drizzle/Hail/Mixed/Noise)
const HYDRO_TYPES = [
  { key: "rain",    label: "Rain",    color: "#3b82f6" }, // blue
  { key: "drizzle", label: "Drizzle", color: "#06b6d4" }, // cyan
  { key: "hail",    label: "Hail",    color: "#f97316" }, // orange
  { key: "mixed",   label: "Mixed",   color: "#a855f7" }, // purple
  { key: "noise",   label: "Noise",   color: "#6b7280" }, // grey
];

const HYDRO_BUFFER_SIZE = 360; // ~30 min at 5 s Firebase update cycle
const EMPTY_HYDRO = () =>
  Array.from({ length: HYDRO_BUFFER_SIZE }, (_, i) => ({
    t: i, rain: 0, drizzle: 0, hail: 0, mixed: 0, noise: 1,
  }));

function getDominantHydro(data) {
  let maxKey = "noise";
  let maxVal = -Infinity;
  HYDRO_TYPES.forEach(({ key }) => {
    const v = data?.[`hydro_${key}`] ?? (key === "noise" ? 1 : 0);
    if (v > maxVal) { maxVal = v; maxKey = key; }
  });
  return HYDRO_TYPES.find((t) => t.key === maxKey);
}

// ── Donut tooltip
function HydroTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const p = payload[0];
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-time" style={{ color: p.payload.color }}>{p.name}</div>
      <div style={{ color: p.payload.color, fontWeight: 700, marginTop: 4 }}>
        {(p.value * 100).toFixed(1)}%
      </div>
    </div>
  );
}

// ── Sparkline tooltip
function HydroSparkTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip" style={{ padding: "5px 8px", fontSize: 11 }}>
      {payload.map((p) => (
        <div key={p.dataKey} style={{ color: p.stroke }}>
          {p.name}: {(p.value * 100).toFixed(0)}%
        </div>
      ))}
    </div>
  );
}

// ── Single-node hydrometeor card
function HydroNodeCard({ nodeId, data, sparkBuffer }) {
  const nodeColor  = NODE_COLORS[nodeId] ?? "#94a3b8";
  const dominant   = getDominantHydro(data);
  const confidence = data?.hydro_confidence ?? data?.confidence ?? 0;

  const donutData = HYDRO_TYPES.map(({ key, label, color }) => ({
    name:  label,
    // clamp to a tiny minimum so segments don't vanish in Recharts
    value: Math.max(0.001, data?.[`hydro_${key}`] ?? (key === "noise" ? 1 : 0)),
    color,
  }));

  return (
    <div className="hydro-node-card" style={{ borderColor: nodeColor + "44" }}>
      {/* Header */}
      <div className="hydro-node-header">
        <span className="hydro-node-id" style={{ color: nodeColor }}>{nodeId}</span>
        {dominant && (
          <span
            className="hydro-dominant-badge"
            style={{
              color:       dominant.color,
              background:  dominant.color + "1a",
              borderColor: dominant.color + "55",
            }}
          >
            ◉ {dominant.label}
          </span>
        )}
      </div>

      {/* Donut chart with center label overlay */}
      <div className="hydro-donut-wrap">
        <ResponsiveContainer width="100%" height={180}>
          <PieChart margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
            <Pie
              data={donutData}
              cx="50%"
              cy="50%"
              innerRadius={52}
              outerRadius={74}
              startAngle={90}
              endAngle={-270}
              dataKey="value"
              isAnimationActive={false}
              paddingAngle={1}
              strokeWidth={0}
            >
              {donutData.map((entry, index) => (
                <Cell key={`hcell-${index}`} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip content={<HydroTooltip />} />
          </PieChart>
        </ResponsiveContainer>

        {/* Absolute center text */}
        <div className="hydro-center">
          {dominant && (
            <>
              <div className="hydro-center-class" style={{ color: dominant.color }}>
                {dominant.label.toUpperCase()}
              </div>
              <div className="hydro-center-conf">
                {(confidence * 100).toFixed(0)}%
              </div>
              <div className="hydro-center-label">confidence</div>
            </>
          )}
        </div>
      </div>

      {/* 30-min sparkline showing how fractions shift */}
      <div className="hydro-sparkline-wrap">
        <div className="hydro-sparkline-title">30-min class trend</div>
        <ResponsiveContainer width="100%" height={72}>
          <LineChart data={sparkBuffer} margin={{ top: 2, right: 4, left: 0, bottom: 0 }}>
            <XAxis dataKey="t" hide />
            <YAxis domain={[0, 1]} hide />
            <Tooltip
              content={<HydroSparkTooltip />}
              cursor={{ stroke: "rgba(255,255,255,0.04)" }}
            />
            {HYDRO_TYPES.map(({ key, label, color }) => (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                stroke={color}
                strokeWidth={1.2}
                dot={false}
                isAnimationActive={false}
                name={label}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>

        {/* Inline legend with live percentages */}
        <div className="hydro-legend">
          {HYDRO_TYPES.map(({ key, label, color }) => {
            const val = data?.[`hydro_${key}`] ?? (key === "noise" ? 1 : 0);
            return (
              <div key={key} className="hydro-legend-chip">
                <div className="hydro-legend-dot" style={{ background: color }} />
                <span style={{ color }}>{label}</span>
                <span className="hydro-legend-pct">{(val * 100).toFixed(0)}%</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Hydrometeor Classification section — all 3 nodes
function HydroSection({ telemetry, hydroBuffers }) {
  return (
    <section className="section">
      <div className="section-heading">
        <Layers size={16} />
        <span>Hydrometeor Type Classification — All Nodes</span>
      </div>
      <div className="hydro-grid">
        {NODE_IDS.map((id) => (
          <HydroNodeCard
            key={id}
            nodeId={id}
            data={telemetry[id]}
            sparkBuffer={hydroBuffers[id]}
          />
        ))}
      </div>
    </section>
  );
}

// ── Piezo waveform tooltip
function PiezoTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip" style={{ padding: "6px 10px" }}>
      <span style={{ color: payload[0].stroke }}>
        {payload[0].value?.toFixed(4)} V·ms
      </span>
    </div>
  );
}

// ── Single-node piezo mini-chart
function PiezoChart({ nodeId, buffer }) {
  const color = NODE_COLORS[nodeId] ?? "#94a3b8";
  const current = buffer[buffer.length - 1];
  const rms   = current?.rms   ?? 0;
  const drops = current?.drops ?? 0;

  return (
    <div className="piezo-chart-wrap">
      <ResponsiveContainer width="100%" height={90}>
        <LineChart data={buffer} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <XAxis dataKey="t" hide />
          <YAxis domain={[0, 10]} hide />
          <Tooltip content={<PiezoTooltip />} cursor={false} />
          <Line
            type="monotone"
            dataKey="rms"
            stroke={color}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
      <div className="piezo-chart-label">
        <span className="piezo-node-id" style={{ color }}>{nodeId}</span>
        <span className="piezo-stat">{rms.toFixed(4)} V·ms</span>
        <span className="piezo-stat">{drops} drops/s</span>
      </div>
    </div>
  );
}

// ── Piezo Waveform section
function PiezoWaveformSection({ piezoBuffers }) {
  return (
    <section className="section">
      <div className="section-heading">
        <Zap size={16} />
        <span>Piezo Waveform — Live 30s</span>
      </div>
      <div className="piezo-grid">
        {NODE_IDS.map((id) => (
          <PiezoChart key={id} nodeId={id} buffer={piezoBuffers[id]} />
        ))}
      </div>
    </section>
  );
}

const BAR_COLORS = ["#38bdf8", "#818cf8", "#34d399", "#fb7185"];

// ── Linear extrapolation using last N points
function extrapolate(points, steps = 6) {
  if (points.length < 2) return [];
  const n = Math.min(10, points.length);
  const recent = points.slice(-n);
  const xs = recent.map((_, i) => i);
  const ys = recent.map((p) => p);
  const xMean = xs.reduce((a, b) => a + b, 0) / n;
  const yMean = ys.reduce((a, b) => a + b, 0) / n;
  const num   = xs.reduce((acc, x, i) => acc + (x - xMean) * (ys[i] - yMean), 0);
  const den   = xs.reduce((acc, x) => acc + (x - xMean) ** 2, 0);
  const slope = den === 0 ? 0 : num / den;
  const intercept = yMean - slope * xMean;
  return Array.from({ length: steps }, (_, i) => {
    const val = intercept + slope * (n + i);
    return Math.max(0, parseFloat(val.toFixed(2)));
  });
}

// ── Rainfall Trend section
function RainfallTrendSection({ rainfallHistory }) {
  // Build unified time-indexed array for the chart
  const allTimestamps = new Set();
  NODE_IDS.forEach((id) => {
    const entries = rainfallHistory[id] ?? [];
    entries.forEach((e) => allTimestamps.add(e.timestamp));
  });
  const sortedTs = Array.from(allTimestamps).sort((a, b) => a - b);

  // Map of ts → { N001, N002, N003 }
  const byTs = {};
  sortedTs.forEach((ts) => { byTs[ts] = { ts }; });
  NODE_IDS.forEach((id) => {
    const entries = rainfallHistory[id] ?? [];
    entries.forEach((e) => {
      if (byTs[e.timestamp]) byTs[e.timestamp][id] = e.rainfall_rate;
    });
  });

  const historicalData = sortedTs.map((ts) => ({
    ...byTs[ts],
    time: new Date(ts * 1000).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false }),
  }));

  // Projection — extend 6 more ticks beyond last actual point
  const lastTs = sortedTs[sortedTs.length - 1] ?? Math.floor(Date.now() / 1000);
  const TICK_INTERVAL = 5; // simulate_node sleeps 5s
  const projectionData = Array.from({ length: 6 }, (_, i) => {
    const ts = lastTs + (i + 1) * TICK_INTERVAL;
    return {
      time: new Date(ts * 1000).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false }),
      ts,
    };
  });

  NODE_IDS.forEach((id) => {
    const vals = historicalData.map((d) => d[id]).filter((v) => v != null);
    const projected = extrapolate(vals, 6);
    projectionData.forEach((d, i) => {
      d[`${id}_proj`] = projected[i] ?? null;
    });
  });

  // Junction point — last actual values carried into first projection point
  if (historicalData.length > 0 && projectionData.length > 0) {
    const last = historicalData[historicalData.length - 1];
    NODE_IDS.forEach((id) => {
      projectionData[0][`${id}_proj`] = last[id] ?? projectionData[0][`${id}_proj`];
    });
  }

  const combinedData = [...historicalData, ...projectionData];
  const projStart = historicalData.length > 0
    ? historicalData[historicalData.length - 1].time
    : null;
  const projEnd = projectionData.length > 0
    ? projectionData[projectionData.length - 1].time
    : null;

  // Peak rainfall panel — last 10 history entries across all nodes
  let peak = { value: 0, nodeId: "—", time: "—" };
  NODE_IDS.forEach((id) => {
    const entries = (rainfallHistory[id] ?? []).slice(-10);
    entries.forEach((e) => {
      if (e.rainfall_rate > peak.value) {
        peak = {
          value: e.rainfall_rate,
          nodeId: id,
          time: new Date(e.timestamp * 1000).toLocaleTimeString("en-IN", {
            hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
          }),
        };
      }
    });
  });

  const hasData = historicalData.length > 0;

  return (
    <section className="section">
      <div className="section-heading">
        <TrendingUp size={16} />
        <span>Rainfall Trend — All Nodes</span>
      </div>

      <div className="chart-wrapper">
        {!hasData ? (
          <div className="empty-state" style={{ padding: "40px" }}>
            <Radio size={28} />
            <span>Waiting for history data…</span>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={combinedData} margin={{ top: 8, right: 20, left: 0, bottom: 0 }}>
              <XAxis
                dataKey="time"
                tick={{ fill: "#94a3b8", fontSize: 11 }}
                axisLine={{ stroke: "#1e2d45" }}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fill: "#94a3b8", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                unit=" mm"
                width={52}
              />
              <Tooltip content={<CustomTooltip />} cursor={{ stroke: "rgba(255,255,255,0.06)", strokeWidth: 1 }} />
              <Legend
                formatter={(value) => {
                  const id = value.replace("_proj", "");
                  return (
                    <span style={{ color: NODE_COLORS[id] ?? "#94a3b8", fontSize: 12 }}>
                      {value.includes("_proj") ? `${id} (projected)` : id}
                    </span>
                  );
                }}
                wrapperStyle={{ paddingTop: 12 }}
              />

              {/* Cloudburst threshold */}
              <ReferenceLine
                y={100}
                stroke="#ef4444"
                strokeDasharray="5 4"
                strokeWidth={1.5}
                label={{ value: "Cloudburst Threshold", fill: "#ef4444", fontSize: 10, position: "insideTopRight" }}
              />

              {/* Projection amber shading */}
              {projStart && projEnd && (
                <ReferenceArea
                  x1={projStart}
                  x2={projEnd}
                  fill="rgba(245,158,11,0.07)"
                  stroke="none"
                />
              )}

              {/* Actual lines */}
              {NODE_IDS.map((id) => (
                <Line
                  key={id}
                  type="monotone"
                  dataKey={id}
                  stroke={NODE_COLORS[id]}
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                  name={id}
                  isAnimationActive={false}
                />
              ))}

              {/* Projected dashed lines */}
              {NODE_IDS.map((id) => (
                <Line
                  key={`${id}_proj`}
                  type="monotone"
                  dataKey={`${id}_proj`}
                  stroke={NODE_COLORS[id]}
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                  dot={false}
                  connectNulls
                  name={`${id}_proj`}
                  isAnimationActive={false}
                />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Peak Rainfall Panel */}
      <div className="peak-panel">
        <div className="peak-label">Peak (last 10 readings)</div>
        <div className="peak-value" style={{ color: getRainfallColor(peak.value) }}>
          {peak.value.toFixed(1)} mm/hr
        </div>
        <div className="peak-meta">
          <span
            className="peak-node"
            style={{ color: NODE_COLORS[peak.nodeId] ?? "var(--muted)" }}
          >
            {peak.nodeId}
          </span>
          <span className="peak-time">{peak.time}</span>
        </div>
      </div>
    </section>
  );
}

// ── Sensor Agreement Badge
function SensorAgreementBadge({ data }) {
  const piezoRain  = (data?.piezo_drop_count  ?? 0) > 2;
  const opticalRain = (data?.optical_interruptions ?? 0) > 2;
  const agree = piezoRain === opticalRain;
  return agree ? (
    <div className="sensor-badge sensor-badge--agree">✓ Sensors Agree</div>
  ) : (
    <div className="sensor-badge sensor-badge--mismatch">⚠ Sensor Mismatch — Check Node</div>
  );
}

// ── Optical signal tooltip
function OpticalTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip" style={{ padding: "6px 10px" }}>
      <span style={{ color: payload[0].stroke }}>
        {payload[0].value?.toFixed(3)}
      </span>
    </div>
  );
}

// ── Single-node optical mini-chart
function OpticalChart({ nodeId, buffer }) {
  const color        = NODE_COLORS[nodeId] ?? "#94a3b8";
  const current      = buffer[buffer.length - 1];
  const signal       = current?.signal       ?? 0.95;
  const interruptions = current?.interruptions ?? 0;

  return (
    <div className="piezo-chart-wrap">
      <ResponsiveContainer width="100%" height={90}>
        <LineChart data={buffer} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <XAxis dataKey="t" hide />
          {/* Tight Y range — makes dry flatline vs rainy drops visually dramatic */}
          <YAxis domain={[0.2, 1.0]} hide />
          <Tooltip content={<OpticalTooltip />} cursor={false} />
          <Line
            type="monotone"
            dataKey="signal"
            stroke={color}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
      <div className="piezo-chart-label">
        <span className="piezo-node-id" style={{ color }}>{nodeId}</span>
        <span className="piezo-stat">{signal.toFixed(3)} signal</span>
        <div className="optical-breaks-wrap">
          <span className="optical-breaks-count" style={{ color }}>{interruptions}</span>
          <span className="optical-breaks-label">Beam breaks/sec</span>
        </div>
      </div>
    </div>
  );
}

// ── Optical Signal section
function OpticalSignalSection({ opticalBuffers }) {
  return (
    <section className="section">
      <div className="section-heading">
        <Aperture size={16} />
        <span>Optical Signal — Live 30s</span>
      </div>
      <div className="piezo-grid">
        {NODE_IDS.map((id) => (
          <OpticalChart key={id} nodeId={id} buffer={opticalBuffers[id]} />
        ))}
      </div>
    </section>
  );
}

// ── Byzantine Consensus Meter
function ConsensusMeter({ alert, statusCfg }) {
  const votes     = alert.votes ?? [];
  const voteCount = votes.length;

  // Bar fill: 0 → 0%, 1 → 33%, 2+ → 66%
  const fillPct   = voteCount === 0 ? 0 : voteCount === 1 ? 33 : 66;
  const barColor  = voteCount === 0 ? "var(--border)"
                  : voteCount === 1 ? "#f59e0b"
                  : "#ef4444";
  const pulsing   = voteCount >= 2;

  const consensusLabel = voteCount >= 2 ? "CONSENSUS REACHED"
                       : voteCount === 1 ? "AWAITING CORROBORATION"
                       : "MONITORING";
  const labelColor = voteCount >= 2 ? "#ef4444"
                   : voteCount === 1 ? "#f59e0b"
                   : "var(--text-dim)";

  return (
    <div className="consensus-meter">
      {/* Label row */}
      <div className="consensus-label-row">
        <span className="consensus-count" style={{ color: labelColor }}>
          {voteCount} / 3 nodes confirming
        </span>
        <span className="consensus-status" style={{ color: labelColor }}>
          {consensusLabel}
        </span>
      </div>

      {/* Progress bar */}
      <div className="consensus-track">
        <div
          className={`consensus-fill${pulsing ? " consensus-fill--pulse" : ""}`}
          style={{ width: `${fillPct}%`, background: barColor }}
        />
      </div>

      {/* Node boxes */}
      <div className="consensus-nodes">
        {NODE_IDS.map((id) => {
          const active = votes.includes(id);
          return (
            <div
              key={id}
              className={`consensus-node-box${active ? " consensus-node-box--active" : ""}`}
              style={active ? {
                color:       statusCfg.color,
                background:  statusCfg.color + "18",
                borderColor: statusCfg.color + "66",
              } : {}}
            >
              {id}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Single cascade row with live countdown
function CascadeRow({ nodeId, entry }) {
  const delayTotal = (entry.delay_minutes ?? 0) * 60; // total seconds
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, entry.arrival_epoch - Math.floor(Date.now() / 1000))
  );

  useEffect(() => {
    const id = setInterval(() => {
      setRemaining(Math.max(0, entry.arrival_epoch - Math.floor(Date.now() / 1000)));
    }, 1000);
    return () => clearInterval(id);
  }, [entry.arrival_epoch]);

  const arrived   = remaining === 0;
  const elapsed   = Math.max(0, delayTotal - remaining);
  const progress  = delayTotal > 0 ? Math.min(100, (elapsed / delayTotal) * 100) : 100;
  const barColor  = arrived ? "#ef4444" : "#f59e0b";
  const mins      = Math.floor(remaining / 60);
  const secs      = remaining % 60;
  const countdownText = arrived
    ? "⚠ ARRIVED"
    : `${mins}m ${String(secs).padStart(2, "0")}s`;

  return (
    <div className="cascade-row">
      <div className="cascade-row-header">
        <div className="cascade-node-info">
          <span className="cascade-node-id" style={{ color: NODE_COLORS[nodeId] ?? "#94a3b8" }}>
            {nodeId}
          </span>
          <span className="cascade-elev">▲ {entry.dest_elev}m</span>
        </div>
        <span
          className={`cascade-countdown${arrived ? " cascade-countdown--arrived" : ""}`}
          style={{ color: arrived ? "#ef4444" : "#f59e0b" }}
        >
          {countdownText}
        </span>
      </div>

      <div className="cascade-progress-track">
        <div
          className="cascade-progress-fill"
          style={{ width: `${progress}%`, background: barColor }}
        />
      </div>

      <div className="cascade-meta">
        Wave speed 11.5 km/hr · Manning's n=0.04
      </div>
    </div>
  );
}

// ── Lead-Time Countdown — catchment parameters (Kirpich formula, Chikmagalur District)
// Concentrations times calibrated from CWC Bhadra basin DEM + field survey data.
const RAIN_THRESHOLD_LTC = 5; // mm/hr — below this rate, threat is not active

const CATCHMENTS_LTC = [
  {
    id:           "C-UPPER",
    name:         "Upper Bhadra",
    subtitle:     "Node N001 · 1 800 m",
    node:         "N001",
    drivingNodes: ["N001"],
    L:            1500,     // channel length (m) — steep Western Ghats slope
    S:            0.22,     // slope (m/m) — high-gradient forested ravine
    area_ha:      210,      // sub-catchment area (ha)
    C:            0.58,     // rational-method runoff coefficient
  },
  {
    id:           "C-MID",
    name:         "Coffee Estate Belt",
    subtitle:     "Nodes N001–N002 · 1 100 m",
    node:         "N002",
    drivingNodes: ["N001", "N002"],
    L:            3200,     // channel + overland flow path (m)
    S:            0.13,     // moderate laterite hillside
    area_ha:      480,
    C:            0.52,
  },
  {
    id:           "C-LOWER",
    name:         "Bhadra Valley Floor",
    subtitle:     "Nodes N001–N003 · 750 m",
    node:         "N003",
    drivingNodes: ["N001", "N002", "N003"],
    L:            5200,     // full valley path to Bhadra confluence (m)
    S:            0.09,     // gentle valley floor
    area_ha:      920,
    C:            0.46,
  },
];

/** Kirpich concentration time (minutes). L in metres, S in m/m. */
function kirpichTc(L, S) {
  return 0.0663 * Math.pow(L, 0.77) * Math.pow(S, -0.385);
}

/** Max rain rate across a catchment's driving nodes (conservative upper bound). */
function ltcCatchmentRain(catchment, telemetry) {
  const vals = catchment.drivingNodes.map((id) => telemetry[id]?.rainfall_rate ?? 0);
  return Math.max(0, ...vals);
}

/**
 * Time-to-peak (minutes) from Kirpich Tc adjusted for:
 *   - rainfall intensity  (higher rain → faster saturation → shorter Tc)
 *   - antecedent moisture (PEAK phase → nearly saturated → shorter Tc)
 */
function ltcTpeak(catchment, rain, phase) {
  const tc      = kirpichTc(catchment.L, catchment.S);
  const rainFac = Math.max(0.40, 1.0 - rain / 250);
  const moistFac = phase === "PEAK"     ? 0.75
                 : phase === "DRAINING" ? 0.85
                 : phase === "RAMPING"  ? 0.90
                 : 1.00; // IDLE
  return Math.max(1, tc * rainFac * moistFac);
}

/** Peak flow estimate (m³/s) via Modified Rational Method: Q = C·I·A / 360 */
function ltcQpeak(catchment, rain, phase) {
  const C = Math.min(0.95, catchment.C * (
    phase === "PEAK"     ? 1.25 :
    phase === "DRAINING" ? 1.15 : 1.0
  ));
  return Math.max(0, C * rain * catchment.area_ha / 360);
}

/** Model confidence 0–1 based on fraction of driving nodes actively reporting. */
function ltcConfidence(catchment, telemetry) {
  const active = catchment.drivingNodes.filter(
    (id) => (telemetry[id]?.rainfall_rate ?? 0) > 2
  ).length;
  const total = catchment.drivingNodes.length;
  return total === 0 ? 0.5 : 0.55 + (active / total) * 0.35;
}

// ── Village Flood Risk — single row with live countdown
function VillageRow({ village, alertStatus, warningFiredAt }) {
  const risk    = village.riskByStatus[alertStatus] ?? "MONITOR";
  const isEvac  = risk === "EVACUATE NOW";
  const isPrep  = risk === "PREPARE";

  // Countdown: only active during WARNING
  const [remaining, setRemaining] = useState(null);

  useEffect(() => {
    if (alertStatus !== "WARNING" || !warningFiredAt) {
      setRemaining(null);
      return;
    }
    const baseSecs = village.baseMins * 60;
    const calc = () => {
      const elapsed = Math.floor(Date.now() / 1000) - warningFiredAt;
      setRemaining(Math.max(0, baseSecs - elapsed));
    };
    calc();
    const id = setInterval(calc, 1000);
    return () => clearInterval(id);
  }, [alertStatus, warningFiredAt, village.baseMins]);

  const arrived = remaining === 0;
  const mins    = remaining != null ? Math.floor(remaining / 60) : null;
  const secs    = remaining != null ? remaining % 60 : null;

  let countdownDisplay;
  if (alertStatus !== "WARNING" || remaining === null) {
    // Static estimate when not WARNING
    countdownDisplay = (
      <span className="village-countdown-static">~{village.baseMins} min</span>
    );
  } else if (arrived) {
    countdownDisplay = (
      <span className="village-countdown--arrived">⚠ Impact Imminent</span>
    );
  } else {
    countdownDisplay = (
      <span className="village-countdown--live">
        {mins}m {String(secs).padStart(2, "0")}s
      </span>
    );
  }

  return (
    <div className={`village-row${isEvac ? " village-row--evacuate" : ""}`}>
      <div className="village-name">
        <MapPin size={12} style={{ flexShrink: 0, color: "var(--text-dim)" }} />
        <span>{village.name}</span>
      </div>
      <div className="village-dist">{village.distKm} km · {village.nearestNode}</div>
      <div className="village-time">{countdownDisplay}</div>
      <div className="village-risk-wrap">
        <span
          className={`village-risk-badge village-risk--${
            isEvac ? "evacuate" : isPrep ? "prepare" : "monitor"
          }`}
        >
          {risk}
        </span>
      </div>
    </div>
  );
}

// ── Lead-Time Countdown — single catchment card
function LeadTimeCatchmentCard({ c, rank }) {
  const { remainingSec, threatActive, qPeak, confidence, activeDrivingNodes, color } = c;

  const urgency = !threatActive        ? "subsiding"
    : remainingSec < 600               ? "critical"   // < 10 min
    : remainingSec < 1800              ? "high"        // 10–30 min
    : remainingSec < 3600              ? "moderate"    // 30–60 min
    : "low";                                           // > 60 min

  const URGENCY_COLOR = {
    subsiding: "#6b7280",
    critical:  "#ef4444",
    high:      "#f97316",
    moderate:  "#f59e0b",
    low:       "#22c55e",
  };
  const uColor = URGENCY_COLOR[urgency];

  const h   = Math.floor(remainingSec / 3600);
  const m   = Math.floor((remainingSec % 3600) / 60);
  const s   = remainingSec % 60;
  const hms = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;

  return (
    <div className={`ltc-card ltc-card--${urgency}`}>
      {/* ── Header: rank · name · node badge */}
      <div className="ltc-card-header">
        <div className="ltc-rank">{rank}</div>
        <div className="ltc-name-block">
          <span className="ltc-catchment-name">{c.name}</span>
          <span className="ltc-catchment-sub">{c.subtitle}</span>
        </div>
        <span className="ltc-node-badge" style={{ color }}>{c.node}</span>
      </div>

      {/* ── Primary: HH:MM:SS countdown or THREAT SUBSIDING */}
      <div className="ltc-timer-row">
        {threatActive ? (
          <span className="ltc-hms" style={{ color: uColor }}>{hms}</span>
        ) : (
          <span className="ltc-subsiding">THREAT SUBSIDING</span>
        )}
        <span className="ltc-urgency-badge" style={{ color: uColor }}>
          {urgency === "subsiding" ? "SUBSIDING" : urgency.toUpperCase()}
        </span>
      </div>

      {/* ── Meta: peak flow · confidence · driving nodes */}
      <div className="ltc-meta-row">
        <div className="ltc-meta-item">
          <span className="ltc-meta-label">Peak Flow</span>
          <span className="ltc-meta-value">{qPeak.toFixed(1)} m³/s</span>
        </div>
        <div className="ltc-meta-item">
          <span className="ltc-meta-label">Confidence</span>
          <span className="ltc-meta-value">{(confidence * 100).toFixed(0)}%</span>
        </div>
        <div className="ltc-meta-item">
          <span className="ltc-meta-label">Driving Nodes</span>
          <span className="ltc-meta-value ltc-meta-nodes">
            {activeDrivingNodes.length > 0 ? activeDrivingNodes.join(", ") : "—"}
          </span>
        </div>
      </div>

      {/* ── Rain intensity bar */}
      <div className="ltc-rain-bar-wrap">
        <div className="ltc-rain-bar-track">
          <div
            className="ltc-rain-bar-fill"
            style={{ width: `${Math.min(100, c.rain)}%`, background: uColor }}
          />
        </div>
        <span className="ltc-rain-label">{c.rain.toFixed(1)} mm/hr</span>
      </div>
    </div>
  );
}

// ── Lead-Time Countdown Panel — operationally paired with Village Flood Risk
function LeadTimePanel({ telemetry }) {
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [nowSec,       setNowSec]       = useState(() => Math.floor(Date.now() / 1000));
  const alertFiredRef  = useRef({});   // catchmentId → bool: has 10-min alert fired?
  const lastTelSecRef  = useRef(Math.floor(Date.now() / 1000));
  const tPeakSnapRef   = useRef({});   // catchmentId → snapshotSec at last telemetry update
  const prevActiveRef  = useRef({});   // catchmentId → was threatActive on last render?
  const [concludedLog, setConcludedLog] = useState([]); // local session event archive

  // 1 s tick drives the countdown display
  useEffect(() => {
    const id = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  // Recompute Tc snapshot whenever Firebase telemetry updates (~5 s)
  useEffect(() => {
    const snapSec = Math.floor(Date.now() / 1000);
    lastTelSecRef.current = snapSec;
    CATCHMENTS_LTC.forEach((c) => {
      const rain  = ltcCatchmentRain(c, telemetry);
      const phase = telemetry[c.node]?.phase ?? "IDLE";
      tPeakSnapRef.current[c.id] = Math.round(ltcTpeak(c, rain, phase) * 60);
    });
  }, [telemetry]);

  const elapsed = nowSec - lastTelSecRef.current;

  // Derive live state for each catchment
  const catchmentStates = CATCHMENTS_LTC.map((c) => {
    const rain             = ltcCatchmentRain(c, telemetry);
    const phase            = telemetry[c.node]?.phase ?? "IDLE";
    const threatActive     = rain >= RAIN_THRESHOLD_LTC;
    const snapshotSec      = tPeakSnapRef.current[c.id]
                             ?? Math.round(ltcTpeak(c, rain, phase) * 60);
    const remainingSec     = threatActive ? Math.max(0, snapshotSec - elapsed) : 0;
    const qPeak            = ltcQpeak(c, rain, phase);
    const confidence       = ltcConfidence(c, telemetry);
    const activeDrivingNodes = c.drivingNodes.filter(
      (id) => (telemetry[id]?.rainfall_rate ?? 0) >= RAIN_THRESHOLD_LTC
    );
    const color = NODE_COLORS[c.node] ?? "#94a3b8";
    return { ...c, rain, phase, threatActive, remainingSec, qPeak, confidence, activeDrivingNodes, color };
  });

  // Most-urgent active threat first; subsiding catchments at the bottom
  catchmentStates.sort((a, b) => {
    if (a.threatActive && !b.threatActive) return -1;
    if (!a.threatActive && b.threatActive) return  1;
    return a.remainingSec - b.remainingSec;
  });

  // Audio + concluded-event tracking (runs after render)
  useEffect(() => {
    catchmentStates.forEach((c) => {
      const wasActive = prevActiveRef.current[c.id] ?? false;

      // Threat just cleared → log to session archive
      if (wasActive && !c.threatActive) {
        const ts = new Date().toLocaleTimeString("en-IN", {
          hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
        });
        setConcludedLog((prev) => [
          { id: c.id, name: c.name, ts, peak: c.qPeak },
          ...prev.slice(0, 9),
        ]);
        alertFiredRef.current[c.id] = false;
      }

      // 10-min threshold: fire audible alert once per event
      if (audioEnabled && c.threatActive && c.remainingSec <= 600 && !alertFiredRef.current[c.id]) {
        alertFiredRef.current[c.id] = true;
        new Audio(alertSound).play().catch(() => {});
      }
      // Reset fired flag when threat clears or time climbs back above 10 min
      if (!c.threatActive || c.remainingSec > 600) {
        alertFiredRef.current[c.id] = false;
      }

      prevActiveRef.current[c.id] = c.threatActive;
    });
  }, [catchmentStates, audioEnabled]);

  return (
    <section className="section">
      <div className="section-heading">
        <Timer size={16} />
        <span>Lead-Time Countdown — Time to Peak Flow</span>
        <button
          className={`ltc-audio-btn${audioEnabled ? " ltc-audio-btn--on" : ""}`}
          onClick={() => setAudioEnabled((v) => !v)}
          title={audioEnabled ? "Mute 10-min threshold alerts" : "Enable 10-min threshold alerts"}
        >
          {audioEnabled ? <Volume2 size={13} /> : <VolumeX size={13} />}
        </button>
      </div>

      <div className="ltc-list">
        {catchmentStates.map((c, i) => (
          <LeadTimeCatchmentCard key={c.id} c={c} rank={i + 1} />
        ))}
      </div>

      {concludedLog.length > 0 && (
        <div className="ltc-concluded">
          <div className="ltc-concluded-title">Concluded events — this session</div>
          {concludedLog.map((e, i) => (
            <div key={i} className="ltc-concluded-row">
              <span className="ltc-concluded-ts">{e.ts}</span>
              <span className="ltc-concluded-sep">│</span>
              <span className="ltc-concluded-name">{e.name}</span>
              <span className="ltc-concluded-sep">│</span>
              <span className="ltc-concluded-detail">threat cleared · est. peak {e.peak.toFixed(1)} m³/s</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ── Village Flood Risk Table section
function VillageFloodRiskTable({ alert, warningFiredAt }) {
  return (
    <section className="section">
      <div className="section-heading">
        <Users size={16} />
        <span>Village Flood Risk — Chikmagalur District</span>
      </div>

      {/* Column headers */}
      <div className="village-table-header">
        <div className="village-col-name">Village</div>
        <div className="village-col-dist">Distance</div>
        <div className="village-col-time">Time to Impact</div>
        <div className="village-col-risk">Risk Level</div>
      </div>

      <div className="village-table-body">
        {VILLAGES.map((v) => (
          <VillageRow
            key={v.name}
            village={v}
            alertStatus={alert.status}
            warningFiredAt={warningFiredAt}
          />
        ))}
      </div>
    </section>
  );
}

// ── Predictive Analytics — Flood Gauge sub-component
function FloodGauge({ floodMm }) {
  const capped = Math.min(floodMm, 700); // cap for gauge rendering
  const maxMm  = 700;
  const pct    = (capped / maxMm) * 100;

  const zoneColor =
    floodMm >= 500 ? "#ef4444"
    : floodMm >= 200 ? "#f59e0b"
    : "#22c55e";

  return (
    <div className="flood-gauge-wrap">
      <div className="flood-gauge-bar-container">
        {/* Zone segments — drawn bottom to top */}
        <div className="flood-gauge-zone flood-gauge-zone--red"   />
        <div className="flood-gauge-zone flood-gauge-zone--amber" />
        <div className="flood-gauge-zone flood-gauge-zone--green" />
        {/* Fill overlay */}
        <div
          className="flood-gauge-fill"
          style={{ height: `${pct}%`, background: zoneColor }}
        />
        {/* Zone labels */}
        <div className="flood-gauge-label flood-gauge-label--top">500+mm</div>
        <div className="flood-gauge-label flood-gauge-label--mid">200mm</div>
        <div className="flood-gauge-label flood-gauge-label--bot">0mm</div>
      </div>

      <div className="flood-gauge-reading">
        <span className="flood-gauge-value" style={{ color: zoneColor }}>
          {floodMm.toFixed(0)}
        </span>
        <span className="flood-gauge-unit">mm</span>
        <div className="flood-gauge-sub">4-hr projection</div>
        <div className="flood-gauge-caveat">±25% uncertainty</div>
      </div>
    </div>
  );
}

// ── Predictive Analytics — KE Flux panel
function KEFluxPanel({ telemetry }) {
  const THRESHOLD = 800;

  const entries = NODE_IDS.map((id) => {
    const d   = telemetry[id] ?? {};
    const rms = d.piezo_rms        ?? 0;
    const drp = d.piezo_drop_count ?? 0;
    const flux = parseFloat((rms * drp * 0.42).toFixed(1));
    return { id, flux, over: flux >= THRESHOLD };
  });

  return (
    <div className="ke-flux-wrap">
      <div className="ke-flux-heading">Kinetic Energy Flux</div>
      <div className="ke-flux-unit-label">J / m² / hr per node</div>

      {entries.map(({ id, flux, over }) => (
        <div key={id} className={`ke-flux-row${over ? " ke-flux-row--over" : ""}`}>
          <span className="ke-flux-node-id" style={{ color: NODE_COLORS[id] }}>
            {id}
          </span>
          <div className="ke-flux-bar-track">
            <div
              className="ke-flux-bar-fill"
              style={{
                width: `${Math.min(100, (flux / 1200) * 100)}%`,
                background: over ? "#ef4444" : NODE_COLORS[id],
              }}
            />
            {/* Threshold line at 800/1200 = 66.67% */}
            <div className="ke-flux-threshold-line" style={{ left: "66.67%" }} />
          </div>
          <span className="ke-flux-value" style={{ color: over ? "#ef4444" : "var(--text)" }}>
            {flux}
          </span>
          {over && (
            <span className="ke-flux-over-badge">⚠</span>
          )}
        </div>
      ))}

      <div className="ke-flux-threshold-label">
        <div className="ke-flux-threshold-dash" />
        <span>Landslide initiation risk · 800 J/m²/hr</span>
      </div>
    </div>
  );
}

// ── Predictive Analytics section
function PredictiveAnalyticsSection({ telemetry }) {
  // Average rainfall across reporting nodes
  const rainfallVals = NODE_IDS
    .map((id) => telemetry[id]?.rainfall_rate)
    .filter((v) => v != null);
  const avgRainfall = rainfallVals.length
    ? rainfallVals.reduce((a, b) => a + b, 0) / rainfallVals.length
    : 0;

  const floodMm = parseFloat((avgRainfall * 4 * 0.65).toFixed(1));

  return (
    <section className="section">
      <div className="section-heading">
        <FlaskConical size={16} />
        <span>Predictive Analytics</span>
      </div>

      <div className="predictive-panels">
        {/* Left: Flood level gauge */}
        <div className="predictive-panel">
          <div className="predictive-panel-title">4-Hour Flood Level Projection</div>
          <div className="predictive-panel-formula">
            flood_mm = avgRainfall × 4 × 0.65
          </div>
          <FloodGauge floodMm={floodMm} />
        </div>

        {/* Divider */}
        <div className="predictive-divider" />

        {/* Right: KE Flux */}
        <div className="predictive-panel">
          <div className="predictive-panel-title">Kinetic Energy Flux</div>
          <div className="predictive-panel-formula">
            ke_flux = piezo_rms × drops × 0.42
          </div>
          <KEFluxPanel telemetry={telemetry} />
        </div>
      </div>
    </section>
  );
}

// ── Alert Escalation Matrix — constants & helpers ──────────────────────────

// Static catchment vulnerability per node (Chikmagalur District domain knowledge)
const NODE_VULNERABILITY = {
  N001: { level: "HIGH",   score: 2 }, // Baba Budangiri   — dense forest, 1800 m
  N002: { level: "MEDIUM", score: 1 }, // Coffee Belt      — laterite soil, 1100 m
  N003: { level: "LOW",    score: 0 }, // Bhadra Valley    — floodplain,    750 m
};

// X-axis: Rainfall intensity thresholds
const AEM_INTENSITY_LEVELS = [
  { label: "Low",      range: "< 20 mm/hr",  maxRain: 20       },
  { label: "Moderate", range: "20–70 mm/hr", maxRain: 70       },
  { label: "Extreme",  range: "> 70 mm/hr",  maxRain: Infinity },
];

// Y-axis: row 0 = highest vulnerability (top of grid)
const AEM_VULN_LABELS = ["High", "Medium", "Low"];

// Risk matrix [vulnRow 0=High…2=Low][intensityCol 0=Low…2=Extreme]
const AEM_RISK_MATRIX = [
  ["MEDIUM", "HIGH",   "CRITICAL"], // High vulnerability
  ["LOW",    "MEDIUM", "HIGH"],     // Medium vulnerability
  ["LOW",    "LOW",    "MEDIUM"],   // Low vulnerability
];

const AEM_RISK_CONFIG = {
  LOW:      { label: "Low",      color: "#22c55e", bg: "rgba(34,197,94,0.10)",   border: "#15803d" },
  MEDIUM:   { label: "Medium",   color: "#f59e0b", bg: "rgba(245,158,11,0.10)", border: "#b45309" },
  HIGH:     { label: "High",     color: "#f97316", bg: "rgba(249,115,22,0.10)", border: "#c2410c" },
  CRITICAL: { label: "Critical", color: "#ef4444", bg: "rgba(239,68,68,0.10)",  border: "#b91c1c" },
};

// Explanatory text for the click-reveal panel
const AEM_VULN_DESCS = [
  "Dense forest at 1800 m (N001 · Baba Budangiri) — saturated laterite slopes, 3000 mm+ annual rainfall, steep Western Ghats gradient",
  "Coffee estate belt at 1100 m (N002 · Coffee Belt) — shallow red soil, reduced infiltration under high intensity rain, moderate slope",
  "Valley floor at 750 m (N003 · Bhadra Valley) — wider floodplain, irrigation channels, natural attenuation, lower gradient",
];
const AEM_INTENSITY_DESCS = [
  "Low (< 20 mm/hr) — within typical soil infiltration capacity, minimal surface runoff expected",
  "Moderate (20–70 mm/hr) — exceeds infiltration threshold, significant surface runoff begins",
  "Extreme (> 70 mm/hr) — fully saturates catchment, near-total surface runoff, flash flood potential",
];
const AEM_RISK_NARRATIVES = {
  LOW:      "Risk is within manageable bounds. Standard monitoring protocols are sufficient — no immediate protective action required.",
  MEDIUM:   "Elevated flood potential. Downstream communities should receive early notification and prepare evacuation routes. Field teams on standby.",
  HIGH:     "High flood risk confirmed. Evacuation advisory strongly recommended for all villages in the impact corridor. Active emergency coordination required.",
  CRITICAL: "Critical threat — imminent catastrophic flooding. All downstream communities must evacuate immediately. Emergency response fully activated.",
};

// Antecedent moisture proxy derived from the dominant node phase
function getAntecedentMoisture(telemetry) {
  const phases = NODE_IDS.map((id) => telemetry[id]?.phase).filter(Boolean);
  if (phases.includes("PEAK"))     return 0.88;
  if (phases.includes("DRAINING")) return 0.72;
  if (phases.includes("RAMPING"))  return 0.48;
  return 0.15;
}

// ── Alert Escalation Matrix component
function AlertEscalationMatrix({ telemetry, alert }) {
  const [selectedCell, setSelectedCell] = useState(null);

  // Status config — reads the same Firebase alert as the existing Alert Status panel
  const statusCfg  = STATUS_CONFIG[alert.status] ?? STATUS_CONFIG.NORMAL;
  const StatusIcon = statusCfg.icon;

  // Active intensity column from max rainfall across all nodes
  const maxRainfall       = Math.max(0, ...NODE_IDS.map((id) => telemetry[id]?.rainfall_rate ?? 0));
  const activeIntensityCol = maxRainfall < 20 ? 0 : maxRainfall < 70 ? 1 : 2;

  // Active vulnerability row from highest-vulnerability raining node
  const rainingNodes = NODE_IDS.filter((id) => (telemetry[id]?.rainfall_rate ?? 0) > 2);
  const leadNode = rainingNodes.length > 0
    ? rainingNodes.reduce((a, b) =>
        (NODE_VULNERABILITY[a]?.score ?? 0) > (NODE_VULNERABILITY[b]?.score ?? 0) ? a : b)
    : NODE_IDS[0];
  // score 2=High→row 0, score 1=Med→row 1, score 0=Low→row 2
  const activeVulnRow = 2 - (NODE_VULNERABILITY[leadNode]?.score ?? 0);

  const moisture     = getAntecedentMoisture(telemetry);
  const activeRisk   = AEM_RISK_MATRIX[activeVulnRow][activeIntensityCol];
  const activeRcfg   = AEM_RISK_CONFIG[activeRisk];

  const selectedRisk = selectedCell ? AEM_RISK_MATRIX[selectedCell[0]][selectedCell[1]] : null;
  const selectedRcfg = selectedRisk ? AEM_RISK_CONFIG[selectedRisk] : null;

  const handleCellClick = (vIdx, iIdx) => {
    setSelectedCell((prev) =>
      prev?.[0] === vIdx && prev?.[1] === iIdx ? null : [vIdx, iIdx]
    );
  };

  return (
    <section className="section">
      <div className="section-heading">
        <ShieldAlert size={16} />
        <span>Alert Status &amp; Risk Matrix</span>
      </div>

      {/* ── Combined status + risk cell — absorbs standalone Alert Status panel ── */}
      <div
        className="alert-panel"
        style={{ borderColor: statusCfg.border, background: statusCfg.bg }}
      >
        <div className="alert-left">
          <StatusIcon size={36} style={{ color: statusCfg.color }} />
          <div>
            <div className="alert-status" style={{ color: statusCfg.color }}>
              {alert.status}
            </div>
            <div className="alert-desc">
              {alert.status === "WARNING" && "Immediate action required"}
              {alert.status === "WATCH"   && "Monitor situation closely"}
              {alert.status === "NORMAL"  && "All systems nominal"}
            </div>
            <div className="aem-inline-cell">
              <span className="aem-inline-pre">Risk matrix:</span>
              <span
                className="aem-active-cell-chip"
                style={{
                  color:       activeRcfg.color,
                  background:  activeRcfg.bg,
                  borderColor: activeRcfg.border + "88",
                }}
              >
                ● {AEM_VULN_LABELS[activeVulnRow]} · {AEM_INTENSITY_LEVELS[activeIntensityCol].label} → {activeRisk} RISK
              </span>
            </div>
          </div>
        </div>
        <ConsensusMeter alert={alert} statusCfg={statusCfg} />
      </div>

      {/* ── 3×3 grid ── */}
      <div className="aem-wrap">
        <div className="aem-y-axis-title">↑ Catchment Vulnerability</div>

        <div className="aem-matrix-outer">
          {AEM_VULN_LABELS.map((vulnLabel, vIdx) => (
            <div key={vIdx} className="aem-row">
              <div className="aem-y-label">{vulnLabel}</div>

              {AEM_INTENSITY_LEVELS.map((_, iIdx) => {
                const risk     = AEM_RISK_MATRIX[vIdx][iIdx];
                const rcfg     = AEM_RISK_CONFIG[risk];
                const isActive   = vIdx === activeVulnRow && iIdx === activeIntensityCol;
                const isSelected = selectedCell?.[0] === vIdx && selectedCell?.[1] === iIdx;

                return (
                  <div
                    key={iIdx}
                    className={`aem-cell${isActive ? " aem-cell--active" : ""}${isSelected ? " aem-cell--selected" : ""}`}
                    style={{
                      background:  rcfg.bg,
                      borderColor: isActive
                        ? rcfg.border
                        : isSelected
                        ? rcfg.border + "99"
                        : "rgba(255,255,255,0.04)",
                      // per-cell glow colour used by keyframe animation
                      "--aem-glow": rcfg.color,
                    }}
                    onClick={() => handleCellClick(vIdx, iIdx)}
                  >
                    <span className="aem-risk-text" style={{ color: rcfg.color }}>
                      {rcfg.label}
                    </span>

                    {/* Antecedent moisture saturation bar */}
                    <div className="aem-moisture-track">
                      <div
                        className="aem-moisture-fill"
                        style={{ width: `${moisture * 100}%`, background: rcfg.color }}
                      />
                    </div>

                    {/* Active indicator pip */}
                    {isActive && (
                      <div className="aem-active-pip" style={{ background: rcfg.border }} />
                    )}
                  </div>
                );
              })}
            </div>
          ))}

          {/* X-axis label row — inside aem-row grid so columns align */}
          <div className="aem-row aem-x-label-row">
            <div /> {/* spacer under y-labels */}
            {AEM_INTENSITY_LEVELS.map((il) => (
              <div key={il.label} className="aem-x-label">
                <span className="aem-x-label-main">{il.label}</span>
                <span className="aem-x-label-range">{il.range}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="aem-x-axis-title">Rainfall Intensity →</div>

        {/* Antecedent moisture global legend */}
        <div className="aem-moisture-legend">
          <div className="aem-moisture-demo-track">
            <div className="aem-moisture-demo-fill" style={{ width: `${moisture * 100}%` }} />
          </div>
          <span className="aem-moisture-legend-text">
            Antecedent moisture{" "}
            <strong style={{ color: "var(--text)" }}>{(moisture * 100).toFixed(0)}%</strong>
            {moisture > 0.7
              ? " — high saturation, runoff significantly amplified"
              : moisture > 0.4
              ? " — moderate saturation, reduced infiltration capacity"
              : " — low saturation, absorption capacity available"}
          </span>
        </div>
      </div>

      {/* ── Click-reveal explanation panel ── */}
      {selectedCell && selectedRcfg && (
        <div className="aem-explain-panel" style={{ borderTopColor: selectedRcfg.border + "55" }}>
          <div className="aem-explain-header">
            <div>
              <span className="aem-explain-risk-label" style={{ color: selectedRcfg.color }}>
                {selectedRcfg.label} Risk
              </span>
              <span className="aem-explain-coords">
                {" "}— {AEM_VULN_LABELS[selectedCell[0]]} vulnerability &times;{" "}
                {AEM_INTENSITY_LEVELS[selectedCell[1]].label} rainfall
              </span>
            </div>
            <button className="aem-close-btn" onClick={() => setSelectedCell(null)}>✕</button>
          </div>

          <p className="aem-explain-narrative">{AEM_RISK_NARRATIVES[selectedRisk]}</p>

          <div className="aem-explain-factors">
            {[
              { label: "Catchment",           value: AEM_VULN_DESCS[selectedCell[0]] },
              { label: "Rainfall intensity",  value: AEM_INTENSITY_DESCS[selectedCell[1]] },
              {
                label: "Antecedent moisture",
                value: `${(moisture * 100).toFixed(0)}% saturation — ${
                  moisture > 0.7
                    ? "significantly reduces absorption capacity; amplifies flood response"
                    : moisture > 0.4
                    ? "reduces infiltration; moderate runoff amplification expected"
                    : "ample capacity remains; runoff coefficient near baseline"
                }`,
              },
            ].map(({ label, value }) => (
              <div key={label} className="aem-factor-row">
                <div className="aem-factor-label">{label}</div>
                <div className="aem-factor-value">{value}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

// ── Cascade Countdown section
function CascadeCountdown({ cascade }) {
  if (!cascade) return null;

  // cascade is an object keyed by nodeId
  const entries = Object.entries(cascade);
  if (entries.length === 0) return null;

  // Derive source node from first entry
  const sourceNode = entries[0]?.[1]?.source_node ?? "—";

  return (
    <section className="section cascade-section">
      <div className="section-heading cascade-heading">
        <span>⚡ Elevation Cascade — Flood Propagation Active</span>
        <span className="cascade-source-label">{sourceNode}</span>
      </div>
      <div className="cascade-body">
        {entries.map(([nodeId, entry]) => (
          <CascadeRow key={nodeId} nodeId={nodeId} entry={entry} />
        ))}
      </div>
    </section>
  );
}

// ── Event Log section
function EventLogSection({ eventLog }) {
  const count = eventLog.length;

  // Determine row color class based on event status field
  const rowClass = (entry) => {
    const s = (entry.status ?? entry.event ?? "").toUpperCase();
    if (s === "WARNING") return "evlog-row--warning";
    if (s === "WATCH")   return "evlog-row--watch";
    if (s === "NORMAL")  return "evlog-row--normal";
    return "evlog-row--system";
  };

  return (
    <section className="section">
      <div className="section-heading">
        <ScrollText size={16} />
        <span>Event Log — last {count} event{count !== 1 ? "s" : ""}</span>
      </div>

      {count === 0 ? (
        <div className="empty-state" style={{ padding: "32px" }}>
          <ScrollText size={24} />
          <span>No events recorded yet</span>
        </div>
      ) : (
        <div className="evlog-panel">
          {eventLog.map((entry, idx) => {
            const ts   = entry.timestamp ?? 0;
            const time = new Date(ts * 1000).toLocaleTimeString("en-IN", {
              hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
            });
            const nodeId   = entry.node_id  ?? entry.node ?? "—";
            const event    = (entry.event   ?? entry.status ?? "—").toUpperCase();
            const rainfall = entry.rainfall != null ? `${Number(entry.rainfall).toFixed(1)} mm/hr` : "—";
            const b3raw    = entry.b3 ?? entry.b3_fraction;
            const b3       = b3raw != null ? `B3=${(Number(b3raw) * 100).toFixed(1)}%` : "";

            return (
              <div
                key={`${ts}-${idx}`}
                className={`evlog-row ${rowClass(entry)}${idx % 2 === 1 ? " evlog-row--alt" : ""}`}
              >
                <span className="evlog-time">{time}</span>
                <span className="evlog-sep">│</span>
                <span className="evlog-node">{nodeId}</span>
                <span className="evlog-sep">│</span>
                <span className="evlog-event">{event}</span>
                <span className="evlog-sep">│</span>
                <span className="evlog-rainfall">{rainfall}</span>
                {b3 && (
                  <>
                    <span className="evlog-sep">│</span>
                    <span className="evlog-b3">{b3}</span>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

const PIEZO_BUFFER_SIZE = 30;
const EMPTY_PIEZO    = () => Array.from({ length: PIEZO_BUFFER_SIZE }, (_, i) => ({ t: i, rms: 0, drops: 0 }));
const EMPTY_OPTICAL  = () => Array.from({ length: PIEZO_BUFFER_SIZE }, (_, i) => ({ t: i, signal: 0.95, interruptions: 0 }));

// ── Weather icon helper ───────────────────────────────────────────────────────
function wxIcon(icon) {
  switch ((icon || "").toLowerCase()) {
    case "thunderstorm": return "⛈️";
    case "drizzle":      return "🌦️";
    case "rain":         return "🌧️";
    case "snow":         return "❄️";
    case "clear":        return "☀️";
    case "clouds":       return "☁️";
    default:             return "🌫️";
  }
}

function dayLabel(dateStr) {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-IN", { weekday: "short" });
}

// ── Weather Forecast Strip ────────────────────────────────────────────────────
function WeatherForecastStrip({ weather, onRefresh }) {
  if (!weather) {
    return (
      <section className="weather-strip weather-strip--skeleton">
        <div className="weather-skeleton-line" />
        <div className="weather-skeleton-row">
          {[0,1,2,3,4].map((i) => <div key={i} className="weather-skeleton-card" />)}
        </div>
      </section>
    );
  }
  if (weather.error) {
    return (
      <section className="weather-strip weather-strip--error">
        <div className="weather-strip-header">
          <CloudRain size={13} />
          <span>Chikmagalur District Weather</span>
          <span className="weather-age weather-age--stale" style={{ marginLeft: "auto" }}>⚠ API key activating — check back in ~2 hours</span>
          <button className="weather-refresh-btn" onClick={onRefresh} title="Retry"><RefreshCw size={11} /></button>
        </div>
        <div className="weather-error-body">
          <span>⏳</span>
          <span>New OpenWeatherMap API keys take up to 2 hours to activate. Weather will appear automatically once ready.</span>
        </div>
      </section>
    );
  }

  const { current: c, forecast, fetched_at, stale } = weather;
  const agoMins = Math.round((Date.now() - fetched_at) / 60000);
  const upcoming = forecast.slice(1, 5);

  return (
    <section className="weather-strip">
      {/* Header row */}
      <div className="weather-strip-header">
        <CloudRain size={13} />
        <span>Chikmagalur District Weather</span>
        <span className="weather-coords">13.32°N 75.77°E</span>
        <span className={`weather-age${stale ? " weather-age--stale" : ""}`}>
          {stale ? "⚠ stale" : `updated ${agoMins}m ago`}
        </span>
        <button className="weather-refresh-btn" onClick={onRefresh} title="Refresh weather">
          <RefreshCw size={11} />
        </button>
      </div>

      <div className="weather-body">
        {/* ── Current conditions ── */}
        <div className="weather-now">
          <div className="weather-now-icon">{wxIcon(c.icon)}</div>
          <div className="weather-now-temp">
            <span className="weather-temp-big">{c.temp}°C</span>
            <span className="weather-feels">Feels {c.feels_like}°C</span>
          </div>
          <div className="weather-now-desc">{c.description}</div>
          <div className="weather-now-stats">
            <span className="wx-stat"><Droplets size={11} />{c.humidity}%</span>
            <span className="wx-stat"><Wind size={11} />{c.wind_kmh} km/h</span>
            {c.rain_1h > 0 && (
              <span className="wx-stat wx-stat--rain"><CloudRain size={11} />{c.rain_1h} mm/h</span>
            )}
            <span className="wx-stat"><Eye size={11} />{c.visibility} km</span>
            <span className="wx-stat"><Thermometer size={11} />{c.pressure} hPa</span>
          </div>
        </div>

        <div className="weather-divider" />

        {/* ── 4-day forecast ── */}
        <div className="weather-forecast-days">
          {upcoming.map((d) => (
            <div key={d.date} className="weather-day-card">
              <div className="wday-name">{dayLabel(d.date)}</div>
              <div className="wday-icon">{wxIcon(d.icon)}</div>
              <div className="wday-temps">
                <span className="wday-high">{d.temp_max}°</span>
                <span className="wday-sep">/</span>
                <span className="wday-low">{d.temp_min}°</span>
              </div>
              {d.rain_prob > 0 && (
                <div className="wday-rain">💧{d.rain_prob}%</div>
              )}
              <div className="wday-desc">{d.description}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Generates alert message in English / Tamil / Kannada ─────────────────────
function buildMessage(alertStatus, selectedNames, lang = "en") {
  const ts = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
  if (!selectedNames.length) return "";
  const nameList = selectedNames.join(", ");
  const sep = "─".repeat(44);

  if (lang === "ta") {
    // ── Tamil ──────────────────────────────────────────────────────────────
    if (alertStatus === "WARNING") {
      return (
        `MEGHADUT வெள்ள எச்சரிக்கை\n` +
        `சிக்கமகளூர் மாவட்ட ஆரம்ப எச்சரிக்கை அமைப்பு\n` +
        `${sep}\n\n` +
        `எச்சரிக்கை நிலை : WARNING\n` +
        `தேதி / நேரம்   : ${ts} IST\n\n` +
        `உடனடி வெளியேற்றம் அவசியம்\n\n` +
        `பின்வரும் கிராம பஞ்சாயத்துக்கள் அதிக வெள்ள ஆபத்து\n` +
        `மண்டலங்களாக அறிவிக்கப்பட்டுள்ளன, உடனடியாக வெளியேறவும்:\n\n` +
        `  ${nameList}\n\n` +
        `சிக்கமகளூர் நீர்நிலைப் பகுதியில் கடுமையான திடீர் வெள்ளம்\n` +
        `உருவாகி வருகிறது. மேற்கண்ட பகுதி குடியிருப்பாளர்கள்\n` +
        `உடனடியாக உயரமான இடங்களுக்கு நகரவும்.\n\n` +
        `தாமதிக்காதீர்கள். அத்தியாவசிய ஆவணங்கள் மட்டும் எடுக்கவும்.\n` +
        `உள்ளூர் அதிகாரிகளின் அறிவுறுத்தல்களை பின்பற்றவும்.\n\n` +
        `${sep}\n` +
        `MEGHADUT ஆரம்ப எச்சரிக்கை அமைப்பு\n` +
        `AeroFyta | Inceptrix 2.0`
      );
    }
    return (
      `MEGHADUT வெள்ள கண்காணிப்பு\n` +
      `சிக்கமகளூர் மாவட்ட ஆரம்ப எச்சரிக்கை அமைப்பு\n` +
      `${sep}\n\n` +
      `எச்சரிக்கை நிலை : WATCH\n` +
      `தேதி / நேரம்   : ${ts} IST\n\n` +
      `சாத்தியமான வெளியேற்றத்திற்கு தயாராகுங்கள்\n\n` +
      `பின்வரும் கிராம பஞ்சாயத்துக்கள் தீவிர வெள்ள கண்காணிப்பில்\n` +
      `உள்ளன, வெளியேற்றத்திற்கு தயார் நிலையில் இருக்கவும்:\n\n` +
      `  ${nameList}\n\n` +
      `சிக்கமகளூர் நீர்நிலைப் பகுதியில் மிதமான வெள்ள நிலைமைகள்\n` +
      `உருவாகி வருகின்றன. குடியிருப்பாளர்கள் விழிப்புடன் இருந்து\n` +
      `அவசர உதவி பொருட்களை தயார் செய்யவும்.\n\n` +
      `${sep}\n` +
      `MEGHADUT ஆரம்ப எச்சரிக்கை அமைப்பு\n` +
      `AeroFyta | Inceptrix 2.0`
    );
  }

  if (lang === "kn") {
    // ── Kannada ────────────────────────────────────────────────────────────
    if (alertStatus === "WARNING") {
      return (
        `MEGHADUT ಪ್ರವಾಹ ಎಚ್ಚರಿಕೆ\n` +
        `ಚಿಕ್ಕಮಗಳೂರು ಜಿಲ್ಲೆ ಮುಂಚಿನ ಎಚ್ಚರಿಕೆ ವ್ಯವಸ್ಥೆ\n` +
        `${sep}\n\n` +
        `ಎಚ್ಚರಿಕೆ ಸ್ಥಿತಿ : WARNING\n` +
        `ದಿನಾಂಕ / ಸಮಯ : ${ts} IST\n\n` +
        `ತಕ್ಷಣ ಸ್ಥಳಾಂತರ ಅಗತ್ಯ\n\n` +
        `ಕೆಳಗಿನ ಗ್ರಾಮ ಪಂಚಾಯತಿಗಳನ್ನು ಅತ್ಯಧಿಕ ಪ್ರವಾಹ ಅಪಾಯ\n` +
        `ವಲಯಗಳೆಂದು ಗುರುತಿಸಲಾಗಿದೆ, ತಕ್ಷಣ ಸ್ಥಳಾಂತರಗೊಳ್ಳಬೇಕು:\n\n` +
        `  ${nameList}\n\n` +
        `ಚಿಕ್ಕಮಗಳೂರು ಜಲಾನಯನ ಪ್ರದೇಶದಲ್ಲಿ ತೀವ್ರ ಪ್ರವಾಹ ಸನ್ನಿಹಿತವಾಗಿದೆ.\n` +
        `ಮೇಲ್ಕಂಡ ಪ್ರದೇಶಗಳ ಎಲ್ಲ ನಿವಾಸಿಗಳು ತಕ್ಷಣ\n` +
        `ಎತ್ತರದ ಪ್ರದೇಶಕ್ಕೆ ಸ್ಥಳಾಂತರಗೊಳ್ಳಬೇಕು.\n\n` +
        `ವಿಳಂಬ ಮಾಡಬೇಡಿ. ಅಗತ್ಯ ದಾಖಲೆಗಳನ್ನು ಮಾತ್ರ ತೆಗೆದುಕೊಳ್ಳಿ.\n` +
        `ಸ್ಥಳೀಯ ಅಧಿಕಾರಿಗಳ ಸೂಚನೆಗಳನ್ನು ಅನುಸರಿಸಿ.\n\n` +
        `${sep}\n` +
        `MEGHADUT ಮುಂಚಿನ ಎಚ್ಚರಿಕೆ ವ್ಯವಸ್ಥೆ\n` +
        `AeroFyta | Inceptrix 2.0`
      );
    }
    return (
      `MEGHADUT ಪ್ರವಾಹ ಎಚ್ಚರಿಕೆ ನಿಗಾ\n` +
      `ಚಿಕ್ಕಮಗಳೂರು ಜಿಲ್ಲೆ ಮುಂಚಿನ ಎಚ್ಚರಿಕೆ ವ್ಯವಸ್ಥೆ\n` +
      `${sep}\n\n` +
      `ಎಚ್ಚರಿಕೆ ಸ್ಥಿತಿ : WATCH\n` +
      `ದಿನಾಂಕ / ಸಮಯ : ${ts} IST\n\n` +
      `ಸಂಭಾವ್ಯ ಸ್ಥಳಾಂತರಕ್ಕೆ ಸಿದ್ಧರಾಗಿ\n\n` +
      `ಕೆಳಗಿನ ಗ್ರಾಮ ಪಂಚಾಯತಿಗಳು ಸಕ್ರಿಯ ಪ್ರವಾಹ ನಿಗಾದಲ್ಲಿದ್ದು,\n` +
      `ಸ್ಥಳಾಂತರಕ್ಕೆ ಸಿದ್ಧರಾಗಿ ಇರಬೇಕು:\n\n` +
      `  ${nameList}\n\n` +
      `ಚಿಕ್ಕಮಗಳೂರು ಜಲಾನಯನ ಪ್ರದೇಶದಲ್ಲಿ ಮಿತ ಪ್ರವಾಹ ಪರಿಸ್ಥಿತಿ\n` +
      `ಅಭಿವೃದ್ಧಿಯಾಗುತ್ತಿದೆ. ನಿವಾಸಿಗಳು ಜಾಗರೂಕರಾಗಿದ್ದು,\n` +
      `ತುರ್ತು ಕಿಟ್ ಸಿದ್ಧಪಡಿಸಿ ಅಧಿಕಾರಿಗಳ ಸೂಚನೆ ಕಾಯಿರಿ.\n\n` +
      `${sep}\n` +
      `MEGHADUT ಮುಂಚಿನ ಎಚ್ಚರಿಕೆ ವ್ಯವಸ್ಥೆ\n` +
      `AeroFyta | Inceptrix 2.0`
    );
  }

  // ── English (default) ─────────────────────────────────────────────────────
  if (alertStatus === "WARNING") {
    return (
      `MEGHADUT FLOOD WARNING\n` +
      `Chikmagalur District Early Warning System\n` +
      `${sep}\n\n` +
      `Alert Status : WARNING\n` +
      `Date / Time  : ${ts} IST\n\n` +
      `IMMEDIATE EVACUATION REQUIRED\n\n` +
      `The following Gram Panchayats have been classified as\n` +
      `critical flood-risk zones and must evacuate at once:\n\n` +
      `  ${nameList}\n\n` +
      `A severe flash flood event is imminent in the Chikmagalur\n` +
      `watershed. All residents in the above areas must move to\n` +
      `designated higher ground immediately.\n\n` +
      `Do not delay. Carry essential documents and emergency\n` +
      `supplies only. Await instructions from local authorities.\n\n` +
      `${sep}\n` +
      `MEGHADUT Early Warning System\n` +
      `AeroFyta | Inceptrix 2.0`
    );
  }
  return (
    `MEGHADUT FLOOD WATCH\n` +
    `Chikmagalur District Early Warning System\n` +
    `${sep}\n\n` +
    `Alert Status : WATCH\n` +
    `Date / Time  : ${ts} IST\n\n` +
    `PREPARE FOR POSSIBLE EVACUATION\n\n` +
    `The following Gram Panchayats are under active flood\n` +
    `monitoring and should prepare for evacuation:\n\n` +
    `  ${nameList}\n\n` +
    `Moderate flooding conditions are developing in the\n` +
    `Chikmagalur watershed. Residents are advised to remain\n` +
    `alert, assemble emergency kits, and stay tuned for\n` +
    `further instructions from local authorities.\n\n` +
    `${sep}\n` +
    `MEGHADUT Early Warning System\n` +
    `AeroFyta | Inceptrix 2.0`
  );
}

// ── Rainfall Accumulation Section ─────────────────────────────────────────────
function RainfallAccumulationSection({ telemetry }) {
  const [range, setRange] = useState("24h");

  // ── Generate 168 hours of deterministic simulated history ──────────────────
  // Anchors the most-recent point to live telemetry; older points use
  // a realistic monsoon pattern with a multi-day heavy spell in days 3-5.
  const histData = useMemo(() => {
    const base = {
      N001: Math.max(telemetry.N001?.rainfall_rate ?? 10, 2),
      N002: Math.max(telemetry.N002?.rainfall_rate ??  7, 1),
      N003: Math.max(telemetry.N003?.rainfall_rate ??  4, 1),
    };
    const now  = Date.now();
    const HOUR = 3_600_000;
    // Per-day intensity multiplier (index 0 = 6 days ago … 6 = today)
    // Simulates: dry start → 3-day monsoon burst → tapering → current
    const DAY_MULT = [0.55, 1.30, 1.50, 1.35, 0.90, 1.20, 1.00];

    return Array.from({ length: 168 }, (_, idx) => {
      const hoursAgo  = 167 - idx;
      const t         = now - hoursAgo * HOUR;
      const daysAgo   = Math.floor(hoursAgo / 24);          // 6 = oldest day
      const mult      = DAY_MULT[6 - daysAgo] ?? 1.0;

      // Afternoon peak diurnal cycle (peaks ~14:00)
      const hr      = new Date(t).getHours();
      const diurnal = 0.60 + 0.75 * Math.pow(Math.max(0, Math.sin((hr - 10) * Math.PI / 14)), 2);

      // Pseudo-random but fully deterministic noise per hour
      const n1 = 0.72 + ((idx * 7  + 3) % 17) / 34;
      const n2 = 0.72 + ((idx * 11 + 5) % 13) / 26;
      const n3 = 0.72 + ((idx * 13 + 7) % 11) / 22;

      const isNow = idx === 167;
      return {
        t,
        N001: isNow ? base.N001 : +(base.N001 * mult * diurnal * n1).toFixed(1),
        N002: isNow ? base.N002 : +(base.N002 * mult * diurnal * n2 * 0.85).toFixed(1),
        N003: isNow ? base.N003 : +(base.N003 * mult * diurnal * n3 * 0.70).toFixed(1),
      };
    });
  }, [telemetry.N001?.rainfall_rate, telemetry.N002?.rainfall_rate, telemetry.N003?.rainfall_rate]);

  // ── Aggregate into daily totals for 7-day view & accumulation risk ─────────
  const dailyData = useMemo(() => {
    const DAY_NAMES = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
    return Array.from({ length: 7 }, (_, di) => {
      // di=0 → 6 days ago (histData[0..23]), di=6 → today (histData[144..167])
      const slice = histData.slice(di * 24, di * 24 + 24);
      const date  = new Date(slice[0]?.t ?? Date.now());
      const label = di === 6 ? "Today" : di === 5 ? "Yest" : DAY_NAMES[date.getDay()];
      return {
        label,
        N001: +slice.reduce((s, h) => s + h.N001, 0).toFixed(1),
        N002: +slice.reduce((s, h) => s + h.N002, 0).toFixed(1),
        N003: +slice.reduce((s, h) => s + h.N003, 0).toFixed(1),
      };
    });
  }, [histData]);

  // ── Multi-day accumulation flood / landslide risk ─────────────────────────
  //
  // Thresholds calibrated for Western Ghats / Chikmagalur District (laterite
  // soil, orographic rainfall, Bhadra river basin).
  //
  // Scientific basis:
  //   IMD daily categories:
  //     Moderate      :   7.6 –  35.5 mm/day  (normal monsoon shower)
  //     Rather Heavy  :  35.6 –  64.4 mm/day  (soil moisture builds)
  //     Heavy Rain    :  64.5 – 124.4 mm/day  ← Karnataka flood trigger
  //     Very Heavy    : 124.5 – 244.4 mm/day  ← landslide risk zone
  //     Extremely Heavy:  ≥ 244.4 mm/day
  //
  //   Western Ghats landslide research (GSI / NRSC):
  //     ≥ 145–150 mm in any single 24 h  → primary landslide trigger
  //     ≥ 300 mm cumulative over 3 days  → documented landslide onset
  //                                         (windward slopes, Chikmagalur)
  //     ~ 500 mm / 3-day                 → catastrophic (Irshalwadi 2023 scale)
  //     2-day antecedent rainfall        → strongest scientific predictor
  //       (if last 48 h ≥ 200 mm the next "Heavy" event is high-risk)
  //
  //   Note: 3 days × 40 mm/day = 120 mm — this is upper "Moderate" range and
  //   does NOT itself trigger floods or landslides in Chikmagalur. It simply
  //   raises soil moisture; a subsequent "Heavy" day becomes dangerous.
  const accumRisk = useMemo(() => {
    const last3 = dailyData.slice(-3);   // most recent 3 days
    const last2 = dailyData.slice(-2);   // most recent 2 days (antecedent predictor)

    // Per-node 3-day totals (use max across nodes — upstream N001 always highest)
    const node3 = {
      N001: +last3.reduce((s, d) => s + d.N001, 0).toFixed(1),
      N002: +last3.reduce((s, d) => s + d.N002, 0).toFixed(1),
      N003: +last3.reduce((s, d) => s + d.N003, 0).toFixed(1),
    };
    const max3 = Math.max(node3.N001, node3.N002, node3.N003);

    // 2-day antecedent totals
    const node2 = {
      N001: +last2.reduce((s, d) => s + d.N001, 0).toFixed(1),
      N002: +last2.reduce((s, d) => s + d.N002, 0).toFixed(1),
      N003: +last2.reduce((s, d) => s + d.N003, 0).toFixed(1),
    };
    const max2 = Math.max(node2.N001, node2.N002, node2.N003);

    // Tier 3 — CRITICAL (≥ 450 mm / 3-day on any node)
    // avg ≥ 150 mm/day = mid "Very Heavy" range; approaching Irshalwadi-scale
    // event. Landslide + flash flood imminent on Western Ghats slopes.
    if (max3 >= 450) return {
      level: "high",
      badge: "⛈ CRITICAL ACCUMULATION",
      msg: `3-day total: ${max3.toFixed(0)} mm on peak node — avg ${(max3/3).toFixed(0)} mm/day (IMD "Very Heavy"). Western Ghats landslide and flash flood risk is CRITICAL. Evacuate low-lying areas now.`,
    };

    // Tier 2 — HIGH RISK (≥ 300 mm / 3-day on any node)
    // avg ≥ 100 mm/day = IMD "Heavy Rain"; matches the GSI / NRSC documented
    // landslide-onset threshold for windward Western Ghats slopes (Chikmagalur).
    if (max3 >= 300) return {
      level: "moderate",
      badge: "⚠ HIGH ACCUMULATION RISK",
      msg: `3-day total: ${max3.toFixed(0)} mm on peak node — avg ${(max3/3).toFixed(0)} mm/day (IMD "Heavy Rain"). At the GSI-documented Western Ghats landslide threshold. Debris-flow and flood risk is HIGH.`,
    };

    // Tier 1a — WATCH via 3-day total (≥ 150 mm / 3-day)
    // avg ≥ 50 mm/day = upper "Rather Heavy" range; laterite + forest soils in
    // Chikmagalur begin significant saturation. The NEXT "Heavy" day (≥64.5 mm)
    // now carries elevated flood potential even without an extreme hourly peak.
    if (max3 >= 150) return {
      level: "watch",
      badge: "👁 ACCUMULATION WATCH",
      msg: `3-day total: ${max3.toFixed(0)} mm on peak node — avg ${(max3/3).toFixed(0)} mm/day (IMD "Rather Heavy"). Soil saturation building on Chikmagalur laterite slopes. A subsequent Heavy-rain day (≥64.5 mm) could trigger localised flooding.`,
    };

    // Tier 1b — WATCH via 2-day antecedent (≥ 200 mm in last 48 h)
    // Primary scientific predictor for Western Ghats debris flows (NRSC research).
    // Even without meeting the 3-day threshold, 200 mm in 48 h strongly
    // pre-conditions slopes for the next rainfall event.
    if (max2 >= 200) return {
      level: "watch",
      badge: "👁 2-DAY ANTECEDENT ALERT",
      msg: `Last 48 h: ${max2.toFixed(0)} mm on peak node — avg ${(max2/2).toFixed(0)} mm/day. 2-day antecedent rainfall is the primary landslide predictor for Western Ghats (NRSC). Slopes are pre-conditioned; any further rain carries elevated risk.`,
    };

    return null;
  }, [dailyData]);

  // ── Build chart data for the selected time window ──────────────────────────
  const { chartData, totals, refY } = useMemo(() => {
    let rows;

    if (range === "24h") {
      const slice = histData.slice(-24);
      let cum = 0;
      rows = slice.map(h => {
        cum += h.N001 + h.N002 + h.N003;
        return {
          label: `${String(new Date(h.t).getHours()).padStart(2,"0")}h`,
          N001: h.N001, N002: h.N002, N003: h.N003,
          cumulative: +cum.toFixed(1),
        };
      });
    } else if (range === "48h") {
      // Group into 2-hour blocks → 24 bars
      const slice = histData.slice(-48);
      let cum = 0;
      rows = [];
      for (let i = 0; i < slice.length; i += 2) {
        const a = slice[i], b = slice[i + 1] ?? slice[i];
        const hr = new Date(b.t).getHours();
        const N1 = +((a.N001 + b.N001) / 2).toFixed(1);
        const N2 = +((a.N002 + b.N002) / 2).toFixed(1);
        const N3 = +((a.N003 + b.N003) / 2).toFixed(1);
        cum += N1 + N2 + N3;
        rows.push({
          label: `${String(hr).padStart(2,"0")}h`,
          N001: N1, N002: N2, N003: N3,
          cumulative: +cum.toFixed(1),
        });
      }
    } else {
      // 7-day daily totals
      let cum = 0;
      rows = dailyData.map(d => {
        cum += d.N001 + d.N002 + d.N003;
        return { label: d.label, N001: d.N001, N002: d.N002, N003: d.N003, cumulative: +cum.toFixed(1) };
      });
    }

    const totals = {
      N001: +rows.reduce((s, r) => s + r.N001, 0).toFixed(1),
      N002: +rows.reduce((s, r) => s + r.N002, 0).toFixed(1),
      N003: +rows.reduce((s, r) => s + r.N003, 0).toFixed(1),
    };

    // ── Reference lines — IMD-calibrated thresholds ──────────────────────────
    // 7d view (mm/day):
    //   64.5  mm/day = IMD "Heavy Rain" lower bound   → Karnataka flood trigger
    //   124.5 mm/day = IMD "Very Heavy Rain" lower bound → landslide risk zone
    // 24h / 48h view (mm/hr):
    //   15 mm/hr = intense burst; if sustained ≥ 4 h → approaches 60 mm event
    //   30 mm/hr = very intense; 5 h at this rate = 150 mm ≈ single-day
    //              landslide trigger for Western Ghats (145–150 mm/24 h threshold)
    const refY = range === "7d"
      ? [
          { y: 64.5,  color: "#f59e0b", lbl: "Heavy (IMD)"    },
          { y: 124.5, color: "#ef4444", lbl: "V.Heavy (IMD)"  },
        ]
      : [
          { y: 15, color: "#f59e0b", lbl: "Intense"  },
          { y: 30, color: "#ef4444", lbl: "Extreme"  },
        ];

    return { chartData: rows, totals, refY };
  }, [histData, dailyData, range]);

  const combined = +(totals.N001 + totals.N002 + totals.N003).toFixed(0);
  const unit     = range === "7d" ? "mm/day" : "mm/hr";
  const xInterval = range === "24h" ? 3 : range === "48h" ? 3 : 0;

  return (
    <section className="section">
      <div className="section-heading">
        <CloudRain size={16} />
        <span>Rainfall Accumulation</span>

        {/* Accumulation risk badge */}
        {accumRisk && (
          <span className={`accum-risk-badge accum-risk-badge--${accumRisk.level}`}>
            {accumRisk.badge}
          </span>
        )}

        {/* Time-range selector */}
        <div className="accum-range-selector">
          {["24h","48h","7d"].map(r => (
            <button
              key={r}
              className={`accum-range-btn${range === r ? " accum-range-btn--active" : ""}`}
              onClick={() => setRange(r)}
            >{r}</button>
          ))}
        </div>
      </div>

      {/* ── Multi-day accumulation warning banner ── */}
      {accumRisk && (
        <div className={`accum-multiday-banner accum-multiday-banner--${accumRisk.level}`}>
          <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>{accumRisk.msg}</span>
        </div>
      )}

      {/* ── Per-node totals strip ── */}
      <div className="accum-stats-row">
        {NODE_IDS.map(id => (
          <div key={id} className="accum-stat-card">
            <span className="accum-stat-node" style={{ color: NODE_COLORS[id] }}>{id}</span>
            <span className="accum-stat-total">{totals[id]}</span>
            <span className="accum-stat-unit">mm</span>
          </div>
        ))}
        <div className="accum-stat-card accum-stat-card--total">
          <span className="accum-stat-node" style={{ color: "#fbbf24" }}>TOTAL</span>
          <span className="accum-stat-total">{combined}</span>
          <span className="accum-stat-unit">mm (all nodes)</span>
        </div>
      </div>

      {/* ── Stacked bar + cumulative line chart ── */}
      <ResponsiveContainer width="100%" height={215}>
        <ComposedChart data={chartData} margin={{ top: 6, right: 52, left: -14, bottom: 0 }}>
          <XAxis
            dataKey="label"
            tick={{ fontSize: 9, fill: "#475569" }}
            interval={xInterval}
          />
          <YAxis
            yAxisId="left"
            tick={{ fontSize: 9, fill: "#475569" }}
            label={{ value: unit, angle: -90, position: "insideLeft", fontSize: 9, fill: "#475569", dx: 16 }}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            tick={{ fontSize: 9, fill: "#fbbf24" }}
            label={{ value: "Accum mm", angle: 90, position: "insideRight", fontSize: 9, fill: "#fbbf24", dx: -6 }}
          />
          <Tooltip
            contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 6, fontSize: 11 }}
            labelStyle={{ color: "#94a3b8" }}
            formatter={(v, name) => {
              if (name === "cumulative") return [`${v} mm`, "Cumulative"];
              const labels = { N001: "N001 · Baba Budangiri", N002: "N002 · Coffee Belt", N003: "N003 · Bhadra Valley" };
              return [`${v} mm`, labels[name] ?? name];
            }}
          />
          {refY.map(r => (
            <ReferenceLine
              key={r.lbl}
              yAxisId="left"
              y={r.y}
              stroke={r.color}
              strokeDasharray="5 4"
              label={{ value: r.lbl, position: "insideTopRight", fontSize: 9, fill: r.color, dy: -2 }}
            />
          ))}
          <Bar yAxisId="left" dataKey="N001" stackId="rain" fill="#38bdf8" fillOpacity={0.85} name="N001" />
          <Bar yAxisId="left" dataKey="N002" stackId="rain" fill="#818cf8" fillOpacity={0.85} name="N002" />
          <Bar yAxisId="left" dataKey="N003" stackId="rain" fill="#34d399" fillOpacity={0.85} name="N003" radius={[2,2,0,0]} />
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="cumulative"
            stroke="#fbbf24"
            strokeWidth={2}
            dot={false}
            name="cumulative"
          />
        </ComposedChart>
      </ResponsiveContainer>

      {/* ── Context note ── */}
      <p className="accum-footnote">
        Bars = per-node rainfall ({unit}, stacked) · Gold line = cumulative (right axis).
        {range === "7d" && (
          " IMD thresholds — Heavy: 64.5 mm/day · Very Heavy: 124.5 mm/day. " +
          "Western Ghats landslide onset: ≥300 mm / 3-day (GSI/NRSC). " +
          "2-day antecedent ≥200 mm is the primary debris-flow predictor."
        )}
        {range !== "7d" && (
          " Intense: 15 mm/hr · Extreme: 30 mm/hr. " +
          "5 h at 30 mm/hr ≈ 150 mm/day — Western Ghats single-day landslide threshold. Switch to 7d for accumulation risk."
        )}
      </p>
    </section>
  );
}

// ── Alert Send Dialog ─────────────────────────────────────────────────────────
function AlertSendDialog({ alertStatus, onClose, villages = VILLAGES }) {
  const statusCfg = STATUS_CONFIG[alertStatus] || STATUS_CONFIG.WARNING;

  // Default-select only villages whose current risk is EVACUATE NOW (or PREPARE for WATCH)
  const defaultSelected = new Set(
    villages
      .filter((v) => {
        const risk = v.riskByStatus[alertStatus];
        return risk === "EVACUATE NOW" || (alertStatus === "WATCH" && risk === "PREPARE");
      })
      .map((v) => v.name)
  );

  const [selected, setSelected]       = useState(defaultSelected);
  const [message,  setMessage]        = useState("");
  const [userEdited, setUserEdited]   = useState(false);
  const [sendState, setSendState]     = useState({}); // { sms: {status,msg,hint}, whatsapp: ..., email: ... }
  const [lang,     setLang]           = useState("en"); // "en" | "ta" | "kn"

  // Auto-generate message whenever selection, status, or language changes
  useEffect(() => {
    if (!userEdited) {
      setMessage(buildMessage(alertStatus, [...selected], lang));
    }
  }, [selected, alertStatus, userEdited, lang]);

  // Build recipients array from selected villages
  const recipients = villages.filter((v) => selected.has(v.name));

  const toggleVillage = (name) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  };

  const handleMessageChange = (e) => {
    setMessage(e.target.value);
    setUserEdited(true);
  };

  const resetMessage = () => {
    setUserEdited(false);
    setMessage(buildMessage(alertStatus, [...selected], lang));
  };

  const doSend = async (channel) => {
    if (!recipients.length) return;
    setSendState((prev) => ({ ...prev, [channel]: { status: "loading" } }));
    try {
      // For WhatsApp, pass alertStatus + villageNames so the server can use
      // the approved Meta message template (bypasses the 24-hour window rule)
      const payload = { recipients, message };
      if (channel === "whatsapp") {
        payload.alertStatus  = alertStatus;
        payload.villageNames = [...selected].join(", ");
      }
      const res = await fetch(`http://localhost:3001/api/send-${channel}`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const errorMsg = data.error || `HTTP ${res.status}`;
        const hint     = data.hint  || null;
        console.error(`[${channel}]`, errorMsg, hint ? `\nHint: ${hint}` : "");
        setSendState((prev) => ({ ...prev, [channel]: { status: "error", msg: errorMsg, hint } }));
        return;
      }
setSendState((prev) => ({ ...prev, [channel]: { status: "ok" } }));
    } catch (err) {
      console.error(`[${channel}]`, err.message);
      setSendState((prev) => ({ ...prev, [channel]: { status: "error", msg: err.message } }));
    }
  };

  const RISK_BADGE_STYLE = {
    "EVACUATE NOW": { background: "#450a0a", color: "#ef4444" },
    "PREPARE":      { background: "#451a03", color: "#f59e0b" },
    "MONITOR":      { background: "#052e16", color: "#22c55e" },
  };

  const SendButton = ({ channel, icon: Icon, label }) => {
    const s     = sendState[channel] || { status: "idle" };
    const state = s.status;
    const tip   = !recipients.length
      ? "Select at least one village"
      : state === "error"
        ? (s.hint ? `${s.msg}\n\n💡 ${s.hint}` : s.msg)
        : `Send via ${label}`;
    return (
      <div className="action-btn-wrap">
        <button
          className={`action-btn action-btn--${channel}${state === "ok" ? " action-btn--done" : ""}${state === "error" ? " action-btn--err" : ""}`}
          onClick={() => doSend(channel)}
          disabled={state === "loading" || !recipients.length}
          title={tip}
        >
          {state === "loading" && <Loader size={14} className="spin" />}
          {state === "ok"      && <CheckCircle size={14} />}
          {state === "error"   && <XCircle size={14} />}
          {state === "idle"    && <Icon size={14} />}
          <span>
            {state === "loading" ? "Sending…" :
             state === "ok"      ? "Sent!" :
             state === "error"   ? "Failed" :
             label}
          </span>
        </button>
        {state === "error" && s.msg && (
          <div className="action-btn-error-msg" title={s.hint || ""}>
            {s.msg.length > 60 ? s.msg.slice(0, 57) + "…" : s.msg}
            {s.hint && <span className="action-btn-hint"> 💡</span>}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="alert-dialog-overlay" onClick={onClose}>
      <div
        className="alert-dialog"
        style={{ borderTopColor: statusCfg.color }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="alert-dialog-header">
          <div className="alert-dialog-title">
            <AlertTriangle size={16} style={{ color: statusCfg.color }} />
            <span>Send Flood Alert</span>
            <span
              className="alert-dialog-status-badge"
              style={{ color: statusCfg.color, background: statusCfg.bg, borderColor: statusCfg.border }}
            >
              {alertStatus}
            </span>
          </div>
          <button className="alert-dialog-close" onClick={onClose}>✕</button>
        </div>

        {/* Village selection */}
        <div className="alert-dialog-section-label">
          <Users size={13} />
          Select Recipients ({selected.size} of {villages.length})
        </div>
        <div className="alert-dialog-villages">
          {villages.map((v) => {
            const risk    = v.riskByStatus[alertStatus];
            const badgeSt = RISK_BADGE_STYLE[risk] || RISK_BADGE_STYLE["MONITOR"];
            return (
              <label key={v.name} className="village-check-row">
                <input
                  type="checkbox"
                  checked={selected.has(v.name)}
                  onChange={() => toggleVillage(v.name)}
                  className="village-check-input"
                />
                <span className="village-check-name">{v.name} Panchayat</span>
                <span className="village-check-dist">{v.distKm} km</span>
                <span className="village-check-risk" style={badgeSt}>{risk}</span>
              </label>
            );
          })}
        </div>

        {/* Language selector */}
        <div className="alert-dialog-section-label">
          <span style={{ fontSize: "12px" }}>🌐</span>
          Language
        </div>
        <div className="lang-selector">
          {[
            { code: "en", label: "English",  flag: "🇬🇧" },
            { code: "ta", label: "தமிழ்",    flag: "🇮🇳" },
            { code: "kn", label: "ಕನ್ನಡ",    flag: "🇮🇳" },
          ].map(({ code, label, flag }) => (
            <button
              key={code}
              className={`lang-btn${lang === code ? " lang-btn--active" : ""}`}
              onClick={() => { setLang(code); setUserEdited(false); }}
            >
              <span>{flag}</span>
              <span>{label}</span>
            </button>
          ))}
        </div>

        {/* Message editor */}
        <div className="alert-dialog-section-label">
          <MessageSquare size={13} />
          Message
          {userEdited && (
            <button className="reset-msg-btn" onClick={resetMessage} title="Reset to auto-generated message">
              Reset
            </button>
          )}
        </div>
        <textarea
          className="alert-dialog-message"
          value={message}
          onChange={handleMessageChange}
          rows={9}
          placeholder="Select villages above to generate a message…"
        />

        {/* Action buttons */}
        <div className="alert-dialog-actions">
          <SendButton channel="sms"       icon={Phone}          label="SMS" />
          <SendButton channel="whatsapp"  icon={MessageSquare}  label="WhatsApp" />
          <SendButton channel="email"     icon={Mail}           label="Email" />
        </div>

        {!recipients.length && (
          <p className="alert-dialog-no-recipients">Select at least one village to send alerts.</p>
        )}
      </div>
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────
function App() {
  const [telemetry, setTelemetry]             = useState({});
  const [alert, setAlert]                     = useState({ status: "NORMAL", votes: [] });
  const [rainfallHistory, setRainfallHistory]  = useState({ N001: [], N002: [], N003: [] });
  const [piezoBuffers, setPiezoBuffers]        = useState({
    N001: EMPTY_PIEZO(), N002: EMPTY_PIEZO(), N003: EMPTY_PIEZO(),
  });
  const [opticalBuffers, setOpticalBuffers]    = useState({
    N001: EMPTY_OPTICAL(), N002: EMPTY_OPTICAL(), N003: EMPTY_OPTICAL(),
  });
  const [hydroBuffers, setHydroBuffers]        = useState({
    N001: EMPTY_HYDRO(), N002: EMPTY_HYDRO(), N003: EMPTY_HYDRO(),
  });
  const [cascade, setCascade] = useState(null);
  // Epoch seconds when status first transitioned to WARNING (null otherwise)
  const [warningFiredAt, setWarningFiredAt] = useState(null);
  const [eventLog, setEventLog] = useState([]);
  const [alertDialogOpen, setAlertDialogOpen] = useState(false);
  const [weather, setWeather] = useState(null);
  // Use a ref so the interval closure always reads the latest telemetry
  const telemetryRef_live  = useRef({});

  useEffect(() => {
    const telRef  = ref(db, "telemetry");
    const alertRef = ref(db, "alerts/current");

    onValue(telRef, (snap) => {
      const val = snap.val() || {};
      telemetryRef_live.current = val;
      setTelemetry(val);

      // Update 30-min hydrometeor sparkline buffers on every Firebase push (~5 s)
      setHydroBuffers((prev) => {
        const next = {};
        NODE_IDS.forEach((id) => {
          const d   = val[id];
          const buf = prev[id];
          if (!d || !buf) { next[id] = buf; return; }
          const entry = {
            t:       (buf[buf.length - 1]?.t ?? 0) + 1,
            rain:    d.hydro_rain    ?? 0,
            drizzle: d.hydro_drizzle ?? 0,
            hail:    d.hydro_hail    ?? 0,
            mixed:   d.hydro_mixed   ?? 0,
            noise:   d.hydro_noise   ?? 1,
          };
          next[id] = [...buf.slice(1), entry];
        });
        return next;
      });
    });
    onValue(alertRef,   (snap) => setAlert(snap.val() || { status: "NORMAL", votes: [] }));
    onValue(ref(db, "cascade/active"), (snap) => setCascade(snap.val() || null));

    // Event log listener
    onValue(ref(db, "events/log"), (snap) => {
      const raw = snap.val();
      if (!raw) { setEventLog([]); return; }
      const entries = Object.values(raw)
        .filter((e) => e && e.timestamp)
        .sort((a, b) => b.timestamp - a.timestamp)  // newest first
        .slice(0, 50);
      setEventLog(entries);
    });

    // History listeners
    NODE_IDS.forEach((nodeId) => {
      const histRef = ref(db, `history/${nodeId}`);
      onValue(histRef, (snap) => {
        const raw = snap.val();
        if (!raw) return;
        const entries = Object.values(raw)
          .filter((e) => e && e.timestamp && e.rainfall_rate != null)
          .sort((a, b) => a.timestamp - b.timestamp)
          .slice(-60);
        setRainfallHistory((prev) => ({ ...prev, [nodeId]: entries }));
      });
    });

    // Rolling 1 s tick — updates both piezo and optical buffers from the live telemetry ref
    const sensorInterval = setInterval(() => {
      const live = telemetryRef_live.current;

      setPiezoBuffers((prev) => {
        const next = {};
        NODE_IDS.forEach((id) => {
          const d    = live[id];
          const rms   = d?.piezo_rms        ?? 0;
          const drops = d?.piezo_drop_count ?? 0;
          const buf   = prev[id];
          next[id] = [...buf.slice(1), { t: buf[buf.length - 1].t + 1, rms, drops }];
        });
        return next;
      });

      setOpticalBuffers((prev) => {
        const next = {};
        NODE_IDS.forEach((id) => {
          const d            = live[id];
          const signal        = d?.optical_signal        ?? 0.95;
          const interruptions = d?.optical_interruptions ?? 0;
          const buf           = prev[id];
          next[id] = [...buf.slice(1), { t: buf[buf.length - 1].t + 1, signal, interruptions }];
        });
        return next;
      });
    }, 1000);

    return () => clearInterval(sensorInterval);
  }, []);

  // Fetch weather on mount + every 10 minutes
  const fetchWeather = () => {
    fetch("http://localhost:3001/api/weather")
      .then((r) => r.json())
      .then((d) => setWeather(d))
      .catch(() => {});
  };
  useEffect(() => {
    fetchWeather();
    const id = setInterval(fetchWeather, 10 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (alert.status === "WARNING") {
      new Audio(alertSound).play();
    }
  }, [alert.status]);

  // Track the exact epoch when status first becomes WARNING
  // Reset to null when status leaves WARNING
  useEffect(() => {
    if (alert.status === "WARNING") {
      setWarningFiredAt((prev) => prev ?? Math.floor(Date.now() / 1000));
    } else {
      setWarningFiredAt(null);
    }
  }, [alert.status]);

  const statusCfg  = STATUS_CONFIG[alert.status] || STATUS_CONFIG.NORMAL;
  const StatusIcon = statusCfg.icon;
  const nodeCount  = Object.keys(telemetry).filter((k) => k !== "meta").length;

  return (
    <div className="app">
      {/* ── HEADER ── */}
      <header className="header">
        <div className="header-brand">
          <div className="brand-icon">
            <CloudRain size={22} />
          </div>
          <div>
            <div className="brand-title">Meghadut</div>
            <div className="brand-sub">Control Center</div>
          </div>
        </div>

        <div className="header-meta">
          <div className="meta-chip">
            <Radio size={12} />
            <span>{nodeCount} Node{nodeCount !== 1 ? "s" : ""} Online</span>
          </div>
          <div
            className="status-chip"
            style={{
              color:       statusCfg.color,
              background:  statusCfg.bg,
              borderColor: statusCfg.border,
            }}
          >
            <StatusIcon size={14} />
            <span>{alert.status}</span>
          </div>
        </div>
      </header>

      {/* ── WARNING / WATCH BANNER ── */}
      {(alert.status === "WARNING" || alert.status === "WATCH") && (
        <div className={`warning-banner warning-banner--${alert.status.toLowerCase()}`}>
          <AlertTriangle size={18} />
          <span>
            {alert.status === "WARNING" ? "Cloudburst Warning Confirmed" : "Flood Watch Active"}
          </span>
          {alert.votes?.length > 0 && (
            <span className="vote-list">Votes: {alert.votes.join(", ")}</span>
          )}
          <button
            className="send-alert-btn"
            onClick={() => setAlertDialogOpen(true)}
            title="Send alert to village panchayats"
          >
            <Send size={13} />
            Send Alert
          </button>
        </div>
      )}

      <main className="main">
        {/* ── WEATHER FORECAST STRIP ── */}
        <WeatherForecastStrip weather={weather} onRefresh={fetchWeather} />

        {/* ── ALERT STATUS & RISK MATRIX — combined ── */}
        <AlertEscalationMatrix telemetry={telemetry} alert={alert} />

        {/* ── CASCADE COUNTDOWN ── */}
        <CascadeCountdown cascade={cascade} />

        {/* ── MAP ── */}
        <section className="section">
          <div className="section-heading">
            <MapPin size={16} />
            <span>Live Node Map — Flood Risk Heat Map</span>
            <div className="map-legend">
              <span className="map-legend-item map-legend--evacuate">● EVACUATE NOW</span>
              <span className="map-legend-item map-legend--prepare">● PREPARE</span>
              <span className="map-legend-item map-legend--monitor">● MONITOR</span>
            </div>
          </div>

          <div className="map-wrapper">
            <MapContainer
              center={[13.25, 75.50]}
              zoom={10}
              style={{ height: "100%", width: "100%" }}
            >
              <TileLayer
                attribution="&copy; OpenStreetMap contributors"
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />

              {/* ── Node circles (actual lat/lon from Firebase) ── */}
              {Object.entries(telemetry)
                .filter(([id]) => id !== "meta")
                .map(([nodeId, data]) => {
                  const color = getRainfallColor(data.rainfall_rate);
                  return (
                    <Circle
                      key={nodeId}
                      center={[data.lat || 13.25, data.lon || 75.50]}
                      radius={400}
                      pathOptions={{ color, fillColor: color, fillOpacity: 0.25, weight: 2 }}
                    >
                      <Popup>
                        <div style={{ fontFamily: "monospace", fontSize: 12, lineHeight: 1.6 }}>
                          <strong style={{ fontSize: 13, color: NODE_COLORS[nodeId] ?? "#fff" }}>{nodeId}</strong><br />
                          Elevation: <strong>{data.elevation ?? "—"}m</strong><br />
                          Rainfall: <strong>{data.rainfall_rate ?? "—"} mm/hr</strong><br />
                          Class: <strong>{data.classification ?? "—"}</strong><br />
                          B3: <strong>{data.b3_fraction != null ? (data.b3_fraction * 100).toFixed(1) + "%" : "—"}</strong><br />
                          Battery: <strong>{data.battery != null ? data.battery.toFixed(1) + "%" : "—"}</strong>
                        </div>
                      </Popup>
                    </Circle>
                  );
                })}

              {/* ── Animated flood wavefront when cascade is active ── */}
              {cascade != null &&
                Object.entries(telemetry)
                  .filter(([id]) => id !== "meta")
                  .map(([nodeId, data]) => (
                    <Circle
                      key={nodeId + "-wavefront"}
                      center={[data.lat || 13.25, data.lon || 75.50]}
                      radius={300}
                      className="leaflet-wavefront"
                      pathOptions={{
                        color: "#38bdf8",
                        fillColor: "transparent",
                        dashArray: "8 6",
                        weight: 2,
                        opacity: 0.85,
                      }}
                    />
                  ))}

              {/* ── Village flood-risk heat zones (background glow) ── */}
              {VILLAGES.map((v) => {
                const risk  = v.riskByStatus[alert.status] ?? "MONITOR";
                const color = getVillageRiskColor(risk);
                const haloRadius = risk === "EVACUATE NOW" ? 900
                                 : risk === "PREPARE"      ? 600 : 350;
                const haloOpacity = risk === "EVACUATE NOW" ? 0.18
                                  : risk === "PREPARE"      ? 0.12 : 0.07;
                return (
                  <Circle
                    key={v.name + "-halo"}
                    center={[v.lat, v.lon]}
                    radius={haloRadius}
                    pathOptions={{
                      color,
                      fillColor: color,
                      fillOpacity: haloOpacity,
                      weight: 0,
                    }}
                  />
                );
              })}

              {/* ── Pulsing outer ring for EVACUATE NOW villages ── */}
              {alert.status === "WARNING" && VILLAGES.filter(
                (v) => v.riskByStatus[alert.status] === "EVACUATE NOW"
              ).map((v) => (
                <Circle
                  key={v.name + "-pulse"}
                  center={[v.lat, v.lon]}
                  radius={1100}
                  className="leaflet-risk-pulse"
                  pathOptions={{
                    color: "#ef4444",
                    fillColor: "transparent",
                    weight: 2,
                    opacity: 0.6,
                    dashArray: "6 5",
                  }}
                />
              ))}

              {/* ── Village markers with permanent name labels ── */}
              {VILLAGES.map((v) => {
                const risk  = v.riskByStatus[alert.status] ?? "MONITOR";
                const color = getVillageRiskColor(risk);
                const markerRadius = risk === "EVACUATE NOW" ? 11
                                   : risk === "PREPARE"      ? 9 : 7;
                return (
                  <CircleMarker
                    key={v.name}
                    center={[v.lat, v.lon]}
                    radius={markerRadius}
                    pathOptions={{
                      color: "#fff",
                      fillColor: color,
                      fillOpacity: 1,
                      weight: 2,
                    }}
                  >
                    {/* Permanent label */}
                    <MapTooltip
                      permanent
                      direction="top"
                      offset={[0, -(markerRadius + 4)]}
                      className="village-map-label"
                    >
                      <span style={{ color }}>{v.name}</span>
                    </MapTooltip>
                    <Popup>
                      <div style={{ fontFamily: "monospace", fontSize: 12, lineHeight: 1.6 }}>
                        <strong style={{ fontSize: 13, color }}>{v.name} Panchayat</strong><br />
                        Risk: <strong style={{ color }}>{risk}</strong><br />
                        Time to impact: <strong>~{v.baseMins} min</strong><br />
                        Distance: <strong>{v.distKm} km</strong> from {v.nearestNode}
                      </div>
                    </Popup>
                  </CircleMarker>
                );
              })}
            </MapContainer>
          </div>
        </section>

        {/* ── NODE CARDS ── */}
        <section className="section">
          <div className="section-heading">
            <Waves size={16} />
            <span>Node Telemetry</span>
          </div>

          <div className="node-grid">
            {Object.entries(telemetry)
              .filter(([id]) => id !== "meta")
              .map(([nodeId, data]) => (
                <NodeCard key={nodeId} nodeId={nodeId} data={data} />
              ))}
            {nodeCount === 0 && (
              <div className="empty-state">
                <Radio size={32} />
                <span>No nodes reporting</span>
              </div>
            )}
          </div>
        </section>

        {/* ── RAINFALL TREND ── */}
        <RainfallTrendSection rainfallHistory={rainfallHistory} />

        {/* ── RAINFALL ACCUMULATION (24h / 48h / 7d + multi-day risk) ── */}
        <RainfallAccumulationSection telemetry={telemetry} />

        {/* ── PIEZO WAVEFORM ── */}
        <PiezoWaveformSection piezoBuffers={piezoBuffers} />

        {/* ── OPTICAL SIGNAL ── */}
        <OpticalSignalSection opticalBuffers={opticalBuffers} />

        {/* ── DSD — ALL NODES ── */}
        <DSDSection telemetry={telemetry} />

        {/* ── HYDROMETEOR TYPE CLASSIFICATION — adjacent to DSD (scientifically related) ── */}
        <HydroSection telemetry={telemetry} hydroBuffers={hydroBuffers} />

        {/* ── LEAD-TIME COUNTDOWN — operationally paired with Village Flood Risk ── */}
        <LeadTimePanel telemetry={telemetry} />

        {/* ── VILLAGE FLOOD RISK TABLE ── */}
        <VillageFloodRiskTable alert={alert} warningFiredAt={warningFiredAt} />

        {/* ── PREDICTIVE ANALYTICS ── */}
        <PredictiveAnalyticsSection telemetry={telemetry} />

        {/* ── EVENT LOG ── */}
        <EventLogSection eventLog={eventLog} />
      </main>

      {/* ── ALERT SEND DIALOG ── */}
      {alertDialogOpen && (
        <AlertSendDialog
          alertStatus={alert.status}
          onClose={() => setAlertDialogOpen(false)}
          villages={VILLAGES}
        />
      )}

      <style>{`
        @keyframes blink-border {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.5; }
        }
        .warning-banner { animation: blink-border 1.4s ease-in-out infinite; }
      `}</style>
    </div>
  );
}

export default App;
