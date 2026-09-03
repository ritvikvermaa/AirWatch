import os
from math import atan2, cos, radians, sin, sqrt
from datetime import datetime, timezone
from time import time

import requests
from flask import Flask, request, jsonify
from flask_cors import CORS
from werkzeug.exceptions import HTTPException

app = Flask(__name__)
CORS(app)

# -------------------- CONFIG --------------------

DATA_GOV_RESOURCE_URL = "https://api.data.gov.in/resource/3b01bcb8-0b14-4abf-b6f2-c1bfd384ba69"

DATA_GOV_HEADERS = {
    "Accept": "application/json",
    "User-Agent": "Mozilla/5.0 (compatible; AirWatch/1.0)",
}

FEATURES = ["NO2", "SO2", "CO", "O3", "NH3"]

_pm25_model = None
_pm10_model = None

# ✅ CACHE — keyed by "<limit>:<offset>" so pagination is cached independently
_cache = {}

# -------------------- BASIC ROUTES --------------------

@app.route("/")
def home():
    return {
        "status": "running",
        "service": "AirWatch Backend",
        "endpoints": ["/health", "/predict-pm", "/cpcb-records", "/nearest-city"]
    }

@app.route("/health")
def health():
    return jsonify({
        "status": "UP",
        "timestamp": datetime.now(timezone.utc).isoformat()
    })

# -------------------- ERROR HANDLER --------------------

@app.errorhandler(Exception)
def handle_error(error):
    if isinstance(error, HTTPException):
        return jsonify({
            "status": "error",
            "message": error.description
        }), error.code

    app.logger.exception("Unhandled error")
    return jsonify({
        "status": "error",
        "message": "Internal backend error",
        "details": str(error)
    }), 500

# -------------------- MODEL LOADING --------------------

def load_pm_models():
    global _pm25_model, _pm10_model

    if _pm25_model is None or _pm10_model is None:
        import joblib
        here = os.path.dirname(os.path.abspath(__file__))
        _pm25_model = joblib.load(os.path.join(here, "pm25_model.pkl"))
        _pm10_model = joblib.load(os.path.join(here, "pm10_model.pkl"))

    return _pm25_model, _pm10_model

# -------------------- ROUTES --------------------

@app.route("/predict-pm", methods=["POST"])
def predict_pm():
    import pandas as pd

    data = request.json or {}
    pm25_model, pm10_model = load_pm_models()

    row = pd.DataFrame([{
        "NO2": data.get("NO2", 0),
        "SO2": data.get("SO2", 0),
        "CO": data.get("CO", 0),
        "O3": data.get("O3", 0),
        "NH3": data.get("NH3", 0),
    }])[FEATURES]

    pm25 = pm25_model.predict(row)[0]
    pm10 = pm10_model.predict(row)[0]

    return jsonify({
        "PM25": round(float(pm25)),
        "PM10": round(float(pm10))
    })

@app.route("/cpcb-records")
def cpcb_records():
    """Transparent proxy for the data.gov.in CPCB resource.

    Returns the upstream payload unchanged ({"records": [...], "total": N, ...})
    so the frontend can parse it exactly like the Vercel proxy (api/cpcb-records.js).
    The API key stays server-side.
    """
    api_key = os.environ.get("DATA_GOV_API_KEY")

    if not api_key:
        return jsonify({"status": "error", "message": "API key missing"}), 500

    limit = request.args.get("limit", "1000")
    offset = request.args.get("offset", "0")
    cache_key = f"{limit}:{offset}"

    # ✅ CACHE
    hit = _cache.get(cache_key)
    if hit and time() - hit["timestamp"] < 300:
        return jsonify(hit["data"])

    params = {
        "api-key": api_key,
        "format": "json",
        "limit": limit,
        "offset": offset,
    }

    try:
        res = requests.get(
            DATA_GOV_RESOURCE_URL,
            params=params,
            headers=DATA_GOV_HEADERS,
            timeout=20
        )

        if res.status_code != 200:
            return jsonify({
                "status": "error",
                "message": f"data.gov.in API failed: {res.status_code}",
            }), 502

        raw = res.json()

        _cache[cache_key] = {"data": raw, "timestamp": time()}

        return jsonify(raw)

    except Exception as e:
        return jsonify({
            "status": "error",
            "message": "Could not reach data.gov.in API",
            "details": str(e),
        }), 502

@app.route("/nearest-city")
def nearest_city():
    try:
        lat = float(request.args.get("lat"))
        lon = float(request.args.get("lon"))
    except:
        return jsonify({"status": "error", "message": "invalid coords"}), 400

    cities = {
        "Delhi": (28.6139, 77.2090),
        "Mumbai": (19.0760, 72.8777),
        "Bengaluru": (12.9716, 77.5946),
    }

    best = None
    best_dist = float("inf")

    for name, (clat, clon) in cities.items():
        d = haversine_km(lat, lon, clat, clon)
        if d < best_dist:
            best = name
            best_dist = d

    return jsonify({"city": best, "distance": round(best_dist, 1)})

# -------------------- UTILS --------------------

def haversine_km(lat1, lon1, lat2, lon2):
    r = 6371
    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)

    a = sin(dlat/2)**2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon/2)**2
    return r * (2 * atan2(sqrt(a), sqrt(1 - a)))

# -------------------- RUN --------------------

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)