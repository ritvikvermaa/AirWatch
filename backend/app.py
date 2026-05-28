from flask import Flask, request, jsonify
from flask_cors import CORS
import joblib
import pandas as pd

app = Flask(__name__)
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

if __name__ == "__main__":
    app.run(port=5000, debug=True)