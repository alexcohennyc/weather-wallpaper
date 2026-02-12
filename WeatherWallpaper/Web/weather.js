// --- Shared location ---
var CACHE_KEY_PREFIX = 'weather-cache';
var UNIT_SYSTEM_KEY = 'unit-system';
var LAST_LOCATION_LAT_KEY = 'last-location-lat';
var LAST_LOCATION_LON_KEY = 'last-location-lon';
var POLLEN_KEY_STORAGE = 'google-pollen-api-key';
var CACHE_TTL = 15 * 60 * 1000;
var DEFAULT_LOCATION = { name: 'Austin, TX', lat: 30.2676, lon: -97.743 };
var currentTimezone = null;
var clockInterval = null;
var showingAllergy = false;
var sunriseMinutes = null;
var sunsetMinutes = null;
var appPaused = false;

window.setAppPaused = function (paused) {
  appPaused = paused;
  if (paused) {
    if (clockInterval) clearInterval(clockInterval);
    clockInterval = null;
  } else {
    updateClock();
    if (clockInterval) clearInterval(clockInterval);
    clockInterval = setInterval(updateClock, 60000);
    // Refresh weather if resumed and stale
    var loc = getLocation();
    var cached = localStorage.getItem(getCacheKey());
    if (cached) {
      try {
        var data = JSON.parse(cached);
        var age = Date.now() - new Date(data.timestamp).getTime();
        if (age >= CACHE_TTL && window.isPrimaryView) {
          fetchWeather(loc);
        }
      } catch (e) { }
    }
  }
};

function normalizeUnitSystem(unitSystem) {
  return unitSystem === 'metric' ? 'metric' : 'imperial';
}

function detectDefaultUnitSystem() {
  try {
    var locale = Intl.DateTimeFormat().resolvedOptions().locale || '';
    var region = locale.split('-').pop().toUpperCase();
    if (region === 'US' || region === 'LR' || region === 'MM') return 'imperial';
  } catch (e) {}
  return 'metric';
}

function getUnitSystem() {
  var stored = localStorage.getItem(UNIT_SYSTEM_KEY);
  return normalizeUnitSystem(stored || detectDefaultUnitSystem());
}

function setStoredUnitSystem(unitSystem) {
  var normalized = normalizeUnitSystem(unitSystem);
  localStorage.setItem(UNIT_SYSTEM_KEY, normalized);
  return normalized;
}

function getCacheKey() {
  return CACHE_KEY_PREFIX + '-' + getUnitSystem();
}

function getPollenApiKey() {
  return localStorage.getItem(POLLEN_KEY_STORAGE) || '';
}

function getStoredLocation() {
  var rawLat = localStorage.getItem(LAST_LOCATION_LAT_KEY);
  var rawLon = localStorage.getItem(LAST_LOCATION_LON_KEY);
  if (rawLat == null || rawLon == null) return null;

  var lat = parseFloat(rawLat);
  var lon = parseFloat(rawLon);
  if (Number.isNaN(lat) || Number.isNaN(lon)) return null;

  return {
    name: window.userLocation && window.userLocation.name ? window.userLocation.name : DEFAULT_LOCATION.name,
    lat: lat,
    lon: lon,
  };
}

function persistLocation(loc) {
  localStorage.setItem(LAST_LOCATION_LAT_KEY, String(loc.lat));
  localStorage.setItem(LAST_LOCATION_LON_KEY, String(loc.lon));
}

function getLocation() {
  if (window.userLocation) return window.userLocation;
  var stored = getStoredLocation();
  if (stored) return stored;
  return DEFAULT_LOCATION;
}

// --- WMO weather code -> condition text ---
function wmoToCondition(code) {
  if (code == null) return 'Fair Skies';
  if (code === 0) return 'Clear Skies';
  if (code === 1) return 'Mostly Clear';
  if (code === 2) return 'Partly Cloudy';
  if (code === 3) return 'Overcast';
  if (code === 45 || code === 48) return 'Foggy';
  if (code >= 51 && code <= 55) return 'Drizzle';
  if (code >= 56 && code <= 57) return 'Freezing Drizzle';
  if (code >= 61 && code <= 65) return 'Rain';
  if (code >= 66 && code <= 67) return 'Freezing Rain';
  if (code >= 71 && code <= 77) return 'Snow';
  if (code >= 80 && code <= 82) return 'Showers';
  if (code >= 85 && code <= 86) return 'Snow Showers';
  if (code === 95) return 'Thunderstorms';
  if (code >= 96) return 'Hail';
  return 'Fair Skies';
}

function wmoToShort(code) {
  if (code == null) return '';
  if (code <= 1) return 'Clear';
  if (code === 2) return 'Clouds';
  if (code === 3) return 'Overcast';
  if (code === 45 || code === 48) return 'Fog';
  if (code >= 51 && code <= 57) return 'Drizzle';
  if (code >= 61 && code <= 67) return 'Rain';
  if (code >= 71 && code <= 77) return 'Snow';
  if (code >= 80 && code <= 82) return 'Showers';
  if (code >= 85 && code <= 86) return 'Snow';
  if (code >= 95) return 'Storms';
  return '';
}

// --- Helpers ---
function formatDayFromDate(dateStr) {
  var d = new Date(dateStr + 'T12:00:00');
  var today = new Date();
  today.setHours(12, 0, 0, 0);
  var diff = Math.round((d - today) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tmrw';
  return d.toLocaleDateString('en-US', { weekday: 'short' });
}

function parseSunMinutes(isoStr) {
  if (!isoStr) return null;
  var parts = isoStr.split('T')[1].split(':');
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}

function formatSunTime(isoStr) {
  if (!isoStr) return '--';
  var parts = isoStr.split('T')[1].split(':');
  var h = parseInt(parts[0], 10);
  var m = parseInt(parts[1], 10);
  var ampm = h >= 12 ? 'PM' : 'AM';
  var h12 = h % 12 || 12;
  return h12 + ':' + (m < 10 ? '0' : '') + m + ' ' + ampm;
}

function currentMinutesInTz(tz) {
  var now = new Date();
  var h = parseInt(now.toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: tz }), 10);
  var m = parseInt(now.toLocaleString('en-US', { minute: '2-digit', timeZone: tz }), 10);
  return h * 60 + m;
}

function updateClock() {
  var tz = currentTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  var now = new Date();
  var dayName = now.toLocaleDateString('en-US', { weekday: 'long', timeZone: tz });
  var dateStr = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: tz });
  var timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz });
  document.getElementById('subtitle').textContent = dayName + ', ' + dateStr + ' \u00B7 ' + timeStr;
  updateSunDot();
}

// --- Sun arc ---
function buildSunArc(sunrise, sunset) {
  var riseStr = formatSunTime(sunrise);
  var setStr = formatSunTime(sunset);
  var accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#C9A84C';

  var w = 90, h = 48;
  var cx = w / 2, horizonY = 24;
  var rx = 40, ryDay = 20, ryNight = 10;

  var svg = '<svg class="sun-arc-svg" viewBox="0 0 ' + w + ' ' + h + '">' +
    '<path d="M ' + (cx - rx) + ' ' + horizonY + ' A ' + rx + ' ' + ryDay + ' 0 0 1 ' + (cx + rx) + ' ' + horizonY + '"' +
    ' stroke="rgba(255,255,255,0.18)" fill="none" stroke-width="1.5"/>' +
    '<path d="M ' + (cx - rx) + ' ' + horizonY + ' A ' + rx + ' ' + ryNight + ' 0 0 0 ' + (cx + rx) + ' ' + horizonY + '"' +
    ' stroke="rgba(255,255,255,0.07)" fill="none" stroke-width="1" stroke-dasharray="2 2"/>' +
    '<circle id="sun-glow" cx="' + cx + '" cy="' + (horizonY - ryDay) + '" r="6" fill="' + accent + '" opacity="0.2"/>' +
    '<circle id="sun-dot" cx="' + cx + '" cy="' + (horizonY - ryDay) + '" r="3" fill="' + accent + '"/>' +
    '</svg>';

  return '<div class="sun-arc-wrap">' +
    '<div class="sun-time"><span class="stat-label">Sunrise</span><span class="stat-value">' + riseStr + '</span></div>' +
    svg +
    '<div class="sun-time"><span class="stat-label">Sunset</span><span class="stat-value">' + setStr + '</span></div>' +
    '</div>';
}

function updateSunDot() {
  var dot = document.getElementById('sun-dot');
  var glow = document.getElementById('sun-glow');
  if (!dot || sunriseMinutes == null || sunsetMinutes == null || !currentTimezone) return;

  var now = currentMinutesInTz(currentTimezone);
  var rise = sunriseMinutes;
  var set = sunsetMinutes;

  var cx = 45, horizonY = 24, rx = 40, ryDay = 20, ryNight = 10;
  var x, y;

  if (now >= rise && now <= set) {
    var t = (now - rise) / (set - rise);
    var angle = Math.PI * (1 - t);
    x = cx + rx * Math.cos(angle);
    y = horizonY - ryDay * Math.sin(angle);
  } else {
    var dayLen = set - rise;
    var nightLen = 1440 - dayLen;
    var elapsed;
    if (now > set) {
      elapsed = now - set;
    } else {
      elapsed = now + 1440 - set;
    }
    var t = Math.min(1, elapsed / nightLen);
    var angle = Math.PI * t;
    x = cx + rx * Math.cos(angle);
    y = horizonY + ryNight * Math.sin(angle);
  }

  dot.setAttribute('cx', x);
  dot.setAttribute('cy', y);
  glow.setAttribute('cx', x);
  glow.setAttribute('cy', y);
}

function render(data) {
  var current = data.current;
  var daily = data.daily;
  var location = data.location;

  document.getElementById('city-name').textContent = location.name;

  var unitSystem = normalizeUnitSystem(data.unitSystem || getUnitSystem());
  var tempUnit = unitSystem === 'metric' ? '°C' : '°F';
  var windUnit = unitSystem === 'metric' ? 'km/h' : 'mph';

  var temp = current.temperature != null ? Math.round(current.temperature) : '--';
  document.getElementById('temperature').innerHTML = temp + '<span class="unit">' + tempUnit + '</span>';
  document.getElementById('condition').textContent = wmoToCondition(current.weatherCode);

  currentTimezone = data.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  updateClock();
  if (clockInterval) clearInterval(clockInterval);
  clockInterval = setInterval(updateClock, 60000);

  sunriseMinutes = parseSunMinutes(data.sunrise);
  sunsetMinutes = parseSunMinutes(data.sunset);

  var stats = [
    { label: 'Humidity', value: current.humidity != null ? Math.round(current.humidity) + '%' : '--' },
    { label: 'Wind', value: current.windSpeed != null ? Math.round(current.windSpeed) + ' ' + windUnit : '--' },
  ];

  var statsHtml = stats.map(function (s) {
    return '<div class="stat-item"><span class="stat-label">' + s.label + '</span><span class="stat-value">' + s.value + '</span></div>';
  }).join('');

  if (data.sunrise && data.sunset) {
    statsHtml += buildSunArc(data.sunrise, data.sunset);
  }

  document.getElementById('stats').innerHTML = statsHtml;
  updateSunDot();

  document.getElementById('forecast').innerHTML = daily.map(function (d) {
    var cond = wmoToShort(d.weatherCode);
    return '<div class="forecast-item">' +
      '<span class="forecast-day">' + d.day + '</span>' +
      (cond ? '<span class="forecast-cond">' + cond + '</span>' : '') +
      '<span class="forecast-temps">' +
      '<span class="forecast-high">' + Math.round(d.high) + '\u00B0</span>' +
      '<span class="forecast-low">' + Math.round(d.low) + '\u00B0</span>' +
      '</span>' +
      '</div>';
  }).join('');
}

async function fetchWeather(loc) {
  if (!window.isPrimaryView || appPaused) return;

  var unitSystem = getUnitSystem();
  var temperatureUnit = unitSystem === 'metric' ? 'celsius' : 'fahrenheit';
  var windSpeedUnit = unitSystem === 'metric' ? 'kmh' : 'mph';

  var url = 'https://api.open-meteo.com/v1/forecast' +
    '?latitude=' + loc.lat +
    '&longitude=' + loc.lon +
    '&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m,surface_pressure,dew_point_2m' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset' +
    '&temperature_unit=' + temperatureUnit +
    '&wind_speed_unit=' + windSpeedUnit +
    '&timezone=auto' +
    '&forecast_days=7';

  var res = await fetch(url);
  var data = await res.json();

  var result = {
    location: loc,
    unitSystem: unitSystem,
    timezone: data.timezone,
    sunrise: data.daily.sunrise ? data.daily.sunrise[0] : null,
    sunset: data.daily.sunset ? data.daily.sunset[0] : null,
    current: {
      temperature: data.current.temperature_2m,
      humidity: data.current.relative_humidity_2m,
      weatherCode: data.current.weather_code,
      windSpeed: data.current.wind_speed_10m,
      windDirection: data.current.wind_direction_10m,
      pressure: data.current.surface_pressure,
      dewpoint: data.current.dew_point_2m,
    },
    daily: data.daily.time.map(function (date, i) {
      return {
        day: formatDayFromDate(date),
        high: data.daily.temperature_2m_max[i],
        low: data.daily.temperature_2m_min[i],
        weatherCode: data.daily.weather_code[i],
      };
    }),
    timestamp: new Date().toISOString(),
  };

  localStorage.setItem(getCacheKey(), JSON.stringify(result));

  // Relay weather data
  try {
    webkit.messageHandlers.dataRelay.postMessage({
      type: 'weather',
      json: JSON.stringify(result)
    });
  } catch (e) { }

  return result;
}

window.receiveWeather = function (data) {
  if (window.isPrimaryView) return;
  render(data);
};

// --- Air quality / allergens ---
function aqiLabel(aqi) {
  if (aqi == null) return { text: '--', cls: '' };
  if (aqi <= 50) return { text: 'Good', cls: 'aqi-good' };
  if (aqi <= 100) return { text: 'Moderate', cls: 'aqi-moderate' };
  if (aqi <= 150) return { text: 'Unhealthy (Sensitive)', cls: 'aqi-sensitive' };
  if (aqi <= 200) return { text: 'Unhealthy', cls: 'aqi-unhealthy' };
  if (aqi <= 300) return { text: 'Very Unhealthy', cls: 'aqi-very-unhealthy' };
  return { text: 'Hazardous', cls: 'aqi-hazardous' };
}

async function fetchAirQuality(loc) {
  var url = 'https://air-quality-api.open-meteo.com/v1/air-quality' +
    '?latitude=' + loc.lat +
    '&longitude=' + loc.lon +
    '&current=us_aqi,pm2_5,pm10,uv_index';
  var res = await fetch(url);
  return await res.json();
}

async function fetchGooglePollen(loc) {
  var key = getPollenApiKey();
  if (!key) return null;
  var url = 'https://pollen.googleapis.com/v1/forecast:lookup' +
    '?key=' + encodeURIComponent(key) +
    '&location.latitude=' + loc.lat +
    '&location.longitude=' + loc.lon +
    '&days=1&plantsDescription=false';
  var res = await fetch(url);
  if (!res.ok) return null;
  return await res.json();
}

function googlePollenCategory(indexInfo) {
  if (!indexInfo) return { text: '--', cls: '' };
  var cat = indexInfo.category || '';
  if (cat === 'None' || cat === 'NONE') return { text: 'None', cls: 'pollen-none' };
  if (cat.toLowerCase().indexOf('very low') >= 0) return { text: 'Very Low', cls: 'pollen-very-low' };
  if (cat.toLowerCase().indexOf('very high') >= 0) return { text: 'Very High', cls: 'pollen-very-high' };
  if (cat.toLowerCase().indexOf('low') >= 0) return { text: 'Low', cls: 'pollen-low' };
  if (cat.toLowerCase().indexOf('moderate') >= 0) return { text: 'Moderate', cls: 'pollen-moderate' };
  if (cat.toLowerCase().indexOf('high') >= 0) return { text: 'High', cls: 'pollen-high' };
  return { text: cat, cls: '' };
}

function renderAllergy(aqData, pollenData) {
  var el = document.getElementById('allergy-content');
  var html = '<div class="allergy-grid">';

  if (aqData && aqData.current) {
    var c = aqData.current;
    var aqi = aqiLabel(c.us_aqi);

    html += '<div class="allergy-item allergy-aqi">' +
      '<span class="stat-label">Air Quality</span>' +
      '<span class="stat-value ' + aqi.cls + '">' + (c.us_aqi != null ? c.us_aqi : '--') + '</span>' +
      '<span class="allergy-sublabel ' + aqi.cls + '">' + aqi.text + '</span>' +
      '</div>';

    html += '<div class="allergy-item">' +
      '<span class="stat-label">PM2.5</span>' +
      '<span class="stat-value">' + (c.pm2_5 != null ? Math.round(c.pm2_5) : '--') + '</span>' +
      '<span class="allergy-sublabel">\u00B5g/m\u00B3</span>' +
      '</div>';

    html += '<div class="allergy-item">' +
      '<span class="stat-label">PM10</span>' +
      '<span class="stat-value">' + (c.pm10 != null ? Math.round(c.pm10) : '--') + '</span>' +
      '<span class="allergy-sublabel">\u00B5g/m\u00B3</span>' +
      '</div>';

    html += '<div class="allergy-item">' +
      '<span class="stat-label">UV Index</span>' +
      '<span class="stat-value">' + (c.uv_index != null ? c.uv_index.toFixed(1) : '--') + '</span>' +
      '</div>';
  }

  if (pollenData && pollenData.dailyInfo && pollenData.dailyInfo.length > 0) {
    var day = pollenData.dailyInfo[0];
    html += '<div class="allergy-divider"></div>';
    if (day.plantInfo) {
      day.plantInfo.forEach(function (plant) {
        if (!plant.inSeason && (!plant.indexInfo || plant.indexInfo.value === 0)) return;
        var cat = googlePollenCategory(plant.indexInfo);
        var val = plant.indexInfo ? plant.indexInfo.value : 0;
        html += '<div class="allergy-item">' +
          '<span class="stat-label">' + plant.displayName + '</span>' +
          '<span class="stat-value ' + cat.cls + '">' + val + '<span class="pollen-scale">/5</span></span>' +
          '<span class="allergy-sublabel ' + cat.cls + '">' + cat.text + '</span>' +
          '</div>';
      });
    }
  } else {
    html += '<div class="allergy-divider"></div>';
    html += '<div class="allergy-item"><span class="stat-label">Pollen</span><span class="stat-value">\u2014</span><span class="allergy-sublabel">Unavailable</span></div>';
  }

  html += '</div>';
  el.innerHTML = html;
}

async function loadAllergyData() {
  if (!window.isPrimaryView) return;
  var el = document.getElementById('allergy-content');
  el.innerHTML = '<span class="bar-loading">Loading\u2026</span>';
  var loc = getLocation();
  try {
    var results = await Promise.all([
      fetchAirQuality(loc).catch(function () { return null; }),
      fetchGooglePollen(loc).catch(function () { return null; })
    ]);
    renderAllergy(results[0], results[1]);

    // Relay allergy data
    try {
      webkit.messageHandlers.dataRelay.postMessage({
        type: 'allergy',
        json: JSON.stringify({ aqData: results[0], pollenData: results[1] })
      });
    } catch (e) { }
  } catch (e) {
    el.innerHTML = '<span class="bar-loading">Air quality unavailable</span>';
  }
}

window.receiveAllergy = function (data) {
  if (window.isPrimaryView) return;
  renderAllergy(data.aqData, data.pollenData);
};

window.reloadAllergy = loadAllergyData;

window.setUnitSystem = function(unitSystem) {
  var normalized = setStoredUnitSystem(unitSystem);
  var loc = getLocation();

  fetchWeather(loc)
    .then(render)
    .catch(function(err) {
      console.error('Weather fetch failed:', err);
    });

  return normalized;
};

function initLeafToggle() {
  // Leaf button removed — pollen toggle now controlled from Swift menu bar
}

// --- Location update from Swift ---
window.addEventListener('locationUpdated', async function (e) {
  var lat = e.detail.latitude;
  var lon = e.detail.longitude;

  if (window.globeSetCity) window.globeSetCity(lat, lon);

  // Secondary views stop here and wait for dataRelay for the rest
  if (!window.isPrimaryView) return;

  var name = e.detail.name || (lat.toFixed(2) + ', ' + lon.toFixed(2));
  var loc = { name: name, lat: lat, lon: lon };
  window.userLocation = loc;
  persistLocation(loc);

  document.getElementById('city-name').textContent = loc.name;

  document.getElementById('allergy-content').innerHTML =
    '<span class="bar-loading">Loading\u2026</span>';

  try {
    var data = await fetchWeather(loc);
    render(data);
  } catch (e) {
    console.error('Weather fetch failed:', e);
  }

  if (showingAllergy) {
    loadAllergyData();
  }
});

// --- Main ---
(async function init() {
  var loc = getLocation();
  window.userLocation = loc;
  document.getElementById('city-name').textContent = loc.name;
  initLeafToggle();

  if (window.globeSetCity) window.globeSetCity(loc.lat, loc.lon);

  var cacheKey = getCacheKey();
  var cached = localStorage.getItem(cacheKey);
  if (cached) {
    try {
      var data = JSON.parse(cached);
      if (data.location && Math.abs(data.location.lat - loc.lat) < 0.01 && Math.abs(data.location.lon - loc.lon) < 0.01) {
        render(data);
        var age = Date.now() - new Date(data.timestamp).getTime();
        if (age < CACHE_TTL) return;
      }
    } catch (e) {
      localStorage.removeItem(cacheKey);
    }
  }

  try {
    if (window.isPrimaryView) {
      var data = await fetchWeather(loc);
      render(data);
    }
  } catch (err) {
    console.error('Weather fetch failed:', err);
    if (!cached) document.getElementById('condition').textContent = 'Unable to load weather';
  }
})();
