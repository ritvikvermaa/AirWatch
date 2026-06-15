# AirWatch AQI Platform

AirWatch is a React + Flask air-quality analytics platform for India. It uses CPCB/data.gov.in station records, Open-Meteo weather data, and a Random Forest ML backend to fill missing PM2.5/PM10 values before showing estimated AQI, pollutant breakdowns, station maps, analytics, health recommendations, and forecasts.

> Note: CPCB/data.gov.in rows provide pollutant concentration values. The current AQI shown by this app is an estimated AQI calculated from station pollutant values, not an official AQI number unless an official AQI field is added to the data source.

## Features

- Live CPCB/data.gov.in station data
- Station-level AQI view instead of city averaging
- ML-based missing PM2.5 and PM10 filling using Flask + Random Forest
- Open-Meteo weather integration
- Interactive India station map using Leaflet and OpenStreetMap
- AQI gauge, pollutant bars, analytics charts, health guidance, and 7-day forecast UI
- Settings page for display, map, prediction, and data preferences
- Clean modern dashboard UI

## Tech Stack

### Frontend

- React
- Vite
- Recharts
- Lucide React
- React Leaflet
- Leaflet

### Backend

- Python
- Flask
- Flask-CORS
- Pandas
- Scikit-learn
- Joblib
- Random Forest models

## Project Structure

```txt
AirWatch/
├── backend/
│   ├── app.py
│   ├── create_training_data.py
│   ├── train.py
│   ├── pm25_model.pkl
│   ├── pm10_model.pkl
│   └── aqi_training.csv
├── src/
│   ├── App.jsx
│   └── main.jsx
├── .env
├── .gitignore
├── package.json
└── README.md
```

## Prerequisites

Install these before running the project:

- Node.js
- npm
- Python 3.10+
- pip
- Git

## Frontend Setup

Install frontend dependencies:

```bash
npm install
```

Install the map dependencies:

```bash
npm install leaflet react-leaflet
```

Create a `.env` file in the frontend root:

```env
DATA_GOV_API_KEY=your_data_gov_api_key_here
VITE_ML_API_URL=http://127.0.0.1:5000
```

Run the frontend:

```bash
npm run dev
```

The frontend usually runs at:

```txt
http://localhost:5173
```

## Backend Setup

Go to the backend folder:

```bash
cd backend
```

Create a virtual environment:

```bash
python3 -m venv venv
```

Activate it on macOS/Linux:

```bash
source venv/bin/activate
```

Activate it on Windows:

```bash
venv\Scripts\activate
```

Install backend dependencies:

```bash
pip install flask flask-cors pandas scikit-learn joblib
```

Train the ML models if needed:

```bash
python train.py
```

Run the Flask backend:

```bash
python app.py
```

The backend should run at:

```txt
http://127.0.0.1:5000
```

The prediction endpoint used by the frontend is:

```txt
POST http://127.0.0.1:5000/predict-pm
```

## Environment Variables

Create `.env` in the frontend root:

```env
DATA_GOV_API_KEY=your_data_gov_api_key_here
VITE_ML_API_URL=http://127.0.0.1:5000
```

Do not commit `.env` to GitHub.

## Recommended `.gitignore`

Create a `.gitignore` file in the project root:

```gitignore
node_modules/
dist/
.env
.env.local

backend/venv/
backend/__pycache__/
backend/*.pyc

.DS_Store
```

## GitHub Upload Steps

### 1. Open the project folder in terminal

```bash
cd path/to/AirWatch
```

### 2. Initialize Git

```bash
git init
```

### 3. Check files

```bash
git status
```

### 4. Add files

```bash
git add .
```

### 5. Commit files

```bash
git commit -m "Initial commit: AirWatch AQI platform"
```

### 6. Create a new GitHub repository

Go to GitHub and create a new repository named:

```txt
AirWatch-AQI-Platform
```

Do not initialize it with README if you already have this README locally.

### 7. Connect local project to GitHub

Replace `your-username` with your GitHub username:

```bash
git remote add origin https://github.com/your-username/AirWatch-AQI-Platform.git
```

### 8. Push to GitHub

```bash
git branch -M main
git push -u origin main
```

## Updating GitHub After Changes

Whenever you make changes:

```bash
git status
git add .
git commit -m "Update AirWatch UI and map functionality"
git push
```

## Deployment Notes

The Flask backend can be deployed on Render. Add this Render Environment Variable:

```env
DATA_GOV_API_KEY=your_data_gov_api_key_here
```

The React frontend can be deployed on Vercel. Set the frontend environment variable to your Render backend URL:

```env
VITE_ML_API_URL=https://your-render-service.onrender.com
```

The frontend uses `VITE_ML_API_URL` for both:

```txt
POST /predict-pm
GET /cpcb-records
```

If you want CPCB traffic to use a different backend/proxy URL, also set:

```env
VITE_CPCB_API_URL=https://your-backend.example.com/cpcb-records
```

For local development, keep the frontend ML API URL as:

```js
http://127.0.0.1:5000
```

## Important Notes

- Keep your data.gov.in API key private.
- Do not commit `.env`.
- The app estimates AQI from pollutant values when official AQI is not available.
- Leaflet markers move correctly with the map because they are rendered inside the Leaflet map layer, not as a separate static overlay.

## Author

Ritvik Verma
