import Cocoa
import WebKit

class DesktopWindowManager {

    private let lastLocationLatKey = "last-location-lat"
    private let lastLocationLonKey = "last-location-lon"

    private var windows: [(NSWindow, WKWebView)] = []
    private var pendingToken: String?
    private var pendingLocation: (lat: Double, lon: Double)?
    private var pendingPollenKey: String?
    private var pendingUnitSystem: String?

    func setupWindows() {
        createWindowsForAllScreens()
    }

    func rebuildWindows() {
        for (window, _) in windows {
            window.orderOut(nil)
        }
        windows.removeAll()
        createWindowsForAllScreens()

        // Re-inject state
        if let token = UserDefaults.standard.string(forKey: "mapbox-access-token"), !token.isEmpty {
            injectMapboxToken(token)
        }
        if let key = UserDefaults.standard.string(forKey: "google-pollen-api-key"), !key.isEmpty {
            injectPollenApiKey(key)
        }
        if let unit = pendingUnitSystem ?? UserDefaults.standard.string(forKey: "unit-system") {
            injectUnitSystem(unit)
        }
        if let loc = pendingLocation ?? persistedLocation() {
            injectLocation(lat: loc.lat, lon: loc.lon)
        }
    }

    private func persistedLocation() -> (lat: Double, lon: Double)? {
        guard let latNum = UserDefaults.standard.object(forKey: lastLocationLatKey) as? NSNumber,
              let lonNum = UserDefaults.standard.object(forKey: lastLocationLonKey) as? NSNumber else {
            return nil
        }
        return (latNum.doubleValue, lonNum.doubleValue)
    }

    // MARK: - Window creation

    private func createWindowsForAllScreens() {
        for screen in NSScreen.screens {
            let (window, webView) = createDesktopWindow(for: screen)
            windows.append((window, webView))
            loadContent(in: webView)
            window.orderFront(nil)
        }
    }

    private func createDesktopWindow(for screen: NSScreen) -> (NSWindow, WKWebView) {
        let window = NSWindow(
            contentRect: screen.frame,
            styleMask: .borderless,
            backing: .buffered,
            defer: false,
            screen: screen
        )

        window.level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopWindow)))
        window.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
        window.ignoresMouseEvents = true
        window.hasShadow = false
        window.isOpaque = false
        window.backgroundColor = .black
        window.canHide = false

        let config = WKWebViewConfiguration()
        config.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")

        // Inject Mapbox token before page load
        if let token = UserDefaults.standard.string(forKey: "mapbox-access-token"), !token.isEmpty {
            let script = WKUserScript(
                source: "localStorage.setItem('mapbox-access-token', \(quoteJS(token)));",
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            )
            config.userContentController.addUserScript(script)
        }

        // Inject pollen API key before page load
        if let key = UserDefaults.standard.string(forKey: "google-pollen-api-key"), !key.isEmpty {
            let script = WKUserScript(
                source: "localStorage.setItem('google-pollen-api-key', \(quoteJS(key)));",
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            )
            config.userContentController.addUserScript(script)
        }

        // Inject preferred unit system before page load
        if let unit = pendingUnitSystem ?? UserDefaults.standard.string(forKey: "unit-system"), ["imperial", "metric"].contains(unit) {
            let script = WKUserScript(
                source: "localStorage.setItem('unit-system', \(quoteJS(unit)));",
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            )
            config.userContentController.addUserScript(script)
        }

        // Inject saved location before page load
        if let loc = pendingLocation ?? persistedLocation() {
            let script = WKUserScript(
                source: "window.userLocation = { name: '', lat: \(loc.lat), lon: \(loc.lon) }; localStorage.setItem('last-location-lat', '\(loc.lat)'); localStorage.setItem('last-location-lon', '\(loc.lon)');",
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            )
            config.userContentController.addUserScript(script)
        }

        let webView = WKWebView(frame: window.contentView!.bounds, configuration: config)
        webView.autoresizingMask = [.width, .height]
        webView.setValue(false, forKey: "drawsBackground")

        window.contentView?.addSubview(webView)

        return (window, webView)
    }

    private func loadContent(in webView: WKWebView) {
        guard let resourceURL = Bundle.main.resourceURL else { return }
        let webDir = resourceURL.appendingPathComponent("Web")
        let indexURL = webDir.appendingPathComponent("index.html")
        webView.loadFileURL(indexURL, allowingReadAccessTo: webDir)
    }

    // MARK: - JavaScript injection

    func injectLocation(lat: Double, lon: Double) {
        pendingLocation = (lat, lon)
        UserDefaults.standard.set(lat, forKey: lastLocationLatKey)
        UserDefaults.standard.set(lon, forKey: lastLocationLonKey)

        let js = """
        localStorage.setItem('last-location-lat', '\(lat)');
        localStorage.setItem('last-location-lon', '\(lon)');
        window.userLocation = { name: '', lat: \(lat), lon: \(lon) };
        window.dispatchEvent(new CustomEvent('locationUpdated', {
            detail: { latitude: \(lat), longitude: \(lon) }
        }));
        """
        evaluateOnAll(js)
    }

    func injectMapboxToken(_ token: String) {
        pendingToken = token
        let js = """
        localStorage.setItem('mapbox-access-token', \(quoteJS(token)));
        location.reload();
        """
        evaluateOnAll(js)
    }

    func injectPollenApiKey(_ key: String) {
        pendingPollenKey = key
        let js = """
        localStorage.setItem('google-pollen-api-key', \(quoteJS(key)));
        if (window.reloadAllergy) window.reloadAllergy();
        """
        evaluateOnAll(js)
    }

    func injectUnitSystem(_ system: String) {
        let normalized = system == "metric" ? "metric" : "imperial"
        pendingUnitSystem = normalized
        let js = """
        localStorage.setItem('unit-system', \(quoteJS(normalized)));
        if (window.setUnitSystem) window.setUnitSystem(\(quoteJS(normalized)));
        """
        evaluateOnAll(js)
    }

    func injectZoom(_ level: Double) {
        let js = "if (window.mapFlyTo) window.mapFlyTo(\(level));"
        evaluateOnAll(js)
    }

    func injectFlightsToggle(_ enabled: Bool) {
        let js = "if (window.setFlightsEnabled) window.setFlightsEnabled(\(enabled));"
        evaluateOnAll(js)
    }

    func injectPollenToggle(_ enabled: Bool) {
        let js = "if (window.setPollenEnabled) window.setPollenEnabled(\(enabled));"
        evaluateOnAll(js)
    }

    func injectWeatherToggle(_ enabled: Bool) {
        let js = "if (window.setWeatherEnabled) window.setWeatherEnabled(\(enabled));"
        evaluateOnAll(js)
    }

    func injectLabelsToggle(_ enabled: Bool) {
        let js = "if (window.setLabelsEnabled) window.setLabelsEnabled(\(enabled));"
        evaluateOnAll(js)
    }

    func injectSpinToggle(_ enabled: Bool) {
        let js = "if (window.setSpinEnabled) window.setSpinEnabled(\(enabled));"
        evaluateOnAll(js)
    }

    private func evaluateOnAll(_ js: String) {
        for (_, webView) in windows {
            webView.evaluateJavaScript(js, completionHandler: nil)
        }
    }

    private func quoteJS(_ s: String) -> String {
        let escaped = s
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "'", with: "\\'")
            .replacingOccurrences(of: "\n", with: "\\n")
        return "'\(escaped)'"
    }
}
