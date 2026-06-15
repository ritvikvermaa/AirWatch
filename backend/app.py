import os

import requests
from flask import Flask, request, jsonify
from flask_cors import CORS
import joblib
import pandas as pd

app = Flask(__name__)
DATA_GOV_RESOURCE_URL = "https://api.data.gov.in/resource/3b01bcb8-0b14-4abf-b6f2-c1bfd384ba69"

@app.route("/")
def home():
    return {
        "status": "running",
        "service": "AirWatch Backend",
        "endpoints": ["/predict-pm", "/cpcb-records"]
    }
CORS(app)

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

    params = {
        "api-key": api_key,
        "format": "json",
        "limit": request.args.get("limit", "1000"),
        "offset": request.args.get("offset", "0"),
    }

    try:
        upstream = requests.get(DATA_GOV_RESOURCE_URL, params=params, timeout=8)
    except requests.RequestException as err:
        return jsonify({
            "status": "error",
            "message": "Could not reach data.gov.in API",
            "details": str(err)
        }), 502

    content_type = upstream.headers.get("content-type", "")

    if not upstream.ok:
        details = upstream.text[:500]
        if "application/json" in content_type:
            try:
                details = upstream.json()
            except ValueError:
                pass

        return jsonify({
            "status": "error",
            "message": f"data.gov.in API failed: {upstream.status_code}",
            "details": details
        }), upstream.status_code

    try:
        return jsonify(upstream.json())
    except ValueError:
        return jsonify({
            "status": "error",
            "message": "data.gov.in returned a non-JSON response",
            "details": upstream.text[:500]
        }), 502

if __name__ == "__main__":
    app.run(port=5000, debug=True)
