# Weather Wallpaper

A cross-platform app that turns your desktop wallpaper into a live 3D globe with real-time weather, flights, and more.

Built with MapboxGL and WebView. Entirely vibe-coded with Claude.

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
- **System Tray / Menu Bar Controls** — toggle everything from the tray or menu bar

## Requirements

- A free [Mapbox access token](https://account.mapbox.com/access-tokens/) (required)
- A [Google Pollen API key](https://console.cloud.google.com/) (optional, for pollen data)

### Windows

- Windows 10 or later
- Python 3.9+ (for running from source)
- Microsoft Edge WebView2 Runtime (pre-installed on Windows 10 1803+ and Windows 11)

### macOS

- macOS 13.0+
- Xcode Command Line Tools (for building from source)

## Install

### Windows

#### Run from source

```bash
git clone https://github.com/alexcohennyc/weather-wallpaper.git
cd weather-wallpaper
pip install -r requirements.txt
pythonw weather_wallpaper.py
```

Or simply double-click `run.bat` — it installs dependencies and launches the app.

#### Build standalone .exe

```bash
build.bat
```

This creates `dist\WeatherWallpaper\WeatherWallpaper.exe` using PyInstaller.

### macOS

#### From DMG

Download the latest DMG from [Releases](https://github.com/alexcohennyc/weather-wallpaper/releases), open it, and drag `WeatherWallpaper.app` to Applications.

#### Build from source

```bash
git clone https://github.com/alexcohennyc/weather-wallpaper.git
cd weather-wallpaper
make run
```

Requires Xcode Command Line Tools (`xcode-select --install`).

## Setup

1. Launch the app — a globe icon appears in your system tray (Windows) or menu bar (macOS)
2. Right-click the icon → **Set Mapbox Token…** → paste your `pk.eyJ…` token
3. The globe renders on your desktop

## System Tray / Menu Bar

| Item | Description |
|------|-------------|
| Refresh Location | Re-detect current location (IP-based on Windows, GPS on macOS) |
| Search Location… | Geocode a city/place and fly there |
| Set Mapbox Token… | Enter your Mapbox public token |
| Set Pollen API Key… | Enter your Google Pollen API key |
| Zoom: Globe / Country / City / Street | Change zoom level (radio select) |
| Show Flights | Toggle live flight tracking |
| Show Weather Radar | Toggle precipitation overlay |
| Show Pollen & Air Quality | Toggle bottom bar to allergy view |
| Show Labels | Toggle map labels |
| Spin Globe | Smooth auto-rotation |
| Launch at Login | Start on boot (Registry on Windows, SMAppService on macOS) |

## How It Works

### Windows

The app uses the **Progman/WorkerW** technique to embed a WebView2 window behind the desktop icons. A Python process manages the system tray icon and injects JavaScript commands into the webview to control the globe, weather overlays, and other features. Settings are stored in `%APPDATA%\WeatherWallpaper\settings.json`.

### macOS

The app creates a borderless `NSWindow` at the desktop window level using `CGWindowLevelForKey(.desktopWindow)` with a `WKWebView` rendering the globe. Settings are stored via `UserDefaults`.

## APIs Used

- [Mapbox GL JS](https://www.mapbox.com/) — 3D globe rendering
- [OpenSky Network](https://opensky-network.org/) — live flight data
- [RainViewer](https://www.rainviewer.com/api.html) — weather radar tiles (free, no key)
- [Open-Meteo](https://open-meteo.com/) — air quality data (free, no key)
- [Google Pollen API](https://developers.google.com/maps/documentation/pollen) — pollen forecasts

## License

MIT
