import "dotenv/config";
import express from "express";
import cors from "cors";
import nodemailer from "nodemailer";

const app  = express();
const PORT = process.env.PORT || 3001;


app.use(cors({ origin: ["http://localhost:5173", "http://localhost:4173"] }));
app.use(express.json());

// ── Meta WhatsApp Cloud API helper ───────────────────────────────────────────
// Sends a free-form text message directly via Meta Cloud API.
// API: POST https://graph.facebook.com/v21.0/{phoneNumberId}/messages
async function sendMetaWhatsApp(to, message) {
  const token       = process.env.META_ACCESS_TOKEN;
  const phoneNumId  = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token)      throw new Error("META_ACCESS_TOKEN not set in .env");
  if (!phoneNumId) throw new Error("WHATSAPP_PHONE_NUMBER_ID not set in .env");

  // Meta needs E.164 without '+': 917418244774
  const phone = to.replace(/^\+/, "");

  const response = await fetch(
    `https://graph.facebook.com/v21.0/${phoneNumId}/messages`,
    {
      method:  "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to:                phone,
        type:              "text",
        text:              { body: message },
      }),
    }
  );

  const data = await response.json();
  if (!response.ok || data.error) {
    throw new Error(data.error?.message || `Meta API error ${response.status}`);
  }
  return data.messages?.[0]?.id;
}

// ── Nodemailer transporter ───────────────────────────────────────────────────
function getTransporter() {
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;
  if (!user || !pass) throw new Error("EMAIL_USER / EMAIL_PASS not set in .env");
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass },
  });
}

// ── Vonage SMS helper ─────────────────────────────────────────────────────────
async function sendVonageSMS(to, message) {
  const apiKey    = process.env.VONAGE_API_KEY;
  const apiSecret = process.env.VONAGE_API_SECRET;
  const from      = process.env.VONAGE_FROM || "MEGHADUT";

  const response = await fetch("https://rest.nexmo.com/sms/json", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: apiKey, api_secret: apiSecret, to, from, text: message }),
  });

  const data = await response.json();
  const msg  = data.messages?.[0];
  if (!msg) throw new Error("No response from Vonage");
  if (msg.status !== "0") {
    throw new Error(msg["error-text"] || `Vonage error status ${msg.status}`);
  }
  return msg["message-id"];
}

// ── POST /api/send-sms  (via Vonage) ─────────────────────────────────────────
app.post("/api/send-sms", async (req, res) => {
  const { recipients, message } = req.body;
  if (!recipients?.length || !message) {
    return res.status(400).json({ error: "recipients and message are required" });
  }

  const apiKey = process.env.VONAGE_API_KEY;
  if (!apiKey || apiKey === "your_vonage_api_key") {
    return res.status(500).json({
      error: "VONAGE_API_KEY not set in .env",
      hint:  "Add VONAGE_API_KEY and VONAGE_API_SECRET to .env",
    });
  }

  // Vonage needs E.164 without '+': 917418244774
  const uniquePhones = [...new Set(recipients.map((r) => r.phone).filter(Boolean))];
  if (!uniquePhones.length) {
    return res.status(400).json({ error: "No valid phone numbers in recipients" });
  }
  const toNumbers = uniquePhones.map((p) => p.replace(/^\+/, ""));

  console.log(`[SMS/Vonage] Sending to: ${toNumbers.join(", ")}`);

  const results = await Promise.allSettled(
    toNumbers.map((to) => sendVonageSMS(to, message))
  );

  const sent   = [];
  const failed = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      sent.push({ phone: uniquePhones[i], messageId: r.value });
      console.log(`[SMS/Vonage ✓] ${uniquePhones[i]} → ID: ${r.value}`);
    } else {
      const errMsg = r.reason?.message || String(r.reason);
      failed.push({ phone: uniquePhones[i], error: errMsg });
      console.error(`[SMS/Vonage ✗] ${uniquePhones[i]} → ${errMsg}`);
    }
  });

  if (failed.length && !sent.length) {
    return res.status(500).json({ error: failed[0].error, sent: 0, failed: failed.length, details: failed });
  }
  res.json({ sent: sent.length, failed: failed.length, total: uniquePhones.length, details: failed });
});

// ── POST /api/send-whatsapp (via Meta Cloud API) ──────────────────────────────
app.post("/api/send-whatsapp", async (req, res) => {
  const { recipients, message } = req.body;
  if (!recipients?.length || !message) {
    return res.status(400).json({ error: "recipients and message are required" });
  }

  const token = process.env.META_ACCESS_TOKEN;
  if (!token) {
    return res.status(500).json({
      error: "META_ACCESS_TOKEN not set in .env",
      hint:  "Generate a token from developers.facebook.com → WhatsApp → API Setup",
    });
  }

  const uniquePhones = [...new Set(recipients.map((r) => r.phone).filter(Boolean))];
  if (!uniquePhones.length) {
    return res.status(400).json({ error: "No valid phone numbers in recipients" });
  }
  console.log(`[WhatsApp/Meta] Sending to: ${uniquePhones.join(", ")}`);

  const results = await Promise.allSettled(
    uniquePhones.map((phone) => sendMetaWhatsApp(phone, message))
  );

  const sent   = [];
  const failed = [];

  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      sent.push({ phone: uniquePhones[i], messageId: r.value });
      console.log(`[WhatsApp/Meta ✓] ${uniquePhones[i]} → ID: ${r.value}`);
    } else {
      const msg = r.reason?.message || String(r.reason);
      failed.push({ phone: uniquePhones[i], error: msg });
      console.error(`[WhatsApp/Meta ✗] ${uniquePhones[i]} → ${msg}`);
    }
  });

  if (failed.length && !sent.length) {
    return res.status(500).json({
      error:   failed[0].error,
      hint:    "Check META_ACCESS_TOKEN and that the recipient is in the allowed test number list.",
      sent:    sent.length,
      failed:  failed.length,
      details: failed,
    });
  }

  res.json({
    sent:     sent.length,
    failed:   failed.length,
    total:    uniquePhones.length,
    provider: "meta-cloud-api",
    details:  failed,
  });
});

// ── POST /api/send-email ─────────────────────────────────────────────────────
app.post("/api/send-email", async (req, res) => {
  const { recipients, message, subject } = req.body;
  if (!recipients?.length || !message) {
    return res.status(400).json({ error: "recipients and message are required" });
  }

  let transporter;
  try { transporter = getTransporter(); }
  catch (e) { return res.status(500).json({ error: e.message }); }

  const uniqueEmails = [...new Set(recipients.map((r) => r.email).filter(Boolean))];
  if (!uniqueEmails.length) {
    return res.status(400).json({ error: "No valid email addresses in recipients" });
  }
  const emailSubject = subject || "MEGHADUT Flood Alert — Kedarnath Valley";
  console.log(`[Email] Sending to: ${uniqueEmails.join(", ")}`);

  try {
    await transporter.sendMail({
      from:    `"MEGHADUT Early Warning System" <${process.env.EMAIL_USER}>`,
      to:      uniqueEmails.join(", "),
      subject: emailSubject,
      text:    message,
      html:    `<pre style="font-family:monospace;white-space:pre-wrap">${message}</pre>`,
    });
    console.log(`[Email ✓] Delivered to ${uniqueEmails.length} address(es)`);
    res.json({ sent: uniqueEmails.length, failed: 0, total: uniqueEmails.length });
  } catch (err) {
    console.error("[Email ✗]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Health check ─────────────────────────────────────────────────────────────
app.get("/api/health", (req, res) => res.json({ status: "ok" }));

// ── GET /api/weather — Kedarnath weather via OpenWeatherMap (10-min cache) ────
let _weatherCache = null;
let _weatherCachedAt = 0;
const WEATHER_TTL_MS = 10 * 60 * 1000; // 10 minutes

app.get("/api/weather", async (req, res) => {
  const apiKey = process.env.OPENWEATHER_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "OPENWEATHER_API_KEY not set in .env" });
  }

  // Serve from cache if still fresh
  if (_weatherCache && Date.now() - _weatherCachedAt < WEATHER_TTL_MS) {
    return res.json(_weatherCache);
  }

  const lat = 13.3161, lon = 75.7720; // Chikmagalur District
  try {
    const [curRes, fcRes] = await Promise.all([
      fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric`),
      fetch(`https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric`),
    ]);
    const cur = await curRes.json();
    const fc  = await fcRes.json();
    if (cur.cod !== 200) throw new Error(cur.message || "OWM current error");

    // Build one representative entry per calendar day from 3-hour slots (prefer 12:00)
    const byDay = {};
    (fc.list || []).forEach((item) => {
      const [date, time] = item.dt_txt.split(" ");
      if (!byDay[date] || time === "12:00:00") byDay[date] = item;
    });
    const days = Object.values(byDay).slice(0, 5);

    const result = {
      current: {
        temp:        Math.round(cur.main.temp),
        feels_like:  Math.round(cur.main.feels_like),
        humidity:    cur.main.humidity,
        wind_kmh:    Math.round((cur.wind?.speed || 0) * 3.6),
        description: cur.weather[0].description,
        icon:        cur.weather[0].main,
        rain_1h:     cur.rain?.["1h"] ?? 0,
        visibility:  Math.round((cur.visibility || 10000) / 1000),
        pressure:    cur.main.pressure,
      },
      forecast: days.map((d) => ({
        date:      d.dt_txt.split(" ")[0],
        temp_max:  Math.round(d.main.temp_max),
        temp_min:  Math.round(d.main.temp_min),
        icon:      d.weather[0].main,
        description: d.weather[0].description,
        rain_prob: Math.round((d.pop || 0) * 100),
        rain_mm:   +(d.rain?.["3h"] ?? 0).toFixed(1),
        humidity:  d.main.humidity,
      })),
      fetched_at: Date.now(),
    };

    _weatherCache    = result;
    _weatherCachedAt = Date.now();
    console.log("[Weather] Fetched fresh from OpenWeatherMap");
    res.json(result);
  } catch (err) {
    console.error("[Weather ✗]", err.message);
    // Return stale cache on error if available
    if (_weatherCache) return res.json({ ..._weatherCache, stale: true });
    res.status(500).json({ error: err.message });
  }
});


// ── Debug: confirm loaded env values (no secrets exposed) ────────────────────
app.get("/api/debug", (req, res) => {
  const metaToken = process.env.META_ACCESS_TOKEN || "";
  res.json({
    META_ACCESS_TOKEN_SET:     !!metaToken,
    META_TOKEN_PREFIX:         metaToken ? metaToken.slice(0, 12) + "…" : "(not set)",
    WHATSAPP_PHONE_NUMBER_ID:  process.env.WHATSAPP_PHONE_NUMBER_ID || "(not set)",
    EMAIL_USER:                process.env.EMAIL_USER    || "(not set)",
    EMAIL_PASS_SET:            !!process.env.EMAIL_PASS,
    VONAGE_API_KEY_SET:        !!process.env.VONAGE_API_KEY,
  });
});

// ── Test SMS: GET /api/test-sms?to=+918078882323 ─────────────────────────────
app.get("/api/test-sms", async (req, res) => {
  const to = req.query.to || "";
  if (!to) return res.status(400).json({ error: "Pass ?to=+918078882323" });

  try {
    const messageId = await sendVonageSMS(to.replace(/^\+/, ""), "MEGHADUT test — Vonage SMS is working!");
    res.json({ success: true, messageId, to, provider: "Vonage" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => {
  const vonageKey = process.env.VONAGE_API_KEY;
  const metaToken = process.env.META_ACCESS_TOKEN;
  console.log(`[MEGHADUT API] Server running on http://localhost:${PORT}`);
  console.log(`  SMS (Vonage):        ${vonageKey ? "credentials set ✓" : "⚠ VONAGE_API_KEY not set"}`);
  console.log(`  WhatsApp (Meta):     ${metaToken ? "token set ✓"       : "⚠ META_ACCESS_TOKEN not set"}`);
  console.log(`  Email user:          ${process.env.EMAIL_USER || "(not set)"}`);
  console.log(`  Debug URL:           http://localhost:${PORT}/api/debug`);
  console.log(`  Test SMS URL:        http://localhost:${PORT}/api/test-sms?to=+918078882323`);
});
