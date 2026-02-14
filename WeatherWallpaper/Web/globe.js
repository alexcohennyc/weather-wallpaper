(function () {
  'use strict';

  var PALETTES = [
    { name: 'gold',   accent: '#C9A84C', accentRgb: 'rgb(201,168,76)'  },
    { name: 'arctic', accent: '#4D8CC9', accentRgb: 'rgb(77,140,201)'  },
    { name: 'aurora', accent: '#4DC98A', accentRgb: 'rgb(77,201,138)'  },
    { name: 'rose',   accent: '#C94D6E', accentRgb: 'rgb(201,77,110)'  },
    { name: 'violet', accent: '#8A4DC9', accentRgb: 'rgb(138,77,201)'  },
    { name: 'ember',  accent: '#C96B4D', accentRgb: 'rgb(201,107,77)'  },
  ];
  var palette = PALETTES[Math.floor(Math.random() * PALETTES.length)];
  document.documentElement.style.setProperty('--accent', palette.accent);
  document.body.classList.add('has-webgl');

  var MAPBOX_TOKEN_KEY = 'mapbox-access-token';
  function getMapboxToken() { return localStorage.getItem(MAPBOX_TOKEN_KEY) || ''; }

  var mapContainer = document.getElementById('globe-map');
  var token = getMapboxToken();
  if (!token) {
    mapContainer.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:rgba(255,255,255,0.3);font-family:Inter,sans-serif;font-size:13px;">' +
        'Waiting for Mapbox token\u2026' +
      '</div>';
    return;
  }
  initMap(token);

  // --- Sun position ---
  var DEG = Math.PI / 180;
  var EARTH_R = 6371000;

  function getSunPosition() {
    var now = new Date();
    var JD = now.getTime() / 86400000 + 2440587.5;
    var n = JD - 2451545.0;
    var L = (280.460 + 0.9856474 * n) % 360;
    var g = (357.528 + 0.9856003 * n) % 360;
    if (L < 0) L += 360; if (g < 0) g += 360;
    var lambda = L + 1.915 * Math.sin(g * DEG) + 0.020 * Math.sin(2 * g * DEG);
    var epsilon = 23.439 - 0.0000004 * n;
    var declRad = Math.asin(Math.sin(epsilon * DEG) * Math.sin(lambda * DEG));
    var GMST = (18.697374558 + 24.06570982441908 * n) % 24;
    if (GMST < 0) GMST += 24;
    var ra = Math.atan2(Math.cos(epsilon * DEG) * Math.sin(lambda * DEG), Math.cos(lambda * DEG));
    var subSolarLon = (ra / DEG) - GMST * 15;
    while (subSolarLon > 180) subSolarLon -= 360;
    while (subSolarLon < -180) subSolarLon += 360;
    return { lat: declRad / DEG, lon: subSolarLon };
  }

  function buildNightPolygon(offsetDeg) {
    var sun = getSunPosition();
    var decl = sun.lat * DEG;
    if (Math.abs(sun.lat) < 0.1) decl = (sun.lat >= 0 ? 0.1 : -0.1) * DEG;
    var darkPoleLat = sun.lat >= 0 ? -90 : 90;
    var shift = (darkPoleLat > 0 ? 1 : -1) * offsetDeg;
    var coords = [];
    for (var lon = -180; lon <= 180; lon += 2) {
      var ha = (lon - sun.lon) * DEG;
      var lat = Math.atan(-Math.cos(ha) / Math.tan(decl)) / DEG + shift;
      if (lat > 90) lat = 90; if (lat < -90) lat = -90;
      coords.push([lon, lat]);
    }
    coords.push([180, darkPoleLat], [-180, darkPoleLat], coords[0].slice());
    return { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] } }] };
  }

  function initMap(accessToken) {
    mapboxgl.workerUrl = 'mapbox-gl-csp-worker.js';
    mapboxgl.accessToken = accessToken;

    var storedLat = parseFloat(localStorage.getItem('last-location-lat'));
    var storedLon = parseFloat(localStorage.getItem('last-location-lon'));
    var hasStoredLocation = !Number.isNaN(storedLat) && !Number.isNaN(storedLon);

    var startLat = window.userLocation ? window.userLocation.lat : (hasStoredLocation ? storedLat : 30.27);
    var startLon = window.userLocation ? window.userLocation.lon : (hasStoredLocation ? storedLon : -97.74);

    var map = new mapboxgl.Map({
      container: 'globe-map',
      style: 'mapbox://styles/mapbox/standard',
      projection: 'globe',
      center: [startLon, startLat],
      zoom: 2.5,
      attributionControl: false,
    });

    var mapLoaded = false;

    map.on('style.load', function () {
      map.setConfigProperty('basemap', 'theme', 'faded');
      map.setConfigProperty('basemap', 'showPlaceLabels', false);
      map.setConfigProperty('basemap', 'showRoadLabels', false);
      map.setConfigProperty('basemap', 'showPointOfInterestLabels', false);
      map.setConfigProperty('basemap', 'showTransitLabels', false);
      map.setFog({
        'color': 'rgb(15, 15, 25)',
        'high-color': palette.accentRgb,
        'space-color': 'rgb(5, 5, 8)',
        'star-intensity': 0.6,
        'horizon-blend': 0.03
      });
    });

    // --- City marker ---
    var markerEl = document.createElement('div');
    markerEl.className = 'city-marker-dot';
    markerEl.style.background = palette.accent;
    markerEl.style.setProperty('--marker-accent', palette.accent);
    var cityMarker = new mapboxgl.Marker({ element: markerEl, anchor: 'center' }).setLngLat([startLon, startLat]);

    window.globeSetCity = function (lat, lon) {
      cityMarker.setLngLat([lon, lat]);
      if (mapLoaded) map.flyTo({ center: [lon, lat], zoom: 3, duration: 2000 });
    };

    // Listen for location updates from Swift
    window.addEventListener('locationUpdated', function(e) {
      globeSetCity(e.detail.latitude, e.detail.longitude);
    });

    // Exposed controls for Swift menu bar
    window.mapFlyTo = function (zoom) {
      map.flyTo({ zoom: zoom, duration: 1500 });
    };

    window.setPollenEnabled = function (on) {
      var weatherView = document.getElementById('weather-view');
      var allergyView = document.getElementById('allergy-view');
      if (on) {
        weatherView.classList.add('bar-hidden');
        allergyView.classList.remove('bar-hidden');
        if (allergyView.querySelector('.bar-loading') && window.reloadAllergy) {
          window.reloadAllergy();
        }
      } else {
        weatherView.classList.remove('bar-hidden');
        allergyView.classList.add('bar-hidden');
      }
    };

    window.setWeatherEnabled = function (on) {
      weatherEnabled = on;
      if (mapLoaded) {
        map.setLayoutProperty('radar-layer', 'visibility', on ? 'visible' : 'none');
        if (on) fetchRadar();
      }
    };

    var labelLayerIds = ['country-labels', 'state-labels', 'city-labels', 'neighborhood-labels'];
    window.setLabelsEnabled = function (on) {
      if (!mapLoaded) return;
      var vis = on ? 'visible' : 'none';
      for (var i = 0; i < labelLayerIds.length; i++) {
        try { map.setLayoutProperty(labelLayerIds[i], 'visibility', vis); } catch (e) {}
      }
    };

    var spinning = false;
    var spinAnimId = null;
    var spinSpeed = 360 / 40; // degrees per second (~40s full rotation)
    var lastSpinTime = 0;
    window.setSpinEnabled = function (on) {
      spinning = on;
      if (on) {
        lastSpinTime = performance.now();
        if (!spinAnimId) spinAnimId = requestAnimationFrame(spinStep);
      } else {
        if (spinAnimId) { cancelAnimationFrame(spinAnimId); spinAnimId = null; }
      }
    };
    function spinStep(ts) {
      if (!spinning) { spinAnimId = null; return; }
      var dt = (ts - lastSpinTime) / 1000;
      lastSpinTime = ts;
      var center = map.getCenter();
      center.lng += spinSpeed * dt;
      if (center.lng > 180) center.lng -= 360;
      map.setCenter(center);
      spinAnimId = requestAnimationFrame(spinStep);
    }

    window.setFlightsEnabled = function (on) {
      flightsEnabled = on;
      if (mapLoaded) {
        map.setLayoutProperty('flights-layer', 'visibility', on ? 'visible' : 'none');
        if (on) {
          fetchFlights();
          if (!flightInterval) flightInterval = setInterval(fetchFlights, 300000);
          startFlightAnimation();
        } else {
          if (flightInterval) { clearInterval(flightInterval); flightInterval = null; }
          if (flightAnimId) { cancelAnimationFrame(flightAnimId); flightAnimId = null; }
        }
      }
    };

    // --- Flight state ---
    var FLIGHTS_MAX = 12000;
    var flightsEnabled = false;
    var flightInterval = null;
    var flightStore = [];
    var lastFlightFetch = 0;
    var flightAnimId = null;
    var lastFlightRender = 0;
    var FLIGHT_RENDER_MS = 200;

    // ==================== MAP LOAD ====================
    map.on('load', function () {
      mapLoaded = true;
      cityMarker.addTo(map);

      // --- Night overlays ---
      map.addSource('twilight-overlay', { type: 'geojson', data: buildNightPolygon(0) });
      map.addLayer({ id: 'twilight-overlay-layer', type: 'fill', source: 'twilight-overlay',
        paint: { 'fill-color': '#000010', 'fill-opacity': 0.3 }
      });

      map.addSource('night-overlay', { type: 'geojson', data: buildNightPolygon(6) });
      map.addLayer({ id: 'night-overlay-layer', type: 'fill', source: 'night-overlay',
        paint: { 'fill-color': '#000008', 'fill-opacity': 0.5 }
      });

      // --- Custom labels (replacing Standard style's white-halo labels) ---
      map.addSource('streets-data', { type: 'vector', url: 'mapbox://mapbox.mapbox-streets-v8' });

      map.addLayer({
        id: 'country-labels',
        type: 'symbol',
        source: 'streets-data',
        'source-layer': 'place_label',
        filter: ['==', ['get', 'class'], 'country'],
        layout: {
          'text-field': ['get', 'name'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 1, 10, 3, 14, 5, 18],
          'text-letter-spacing': 0.1,
          'text-max-width': 8
        },
        paint: {
          'text-color': 'rgba(0,0,0,0.6)',
          'text-halo-width': 0
        }
      });

      map.addLayer({
        id: 'state-labels',
        type: 'symbol',
        source: 'streets-data',
        'source-layer': 'place_label',
        filter: ['in', ['get', 'class'], ['literal', ['state', 'region']]],
        minzoom: 3,
        layout: {
          'text-field': ['get', 'name'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 3, 9, 5, 12, 7, 14],
          'text-letter-spacing': 0.05,
          'text-max-width': 8
        },
        paint: {
          'text-color': 'rgba(0,0,0,0.5)',
          'text-halo-width': 0
        }
      });

      map.addLayer({
        id: 'city-labels',
        type: 'symbol',
        source: 'streets-data',
        'source-layer': 'place_label',
        filter: ['==', ['get', 'class'], 'settlement'],
        layout: {
          'text-field': ['get', 'name'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 3, 9, 6, 12, 10, 16, 14, 20],
          'text-max-width': 8
        },
        paint: {
          'text-color': 'rgba(0,0,0,0.55)',
          'text-halo-width': 0
        }
      });

      map.addLayer({
        id: 'neighborhood-labels',
        type: 'symbol',
        source: 'streets-data',
        'source-layer': 'place_label',
        filter: ['==', ['get', 'class'], 'settlement_subdivision'],
        minzoom: 8,
        layout: {
          'text-field': ['get', 'name'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 8, 9, 12, 13, 15, 16],
          'text-max-width': 8
        },
        paint: {
          'text-color': 'rgba(0,0,0,0.45)',
          'text-halo-width': 0
        }
      });

      map.addLayer({
        id: 'road-lights',
        type: 'line',
        source: 'streets-data',
        'source-layer': 'road',
        filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary']]],
        paint: {
          'line-color': '#ffb040',
          'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.3, 8, 0.6, 12, 1.2],
          'line-opacity': 0.15,
          'line-blur': 1
        }
      });

      // --- Weather radar (RainViewer) ---
      map.addSource('radar', {
        type: 'raster',
        tiles: ['https://tilecache.rainviewer.com/v2/radar/nowcast/256/{z}/{x}/{y}/2/1_1.png'],
        tileSize: 256
      });
      map.addLayer({
        id: 'radar-layer',
        type: 'raster',
        source: 'radar',
        paint: { 'raster-opacity': 0.5 },
        layout: { 'visibility': 'none' }
      });

      // Radar starts disabled; controlled via window.setWeatherEnabled()

      // Update terminator every 60s
      setInterval(function () {
        var tw = map.getSource('twilight-overlay');
        var nt = map.getSource('night-overlay');
        if (tw) tw.setData(buildNightPolygon(0));
        if (nt) nt.setData(buildNightPolygon(6));
      }, 60000);

      // --- Flights ---
      map.addSource('flights', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

      var sz = 48;
      var ic = document.createElement('canvas');
      ic.width = sz; ic.height = sz;
      var ctx = ic.getContext('2d');
      ctx.fillStyle = palette.accent;
      ctx.translate(sz / 2, sz / 2);
      ctx.beginPath();
      ctx.moveTo(0, -14); ctx.lineTo(3, -4); ctx.lineTo(14, 2);
      ctx.lineTo(3, 3); ctx.lineTo(5, 12); ctx.lineTo(0, 9);
      ctx.lineTo(-5, 12); ctx.lineTo(-3, 3); ctx.lineTo(-14, 2);
      ctx.lineTo(-3, -4); ctx.closePath(); ctx.fill();
      var imgData = ctx.getImageData(0, 0, sz, sz);
      map.addImage('airplane', { width: sz, height: sz, data: imgData.data }, { pixelRatio: 2 });

      map.addLayer({
        id: 'flights-layer',
        type: 'symbol',
        source: 'flights',
        layout: {
          'icon-image': 'airplane',
          'icon-size': ['interpolate', ['linear'], ['zoom'], 2, 0.4, 5, 0.7, 8, 1.2, 12, 2.5],
          'icon-rotate': ['get', 'heading'],
          'icon-rotation-alignment': 'map',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'visibility': 'visible'
        },
        paint: { 'icon-opacity': 0.9 }
      });

      // Flights start disabled; controlled via window.setFlightsEnabled()
      map.setLayoutProperty('flights-layer', 'visibility', 'none');
    });

    // --- Flight fetching ---
    function fetchFlights() {
      if (!mapLoaded) return;
      fetch('https://opensky-network.org/api/states/all')
        .then(function (res) {
          if (res.status === 429) { console.warn('[Flights] Rate limited, backing off'); return null; }
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.json();
        })
        .then(function (data) {
          if (!data || !data.states) return;
          var newStore = [];
          for (var i = 0; i < data.states.length && newStore.length < FLIGHTS_MAX; i++) {
            var s = data.states[i];
            var lon = s[5], lat = s[6], onGround = s[8];
            if (onGround || lon == null || lat == null) continue;
            newStore.push({
              lon: lon, lat: lat,
              velocity: s[9] || 0, heading: s[10] || 0,
              callsign: s[1] || '', origin_country: s[2] || '',
              altitude: s[13] != null ? s[13] : (s[7] || 0),
              vertical_rate: s[11] || 0
            });
          }
          flightStore = newStore;
          lastFlightFetch = Date.now();
          renderFlightPositions();
        })
        .catch(function (err) { console.warn('[Flights]', err.message || err); });
    }

    function renderFlightPositions() {
      if (!flightStore.length) return;
      var elapsed = (Date.now() - lastFlightFetch) / 1000;
      var features = [];
      for (var i = 0; i < flightStore.length; i++) {
        var f = flightStore[i];
        var dist = f.velocity * elapsed;
        var hRad = f.heading * DEG;
        var latRad = f.lat * DEG;
        var cosLat = Math.cos(latRad);
        var dLat = (dist / EARTH_R) * Math.cos(hRad) / DEG;
        var dLon = cosLat > 0.01 ? (dist / EARTH_R) * Math.sin(hRad) / cosLat / DEG : 0;
        features.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [f.lon + dLon, f.lat + dLat] },
          properties: {
            heading: f.heading, callsign: f.callsign, origin_country: f.origin_country,
            altitude: f.altitude, velocity: f.velocity, vertical_rate: f.vertical_rate
          }
        });
      }
      var src = map.getSource('flights');
      if (src) src.setData({ type: 'FeatureCollection', features: features });
    }

    function animateFlights(ts) {
      if (!flightsEnabled) { flightAnimId = null; return; }
      if (ts - lastFlightRender >= FLIGHT_RENDER_MS) { lastFlightRender = ts; renderFlightPositions(); }
      flightAnimId = requestAnimationFrame(animateFlights);
    }
    function startFlightAnimation() { if (!flightAnimId) { lastFlightRender = 0; flightAnimId = requestAnimationFrame(animateFlights); } }

    // --- Weather radar (RainViewer) ---
    var weatherEnabled = false;
    function fetchRadar() {
      if (!mapLoaded) return;
      fetch('https://api.rainviewer.com/public/weather-maps.json')
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (!data || !data.radar || !data.radar.past || !data.radar.past.length) return;
          var latest = data.radar.past[data.radar.past.length - 1];
          var tileUrl = 'https://tilecache.rainviewer.com' + latest.path + '/256/{z}/{x}/{y}/2/1_1.png';
          var src = map.getSource('radar');
          if (src) {
            var vis = weatherEnabled ? 'visible' : 'none';
            map.removeLayer('radar-layer');
            map.removeSource('radar');
            map.addSource('radar', { type: 'raster', tiles: [tileUrl], tileSize: 256 });
            map.addLayer({
              id: 'radar-layer', type: 'raster', source: 'radar',
              paint: { 'raster-opacity': 0.5 },
              layout: { 'visibility': vis }
            });
          }
        })
        .catch(function (err) { console.warn('[Radar]', err.message || err); });
    }
  }
})();
