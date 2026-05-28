import requests
import pandas as pd

API_KEY = "579b464db66ec23bdd0000012fb02f48b08641b64b72ece6dbb058c9"
RESOURCE_URL = "https://api.data.gov.in/resource/3b01bcb8-0b14-4abf-b6f2-c1bfd384ba69"

import time
import requests

def fetch_records():
    all_records = []
    limit = 100
    offset = 0
    max_retries = 3

    while True:
        params = {
            "api-key": API_KEY,
            "format": "json",
            "limit": limit,
            "offset": offset,
        }

        for attempt in range(max_retries):
            try:
                res = requests.get(
                    RESOURCE_URL,
                    params=params,
                    timeout=20,
                    headers={"User-Agent": "Mozilla/5.0"}
                )

                print("Offset:", offset, "Status:", res.status_code)

                if res.status_code == 502:
                    print("502 from data.gov.in, retrying...")
                    time.sleep(2)
                    continue

                if not res.ok:
                    print("Response:", res.text[:300])
                    raise Exception(f"API failed with status {res.status_code}")

                if not res.text.strip():
                    raise Exception("Empty response from API")

                data = res.json()
                records = data.get("records", [])

                if not records:
                    return all_records

                all_records.extend(records)

                if len(records) < limit:
                    return all_records

                offset += limit
                time.sleep(0.5)
                break

            except Exception as e:
                print("Attempt failed:", e)

                if attempt == max_retries - 1:
                    print("Skipping this offset:", offset)
                    offset += limit
                    break

                time.sleep(2)

        if offset > 20000:
            break

    return all_records


def build_station_table(records):
    rows = []

    for r in records:
        city = r.get("city")
        station = r.get("station")
        pollutant = r.get("pollutant_id")
        value = r.get("avg_value")

        if not city or not station or not pollutant:
            continue

        if value in ["NA", "", None]:
            continue

        try:
            value = float(value)
        except:
            continue

        rows.append({
            "city": city,
            "station": station,
            "pollutant": pollutant,
            "value": value,
        })

    df = pd.DataFrame(rows)

    station_df = df.pivot_table(
        index=["city", "station"],
        columns="pollutant",
        values="value",
        aggfunc="mean"
    ).reset_index()

    station_df = station_df.rename(columns={
        "PM2.5": "PM25",
        "PM10": "PM10",
        "NO2": "NO2",
        "SO2": "SO2",
        "CO": "CO",
        "OZONE": "O3",
        "O3": "O3",
        "NH3": "NH3",
    })

    return station_df


records = fetch_records()
df = build_station_table(records)

df.to_csv("aqi_training.csv", index=False)

print("Training dataset created")
print(df.head())
print("Rows:", len(df))