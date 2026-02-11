# Weather Wallpaper

A macOS app that turns your desktop wallpaper into a live 3D globe with real-time weather, flights, and more.

Built with MapboxGL, Swift, and WebKit. Entirely vibe-coded with Claude.

## Features

- **3D Globe** — Mapbox Standard style with faded theme, rendered as your desktop wallpaper
- **Day/Night Cycle** — real-time sun position with twilight and night overlays
- **Weather Radar** — live precipitation overlay via RainViewer (no API key needed)
- **Live Flights** — real-time aircraft positions from OpenSky Network
- **Pollen & Air Quality** — Google Pollen API + Open-Meteo air quality data
- **City Labels** — custom-styled country, state, city, and neighborhood labels
- **Globe Spin** — smooth auto-rotation (~40s per revolution)
- **Zoom Levels** — Globe, Country, City, and Street views
- **Search Location** — geocode any city/place and fly there
- **Menu Bar Controls** — toggle everything from the menu bar

## Requirements

- macOS 13.0+
- A free [Mapbox access token](https://account.mapbox.com/access-tokens/) (required)
- A [Google Pollen API key](https://console.cloud.google.com/) (optional, for pollen data)

## Install

### From DMG

Download the latest DMG from [Releases](https://github.com/alexcohennyc/weather-wallpaper/releases), open it, and drag `WeatherWallpaper.app` to Applications.

### Build from source

```bash
git clone https://github.com/alexcohennyc/weather-wallpaper.git
cd weather-wallpaper
make run
```

Requires Xcode Command Line Tools (`xcode-select --install`).

## Setup

1. Launch the app — a globe icon appears in your menu bar
2. Click the icon → **Set Mapbox Token…** → paste your `pk.eyJ…` token
3. The globe renders on your desktop

## Menu Bar

| Item | Description |
|------|-------------|
| Refresh Location | Re-detect current location via GPS |
| Search Location… | Geocode a city/place and fly there |
| Set Mapbox Token… | Enter your Mapbox public token |
| Set Pollen API Key… | Enter your Google Pollen API key |
| Zoom: Globe / Country / City / Street | Change zoom level (radio select) |
| Show Flights | Toggle live flight tracking |
| Show Weather Radar | Toggle precipitation overlay |
| Show Pollen & Air Quality | Toggle bottom bar to allergy view |
| Show Labels | Toggle map labels |
| Spin Globe | Smooth auto-rotation |
| Launch at Login | Start on boot |

## APIs Used

- [Mapbox GL JS](https://www.mapbox.com/) — 3D globe rendering
- [OpenSky Network](https://opensky-network.org/) — live flight data
- [RainViewer](https://www.rainviewer.com/api.html) — weather radar tiles (free, no key)
- [Open-Meteo](https://open-meteo.com/) — air quality data (free, no key)
- [Google Pollen API](https://developers.google.com/maps/documentation/pollen) — pollen forecasts

## License

MIT
