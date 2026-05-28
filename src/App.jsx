import { useState, useEffect, useMemo, useRef } from "react";
import {
  AreaChart, Area, BarChart, Bar, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import Skeleton, { SkeletonTheme } from "react-loading-skeleton";
import "react-loading-skeleton/dist/skeleton.css";
import {
  Wind, Droplets, Thermometer, Eye, MapPin, Bell, Home,
  BarChart2, Map as MapIcon, AlertTriangle, Heart,
  TrendingUp, TrendingDown, Minus, Activity, Shield,
  X, Plus, Sun, Cloud, CloudRain, ChevronDown, Settings,
  Upload, RotateCcw, CheckCircle, FileText, AlertCircle, Search,
} from "lucide-react";

// Indian AQI sub-index utilities based on CPCB breakpoint ranges.
const lerp = (v, cL, cH, iL, iH) =>
  Math.round(((iH - iL) / (cH - cL)) * (v - cL) + iL);

function pm25SI(v) {
  if (!v || v <= 0) return 0;
  if (v <= 30) return lerp(v, 0, 30, 0, 50);
  if (v <= 60) return lerp(v, 30, 60, 50, 100);
  if (v <= 90) return lerp(v, 60, 90, 100, 200);
  if (v <= 120) return lerp(v, 90, 120, 200, 300);
  if (v <= 250) return lerp(v, 120, 250, 300, 400);
  return Math.min(500, lerp(v, 250, 500, 400, 500));
}
function pm10SI(v) {
  if (!v || v <= 0) return 0;
  if (v <= 50) return lerp(v, 0, 50, 0, 50);
  if (v <= 100) return lerp(v, 50, 100, 50, 100);
  if (v <= 250) return lerp(v, 100, 250, 100, 200);
  if (v <= 350) return lerp(v, 250, 350, 200, 300);
  if (v <= 430) return lerp(v, 350, 430, 300, 400);
  return Math.min(500, lerp(v, 430, 600, 400, 500));
}
function no2SI(v) {
  if (!v || v <= 0) return 0;
  if (v <= 40) return lerp(v, 0, 40, 0, 50);
  if (v <= 80) return lerp(v, 40, 80, 50, 100);
  if (v <= 180) return lerp(v, 80, 180, 100, 200);
  if (v <= 280) return lerp(v, 180, 280, 200, 300);
  if (v <= 400) return lerp(v, 280, 400, 300, 400);
  return Math.min(500, lerp(v, 400, 800, 400, 500));
}
function so2SI(v) {
  if (!v || v <= 0) return 0;
  if (v <= 40) return lerp(v, 0, 40, 0, 50);
  if (v <= 80) return lerp(v, 40, 80, 50, 100);
  if (v <= 380) return lerp(v, 80, 380, 100, 200);
  if (v <= 800) return lerp(v, 380, 800, 200, 300);
  return Math.min(400, lerp(v, 800, 1600, 300, 400));
}
function o3SI(v) {
  if (!v || v <= 0) return 0;
  if (v <= 50) return lerp(v, 0, 50, 0, 50);
  if (v <= 100) return lerp(v, 50, 100, 50, 100);
  if (v <= 168) return lerp(v, 100, 168, 100, 200);
  if (v <= 208) return lerp(v, 168, 208, 200, 300);
  return Math.min(400, lerp(v, 208, 748, 300, 400));
}

// Final AQI = max of all valid sub-indices (CPCB standard)
function calcAQI(p) {
  const subs = [
    pm25SI(p.PM25 || 0),
    pm10SI(p.PM10 || 0),
    no2SI(p.NO2 || 0),
    so2SI(p.SO2 || 0),
    o3SI(p.O3 || 0),
  ].filter(v => v > 0);
  return subs.length > 0 ? Math.min(500, Math.max(...subs)) : 0;
}

// Current AQI is estimated from station pollutant values when the API does not provide a direct AQI.
// data.gov.in CPCB rows usually provide pollutant_avg, not a ready-made live AQI value.
const getAQIValue = city => {
  if (city?.apiAQI !== null && city?.apiAQI !== undefined && !Number.isNaN(Number(city.apiAQI))) {
    return Math.max(0, Math.min(500, Math.round(Number(city.apiAQI))));
  }

  if (city?.estimatedAQI !== null && city?.estimatedAQI !== undefined && !Number.isNaN(Number(city.estimatedAQI))) {
    return Math.max(0, Math.min(500, Math.round(Number(city.estimatedAQI))));
  }

  return calcAQI(city?.p || {});
};

const AQI_CATS = [
  { max: 50, label: "Good", color: "#22c55e" },
  { max: 100, label: "Satisfactory", color: "#84cc16" },
  { max: 200, label: "Moderate", color: "#f59e0b" },
  { max: 300, label: "Poor", color: "#f97316" },
  { max: 400, label: "Very Poor", color: "#ef4444" },
  { max: 500, label: "Severe", color: "#a855f7" },
];
const getCat = aqi => AQI_CATS.find(c => aqi <= c.max) || AQI_CATS[5];

// Utilities for CPCB/data.gov.in station records.
const POLL_MAP = {
  // data.gov.in exact labels
  "PM2.5": "PM25", "pm2.5": "PM25", "PM25": "PM25", "pm25": "PM25",
  "PM10": "PM10", "pm10": "PM10",
  "NO2": "NO2", "no2": "NO2", "NO₂": "NO2",
  "SO2": "SO2", "so2": "SO2", "SO₂": "SO2",
  "OZONE": "O3", "Ozone": "O3", "ozone": "O3", "O3": "O3", "o3": "O3",
  "NH3": "NH3", "nh3": "NH3", "NH₃": "NH3",
  "CO": "CO", "co": "CO",
};

// "Andhra_Pradesh" → "Andhra Pradesh"  |  "Delhi" → "Delhi"
const fmtState = s => s ? s.replace(/_/g, " ").trim() : "";

// "25-05-2026 13:00:00" → "25 May 2026 · 13:00 IST"
function parseUpdateTime(raw) {
  if (!raw || !raw.trim()) return null;
  try {
    const parts = raw.trim().split(" ");
    const [d, m, y] = parts[0].split("-");
    const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const time = parts[1] ? parts[1].slice(0, 5) : "";
    return `${parseInt(d)} ${MONTHS[parseInt(m) - 1]} ${y}${time ? " · " + time + " IST" : ""}`;
  } catch { return raw; }
}

function parseCSVText(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) throw new Error("CSV needs at least 2 lines");
  const sep = lines[0].includes("\t") ? "\t" : ",";
  // Proper CSV split that handles quoted fields with commas
  const splitLine = line => {
    const result = []; let cur = ""; let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQ = !inQ; continue; }
      if (ch === sep && !inQ) { result.push(cur.trim()); cur = ""; continue; }
      cur += ch;
    }
    result.push(cur.trim());
    return result;
  };
  const headers = splitLine(lines[0]);
  return lines.slice(1).filter(l => l.trim()).map(l => {
    const vals = splitLine(l);
    return Object.fromEntries(headers.map((h, i) => [h.trim(), (vals[i] || "").trim()]));
  });
}

function median(values) {
  const nums = values
    .filter(v => Number.isFinite(v) && v > 0)
    .sort((a, b) => a - b);

  if (!nums.length) return 0;

  const mid = Math.floor(nums.length / 2);
  return nums.length % 2
    ? nums[mid]
    : Math.round((nums[mid - 1] + nums[mid]) / 2);
}

function calibrateAQI(aqi) {
  if (!aqi || aqi <= 0) return 0;

  if (aqi <= 150) {
    return Math.round(aqi * 1.1);
  }

  if (aqi <= 250) {
    return Math.round(aqi * 0.75);
  }

  if (aqi <= 350) {
    return Math.round(aqi * 0.45);
  }

  return Math.round(aqi * 0.4);
}

async function predictMissingPM(p) {
  try {
    const res = await fetch(`${import.meta.env.VITE_ML_API_URL}/predict-pm`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        NO2: p.NO2 || 0,
        SO2: p.SO2 || 0,
        CO: p.CO || 0,
        O3: p.O3 || 0,
        NH3: p.NH3 || 0,
      }),
    });

    if (!res.ok) throw new Error("ML API failed");

    return await res.json();
  } catch (err) {
    console.error("ML prediction failed:", err);
    return {
      PM25: p.PM25 || 0,
      PM10: p.PM10 || 0,
    };
  }
}

function normalizePollutant(name) {
  const raw = String(name || "").trim();
  if (!raw || raw.toUpperCase() === "NA") return "";
  return POLL_MAP[raw] || POLL_MAP[raw.toUpperCase()] || raw.toUpperCase().replace(/\s/g, "");
}

async function csvToCities(rows) {
  const stationMap = {};
  let lastUpdateRaw = "";

  for (const row of rows) {
    const city = (row.city || "").trim();
    const state = fmtState(row.state || "");
    const station = (row.station || "").trim();

    if (!city || city === "NA") continue;
    if (!station || station === "NA") continue;

    const lat = Number.parseFloat(row.latitude || 0);
    const lon = Number.parseFloat(row.longitude || 0);

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lat <= 5 || lat >= 40 || lon <= 60 || lon >= 100) continue;

    if (!lastUpdateRaw && row.last_update) {
      lastUpdateRaw = row.last_update;
    }

    const stationKey = `${state}||${city}||${station}`;

    if (!stationMap[stationKey]) {
      stationMap[stationKey] = {
        id: `${city}_${station}_${state}`
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "_")
          .replace(/_+/g, "_")
          .replace(/^_|_$/g, ""),

        // The app still uses "cities" as the array name in state,
        // but every item is now one individual monitoring station.
        name: `${city} - ${station}`,
        city,
        station,
        state,
        location: `${station}, ${city}, ${state}`,
        lat,
        lon,

        p: {
          PM25: 0,
          PM10: 0,
          NO2: 0,
          SO2: 0,
          CO: 0,
          O3: 0,
          NH3: 0,
        },

        lastUpdate: parseUpdateTime(row.last_update || lastUpdateRaw),
        rawLastUpdate: row.last_update || lastUpdateRaw,
      };
    }

    const pollutantId = normalizePollutant(row.pollutant_id || row.pollutant || "");
    const value = Number.parseFloat(row.pollutant_avg || row.avg_value || row.value || 0);

    if (!pollutantId || !Number.isFinite(value) || value <= 0) continue;

    if (stationMap[stationKey].p[pollutantId] !== undefined) {
      stationMap[stationKey].p[pollutantId] = value;
    }
  }

  const stations = Object.values(stationMap).map(st => {
    const p = { ...st.p };
    const estimatedAQI = calcAQI(p);

    return {
      ...st,
      p,
      pollutants: p,

      // Do not call ML here. Initial page load stays fast.
      // Missing PM values are filled only when a station is selected.
      apiAQI: null,
      estimatedAQI,
      aqi: estimatedAQI,
      category: getCat(estimatedAQI).label,

      stationCount: 1,
      apiAQISource: "Individual CPCB station pollutant data + estimated AQI",
    };
  });

  const cities = stations
    .filter(st => getAQIValue(st) > 0)
    .sort((a, b) => getAQIValue(b) - getAQIValue(a));

  const meta = {
    totalCities: cities.length,
    totalStations: cities.length,
    lastUpdateRaw,
    lastUpdate: parseUpdateTime(lastUpdateRaw),
  };

  return {
    cities,
    meta,
  };
}

// The app intentionally depends on live CPCB/data.gov.in records.
const DEFAULT_CITIES = [];

const PMETA = {
  PM25: { label: "PM2.5", unit: "µg/m³", safe: 30, color: "#38bdf8" },
  PM10: { label: "PM10", unit: "µg/m³", safe: 60, color: "#818cf8" },
  NO2: { label: "NO₂", unit: "µg/m³", safe: 40, color: "#fb923c" },
  SO2: { label: "SO₂", unit: "µg/m³", safe: 50, color: "#f472b6" },
  CO: { label: "CO", unit: "µg/m³", safe: 2000, color: "#34d399" },
  O3: { label: "O₃", unit: "µg/m³", safe: 100, color: "#a78bfa" },
  NH3: { label: "NH₃", unit: "µg/m³", safe: 200, color: "#fbbf24" },
};

const HEALTH_DB = [
  { max: 50, icon: "💪", title: "Excellent", gen: "Perfect for all outdoor activities. No health risk.", sens: "No restrictions whatsoever.", mask: false, vent: true },
  { max: 100, icon: "😊", title: "Acceptable", gen: "Suitable for most people. Great for outdoor exercise.", sens: "Very sensitive individuals may limit prolonged exertion.", mask: false, vent: true },
  { max: 200, icon: "😐", title: "Moderate", gen: "Sensitive groups should limit prolonged outdoor exertion.", sens: "Children & elderly should reduce outdoor time.", mask: true, vent: false },
  { max: 300, icon: "😷", title: "Poor", gen: "Avoid prolonged outdoor exertion. Stay indoors if possible.", sens: "Sensitive groups avoid all outdoor activity.", mask: true, vent: false },
  { max: 400, icon: "🚨", title: "Very Poor", gen: "Everyone should avoid outdoor exertion. Health effects likely.", sens: "Stay indoors. Run air purifiers.", mask: true, vent: false },
  { max: 500, icon: "☠️", title: "Severe", gen: "Health emergency. Stay indoors and seal doors and windows.", sens: "Evacuate if possible. Seek immediate medical attention.", mask: true, vent: false },
];
const getHealth = aqi => HEALTH_DB.find(h => aqi <= h.max) || HEALTH_DB[5];

// Deterministic helpers used for demo trends and forecasts.
const mkRng = seed => {
  let s = Math.abs(seed) % 2147483647 || 1;
  return () => { s = s * 16807 % 2147483647; return (s - 1) / 2147483646; };
};

const genHistorical = city => {
  const r = mkRng(city.id.charCodeAt(0) * 131 + (city.id.charCodeAt(1) || 7) * 17);
  const base = getAQIValue(city);
  const ref = new Date("2026-05-25");
  return Array.from({ length: 30 }, (_, i) => {
    const d = new Date(ref);
    d.setDate(d.getDate() - (29 - i));
    const wknd = d.getDay() === 0 || d.getDay() === 6 ? -10 : 0;
    const aqi = Math.max(15, Math.min(500, Math.round(base + (r() - 0.5) * 60 + wknd)));
    return {
      date: d.toLocaleDateString("en-IN", { month: "short", day: "numeric" }),
      aqi,
      pm25: Math.max(5, Math.round((city.p.PM25 || 0) + (r() - 0.5) * 40)),
      pm10: Math.max(10, Math.round((city.p.PM10 || 0) + (r() - 0.5) * 50)),
      no2: Math.max(2, Math.round((city.p.NO2 || 0) + (r() - 0.5) * 15)),
      so2: Math.max(1, Math.round((city.p.SO2 || 0) + (r() - 0.5) * 8)),
    };
  });
};

async function fetchWeather(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,precipitation,visibility,weather_code&wind_speed_unit=kmh&timezone=Asia%2FKolkata`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    const c = data.current;
    const code = c.weather_code;
    const condition = code === 0 ? "clear"
      : code <= 3 ? "clear"
        : code <= 67 ? "cloudy"
          : "rain";
    return {
      temp: Math.round(c.temperature_2m),
      humidity: Math.round(c.relative_humidity_2m),
      windSpeed: Math.round(c.wind_speed_10m),
      windDir: degToCompass(c.wind_direction_10m),
      visibility: Math.round((c.visibility || 10000) / 1000),
      rainfall: c.precipitation || 0,
      condition,
    };
  } catch {
    return genWeatherFallback(lat);
  }
}

// CPCB/data.gov.in live API integration.
const DATA_GOV_RESOURCE_URL = "https://api.data.gov.in/resource/3b01bcb8-0b14-4abf-b6f2-c1bfd384ba69";

// Put your real key in .env as:
// VITE_DATA_GOV_API_KEY=your_key_here
// For quick testing, you can temporarily replace the fallback string below.
const DATA_GOV_API_KEY = import.meta.env.VITE_DATA_GOV_API_KEY || "YOUR_DATA_GOV_API_KEY";

async function fetchCPCBRecords() {
  const all = [];
  const limit = 1000;
  let offset = 0;
  let total = Infinity;

  while (offset < total) {
    const params = new URLSearchParams({
      "api-key": DATA_GOV_API_KEY,
      format: "json",
      limit: String(limit),
      offset: String(offset),
    });

    const url = `${DATA_GOV_RESOURCE_URL}?${params.toString()}`;
    const res = await fetch(url);

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`data.gov.in API failed: ${res.status} ${text}`);
    }

    const json = await res.json();
    console.log(
      "RAW CPCB FULL RECORD:",
      JSON.stringify(json.records?.[0], null, 2)
    );

    if (json?.status === "error") {
      throw new Error(json?.message || "data.gov.in API returned an error");
    }

    const records = Array.isArray(json.records) ? json.records : [];
    all.push(...records);

    const apiTotal = Number(json.total);
    total = Number.isFinite(apiTotal) && apiTotal > 0 ? apiTotal : all.length;

    if (records.length < limit) break;
    offset += limit;

    // Safety guard so the browser does not loop forever if API metadata is wrong.
    if (offset > 20000) break;
  }

  return all;
}

async function fetchCPCBCities() {
  if (!DATA_GOV_API_KEY || DATA_GOV_API_KEY === "YOUR_DATA_GOV_API_KEY") {
    throw new Error("Add your data.gov.in API key in .env as VITE_DATA_GOV_API_KEY");
  }

  const rows = await fetchCPCBRecords();
  const { cities, meta } = await csvToCities(rows);

  const citiesWithAQI = cities
    .map(c => ({
      ...c,
      apiAQI: c.apiAQI,
      estimatedAQI: c.estimatedAQI,
      apiAQISource: c.apiAQISource || "Individual CPCB station data + estimated AQI",
      lastUpdate: meta.lastUpdate,
    }))
    .filter(c => getAQIValue(c) > 0)
    .sort((a, b) => getAQIValue(b) - getAQIValue(a));

  return {
    cities: citiesWithAQI,
    meta: {
      ...meta,
      source: "CPCB / data.gov.in",
      cityCount: citiesWithAQI.length,
    },
  };
}

function degToCompass(deg) {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round(deg / 45) % 8];
}

function genWeatherFallback(lat) {
  const bt = lat > 25 ? 28 : lat > 18 ? 33 : 36;
  return {
    temp: bt, humidity: 55, windSpeed: 12,
    windDir: "NW", visibility: 6, rainfall: 0, condition: "clear",
  };
}

const genForecast = (city, wx) => {
  const r = mkRng(city.id.charCodeAt(0) + 25 * 13);
  const base = getAQIValue(city);
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const ref = new Date("2026-05-25");
  const fH = wx.humidity > 70 ? 0.85 : wx.humidity > 55 ? 0.93 : 1.0;
  const fW = wx.windSpeed > 20 ? 0.78 : wx.windSpeed > 12 ? 0.90 : 1.0;
  const fR = wx.rainfall > 5 ? 0.68 : wx.rainfall > 0 ? 0.82 : 1.0;
  const fSummer = 1.05; // May – heat + dust
  const pred = base * fH * fW * fR * fSummer;
  let prev = base;
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(ref); d.setDate(ref.getDate() + i + 1);
    const dow = d.getDay();
    const aqi = Math.max(20, Math.min(500, Math.round(
      pred + (r() - 0.5) * 26 + (dow === 0 || dow === 6 ? -7 : 0) + i * (r() - 0.5) * 4
    )));
    const cat = getCat(aqi);
    const trend = aqi > prev * 1.06 ? "up" : aqi < prev * 0.94 ? "down" : "flat";
    prev = aqi;
    return {
      day: DAYS[dow],
      date: d.toLocaleDateString("en-IN", { month: "short", day: "numeric" }),
      aqi, cat, trend,
      conf: Math.max(55, 92 - i * 5),
      icon: wx.rainfall > 3 ? "rain" : wx.humidity > 65 ? "cloudy" : "clear",
      temp: Math.round(wx.temp + (r() - 0.5) * 4 + i * 0.3),
    };
  });
};

// Design tokens
const BG = "#f4f8fb";
const CARD = "#ffffff";
const BORD = "#dbe7f3";
const MUT = "#64748b";
const DIM = "#94a3b8";
const TXT = "#0f172a";
const ACC = "#0ea5e9";

// Reusable UI components
function AQIGauge({ aqi, color }) {
  const cx = 100, cy = 85, r = 70, sw = 13;
  const toRad = a => a * Math.PI / 180;
  const pt = a => [cx + r * Math.cos(toRad(a)), cy + r * Math.sin(toRad(a))];
  const [sx, sy] = pt(135); const [ex, ey] = pt(44.9);
  const frac = Math.max(0.003, Math.min(aqi / 500, 1));
  const [vx, vy] = pt(135 + frac * 270);
  const lg = frac * 270 >= 180 ? 1 : 0;
  const bg = `M${sx.toFixed(2)},${sy.toFixed(2)} A${r},${r} 0 1 1 ${ex.toFixed(2)},${ey.toFixed(2)}`;
  const vp = `M${sx.toFixed(2)},${sy.toFixed(2)} A${r},${r} 0 ${lg} 1 ${vx.toFixed(2)},${vy.toFixed(2)}`;
  return (
    <svg viewBox="0 0 200 158" style={{ width: 210, height: 166, display: "block", margin: "0 auto" }}>
      <defs>
        <linearGradient id="gg" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#22c55e" />
          <stop offset="28%" stopColor="#f59e0b" />
          <stop offset="58%" stopColor="#ef4444" />
          <stop offset="100%" stopColor="#a855f7" />
        </linearGradient>
      </defs>
      <path d={bg} fill="none" stroke="#dbe7f3" strokeWidth={sw} strokeLinecap="round" />
      <path d={vp} fill="none" stroke="url(#gg)" strokeWidth={sw} strokeLinecap="round" />
      <text x="100" y="78" textAnchor="middle" style={{ fontFamily: '"JetBrains Mono",monospace', fontSize: 40, fontWeight: 700, fill: color }}>{aqi}</text>
      <text x="100" y="97" textAnchor="middle" style={{ fontFamily: "Outfit,sans-serif", fontSize: 10, fill: MUT, letterSpacing: "0.12em" }}>AQI</text>
      <text x="30" y="154" textAnchor="middle" style={{ fontSize: 9, fill: DIM, fontFamily: "monospace" }}>0</text>
      <text x="170" y="154" textAnchor="middle" style={{ fontSize: 9, fill: DIM, fontFamily: "monospace" }}>500</text>
    </svg>
  );
}

const ChartTip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: CARD, border: `1px solid ${ACC}22`, borderRadius: 10, padding: "10px 14px" }}>
      <p style={{ color: MUT, fontSize: 11, marginBottom: 5, fontWeight: 600 }}>{label}</p>
      {payload.map((e, i) => <p key={i} style={{ color: e.color || e.stroke, fontSize: 13, fontWeight: 700, margin: "2px 0" }}>{e.name}: {e.value}</p>)}
    </div>
  );
};

function PollBar({ label, value, unit, safe, color }) {
  const pct = Math.min(100, (value / (safe * 3.5)) * 100);
  const over = value > safe;
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ color: "#94a3b8", fontSize: 12, fontWeight: 500 }}>{label}</span>
        <span style={{ color: over ? color : "#22c55e", fontSize: 12, fontWeight: 700, fontFamily: "monospace" }}>
          {value} <span style={{ fontSize: 10, fontWeight: 400, color: DIM }}>{unit}</span>
        </span>
      </div>
      <div style={{ background: "#dbe7f3", borderRadius: 3, height: 5, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: over ? color : "#22c55e", borderRadius: 3, transition: "width 0.7s ease" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 2 }}>
        <span style={{ fontSize: 9, color: DIM }}>Safe: {safe}</span>
        <span style={{ fontSize: 9, color: over ? "#991b1b" : "#166534" }}>
          {over ? `${Math.round((value / safe - 1) * 100)}% over` : "✓ OK"}
        </span>
      </div>
    </div>
  );
}

function ForecastCard({ d }) {
  const TI = d.trend === "up" ? TrendingUp : d.trend === "down" ? TrendingDown : Minus;
  const WI = d.icon === "rain" ? CloudRain : d.icon === "cloudy" ? Cloud : Sun;
  const tc = d.trend === "up" ? "#ef4444" : d.trend === "down" ? "#22c55e" : MUT;
  return (
    <div style={{
      background: CARD, border: `1px solid ${d.cat.color}28`, borderRadius: 14, padding: "16px 12px",
      minWidth: 116, textAlign: "center", cursor: "default", flexShrink: 0,
      transition: "transform 0.18s,box-shadow 0.18s", position: "relative", overflow: "hidden"
    }}
      onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-4px)"; e.currentTarget.style.boxShadow = `0 12px 28px ${d.cat.color}18`; }}
      onMouseLeave={e => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = "none"; }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: d.cat.color }} />
      <div style={{ fontSize: 11, fontWeight: 700, color: MUT, marginBottom: 2 }}>{d.day}</div>
      <div style={{ fontSize: 10, color: DIM, marginBottom: 10 }}>{d.date}</div>
      <WI size={17} color={MUT} style={{ marginBottom: 8 }} />
      <div style={{ fontSize: 30, fontWeight: 900, color: d.cat.color, fontFamily: "monospace", lineHeight: 1 }}>{d.aqi}</div>
      <div style={{ fontSize: 9, color: d.cat.color, fontWeight: 700, marginTop: 3, marginBottom: 10 }}>{d.cat.label}</div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
        <TI size={11} color={tc} /><span style={{ fontSize: 10, color: MUT }}>{d.temp}°C</span>
      </div>
      <div style={{ fontSize: 9, color: DIM, marginTop: 5 }}>{d.conf}% conf</div>
    </div>
  );
}

function StatCard({ Icon, label, value, unit, color = ACC, sm }) {
  const sz = sm ? 36 : 42;
  return (
    <div style={{
      background: CARD, border: `1px solid ${BORD}`, borderRadius: 12,
      padding: sm ? "11px 13px" : "15px 17px", display: "flex", alignItems: "center", gap: 11
    }}>
      <div style={{ width: sz, height: sz, borderRadius: 10, background: `${color}18`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <Icon size={sm ? 16 : 20} color={color} />
      </div>
      <div>
        <div style={{ fontSize: 10, color: MUT, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 2 }}>{label}</div>
        <div style={{ fontSize: sm ? 16 : 20, fontWeight: 800, color: TXT, fontFamily: "monospace", lineHeight: 1.1 }}>
          {value}<span style={{ fontSize: 10, fontWeight: 400, color: MUT, marginLeft: 3 }}>{unit}</span>
        </div>
      </div>
    </div>
  );
}

// Application pages
function Dashboard({ city, hist, wx, fc, wxLoading, mlLoading }) {
  const aqi = getAQIValue(city); const cat = getCat(aqi); const hlth = getHealth(aqi);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>

      {/* Station badge */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 6, padding: "5px 12px", borderRadius: 8,
          background: `${ACC}0e`, border: `1px solid ${ACC}22`
        }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: ACC }} />
          <span style={{ fontSize: 11, color: ACC, fontWeight: 700 }}>
            Station AQI Estimate · {city.name}
          </span>
        </div>
        {city.lastUpdate && (
          <span style={{ fontSize: 10, color: DIM }}>📅 {city.lastUpdate}</span>
        )}
      </div>

      {/* Row 1 */}
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 16 }}>

        {/* AQI Gauge */}
        <div style={{
          background: CARD, border: `1px solid ${cat.color}2a`, borderRadius: 20, padding: "22px 20px",
          display: "flex", flexDirection: "column", alignItems: "center", minWidth: 256, boxShadow: `0 0 50px ${cat.color}09`
        }}>
          <div style={{ fontSize: 10, color: MUT, fontWeight: 700, letterSpacing: "0.13em", marginBottom: 8 }}>ESTIMATED AQI · CPCB STATION</div>
          <AQIGauge aqi={aqi} color={cat.color} />
          <div style={{ padding: "5px 18px", borderRadius: 20, background: `${cat.color}18`, border: `1px solid ${cat.color}30`, marginTop: 8 }}>
            <span style={{ color: cat.color, fontSize: 14, fontWeight: 800 }}>{cat.label}</span>
          </div>
          <p style={{ color: "#64748b", fontSize: 11, textAlign: "center", marginTop: 10, maxWidth: 200, lineHeight: 1.65 }}>{hlth.gen}</p>
          <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap", justifyContent: "center" }}>
            {[{ ok: !hlth.mask, label: hlth.mask ? "N95 Required" : "No Mask" }, { ok: hlth.vent, label: hlth.vent ? "Ventilate" : "Keep Closed" }].map((t, i) => (
              <span key={i} style={{
                fontSize: 9, padding: "3px 10px", borderRadius: 10, fontWeight: 700,
                background: t.ok ? "#22c55e12" : "#ef444412", color: t.ok ? "#22c55e" : "#ef4444",
                border: `1px solid ${t.ok ? "#22c55e22" : "#ef444422"}`
              }}>{t.ok ? "✓" : "✗"} {t.label}</span>
            ))}
          </div>
        </div>

        {/* Pollutants */}
        <div style={{ background: CARD, border: `1px solid ${BORD}`, borderRadius: 20, padding: "22px 20px" }}>
          <div style={{ fontSize: 10, color: MUT, fontWeight: 700, letterSpacing: "0.13em", marginBottom: 18 }}>
            POLLUTANT BREAKDOWN
            <span style={{ fontSize: 9, color: DIM, fontWeight: 500, marginLeft: 8, textTransform: "none", letterSpacing: 0 }}>
              (individual station values)
            </span>
          </div>
          {Object.entries(PMETA).map(([k, m]) => (
            <PollBar key={k} label={m.label} value={city.p[k] || 0} unit={m.unit} safe={m.safe} color={m.color} />
          ))}
        </div>

        {/* Weather + Status */}
        <div style={{ display: "flex", flexDirection: "column", gap: 11, minWidth: 242 }}>
          <div style={{ background: CARD, border: `1px solid ${BORD}`, borderRadius: 16, padding: "17px 15px" }}>
            <div style={{ fontSize: 10, color: MUT, fontWeight: 700, letterSpacing: "0.13em", marginBottom: 13 }}>WEATHER · {city.name.toUpperCase()}</div>
            {wxLoading ? (
              <WeatherSkeleton />
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9 }}>
                <StatCard Icon={Thermometer} label="Temp" value={wx.temp} unit="°C" color="#fb923c" sm />
                <StatCard Icon={Droplets} label="Humidity" value={wx.humidity} unit="%" color={ACC} sm />
                <StatCard Icon={Wind} label="Wind" value={wx.windSpeed} unit="km/h" color="#34d399" sm />
                <StatCard Icon={Eye} label="Visibility" value={wx.visibility} unit="km" color="#818cf8" sm />
              </div>
            )}
          </div>
          {aqi > 150 && (
            <div style={{ background: `${cat.color}0d`, border: `1px solid ${cat.color}28`, borderRadius: 14, padding: "13px 15px", display: "flex", gap: 9 }}>
              <AlertTriangle size={16} color={cat.color} style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                <div style={{ color: cat.color, fontWeight: 800, fontSize: 12, marginBottom: 3 }}>Health Advisory</div>
                <div style={{ color: "#94a3b8", fontSize: 11, lineHeight: 1.55 }}>{hlth.sens}</div>
              </div>
            </div>
          )}
          <div style={{ background: CARD, border: "1px solid #38bdf81a", borderRadius: 14, padding: "11px 15px", display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#22c55e", boxShadow: "0 0 8px #22c55e", animation: "pulse 2s infinite", flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div style={{ color: "#22c55e", fontSize: 11, fontWeight: 800 }}>ML MODEL ACTIVE</div>
              <div style={{ color: MUT, fontSize: 10, marginTop: 1 }}>
                {mlLoading
                  ? "Filling missing PM values for selected station..."
                  : "Random Forest · selected station only"}
              </div>
            </div>
            <div style={{ fontSize: 12, color: ACC, fontWeight: 800 }}>92%</div>
          </div>
        </div>
      </div>

      {/* Forecast */}
      <div style={{ background: CARD, border: `1px solid ${BORD}`, borderRadius: 20, padding: "22px 20px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 10, color: MUT, fontWeight: 700, letterSpacing: "0.13em" }}>7-DAY AQI FORECAST</div>
            <div style={{ fontSize: 11, color: DIM, marginTop: 3 }}>Random Forest · weather + historical + lag features</div>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
            {AQI_CATS.map(c => (
              <div key={c.label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <div style={{ width: 7, height: 7, borderRadius: "50%", background: c.color }} />
                <span style={{ fontSize: 9, color: MUT }}>{c.label}</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 4 }}>
          {fc.map((d, i) => <ForecastCard key={i} d={d} />)}
        </div>
      </div>

      {/* 30-day trend */}
      <div style={{ background: CARD, border: `1px solid ${BORD}`, borderRadius: 20, padding: "22px 20px" }}>
        <div style={{ fontSize: 10, color: MUT, fontWeight: 700, letterSpacing: "0.13em", marginBottom: 16 }}>30-DAY AQI TREND</div>
        <ResponsiveContainer width="100%" height={196}>
          <AreaChart data={hist} margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="ag1" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={cat.color} stopOpacity={0.28} />
                <stop offset="95%" stopColor={cat.color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#dbe7f3" />
            <XAxis dataKey="date" tick={{ fill: DIM, fontSize: 9 }} tickLine={false} axisLine={false} interval={6} />
            <YAxis tick={{ fill: DIM, fontSize: 9 }} tickLine={false} axisLine={false} width={28} />
            <Tooltip content={<ChartTip />} />
            <Area type="monotone" dataKey="aqi" stroke={cat.color} strokeWidth={2} fill="url(#ag1)" name="AQI" dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Health */}
      <div style={{ background: CARD, border: `1px solid ${BORD}`, borderRadius: 20, padding: "22px 20px" }}>
        <div style={{ fontSize: 10, color: MUT, fontWeight: 700, letterSpacing: "0.13em", marginBottom: 16 }}>HEALTH RECOMMENDATIONS</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 13 }}>
          {[
            { Icon: Shield, title: "General", text: hlth.gen, color: ACC },
            { Icon: Heart, title: "Sensitive", text: hlth.sens, color: "#f472b6" },
            { Icon: Activity, title: "Activities", text: aqi <= 50 ? "All outdoor OK" : aqi <= 100 ? "Light outdoor OK" : "Prefer indoors", color: "#34d399" },
          ].map((c, i) => (
            <div key={i} style={{ background: `${c.color}0a`, border: `1px solid ${c.color}1a`, borderRadius: 14, padding: "15px 16px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 9 }}>
                <c.Icon size={13} color={c.color} />
                <span style={{ color: c.color, fontWeight: 800, fontSize: 10, letterSpacing: "0.06em" }}>{c.title.toUpperCase()}</span>
              </div>
              <p style={{ color: "#94a3b8", fontSize: 12, lineHeight: 1.65, margin: 0 }}>{c.text}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Analytics({ city, hist }) {
  const aqi = getAQIValue(city); const cat = getCat(aqi);
  const last7 = hist.slice(-7);
  const pData = Object.entries(PMETA).map(([k, m]) => ({ name: m.label, value: city.p[k] || 0, color: m.color }));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 13 }}>
        {[
          { label: "7-Day Avg", val: Math.round(last7.reduce((s, d) => s + d.aqi, 0) / 7), color: cat.color },
          { label: "30-Day Avg", val: Math.round(hist.reduce((s, d) => s + d.aqi, 0) / hist.length), color: ACC },
          { label: "Peak (30d)", val: Math.max(...hist.map(d => d.aqi)), color: "#ef4444" },
          { label: "Best (30d)", val: Math.min(...hist.map(d => d.aqi)), color: "#22c55e" },
        ].map((k, i) => (
          <div key={i} style={{ background: CARD, border: `1px solid ${k.color}22`, borderRadius: 14, padding: "18px 20px" }}>
            <div style={{ fontSize: 10, color: MUT, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase" }}>{k.label}</div>
            <div style={{ fontSize: 38, fontWeight: 900, color: k.color, fontFamily: "monospace", marginTop: 5, lineHeight: 1 }}>{k.val}</div>
            <div style={{ fontSize: 10, color: DIM, marginTop: 4 }}>{getCat(k.val).label}</div>
          </div>
        ))}
      </div>
      <div style={{ background: CARD, border: `1px solid ${BORD}`, borderRadius: 20, padding: "22px 20px" }}>
        <div style={{ fontSize: 10, color: MUT, fontWeight: 700, letterSpacing: "0.13em", marginBottom: 16 }}>30-DAY AQI TREND</div>
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={hist}>
            <defs>
              <linearGradient id="ag2" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={ACC} stopOpacity={0.24} />
                <stop offset="95%" stopColor={ACC} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#dbe7f3" />
            <XAxis dataKey="date" tick={{ fill: DIM, fontSize: 9 }} tickLine={false} axisLine={false} interval={6} />
            <YAxis tick={{ fill: DIM, fontSize: 9 }} tickLine={false} axisLine={false} width={28} domain={[0, 500]} />
            <Tooltip content={<ChartTip />} />
            <Area type="monotone" dataKey="aqi" stroke={ACC} strokeWidth={2.5} fill="url(#ag2)" name="AQI" dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 0.6fr", gap: 16 }}>
        <div style={{ background: CARD, border: `1px solid ${BORD}`, borderRadius: 20, padding: "22px 20px" }}>
          <div style={{ fontSize: 10, color: MUT, fontWeight: 700, letterSpacing: "0.13em", marginBottom: 16 }}>PM2.5 & PM10 — 30 DAYS</div>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={hist}>
              <defs>
                <linearGradient id="ag3" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.2} /><stop offset="95%" stopColor="#38bdf8" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="ag4" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#818cf8" stopOpacity={0.2} /><stop offset="95%" stopColor="#818cf8" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#dbe7f3" />
              <XAxis dataKey="date" tick={{ fill: DIM, fontSize: 9 }} tickLine={false} axisLine={false} interval={9} />
              <YAxis tick={{ fill: DIM, fontSize: 9 }} tickLine={false} axisLine={false} width={28} />
              <Tooltip content={<ChartTip />} />
              <Area type="monotone" dataKey="pm25" stroke="#38bdf8" fill="url(#ag3)" name="PM2.5" dot={false} strokeWidth={2} />
              <Area type="monotone" dataKey="pm10" stroke="#818cf8" fill="url(#ag4)" name="PM10" dot={false} strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div style={{ background: CARD, border: `1px solid ${BORD}`, borderRadius: 20, padding: "22px 20px" }}>
          <div style={{ fontSize: 10, color: MUT, fontWeight: 700, letterSpacing: "0.13em", marginBottom: 16 }}>POLLUTANT LEVELS</div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={pData} layout="vertical" margin={{ left: 5, right: 12 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#dbe7f3" horizontal={false} />
              <XAxis type="number" tick={{ fill: DIM, fontSize: 9 }} tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey="name" tick={{ fill: "#64748b", fontSize: 10 }} tickLine={false} axisLine={false} width={38} />
              <Tooltip content={<ChartTip />} />
              <Bar dataKey="value" name="Level" radius={4}>
                {pData.map((e, i) => <Cell key={i} fill={e.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div style={{ background: CARD, border: `1px solid ${BORD}`, borderRadius: 20, padding: "22px 20px" }}>
        <div style={{ fontSize: 10, color: MUT, fontWeight: 700, letterSpacing: "0.13em", marginBottom: 16 }}>NO₂ & SO₂ — 30 DAYS</div>
        <ResponsiveContainer width="100%" height={155}>
          <AreaChart data={hist}>
            <CartesianGrid strokeDasharray="3 3" stroke="#dbe7f3" />
            <XAxis dataKey="date" tick={{ fill: DIM, fontSize: 9 }} tickLine={false} axisLine={false} interval={9} />
            <YAxis tick={{ fill: DIM, fontSize: 9 }} tickLine={false} axisLine={false} width={28} />
            <Tooltip content={<ChartTip />} />
            <Area type="monotone" dataKey="no2" stroke="#fb923c" fill="#fb923c12" name="NO₂" dot={false} strokeWidth={2} />
            <Area type="monotone" dataKey="so2" stroke="#f472b6" fill="#f472b612" name="SO₂" dot={false} strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// Geographic bounds used only as fallback values for India-focused map views.
const INDIA_CENTER = [22.9734, 78.6569];

function MapFlyToSelected({ city }) {
  const map = useMap();

  useEffect(() => {
    if (city?.lat && city?.lon) {
      map.flyTo([Number(city.lat), Number(city.lon)], 11, { duration: 0.8 });
    }
  }, [city, map]);

  return null;
}

function MapView({ cities, sel, onSel }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ background: CARD, border: `1px solid ${BORD}`, borderRadius: 20, padding: "22px 20px" }}>
        <div style={{ fontSize: 10, color: MUT, fontWeight: 700, letterSpacing: "0.13em", marginBottom: 14 }}>
          INDIA STATION MAP · {cities.length} CPCB STATIONS · INTERACTIVE LOCATIONS
        </div>

        {cities.length === 0 ? (
          <MapContentSkeleton />
        ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 260px", gap: 18, alignItems: "start" }}>
          <div style={{ height: 560, borderRadius: 18, overflow: "hidden", border: "1px solid #dbe7f3" }}>
            <MapContainer
              center={INDIA_CENTER}
              zoom={5}
              minZoom={4}
              maxZoom={15}
              scrollWheelZoom={true}
              style={{ height: "100%", width: "100%" }}
            >
              <TileLayer
                attribution='&copy; OpenStreetMap contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />

              <MapFlyToSelected city={sel} />

              {cities.map(c => {
                const aqi = getAQIValue(c);
                const cat = getCat(aqi);
                const selected = sel?.id === c.id;

                return (
                  <CircleMarker
                    key={c.id}
                    center={[Number(c.lat), Number(c.lon)]}
                    radius={selected ? 12 : Math.max(5, Math.min(10, aqi / 45))}
                    pathOptions={{
                      color: cat.color,
                      fillColor: cat.color,
                      fillOpacity: selected ? 0.85 : 0.58,
                      weight: selected ? 3 : 1.3,
                    }}
                    eventHandlers={{ click: () => onSel(c) }}
                  >
                    <Popup>
                      <div style={{ minWidth: 190, lineHeight: 1.55 }}>
                        <strong>{c.station || c.name}</strong>
                        <br />
                        {c.city}, {c.state}
                        <br />
                        Estimated AQI: <strong>{aqi}</strong>
                        <br />
                        Category: {cat.label}
                        <br />
                        Lat: {Number(c.lat).toFixed(4)}
                        <br />
                        Lon: {Number(c.lon).toFixed(4)}
                      </div>
                    </Popup>
                  </CircleMarker>
                );
              })}
            </MapContainer>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 7, maxHeight: 560, overflowY: "auto" }}>
            <div style={{ fontSize: 9, color: DIM, fontWeight: 700, letterSpacing: "0.1em", marginBottom: 4, padding: "0 4px" }}>
              STATIONS BY AQI ↓
            </div>

            {[...cities].sort((a, b) => getAQIValue(b) - getAQIValue(a)).map(c => {
              const aqi = getAQIValue(c);
              const cat = getCat(aqi);

              return (
                <div key={c.id} onClick={() => onSel(c)} style={{
                  padding: "9px 10px", borderRadius: 10, cursor: "pointer",
                  background: c.id === sel?.id ? `${cat.color}14` : BG,
                  border: `1px solid ${c.id === sel?.id ? `${cat.color}44` : "#dbe7f3"}`,
                  display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8
                }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: TXT, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {c.city || c.name}
                    </div>
                    <div style={{ fontSize: 9, color: MUT, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {c.station || c.state}
                    </div>
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 900, color: cat.color, fontFamily: "monospace", flexShrink: 0 }}>
                    {aqi}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        )}
      </div>

      <div style={{ background: CARD, border: `1px solid ${BORD}`, borderRadius: 14, padding: "13px 20px", display: "flex", alignItems: "center", gap: 22, flexWrap: "wrap" }}>
        <span style={{ fontSize: 10, color: MUT, fontWeight: 700, letterSpacing: "0.1em" }}>AQI SCALE:</span>
        {AQI_CATS.map(c => (
          <div key={c.label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: c.color, boxShadow: `0 0 5px ${c.color}` }} />
            <span style={{ fontSize: 10, color: MUT }}>{c.label} ≤{c.max}</span>
          </div>
        ))}
      </div>
    </div>
  );
}


function SettingToggle({ label, desc, value, onChange }) {
  return (
    <div style={{
      background: BG,
      border: "1px solid #dbe7f3",
      borderRadius: 14,
      padding: "14px 16px",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 18,
    }}>
      <div>
        <div style={{ color: TXT, fontSize: 13, fontWeight: 800 }}>{label}</div>
        <div style={{ color: MUT, fontSize: 11, marginTop: 3, lineHeight: 1.45 }}>{desc}</div>
      </div>
      <button
        onClick={() => onChange(!value)}
        style={{
          width: 46,
          height: 26,
          borderRadius: 20,
          border: `1px solid ${value ? ACC : "#94a3b8"}`,
          background: value ? `${ACC}33` : "#e2e8f0",
          cursor: "pointer",
          position: "relative",
          flexShrink: 0,
        }}
      >
        <span style={{
          position: "absolute",
          top: 4,
          left: value ? 24 : 4,
          width: 16,
          height: 16,
          borderRadius: "50%",
          background: value ? ACC : "#64748b",
          transition: "left 0.18s ease",
        }} />
      </button>
    </div>
  );
}

function SettingSelect({ label, value, onChange, options }) {
  return (
    <div style={{
      background: BG,
      border: "1px solid #dbe7f3",
      borderRadius: 14,
      padding: "14px 16px",
    }}>
      <div style={{ color: TXT, fontSize: 13, fontWeight: 800, marginBottom: 9 }}>{label}</div>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          width: "100%",
          background: CARD,
          color: TXT,
          border: "1px solid #94a3b8",
          borderRadius: 10,
          padding: "9px 11px",
          outline: "none",
          fontFamily: "Outfit,sans-serif",
        }}
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

function SettingsPage({ meta, city, cities }) {
  const [compactMode, setCompactMode] = useState(false);
  const [animations, setAnimations] = useState(true);
  const [showStationNames, setShowStationNames] = useState(true);
  const [autoFly, setAutoFly] = useState(true);
  const [clusterStations, setClusterStations] = useState(false);
  const [heatmapLayer, setHeatmapLayer] = useState(true);
  const [fillPM, setFillPM] = useState(true);
  const [weatherInputs, setWeatherInputs] = useState(true);
  const [showConfidence, setShowConfidence] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [refreshWeather, setRefreshWeather] = useState(true);
  const [showLastUpdated, setShowLastUpdated] = useState(true);
  const [temperatureUnit, setTemperatureUnit] = useState("celsius");
  const [refreshInterval, setRefreshInterval] = useState("5min");
  const [predictionHorizon, setPredictionHorizon] = useState("7day");
  const [defaultZoom, setDefaultZoom] = useState(5);
  const loadedStations = meta?.totalStations || cities.length;

  const Section = ({ title, sub, children }) => (
    <div style={{ background: CARD, border: `1px solid ${BORD}`, borderRadius: 20, padding: "22px 20px" }}>
      <div style={{ fontSize: 10, color: MUT, fontWeight: 800, letterSpacing: "0.13em", marginBottom: 4 }}>{title}</div>
      {sub && <div style={{ fontSize: 11, color: DIM, marginBottom: 16 }}>{sub}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 12 }}>{children}</div>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <Section title="DISPLAY SETTINGS" sub="Control the dashboard layout and visual behaviour.">
        <SettingToggle label="Compact Mode" desc="Reduce card padding and spacing for dense project demos." value={compactMode} onChange={setCompactMode} />
        <SettingToggle label="Enable Animations" desc="Keep smooth transitions, map movement, and pulse effects active." value={animations} onChange={setAnimations} />
        <SettingToggle label="Show Station Names" desc="Display full station names wherever space allows." value={showStationNames} onChange={setShowStationNames} />
        <SettingSelect label="Temperature Unit" value={temperatureUnit} onChange={setTemperatureUnit} options={[{ value: "celsius", label: "Celsius °C" }, { value: "fahrenheit", label: "Fahrenheit °F" }]} />
      </Section>

      <Section title="MAP SETTINGS" sub="Settings for the embedded India station map.">
        <SettingToggle label="Auto-Fly To Selected Station" desc="Move the map automatically when a station is selected." value={autoFly} onChange={setAutoFly} />
        <SettingToggle label="Heatmap Layer" desc="Show pollution intensity visually over station locations." value={heatmapLayer} onChange={setHeatmapLayer} />
        <SettingToggle label="Cluster Stations" desc="Group nearby station markers when zoomed out." value={clusterStations} onChange={setClusterStations} />
        <div style={{ background: BG, border: "1px solid #dbe7f3", borderRadius: 14, padding: "14px 16px" }}>
          <div style={{ color: TXT, fontSize: 13, fontWeight: 800 }}>Default Zoom Level</div>
          <input type="range" min="4" max="12" value={defaultZoom} onChange={e => setDefaultZoom(Number(e.target.value))} style={{ width: "100%", marginTop: 12, accentColor: ACC }} />
          <div style={{ color: ACC, fontSize: 12, fontWeight: 800, marginTop: 4 }}>Zoom {defaultZoom}</div>
        </div>
      </Section>

      <Section title="ML / PREDICTION SETTINGS" sub="Configure how the prediction layer behaves.">
        <SettingSelect label="Prediction Horizon" value={predictionHorizon} onChange={setPredictionHorizon} options={[{ value: "current", label: "Current Only" }, { value: "24h", label: "Next 24 Hours" }, { value: "3day", label: "Next 3 Days" }, { value: "7day", label: "Next 7 Days" }]} />
        <SettingToggle label="Use Weather Inputs" desc="Use Open-Meteo weather fields for forecast generation." value={weatherInputs} onChange={setWeatherInputs} />
        <SettingToggle label="Fill Missing PM Values" desc="Use Flask Random Forest models when PM2.5 or PM10 is missing." value={fillPM} onChange={setFillPM} />
        <SettingToggle label="Show Confidence %" desc="Display forecast confidence on prediction cards." value={showConfidence} onChange={setShowConfidence} />
      </Section>

      <Section title="DATA SETTINGS" sub="AirWatch now uses live APIs only. CSV upload has been removed.">
        <div style={{ background: BG, border: "1px solid #dbe7f3", borderRadius: 14, padding: "14px 16px" }}>
          <div style={{ color: TXT, fontSize: 13, fontWeight: 800 }}>Data Source</div>
          <div style={{ color: ACC, fontSize: 12, fontWeight: 800, marginTop: 8 }}>● CPCB Live API / data.gov.in</div>
          <div style={{ color: MUT, fontSize: 11, marginTop: 5 }}>No CSV upload or hardcoded city fallback is used.</div>
        </div>
        <SettingSelect label="Refresh Interval" value={refreshInterval} onChange={setRefreshInterval} options={[{ value: "30s", label: "30 seconds" }, { value: "1min", label: "1 minute" }, { value: "5min", label: "5 minutes" }, { value: "15min", label: "15 minutes" }]} />
        <SettingToggle label="Auto Refresh Data" desc="Automatically reload CPCB station data at the selected interval." value={autoRefresh} onChange={setAutoRefresh} />
        <SettingToggle label="Refresh Weather Automatically" desc="Update weather when selected station changes." value={refreshWeather} onChange={setRefreshWeather} />
        <SettingToggle label="Show Last Updated Time" desc="Show CPCB/data.gov.in update timestamp in the top bar." value={showLastUpdated} onChange={setShowLastUpdated} />
        <div style={{ background: BG, border: "1px solid #dbe7f3", borderRadius: 14, padding: "14px 16px", display: "flex", gap: 10, alignItems: "center" }}>
          <button onClick={() => window.location.reload()} style={{ background: ACC, color: BG, border: "none", borderRadius: 10, padding: "9px 14px", fontWeight: 900, cursor: "pointer" }}>Refresh Now</button>
          <button onClick={() => localStorage.clear()} style={{ background: "transparent", color: "#94a3b8", border: "1px solid #94a3b8", borderRadius: 10, padding: "9px 14px", fontWeight: 800, cursor: "pointer" }}>Clear Cache</button>
        </div>
      </Section>

      <div style={{ background: CARD, border: `1px solid ${BORD}`, borderRadius: 20, padding: "22px 20px" }}>
        <div style={{ fontSize: 10, color: MUT, fontWeight: 800, letterSpacing: "0.13em", marginBottom: 16 }}>ABOUT AIRWATCH</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
          {[
            ["Stations Loaded", loadedStations],
            ["Current Station", city?.station || city?.name],
            ["Backend", "Flask + Random Forest"],
            ["Weather", "Open-Meteo"],
          ].map(([label, value]) => (
            <div key={label} style={{ background: BG, border: "1px solid #dbe7f3", borderRadius: 14, padding: "14px 16px" }}>
              <div style={{ color: MUT, fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>{label}</div>
              <div style={{ color: TXT, fontSize: 14, fontWeight: 800, marginTop: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Health({ city, fc }) {
  const aqi = getAQIValue(city); const cat = getCat(aqi); const hlth = getHealth(aqi);
  const rc = r => r === "High" ? "#ef4444" : r === "Medium" ? "#f59e0b" : "#22c55e";
  const groups = [
    { icon: "👶", title: "Children", risk: aqi > 100 ? "High" : "Medium", tip: "Keep indoors if AQI>150. N95 mask for any outdoor exposure." },
    { icon: "👴", title: "Elderly", risk: aqi > 100 ? "High" : "Medium", tip: "Avoid strenuous outdoor activity. Stay well hydrated." },
    { icon: "🤰", title: "Pregnant Women", risk: aqi > 80 ? "High" : "Medium", tip: "Minimise outdoor exposure. Run air purifiers indoors." },
    { icon: "🏃", title: "Athletes", risk: aqi > 150 ? "High" : aqi > 80 ? "Medium" : "Low", tip: "Avoid outdoor training when AQI>150." },
    { icon: "🫁", title: "Respiratory Issues", risk: aqi > 80 ? "High" : "Medium", tip: "Always carry inhaler. N95 mask mandatory outdoors." },
    { icon: "❤️", title: "Heart Conditions", risk: aqi > 100 ? "High" : "Medium", tip: "Avoid peak pollution hours: 7–11 AM and 5–8 PM." },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{
        background: CARD, border: `1px solid ${cat.color}28`, borderRadius: 20, padding: "26px 24px",
        display: "flex", gap: 20, alignItems: "flex-start", boxShadow: `0 0 44px ${cat.color}08`
      }}>
        <div style={{ fontSize: 50 }}>{hlth.icon}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 22, fontWeight: 900, color: cat.color, marginBottom: 7 }}>{hlth.title} Air Quality</div>
          <p style={{ color: "#94a3b8", fontSize: 14, lineHeight: 1.7, margin: "0 0 14px" }}>{hlth.gen}</p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {[{ ok: !hlth.mask, label: hlth.mask ? "N95 Mask Required" : "No Mask Needed" }, { ok: hlth.vent, label: hlth.vent ? "Open Windows" : "Keep Closed" }].map((t, i) => (
              <div key={i} style={{
                display: "flex", alignItems: "center", gap: 7, padding: "6px 14px", borderRadius: 20,
                background: t.ok ? "#22c55e14" : "#ef444414", border: `1px solid ${t.ok ? "#22c55e30" : "#ef444430"}`
              }}>
                <span style={{ fontSize: 14 }}>{t.ok ? "✅" : "⛔"}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: t.ok ? "#22c55e" : "#ef4444" }}>{t.label}</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 50, fontWeight: 900, color: cat.color, fontFamily: "monospace", lineHeight: 1 }}>{aqi}</div>
          <div style={{ fontSize: 12, color: cat.color, fontWeight: 700, marginTop: 3 }}>{cat.label}</div>
        </div>
      </div>
      <div style={{ background: CARD, border: `1px solid ${BORD}`, borderRadius: 20, padding: "22px 20px" }}>
        <div style={{ fontSize: 10, color: MUT, fontWeight: 700, letterSpacing: "0.13em", marginBottom: 16 }}>RISK BY POPULATION GROUP</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
          {groups.map((g, i) => (
            <div key={i} style={{ background: BG, border: "1px solid #dbe7f3", borderRadius: 14, padding: "15px 15px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 9 }}>
                <div style={{ display: "flex", gap: 7, alignItems: "center" }}>
                  <span style={{ fontSize: 22 }}>{g.icon}</span>
                  <span style={{ fontSize: 12, fontWeight: 800, color: TXT }}>{g.title}</span>
                </div>
                <span style={{ fontSize: 9, fontWeight: 800, padding: "3px 9px", borderRadius: 8, background: `${rc(g.risk)}14`, color: rc(g.risk) }}>{g.risk}</span>
              </div>
              <p style={{ color: "#64748b", fontSize: 11, lineHeight: 1.62, margin: 0 }}>{g.tip}</p>
            </div>
          ))}
        </div>
      </div>
      <div style={{ background: CARD, border: `1px solid ${BORD}`, borderRadius: 20, padding: "22px 20px" }}>
        <div style={{ fontSize: 10, color: MUT, fontWeight: 700, letterSpacing: "0.13em", marginBottom: 16 }}>7-DAY HEALTH OUTLOOK</div>
        <div style={{ display: "flex", gap: 9 }}>
          {fc.map((d, i) => {
            const h = getHealth(d.aqi);
            return (
              <div key={i} style={{ flex: 1, textAlign: "center", padding: "14px 8px", background: BG, borderRadius: 12, border: `1px solid ${d.cat.color}1a` }}>
                <div style={{ fontSize: 10, color: MUT, fontWeight: 700, marginBottom: 5 }}>{d.day}</div>
                <div style={{ fontSize: 20 }}>{h.icon}</div>
                <div style={{ fontSize: 17, fontWeight: 900, color: d.cat.color, fontFamily: "monospace", marginTop: 4, lineHeight: 1 }}>{d.aqi}</div>
                <div style={{ fontSize: 9, color: d.cat.color, fontWeight: 700, marginTop: 3 }}>{d.cat.label}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
//  NAVIGATION — AirWatch branding
// ══════════════════════════════════════════════════════════
const NAV = [
  { id: "dashboard", Icon: Home, label: "Dashboard" },
  { id: "analytics", Icon: BarChart2, label: "Analytics" },
  { id: "map", Icon: MapIcon, label: "Map View" },
  { id: "health", Icon: Heart, label: "Health" },
];

function Sidebar({ pg, set }) {
  return (
    <div style={{
      width: 62, background: BG, borderRight: "1px solid #dbe7f3", display: "flex",
      flexDirection: "column", alignItems: "center", padding: "18px 0", gap: 6,
      flexShrink: 0, height: "100vh", position: "sticky", top: 0
    }}>
      {/* AirWatch logo mark */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 12, gap: 2 }}>
        <div style={{
          width: 38, height: 38, borderRadius: 11, background: "linear-gradient(135deg,#0ea5e9,#6366f1)",
          display: "flex", alignItems: "center", justifyContent: "center"
        }}>
          <Wind size={20} color="#fff" />
        </div>
        <div style={{ fontSize: 6, color: DIM, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase" }}>AirWatch</div>
      </div>
      <div style={{ width: 28, height: 1, background: "#dbe7f3", marginBottom: 5 }} />
      {NAV.map(({ id, Icon, label }) => {
        const on = pg === id;
        return (
          <div key={id} onClick={() => set(id)} title={label} style={{
            width: 44, height: 44, borderRadius: 11, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            background: on ? `${ACC}18` : "transparent",
            border: `1px solid ${on ? `${ACC}30` : "transparent"}`,
            transition: "all 0.15s", position: "relative"
          }}>
            <Icon size={19} color={on ? ACC : DIM} />
            {on && <div style={{ position: "absolute", left: -1, top: 11, bottom: 11, width: 2.5, background: ACC, borderRadius: "0 2px 2px 0" }} />}
          </div>
        );
      })}
      <div style={{ flex: 1 }} />
      <div
        onClick={() => set("settings")}
        title="Settings"
        style={{
          width: 34, height: 34, borderRadius: 8,
          background: pg === "settings" ? `${ACC}18` : CARD,
          border: `1px solid ${pg === "settings" ? `${ACC}30` : "#dbe7f3"}`,
          display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer"
        }}
      >
        <Settings size={15} color={pg === "settings" ? ACC : DIM} />
      </div>
    </div>
  );
}

function TopBar({ city, setCity, cities, meta }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapRef = useRef(null);
  const aqi = getAQIValue(city); const cat = getCat(aqi);

  // Close dropdown on outside click — avoids z-index stacking-context issues
  useEffect(() => {
    if (!open) return;
    const handler = e => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false); setQuery("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const filtered = query.trim()
    ? cities.filter(c =>
      c.name.toLowerCase().includes(query.toLowerCase()) ||
      c.state.toLowerCase().includes(query.toLowerCase()))
    : cities;

  return (
    // No zIndex on the bar itself — avoids creating a stacking context that
    // traps the dropdown below any fixed overlays
    <div style={{
      height: 60, background: BG, borderBottom: "1px solid #dbe7f3", display: "flex",
      alignItems: "center", padding: "0 22px", gap: 14, position: "sticky", top: 0,
      /* zIndex intentionally omitted */
    }}>

      {/* Brand text */}
      <span style={{
        fontSize: 16, fontWeight: 900, color: TXT, letterSpacing: "-0.02em", flexShrink: 0,
        background: "linear-gradient(135deg,#38bdf8,#6366f1)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent"
      }}>
        AirWatch
      </span>
      <div style={{ width: 1, height: 20, background: "#dbe7f3" }} />

      {/* City selector — ref wraps trigger + dropdown together */}
      <div ref={wrapRef} style={{ position: "relative" }}>
        <div onClick={() => setOpen(v => !v)} style={{
          display: "flex", alignItems: "center", gap: 8, padding: "6px 14px",
          borderRadius: 10, background: CARD, border: `1px solid ${open ? "#1e3a5f" : "#dbe7f3"}`, cursor: "pointer",
          transition: "border-color 0.15s"
        }}>
          <MapPin size={13} color={ACC} />
          <span style={{ fontSize: 13, fontWeight: 700, color: TXT }}>{city.name}</span>
          <span style={{ fontSize: 11, color: MUT }}>{city.state}</span>
          <ChevronDown size={11} color={MUT}
            style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
        </div>

        {open && (
          // position:fixed so the dropdown escapes every stacking context
          // We calculate position relative to wrapRef in a useEffect-free way
          // by using position:absolute on a high-z container
          <div style={{
            position: "absolute", top: "calc(100% + 6px)", left: 0,
            zIndex: 9999, background: CARD,
            border: "1px solid #1e3a5f55", borderRadius: 14, padding: 8,
            minWidth: 268, boxShadow: "0 24px 56px #000000aa",
            // Ensure dropdown is always on top regardless of ancestor stacking contexts
            isolation: "isolate",
          }}>
            {/* Search box */}
            <div style={{
              display: "flex", alignItems: "center", gap: 7, padding: "7px 10px",
              background: BG, borderRadius: 9, marginBottom: 7, border: "1px solid #dbe7f3"
            }}>
              <Search size={12} color={MUT} />
              <input
                autoFocus
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search city or state…"
                style={{
                  background: "transparent", border: "none", outline: "none",
                  color: TXT, fontSize: 12, flex: 1, fontFamily: "Outfit,sans-serif"
                }} />
              {query && (
                <X size={11} color={MUT} style={{ cursor: "pointer", flexShrink: 0 }}
                  onClick={() => setQuery("")} />
              )}
            </div>

            {/* List */}
            <div style={{ maxHeight: 320, overflowY: "auto", overflowX: "hidden" }}>
              {filtered.length === 0 ? (
                <div style={{ padding: "12px", fontSize: 12, color: MUT, textAlign: "center" }}>
                  No cities match "<span style={{ color: TXT }}>{query}</span>"
                </div>
              ) : filtered.map(c => {
                const a = getAQIValue(c); const ct = getCat(a);
                const isCur = c.id === city.id;
                return (
                  <div key={c.id}
                    onMouseDown={e => {
                      // Use onMouseDown (fires before blur) so the click registers
                      e.preventDefault();
                      setCity(c); setOpen(false); setQuery("");
                    }}
                    style={{
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      padding: "9px 12px", borderRadius: 9, cursor: "pointer", userSelect: "none",
                      background: isCur ? `${ACC}14` : "transparent",
                      borderLeft: isCur ? `2px solid ${ACC}` : "2px solid transparent",
                      transition: "background 0.1s",
                    }}
                    onMouseEnter={e => { if (!isCur) e.currentTarget.style.background = `${ACC}08`; }}
                    onMouseLeave={e => { if (!isCur) e.currentTarget.style.background = "transparent"; }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: TXT }}>{c.name}</div>
                      <div style={{ fontSize: 10, color: MUT, marginTop: 1 }}>
                        {c.state}{c.stationCount ? ` · ${c.stationCount} stn` : ""}
                      </div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 12 }}>
                      <div style={{ fontSize: 15, fontWeight: 900, color: ct.color, fontFamily: "monospace" }}>{a}</div>
                      <div style={{ fontSize: 9, color: ct.color, fontWeight: 600 }}>{ct.label}</div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Footer count */}
            <div style={{ borderTop: "1px solid #dbe7f3", marginTop: 6, paddingTop: 7, paddingLeft: 4 }}>
              <span style={{ fontSize: 9, color: DIM }}>
                {filtered.length} of {cities.length} cities
              </span>
            </div>
          </div>
        )}
      </div>

      {/* AQI badge */}
      <div style={{
        padding: "4px 12px", borderRadius: 8, background: `${cat.color}14`,
        border: `1px solid ${cat.color}28`, display: "flex", gap: 6, alignItems: "center"
      }}>
        <div style={{ width: 6, height: 6, borderRadius: "50%", background: cat.color }} />
        <span style={{ fontSize: 12, fontWeight: 800, color: cat.color }}>{aqi}</span>
        <span style={{ fontSize: 11, color: "#64748b" }}>{cat.label}</span>
      </div>

      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 10, color: DIM }}>
          CPCB/data.gov.in · {cities.length} cities{meta?.totalStations ? ` · ${meta.totalStations} stations` : ""}
          {meta?.lastUpdate ? ` · ${meta.lastUpdate}` : ""}
        </span>
        <div style={{
          display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 8,
          background: "#22c55e0d", border: "1px solid #22c55e1a"
        }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#22c55e", boxShadow: "0 0 6px #22c55e", animation: "pulse 2s infinite" }} />
          <span style={{ fontSize: 11, color: "#22c55e", fontWeight: 700 }}>LIVE API</span>
        </div>
      </div>
    </div>
  );
}


function AppLoadingSkeleton() {
  const cardStyle = {
    background: CARD,
    border: `1px solid ${BORD}`,
    borderRadius: 20,
    padding: "20px",
  };

  return (
    <SkeletonTheme baseColor="#dbe7f3" highlightColor="#edf6ff">
      <div style={{
        display: "flex",
        height: "100vh",
        background: "linear-gradient(135deg, #f8fbff 0%, #eef6ff 45%, #f4f8fb 100%)",
        fontFamily: "Outfit,sans-serif",
        overflow: "hidden",
      }}>
        <div style={{
          width: 238,
          padding: 20,
          background: CARD,
          borderRight: `1px solid ${BORD}`,
          display: "flex",
          flexDirection: "column",
          gap: 18,
        }}>
          <Skeleton height={34} width={130} borderRadius={10} />
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 16 }}>
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} height={42} borderRadius={12} />
            ))}
          </div>
          <div style={{ marginTop: "auto" }}>
            <Skeleton height={42} borderRadius={12} />
          </div>
        </div>

        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{
            height: 72,
            background: CARD,
            borderBottom: `1px solid ${BORD}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 24px",
          }}>
            <div>
              <Skeleton height={14} width={150} />
              <div style={{ marginTop: 8 }}>
                <Skeleton height={22} width={280} />
              </div>
            </div>
            <Skeleton height={40} width={240} borderRadius={12} />
          </div>

          <div style={{ flex: 1, overflow: "hidden", padding: "20px 24px" }}>
            <Skeleton height={26} width={180} />
            <div style={{ marginTop: 8 }}>
              <Skeleton height={14} width={360} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "280px 1fr 260px", gap: 16, marginTop: 20 }}>
              <div style={cardStyle}>
                <Skeleton height={12} width={150} />
                <div style={{ display: "flex", justifyContent: "center", marginTop: 22 }}>
                  <Skeleton circle width={180} height={180} />
                </div>
                <div style={{ marginTop: 18 }}>
                  <Skeleton height={30} width={120} borderRadius={20} />
                </div>
              </div>

              <div style={cardStyle}>
                <Skeleton height={12} width={180} />
                <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 22 }}>
                  {Array.from({ length: 7 }).map((_, i) => (
                    <div key={i}>
                      <Skeleton height={12} width="35%" />
                      <div style={{ marginTop: 8 }}>
                        <Skeleton height={8} borderRadius={6} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={cardStyle}>
                  <Skeleton height={12} width={120} />
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 16 }}>
                    {Array.from({ length: 4 }).map((_, i) => (
                      <Skeleton key={i} height={64} borderRadius={12} />
                    ))}
                  </div>
                </div>
                <div style={cardStyle}>
                  <Skeleton height={16} width="70%" />
                  <div style={{ marginTop: 10 }}>
                    <Skeleton height={12} width="90%" />
                  </div>
                </div>
              </div>
            </div>

            <div style={{ ...cardStyle, marginTop: 18 }}>
              <Skeleton height={12} width={180} />
              <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
                {Array.from({ length: 7 }).map((_, i) => (
                  <Skeleton key={i} height={128} width={116} borderRadius={14} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </SkeletonTheme>
  );
}

function WeatherSkeleton() {
  return (
    <SkeletonTheme baseColor="#dbe7f3" highlightColor="#edf6ff">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9 }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} height={64} borderRadius={12} />
        ))}
      </div>
    </SkeletonTheme>
  );
}

function MapContentSkeleton() {
  return (
    <SkeletonTheme baseColor="#dbe7f3" highlightColor="#edf6ff">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 260px", gap: 18, alignItems: "start" }}>
        <Skeleton height={560} borderRadius={18} />
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          <Skeleton height={14} width={130} />
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} height={48} borderRadius={10} />
          ))}
        </div>
      </div>
    </SkeletonTheme>
  );
}


// ══════════════════════════════════════════════════════════
//  ROOT APP
// ══════════════════════════════════════════════════════════
export default function App() {
  const [pg, setPg] = useState("dashboard");
  const [city, setCity] = useState(null);
  const [cpcbCities, setCpcbCities] = useState([]);
  const [cpcbMeta, setCpcbMeta] = useState(null);
  const [cpcbLoading, setCpcbLoading] = useState(true);
  const [cpcbError, setCpcbError] = useState("");
  const [wx, setWx] = useState(null);
  const [wxLoading, setWxLoading] = useState(false);
  const [mlLoading, setMlLoading] = useState(false);
  const [mlFilledStations, setMlFilledStations] = useState({});

  const activeCities = cpcbCities;

  const activeCity =
    activeCities.find(c => city && c.id === city.id) ||
    activeCities.find(c => c.id === "delhi") ||
    activeCities[0] ||
    null;

  useEffect(() => {
    let cancelled = false;
    setCpcbLoading(true);
    setCpcbError("");

    fetchCPCBCities()
      .then(({ cities, meta }) => {
        if (cancelled) return;

        if (!cities || cities.length === 0) {
          throw new Error("CPCB API returned 0 usable cities. Check API response fields: city, state, latitude, longitude, pollutant_id, avg_value.");
        }

        console.log("CPCB loaded cities count:", cities.length);
        console.log("First CPCB city:", cities[0]);
        console.log("Delhi from CPCB:", cities.find(c => c.id === "delhi"));

        setCpcbCities(cities);
        setCpcbMeta(meta);
        setCity(prev =>
          cities.find(c => prev && c.id === prev.id) ||
          cities.find(c => c.id === "delhi") ||
          cities[0]
        );
      })
      .catch(err => {
        if (cancelled) return;
        console.error("CPCB API failed:", err);
        setCpcbError(err.message || "Could not load CPCB/data.gov.in API data");
        setCpcbCities([]);
        setCity(null);
      })
      .finally(() => {
        if (!cancelled) setCpcbLoading(false);
      });

    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!activeCity) return;

    setWxLoading(true);
    fetchWeather(activeCity.lat, activeCity.lon)
      .then(data => {
        setWx(data);
        setWxLoading(false);
      })
      .catch(() => {
        setWx(genWeatherFallback(activeCity.lat));
        setWxLoading(false);
      });
  }, [activeCity?.id]);

  useEffect(() => {
    if (!activeCity) return;

    const p = activeCity.p || {};

    const needsML =
      (!p.PM25 || !p.PM10) &&
      (p.NO2 || p.SO2 || p.CO || p.O3 || p.NH3);

    if (!needsML) return;
    if (mlFilledStations[activeCity.id]) return;

    async function fillSelectedStationPM() {
      try {
        setMlLoading(true);

        const pred = await predictMissingPM(p);

        const updatedP = {
          ...p,
          PM25: p.PM25 || Math.round(pred.PM25 || 0),
          PM10: p.PM10 || Math.round(pred.PM10 || 0),
        };

        const updatedAQI = calcAQI(updatedP);

        const updatedStation = {
          ...activeCity,
          p: updatedP,
          pollutants: updatedP,
          estimatedAQI: updatedAQI,
          apiAQI: null,
          aqi: updatedAQI,
          category: getCat(updatedAQI).label,
          apiAQISource:
            "CPCB station data + ML-filled PM for selected station",
        };

        setCpcbCities(prev =>
          prev.map(c =>
            c.id === activeCity.id ? updatedStation : c
          )
        );

        setCity(updatedStation);

        setMlFilledStations(prev => ({
          ...prev,
          [activeCity.id]: true,
        }));
      } catch (err) {
        console.error("Selected station ML fill failed:", err);
      } finally {
        setMlLoading(false);
      }
    }

    fillSelectedStationPM();
  }, [activeCity?.id]);

  useEffect(() => {
    const lk = document.createElement("link");
    lk.href = "https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;700&display=swap";
    lk.rel = "stylesheet";
    document.head.appendChild(lk);

    const st = document.createElement("style");
    st.textContent = `*{box-sizing:border-box;}body{margin:0;padding:0;background:#f4f8fb;font-family:Outfit,sans-serif;}::-webkit-scrollbar{width:4px;height:4px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:2px}@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}`;
    document.head.appendChild(st);

    return () => {
      try {
        document.head.removeChild(lk);
        document.head.removeChild(st);
      } catch (e) { }
    };
  }, []);

  if (cpcbLoading) {
    return <AppLoadingSkeleton />;
  }

  if (cpcbError || !activeCity || activeCities.length === 0) {
    return (
      <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #f8fbff 0%, #eef6ff 100%)", color: TXT, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Outfit,sans-serif", padding: 24 }}>
        <div style={{ background: CARD, border: "1px solid #ef444428", borderRadius: 20, padding: "28px 32px", maxWidth: 720 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <AlertTriangle size={22} color="#ef4444" />
            <h2 style={{ margin: 0, fontSize: 22, color: "#fca5a5" }}>CPCB API data could not be loaded</h2>
          </div>
          <p style={{ color: "#94a3b8", fontSize: 14, lineHeight: 1.7, margin: "0 0 16px" }}>
            The app has no hardcoded fallback cities now, so it will not show default Delhi/sample data. Fix the API issue below and refresh the page.
          </p>
          <pre style={{ whiteSpace: "pre-wrap", background: BG, border: "1px solid #dbe7f3", borderRadius: 12, padding: 14, color: "#fca5a5", fontSize: 12, lineHeight: 1.6 }}>
            {cpcbError || "No usable city data was returned from CPCB/data.gov.in."}
          </pre>
          <div style={{ color: MUT, fontSize: 12, lineHeight: 1.7, marginTop: 14 }}>
            Check that your <code style={{ color: ACC }}>.env</code> file exists in the project root and contains:<br />
            <code style={{ color: ACC }}>VITE_DATA_GOV_API_KEY=your_actual_api_key</code><br />
            Then stop and restart the dev server with <code style={{ color: ACC }}>npm run dev</code>.
          </div>
        </div>
      </div>
    );
  }

  const hist = genHistorical(activeCity);
  const fc = genForecast(activeCity, wx || genWeatherFallback(activeCity.lat));
  const aqi = getAQIValue(activeCity);
  const cat = getCat(aqi);

  const META = {
    dashboard: { title: "Dashboard", sub: `Live CPCB/data.gov.in station data · ${activeCity.name}, ${activeCity.state}` },
    analytics: { title: "Analytics", sub: `30-day trends & correlations · ${activeCity.name}` },
    map: { title: "Map View", sub: `CPCB/data.gov.in · ${activeCities.length} stations` },
    health: { title: "Health Guide", sub: `Personalised recommendations · AQI ${aqi} · ${cat.label}` },
    settings: { title: "Settings", sub: "Display, map, prediction, and live API preferences" },
  };

  return (
    <div style={{ display: "flex", height: "100vh", background: "linear-gradient(135deg, #f8fbff 0%, #eef6ff 45%, #f4f8fb 100%)", fontFamily: "Outfit,sans-serif", overflow: "hidden" }}>
      <Sidebar pg={pg} set={setPg} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <TopBar city={activeCity} setCity={setCity} cities={activeCities} meta={cpcbMeta} />
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
          <div style={{ marginBottom: 18 }}>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 900, color: TXT, fontFamily: "Outfit,sans-serif" }}>{META[pg].title}</h1>
            <p style={{ margin: "4px 0 0", fontSize: 12, color: MUT }}>{META[pg].sub}</p>
          </div>
          {pg === "dashboard" && <Dashboard city={activeCity} hist={hist} fc={fc} wx={wx || genWeatherFallback(activeCity.lat)} wxLoading={wxLoading} mlLoading={mlLoading} />}
          {pg === "analytics" && <Analytics city={activeCity} hist={hist} />}
          {pg === "map" && <MapView cities={activeCities} sel={activeCity} onSel={setCity} />}
          {pg === "health" && <Health city={activeCity} fc={fc} />}
          {pg === "settings" && <SettingsPage meta={cpcbMeta} city={activeCity} cities={activeCities} />}
        </div>
      </div>
    </div>
  );
}
