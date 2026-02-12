import Cocoa
import WebKit

class DesktopWindowManager: NSObject, WKScriptMessageHandler {

    private var windows: [(NSWindow, WKWebView)] = []
    private var pendingToken: String?
    private var pendingLocation: (lat: Double, lon: Double)?
    private var pendingPollenKey: String?
    private let processPool = WKProcessPool()

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
        if let loc = pendingLocation {
            injectLocation(lat: loc.lat, lon: loc.lon)
        }
    }

    // MARK: - Window creation

    private func createWindowsForAllScreens() {
        for (index, screen) in NSScreen.screens.enumerated() {
            let isPrimary = (index == 0)
            let (window, webView) = createDesktopWindow(for: screen, isPrimary: isPrimary)
            windows.append((window, webView))
            loadContent(in: webView)
            window.orderFront(nil)
        }
    }

    private func createDesktopWindow(for screen: NSScreen, isPrimary: Bool) -> (NSWindow, WKWebView) {
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
        #if DEBUG
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")
        #endif
        config.processPool = processPool

        // Register data relay message handler
        config.userContentController.add(self, name: "dataRelay")

        // Inject primary/secondary flag before page load
        let primaryScript = WKUserScript(
            source: "window.isPrimaryView = \(isPrimary);",
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        )
        config.userContentController.addUserScript(primaryScript)

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

        // Inject saved location before page load
        if let loc = pendingLocation {
            let script = WKUserScript(
                source: "window.userLocation = { name: '', lat: \(loc.lat), lon: \(loc.lon) };",
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

    // MARK: - WKScriptMessageHandler (data relay from primary → all)

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard message.name == "dataRelay",
              let body = message.body as? [String: Any],
              let type = body["type"] as? String,
              let jsonStr = body["json"] as? String else { return }

        // Broadcast to all webviews (primary will receive too, but receivers are idempotent)
        let js: String
        switch type {
        case "flights":
            js = "if (window.receiveFlights) window.receiveFlights(\(jsonStr));"
        case "weather":
            js = "if (window.receiveWeather) window.receiveWeather(\(jsonStr));"
        case "allergy":
            js = "if (window.receiveAllergy) window.receiveAllergy(\(jsonStr));"
        case "radarUrl":
            js = "if (window.receiveRadarUrl) window.receiveRadarUrl(\(jsonStr));"
        default:
            return
        }
        evaluateOnAll(js)
    }

    // MARK: - JavaScript injection

    func injectLocation(lat: Double, lon: Double, name: String = "") {
        pendingLocation = (lat, lon)
        let js = """
        window.userLocation = { name: \(quoteJS(name)), lat: \(lat), lon: \(lon) };
        window.dispatchEvent(new CustomEvent('locationUpdated', {
            detail: { latitude: \(lat), longitude: \(lon), name: \(quoteJS(name)) }
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

    func injectPaused(_ paused: Bool) {
        let js = "if (window.setAppPaused) window.setAppPaused(\(paused));"
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
