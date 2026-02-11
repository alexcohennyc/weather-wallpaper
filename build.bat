@echo off
REM Weather Wallpaper — Build standalone .exe with PyInstaller
REM The resulting executable will be in dist\WeatherWallpaper\

pip install pyinstaller --quiet >nul 2>&1
pip install -r "%~dp0requirements.txt" --quiet >nul 2>&1

pyinstaller ^
    --name WeatherWallpaper ^
    --noconsole ^
    --add-data "WeatherWallpaper\Web;WeatherWallpaper\Web" ^
    --icon=NUL ^
    --noconfirm ^
    weather_wallpaper.py

echo.
echo Build complete. Run dist\WeatherWallpaper\WeatherWallpaper.exe
pause
