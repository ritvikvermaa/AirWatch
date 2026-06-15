import csv
import os
import time
from pathlib import Path

import requests
from flask import Flask, request, jsonify
from flask_cors import CORS
from werkzeug.exceptions import HTTPException
import joblib
import pandas as pd

app = Flask(__name__)
DATA_GOV_RESOURCE_URL = "https://api.data.gov.in/resource/3b01bcb8-0b14-4abf-b6f2-c1bfd384ba69"
DATA_GOV_HEADERS = {
    "Accept": "application/json",
    "User-Agent": "Mozilla/5.0 (compatible; AirWatch/1.0)",
}
MAX_CPCB_LIMIT = 100
FALLBACK_CSV_PATH = Path(__file__).with_name("aqi_training.csv")
FALLBACK_CITY_COORDS = {
    "Agra": (27.1767, 78.0081),
    "Ahmedabad": (23.0225, 72.5714),
    "Ajmer": (26.4499, 74.6399),
    "Amaravati": (16.5131, 80.5165),
    "Amritsar": (31.6340, 74.8723),
    "Asansol": (23.6739, 86.9524),
    "Aurangabad": (19.8762, 75.3433),
    "Bareilly": (28.3670, 79.4304),
    "Belgaum": (15.8497, 74.4977),
    "Bengaluru": (12.9716, 77.5946),
    "Bharatpur": (27.2152, 77.5030),
    "Bhiwadi": (28.2088, 76.8446),
    "Bhopal": (23.2599, 77.4126),
    "Bhubaneswar": (20.2961, 85.8245),
    "Chandigarh": (30.7333, 76.7794),
    "Chennai": (13.0827, 80.2707),
    "Coimbatore": (11.0168, 76.9558),
    "Cuttack": (20.4625, 85.8830),
    "Dehradun": (30.3165, 78.0322),
    "Delhi": (28.6139, 77.2090),
    "Dhanbad": (23.7957, 86.4304),
    "Durgapur": (23.5204, 87.3119),
    "Faridabad": (28.4089, 77.3178),
    "Firozabad": (27.1592, 78.3957),
    "Gandhinagar": (23.2156, 72.6369),
    "Gaya": (24.7914, 85.0002),
    "Ghaziabad": (28.6692, 77.4538),
    "Gorakhpur": (26.7606, 83.3732),
    "Greater Noida": (28.4744, 77.5040),
    "Gurugram": (28.4595, 77.0266),
    "Guwahati": (26.1445, 91.7362),
    "Gwalior": (26.2183, 78.1828),
    "Hisar": (29.1492, 75.7217),
    "Howrah": (22.5958, 88.2636),
    "Hyderabad": (17.3850, 78.4867),
    "Indore": (22.7196, 75.8577),
    "Jabalpur": (23.1815, 79.9864),
    "Jaipur": (26.9124, 75.7873),
    "Jalandhar": (31.3260, 75.5762),
    "Jhansi": (25.4484, 78.5685),
    "Jodhpur": (26.2389, 73.0243),
    "Kanpur": (26.4499, 80.3319),
    "Karnal": (29.6857, 76.9905),
    "Kolkata": (22.5726, 88.3639),
    "Kota": (25.2138, 75.8648),
    "Lucknow": (26.8467, 80.9462),
    "Ludhiana": (30.9010, 75.8573),
    "Meerut": (28.9845, 77.7064),
    "Moradabad": (28.8386, 78.7733),
    "Mumbai": (19.0760, 72.8777),
    "Muzaffarpur": (26.1209, 85.3647),
    "Mysuru": (12.2958, 76.6394),
    "Nagpur": (21.1458, 79.0882),
    "Nashik": (19.9975, 73.7898),
    "Navi Mumbai": (19.0330, 73.0297),
    "Noida": (28.5355, 77.3910),
    "Panipat": (29.3909, 76.9635),
    "Patiala": (30.3398, 76.3869),
    "Patna": (25.5941, 85.1376),
    "Prayagraj": (25.4358, 81.8463),
    "Puducherry": (11.9416, 79.8083),
    "Pune": (18.5204, 73.8567),
    "Raipur": (21.2514, 81.6296),
    "Rajkot": (22.3039, 70.8022),
    "Rishikesh": (30.0869, 78.2676),
    "Rohtak": (28.8955, 76.6066),
    "Rourkela": (22.2604, 84.8536),
    "Siliguri": (26.7271, 88.3953),
    "Solapur": (17.6599, 75.9064),
    "Sonipat": (28.9931, 77.0151),
    "Srinagar": (34.0837, 74.7973),
    "Surat": (21.1702, 72.8311),
    "Thane": (19.2183, 72.9781),
    "Thiruvananthapuram": (8.5241, 76.9366),
    "Thrissur": (10.5276, 76.2144),
    "Tirupati": (13.6288, 79.4192),
    "Udaipur": (24.5854, 73.7125),
    "Ujjain": (23.1765, 75.7885),
    "Vadodara": (22.3072, 73.1812),
    "Varanasi": (25.3176, 82.9739),
    "Vijayawada": (16.5062, 80.6480),
    "Visakhapatnam": (17.6868, 83.2185),
}

@app.route("/")
def home():
    return {
        "status": "running",
        "service": "AirWatch Backend",
        "endpoints": ["/predict-pm", "/cpcb-records"]
    }
CORS(app)

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

pm25_model = joblib.load("pm25_model.pkl")
pm10_model = joblib.load("pm10_model.pkl")

FEATURES = ["NO2", "SO2", "CO", "O3", "NH3"]

@app.route("/predict-pm", methods=["POST"])
def predict_pm():
    data = request.json or {}

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

@app.route("/cpcb-records", methods=["GET"])
def cpcb_records():
    api_key = os.environ.get("DATA_GOV_API_KEY") or os.environ.get("VITE_DATA_GOV_API_KEY")

    if not api_key:
        return jsonify({
            "status": "error",
            "message": "DATA_GOV_API_KEY is not configured on the server"
        }), 500

    try:
        limit = min(max(int(request.args.get("limit", MAX_CPCB_LIMIT)), 1), MAX_CPCB_LIMIT)
        offset = max(int(request.args.get("offset", 0)), 0)
    except ValueError:
        return jsonify({
            "status": "error",
            "message": "limit and offset must be numbers"
        }), 400

    params = {
        "api-key": api_key,
        "format": "json",
        "limit": str(limit),
        "offset": str(offset),
    }

    upstream = None
    last_error = None

    for attempt in range(2):
        try:
            upstream = requests.get(
                DATA_GOV_RESOURCE_URL,
                params=params,
                timeout=(5, 10),
                headers=DATA_GOV_HEADERS,
            )

            if upstream.status_code not in (502, 503, 504):
                break
        except requests.RequestException as err:
            last_error = err

        if attempt == 0:
            time.sleep(1.5)

    if upstream is None:
        return fallback_cpcb_response(limit, offset, f"Could not reach data.gov.in API: {last_error}")

    content_type = upstream.headers.get("content-type", "")

    if not upstream.ok:
        details = upstream.text[:500]
        if "application/json" in content_type:
            try:
                details = upstream.json()
            except ValueError:
                pass

        if upstream.status_code in (502, 503, 504):
            return fallback_cpcb_response(limit, offset, f"data.gov.in API failed: {upstream.status_code}")

        status_code = 502 if upstream.status_code >= 500 else upstream.status_code

        return jsonify({
            "status": "error",
            "message": f"data.gov.in API failed: {upstream.status_code}",
            "details": details
        }), status_code

    try:
        return jsonify(upstream.json())
    except ValueError:
        return jsonify({
            "status": "error",
            "message": "data.gov.in returned a non-JSON response",
            "details": upstream.text[:500]
        }), 502

def fallback_cpcb_response(limit, offset, reason):
    records = build_fallback_cpcb_records()
    page = records[offset:offset + limit]

    return jsonify({
        "records": page,
        "total": len(records),
        "count": len(page),
        "offset": offset,
        "limit": limit,
        "status": "ok",
        "fallback": True,
        "message": reason,
    })

def build_fallback_cpcb_records():
    if not FALLBACK_CSV_PATH.exists():
        return []

    records = []
    pollutants = ["CO", "NH3", "NO2", "O3", "PM10", "PM25", "SO2"]

    with FALLBACK_CSV_PATH.open(newline="") as csv_file:
        reader = csv.DictReader(csv_file)

        for index, row in enumerate(reader):
            city = (row.get("city") or "").strip()
            station = (row.get("station") or "").strip()
            coords = FALLBACK_CITY_COORDS.get(city)

            if not city or not station or not coords:
                continue

            lat, lon = coords
            station_offset = ((index % 9) - 4) * 0.01

            for pollutant in pollutants:
                raw_value = (row.get(pollutant) or "").strip()
                if not raw_value:
                    continue

                records.append({
                    "country": "India",
                    "state": "",
                    "city": city,
                    "station": station,
                    "latitude": round(lat + station_offset, 5),
                    "longitude": round(lon - station_offset, 5),
                    "pollutant_id": "PM2.5" if pollutant == "PM25" else pollutant,
                    "pollutant_avg": raw_value,
                    "last_update": "Fallback training data",
                })

    return records

if __name__ == "__main__":
    app.run(port=5000, debug=True)
