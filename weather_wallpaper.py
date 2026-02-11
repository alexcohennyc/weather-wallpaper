"""
Weather Wallpaper — Windows Edition
Renders a live 3D globe with real-time weather as your desktop wallpaper.
Uses WebView2 (via pywebview) embedded behind desktop icons.
"""

import ctypes
import ctypes.wintypes
import json
import os
import sys
import threading
import time
import winreg

import webview
from PIL import Image, ImageDraw
from pystray import Icon, Menu, MenuItem

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

def resource_path(*parts):
    """Return absolute path to a resource, works for dev and PyInstaller."""
    if getattr(sys, "_MEIPASS", None):
        base = sys._MEIPASS
    else:
        base = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(base, *parts)

CONFIG_DIR = os.path.join(os.environ.get("APPDATA", os.path.expanduser("~")), "WeatherWallpaper")
CONFIG_FILE = os.path.join(CONFIG_DIR, "settings.json")
WEB_DIR = resource_path("WeatherWallpaper", "Web")
INDEX_HTML = os.path.join(WEB_DIR, "index.html")
APP_NAME = "WeatherWallpaper"
STARTUP_REG_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"

# ---------------------------------------------------------------------------
# Settings (replaces macOS UserDefaults)
# ---------------------------------------------------------------------------

_settings = {}


def load_settings():
    global _settings
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                _settings = json.load(f)
        except Exception:
            _settings = {}
    return _settings


def save_settings():
    os.makedirs(CONFIG_DIR, exist_ok=True)
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(_settings, f, indent=2)


def get_setting(key, default=None):
    return _settings.get(key, default)


def set_setting(key, value):
    _settings[key] = value
    save_settings()


# ---------------------------------------------------------------------------
# Windows desktop embedding  (Progman / WorkerW trick)
# ---------------------------------------------------------------------------

user32 = ctypes.windll.user32
HWND = ctypes.wintypes.HWND
LPARAM = ctypes.wintypes.LPARAM

EnumWindowsProc = ctypes.WINFUNCTYPE(ctypes.c_bool, HWND, LPARAM)


def _find_worker_w():
    """
    Send 0x052C to Progman so Windows creates a WorkerW behind the desktop
    icons, then find that WorkerW handle.
    """
    progman = user32.FindWindowW("Progman", None)
    # Ask Progman to spawn the wallpaper WorkerW
    user32.SendMessageTimeoutW(
        progman, 0x052C, 0, 0, 0x0000, 1000, ctypes.byref(ctypes.c_ulong(0))
    )

    worker_w = HWND(0)

    def _enum_cb(hwnd, _lparam):
        nonlocal worker_w
        shell_view = user32.FindWindowExW(hwnd, None, "SHELLDLL_DefView", None)
        if shell_view:
            # The WorkerW *behind* the icons is the next sibling
            worker_w = user32.FindWindowExW(None, hwnd, "WorkerW", None)
        return True

    user32.EnumWindows(EnumWindowsProc(_enum_cb), 0)
    return worker_w


def embed_in_desktop(webview_hwnd):
    """Re-parent the webview window into the desktop WorkerW layer."""
    worker_w = _find_worker_w()
    if not worker_w:
        print("[Desktop] Could not find WorkerW — running as normal window")
        return False
    user32.SetParent(webview_hwnd, worker_w)

    # Remove title-bar / borders and stretch to fill the screen
    GWL_STYLE = -16
    WS_CHILD = 0x40000000
    user32.SetWindowLongW(webview_hwnd, GWL_STYLE, WS_CHILD)

    # Fill the whole primary screen
    width = user32.GetSystemMetrics(0)   # SM_CXSCREEN
    height = user32.GetSystemMetrics(1)  # SM_CYSCREEN
    user32.MoveWindow(webview_hwnd, 0, 0, width, height, True)
    return True


# ---------------------------------------------------------------------------
# Location via IP geolocation (replaces macOS CoreLocation)
# ---------------------------------------------------------------------------

def fetch_ip_location():
    """Get approximate location from IP. Returns (lat, lon) or None."""
    import urllib.request
    try:
        with urllib.request.urlopen("https://ipapi.co/json/", timeout=10) as resp:
            data = json.loads(resp.read())
            return float(data["latitude"]), float(data["longitude"])
    except Exception as e:
        print(f"[Location] IP geolocation failed: {e}")
    return None


# ---------------------------------------------------------------------------
# Launch-at-login helpers (Windows Registry)
# ---------------------------------------------------------------------------

def _exe_path():
    if getattr(sys, "frozen", False):
        return sys.executable
    return f'pythonw "{os.path.abspath(__file__)}"'


def is_launch_at_login():
    try:
        key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, STARTUP_REG_KEY, 0, winreg.KEY_READ)
        winreg.QueryValueEx(key, APP_NAME)
        winreg.CloseKey(key)
        return True
    except FileNotFoundError:
        return False


def set_launch_at_login(enabled):
    try:
        key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, STARTUP_REG_KEY, 0, winreg.KEY_SET_VALUE)
        if enabled:
            winreg.SetValueEx(key, APP_NAME, 0, winreg.REG_SZ, _exe_path())
        else:
            try:
                winreg.DeleteValue(key, APP_NAME)
            except FileNotFoundError:
                pass
        winreg.CloseKey(key)
    except Exception as e:
        print(f"[LaunchAtLogin] {e}")


# ---------------------------------------------------------------------------
# JavaScript bridge helpers
# ---------------------------------------------------------------------------

_window = None  # type: webview.Window | None


def _eval(js):
    """Evaluate JavaScript in the webview (thread-safe)."""
    if _window:
        try:
            _window.evaluate_js(js)
        except Exception:
            pass


def _quote_js(s):
    return "'" + s.replace("\\", "\\\\").replace("'", "\\'").replace("\n", "\\n") + "'"


def inject_location(lat, lon):
    set_setting("last_lat", lat)
    set_setting("last_lon", lon)
    _eval(f"""
        window.userLocation = {{ name: '', lat: {lat}, lon: {lon} }};
        window.dispatchEvent(new CustomEvent('locationUpdated', {{
            detail: {{ latitude: {lat}, longitude: {lon} }}
        }}));
    """)


def inject_mapbox_token(token):
    set_setting("mapbox-access-token", token)
    _eval(f"localStorage.setItem('mapbox-access-token', {_quote_js(token)}); location.reload();")


def inject_pollen_api_key(key):
    set_setting("google-pollen-api-key", key)
    _eval(f"localStorage.setItem('google-pollen-api-key', {_quote_js(key)}); if(window.reloadAllergy) window.reloadAllergy();")


def inject_zoom(level):
    _eval(f"if(window.mapFlyTo) window.mapFlyTo({level});")


def inject_toggle(fn_name, enabled):
    _eval(f"if(window.{fn_name}) window.{fn_name}({str(enabled).lower()});")


# ---------------------------------------------------------------------------
# System-tray icon  (replaces macOS NSStatusBar menu)
# ---------------------------------------------------------------------------

# State
_current_zoom = 2.5
_flights_on = False
_weather_on = False
_pollen_on = False
_labels_on = True
_spin_on = False


def _make_icon_image():
    """Create a small globe-like tray icon with PIL."""
    img = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.ellipse([4, 4, 60, 60], outline=(200, 200, 200, 255), width=2)
    draw.arc([4, 4, 60, 60], 0, 360, fill=(200, 200, 200, 255), width=2)
    # Meridian
    draw.ellipse([22, 4, 42, 60], outline=(200, 200, 200, 180), width=1)
    # Equator
    draw.line([(4, 32), (60, 32)], fill=(200, 200, 200, 180), width=1)
    return img


def _prompt_text(title, message, current=""):
    """Show a simple input dialog using tkinter (available on all Python installs)."""
    result = [None]

    def _run():
        import tkinter as tk
        from tkinter import simpledialog
        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        val = simpledialog.askstring(title, message, initialvalue=current, parent=root)
        result[0] = val
        root.destroy()

    t = threading.Thread(target=_run)
    t.start()
    t.join()
    return result[0]


def _on_refresh_location(_=None):
    loc = fetch_ip_location()
    if loc:
        inject_location(loc[0], loc[1])


def _on_search_location(_=None):
    query = _prompt_text("Search Location", "Enter a city or place name:")
    if not query or not query.strip():
        return
    import urllib.request, urllib.parse
    try:
        url = "https://geocoding-api.open-meteo.com/v1/search?" + urllib.parse.urlencode(
            {"name": query.strip(), "count": 1, "language": "en", "format": "json"}
        )
        with urllib.request.urlopen(url, timeout=10) as resp:
            data = json.loads(resp.read())
            if data.get("results"):
                r = data["results"][0]
                inject_location(r["latitude"], r["longitude"])
    except Exception as e:
        print(f"[Search] Geocoding failed: {e}")


def _on_set_mapbox_token(_=None):
    token = _prompt_text(
        "Mapbox Access Token",
        "Enter your Mapbox public token (pk.eyJ…).\nGet one free at mapbox.com/account/access-tokens",
        current=get_setting("mapbox-access-token", ""),
    )
    if token and token.strip():
        inject_mapbox_token(token.strip())


def _on_set_pollen_key(_=None):
    key = _prompt_text(
        "Google Pollen API Key",
        "Enter your Google Pollen API key.\nGet one at console.cloud.google.com",
        current=get_setting("google-pollen-api-key", ""),
    )
    if key and key.strip():
        inject_pollen_api_key(key.strip())


def _set_zoom(level):
    global _current_zoom
    _current_zoom = level
    inject_zoom(level)


def _on_zoom_globe(_=None):
    _set_zoom(2.5)

def _on_zoom_country(_=None):
    _set_zoom(5.0)

def _on_zoom_city(_=None):
    _set_zoom(8.0)

def _on_zoom_street(_=None):
    _set_zoom(12.0)


def _on_toggle_flights(_=None):
    global _flights_on
    _flights_on = not _flights_on
    inject_toggle("setFlightsEnabled", _flights_on)

def _on_toggle_weather(_=None):
    global _weather_on
    _weather_on = not _weather_on
    inject_toggle("setWeatherEnabled", _weather_on)

def _on_toggle_pollen(_=None):
    global _pollen_on
    _pollen_on = not _pollen_on
    inject_toggle("setPollenEnabled", _pollen_on)

def _on_toggle_labels(_=None):
    global _labels_on
    _labels_on = not _labels_on
    inject_toggle("setLabelsEnabled", _labels_on)

def _on_toggle_spin(_=None):
    global _spin_on
    _spin_on = not _spin_on
    inject_toggle("setSpinEnabled", _spin_on)


def _on_toggle_launch(_=None):
    enabled = not is_launch_at_login()
    set_launch_at_login(enabled)


def _on_quit(icon, _=None):
    icon.stop()
    if _window:
        _window.destroy()
    os._exit(0)


def _build_tray_menu():
    return Menu(
        MenuItem("Refresh Location", _on_refresh_location),
        MenuItem("Search Location…", _on_search_location),
        MenuItem("Set Mapbox Token…", _on_set_mapbox_token),
        MenuItem("Set Pollen API Key…", _on_set_pollen_key),
        Menu.SEPARATOR,
        MenuItem("Zoom: Globe", _on_zoom_globe, checked=lambda _: _current_zoom == 2.5),
        MenuItem("Zoom: Country", _on_zoom_country, checked=lambda _: _current_zoom == 5.0),
        MenuItem("Zoom: City", _on_zoom_city, checked=lambda _: _current_zoom == 8.0),
        MenuItem("Zoom: Street", _on_zoom_street, checked=lambda _: _current_zoom == 12.0),
        Menu.SEPARATOR,
        MenuItem("Show Flights", _on_toggle_flights, checked=lambda _: _flights_on),
        MenuItem("Show Weather Radar", _on_toggle_weather, checked=lambda _: _weather_on),
        MenuItem("Show Pollen && Air Quality", _on_toggle_pollen, checked=lambda _: _pollen_on),
        MenuItem("Show Labels", _on_toggle_labels, checked=lambda _: _labels_on),
        MenuItem("Spin Globe", _on_toggle_spin, checked=lambda _: _spin_on),
        Menu.SEPARATOR,
        MenuItem("Launch at Login", _on_toggle_launch, checked=lambda _: is_launch_at_login()),
        Menu.SEPARATOR,
        MenuItem("Quit Weather Wallpaper", _on_quit),
    )


# ---------------------------------------------------------------------------
# Webview lifecycle
# ---------------------------------------------------------------------------

def _on_webview_loaded():
    """Called when the webview has finished loading."""
    # Inject stored Mapbox token
    token = get_setting("mapbox-access-token", "")
    if token:
        _eval(f"localStorage.setItem('mapbox-access-token', {_quote_js(token)});")

    # Inject stored pollen key
    pollen_key = get_setting("google-pollen-api-key", "")
    if pollen_key:
        _eval(f"localStorage.setItem('google-pollen-api-key', {_quote_js(pollen_key)});")

    # Inject location
    lat = get_setting("last_lat")
    lon = get_setting("last_lon")
    if lat is not None and lon is not None:
        inject_location(lat, lon)
    else:
        # Try IP geolocation
        loc = fetch_ip_location()
        if loc:
            inject_location(loc[0], loc[1])

    # Reload if token was injected before page parsed it
    if token:
        _eval("if(!window.mapboxgl || !mapboxgl.accessToken) location.reload();")

    # Embed into desktop wallpaper layer
    try:
        hwnd = _window.native_handle
        if hwnd:
            embed_in_desktop(hwnd)
    except Exception as e:
        print(f"[Desktop] Embedding failed: {e}")


def _start_tray():
    """Run the system-tray icon (blocks until quit)."""
    icon = Icon(
        "Weather Wallpaper",
        _make_icon_image(),
        "Weather Wallpaper",
        _build_tray_menu(),
    )
    icon.run()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    global _window

    load_settings()

    # Start system tray in a background thread
    tray_thread = threading.Thread(target=_start_tray, daemon=True)
    tray_thread.start()

    # Build initial JS to inject before page load
    init_js = ""
    token = get_setting("mapbox-access-token", "")
    if token:
        init_js += f"localStorage.setItem('mapbox-access-token', {_quote_js(token)});\n"

    pollen_key = get_setting("google-pollen-api-key", "")
    if pollen_key:
        init_js += f"localStorage.setItem('google-pollen-api-key', {_quote_js(pollen_key)});\n"

    lat = get_setting("last_lat")
    lon = get_setting("last_lon")
    if lat is not None and lon is not None:
        init_js += f"window.userLocation = {{ name: '', lat: {lat}, lon: {lon} }};\n"

    # Create the webview window
    _window = webview.create_window(
        "Weather Wallpaper",
        url=INDEX_HTML,
        js_api=None,
        width=user32.GetSystemMetrics(0),
        height=user32.GetSystemMetrics(1),
        frameless=True,
        easy_drag=False,
        background_color="#050508",
    )

    _window.events.loaded += _on_webview_loaded

    # Inject settings JS before load
    if init_js:
        _window.events.loaded += lambda: _eval(init_js)

    # Start the webview event loop (blocks)
    webview.start(debug=False, private_mode=False)


if __name__ == "__main__":
    main()
