import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error
import joblib

df = pd.read_csv("aqi_training.csv")

print("Dataset shape:", df.shape)
print(df.head())

features = ["NO2", "SO2", "CO", "O3", "NH3"]

# ---------------- PM2.5 MODEL ----------------

pm25_df = df.dropna(subset=["PM25"])

X_pm25 = pm25_df[features].fillna(0)
y_pm25 = pm25_df["PM25"]

X_train, X_test, y_train, y_test = train_test_split(
    X_pm25,
    y_pm25,
    test_size=0.2,
    random_state=42
)

pm25_model = RandomForestRegressor(
    n_estimators=200,
    random_state=42
)

pm25_model.fit(X_train, y_train)

pred_pm25 = pm25_model.predict(X_test)

print("PM2.5 MAE:", mean_absolute_error(y_test, pred_pm25))

joblib.dump(pm25_model, "pm25_model.pkl")

# ---------------- PM10 MODEL ----------------

pm10_df = df.dropna(subset=["PM10"])

X_pm10 = pm10_df[features].fillna(0)
y_pm10 = pm10_df["PM10"]

X_train, X_test, y_train, y_test = train_test_split(
    X_pm10,
    y_pm10,
    test_size=0.2,
    random_state=42
)

pm10_model = RandomForestRegressor(
    n_estimators=200,
    random_state=42
)

pm10_model.fit(X_train, y_train)

pred_pm10 = pm10_model.predict(X_test)

print("PM10 MAE:", mean_absolute_error(y_test, pred_pm10))

joblib.dump(pm10_model, "pm10_model.pkl")

print("Models saved successfully")