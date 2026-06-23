# Colorado Snow ❄️

A single-file weather web app focused on Colorado mountains and backcountry skiing:
current conditions, 24‑hour and 7‑day forecasts, 7‑day snowfall (past & forecast),
a **By Elevation** panel (Summit / Mid / Base with the tallest summit within 2 miles),
animated radar, and the nearest SNOTEL snow-station data — on a multi-basemap map.

It's an installable **PWA**: no build step, no backend, no API keys.

## Live app

Once GitHub Pages is enabled (Settings → Pages → Deploy from branch → `main` / root):

> `https://<your-username>.github.io/<repo-name>/`

On iPhone, open that link in **Safari → Share → Add to Home Screen** for a full-screen app.

## Run locally

```bash
python3 -m http.server 4173
# then open http://localhost:4173
```

(A service worker provides offline caching; it only activates over HTTPS or `localhost`.)

## Data & attribution

- Forecasts & current conditions: **NOAA / National Weather Service** (api.weather.gov)
- Snowfall history & by-elevation/freezing-level: **Open‑Meteo**
- Radar: **NWS NEXRAD (Iowa Environmental Mesonet)** and **RainViewer**
- Snow stations: **USDA NRCS SNOTEL**
- Map tiles: OpenTopoMap, USGS The National Map, Esri, CyclOSM; ski/trail overlays from
  OpenSnowMap and Waymarked Trails. Map rendering by **Leaflet**.

## Note

Built for personal/non-commercial use. Several data and tile sources are free only for
non-commercial use or under fair-use policies — review each provider's terms before any
commercial use. Not a substitute for official avalanche forecasts or your own judgment in
the backcountry.
