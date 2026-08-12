import os
from math import atan2, cos, radians, sin, sqrt
from pathlib import Path
from datetime import datetime
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

# ✅ CACHE
_cache = {
    "data": None,
    "timestamp": 0
}

# -------------------- BASIC ROUTES --------------------

@app.route("/")
def home():
    return {
        "status": "running",
        "service": "AirWatch Backend",
        "endpoints": ["/health", "/predict-pm", "/cpcb-records", "/nearest-city"]
    }

@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status": "UP",
        "timestamp": datetime.utcnow().isoformat()
    }), 200

# -------------------- ERROR HANDLER --------------------

@app.errorhandler(Exception)
def handle_unexpected_error(error):
    if isinstance(error, HTTPException):
        return jsonify({
            "status": "error",
            "message": error.description,
        }), error.code

    app.logger.exception("Unhandled backend error")
    return jsonify({
        "status": "error",
        "message": "Internal backend error",
        "details": str(error),
    }), 500

# -------------------- MODEL LOADING --------------------

def load_pm_models():
    global _pm25_model, _pm10_model

    if _pm25_model is None or _pm10_model is None:
        import joblib
        _pm25_model = joblib.load("pm25_model.pkl")
        _pm10_model = joblib.load("pm10_model.pkl")

    return _pm25_model, _pm10_model

# -------------------- GROUPING LOGIC (NEW) --------------------

def group_by_station(records):
    stations = {}

    for r in records:
        city = r.get("city")
        station = r.get("station")
        pollutant = r.get("pollutant_id")
        value = r.get("pollutant_avg")

        if not city or not station or not pollutant:
            continue

        key = f"{city}-{station}"

        if key not in stations:
            stations[key] = {
                "city": city,
                "station": station,
                "pollutants": {}
            }

        try:
            value = float(value)
        except:
            continue

        stations[key]["pollutants"][pollutant] = value

    return list(stations.values())

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

@app.route("/nearest-city", methods=["GET"])
def nearest_city():
    try:
        lat = float(request.args.get("lat", ""))
        lon = float(request.args.get("lon", ""))
    except ValueError:
        return jsonify({
            "status": "error",
            "message": "lat and lon must be numbers"
        }), 400

    FALLBACK_CITY_COORDS = {
        "Delhi": (28.6139, 77.2090),
        "Mumbai": (19.0760, 72.8777),
        "Bengaluru": (12.9716, 77.5946),
        "Chandigarh": (30.7333, 76.7794),
    }

    nearest_name = None
    nearest_distance = None

    for city, (city_lat, city_lon) in FALLBACK_CITY_COORDS.items():
        distance = haversine_km(lat, lon, city_lat, city_lon)

        if nearest_distance is None or distance < nearest_distance:
            nearest_name = city
            nearest_distance = distance

    return jsonify({
        "status": "ok",
        "city": nearest_name,
        "distanceKm": round(nearest_distance, 1) if nearest_distance else None,
    })

# -------------------- FINAL CPCB ROUTE --------------------

@app.route("/cpcb-records", methods=["GET"])
def cpcb_records():
    api_key = os.environ.get("DATA_GOV_API_KEY")

    if not api_key:
        return jsonify({
            "status": "error",
            "message": "API key not set"
        }), 500

    # ✅ CACHE HIT
    if _cache["data"] and time() - _cache["timestamp"] < 300:
        return jsonify(_cache["data"])

    params = {
        "api-key": api_key,
        "format": "json",
        "limit": "1000",  # ✅ UPDATED LIMIT
    }

    try:
        res = requests.get(
            DATA_GOV_RESOURCE_URL,
            params=params,
            headers=DATA_GOV_HEADERS,
            timeout=5
        )

        if res.status_code != 200:
            return jsonify({
                "status": "ok",
                "fallback": True,
                "stations": [],
                "message": "CPCB API unavailable"
            })

        raw_data = res.json()
        records = raw_data.get("records", [])

        # ✅ GROUPING APPLIED
        grouped = group_by_station(records)

        final_data = {
            "status": "ok",
            "total_records": len(records),
            "total_stations": len(grouped),
            "stations": grouped
        }

        # ✅ CACHE STORE
        _cache["data"] = final_data
        _cache["timestamp"] = time()

        return jsonify(final_data)

    except Exception as e:
        return jsonify({
            "status": "ok",
            "fallback": True,
            "stations": [],
            "message": "CPCB fetch failed",
            "details": str(e)
        })

# -------------------- UTILS --------------------

def haversine_km(lat1, lon1, lat2, lon2):
    radius = 6371
    d_lat = radians(lat2 - lat1)
    d_lon = radians(lon2 - lon1)
    a = sin(d_lat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(d_lon / 2) ** 2
    return radius * (2 * atan2(sqrt(a), sqrt(1 - a)))

# -------------------- RUN --------------------

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)