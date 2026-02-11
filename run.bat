@echo off
REM Weather Wallpaper — Windows launcher
REM Installs dependencies if needed and starts the app.

where pythonw >nul 2>&1
if %errorlevel% neq 0 (
    echo Python is not installed or not in PATH.
    echo Download Python from https://www.python.org/downloads/
    pause
    exit /b 1
)

pip install -r "%~dp0requirements.txt" --quiet >nul 2>&1

echo Starting Weather Wallpaper...
start "" pythonw "%~dp0weather_wallpaper.py"
