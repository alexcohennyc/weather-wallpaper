import Cocoa
import WebKit
import CoreLocation

class AppDelegate: NSObject, NSApplicationDelegate {

    private var statusItem: NSStatusItem!
    private var desktopManager: DesktopWindowManager!
    private var locationManager: LocationManager!
    private var currentZoom: Double = 2.5
    private var flightsEnabled: Bool = false
    private var pollenEnabled: Bool = false
    private var weatherEnabled: Bool = false
    private var labelsEnabled: Bool = true
    private var spinEnabled: Bool = false
    private var currentUnitSystem: String = "imperial"

    func applicationDidFinishLaunching(_ notification: Notification) {
        if let savedUnit = UserDefaults.standard.string(forKey: "unit-system"), ["imperial", "metric"].contains(savedUnit) {
            currentUnitSystem = savedUnit
        }

        setupMenuBar()

        desktopManager = DesktopWindowManager()
        desktopManager.setupWindows()
        desktopManager.injectUnitSystem(currentUnitSystem)

        locationManager = LocationManager { [weak self] lat, lon in
            self?.desktopManager.injectLocation(lat: lat, lon: lon)
        }
        locationManager.requestLocation()

        if let token = UserDefaults.standard.string(forKey: "mapbox-access-token"), !token.isEmpty {
            desktopManager.injectMapboxToken(token)
        }

        NotificationCenter.default.addObserver(
            self,
            selector: #selector(screensChanged),
            name: NSApplication.didChangeScreenParametersNotification,
            object: nil
        )
    }

    // MARK: - Menu Bar

    private func setupMenuBar() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let img = NSImage(systemSymbolName: "globe.americas.fill", accessibilityDescription: "Weather Wallpaper") {
            img.isTemplate = true
            statusItem.button?.image = img
        } else {
            statusItem.button?.title = "☀"
        }

        let menu = NSMenu()

        menu.addItem(NSMenuItem(title: "Refresh Location", action: #selector(refreshLocation), keyEquivalent: "r"))
        menu.addItem(NSMenuItem(title: "Search Location…", action: #selector(searchLocation), keyEquivalent: "l"))
        menu.addItem(NSMenuItem(title: "Set Mapbox Token…", action: #selector(setMapboxToken), keyEquivalent: ""))
        menu.addItem(NSMenuItem(title: "Set Pollen API Key…", action: #selector(setPollenApiKey), keyEquivalent: ""))
        menu.addItem(NSMenuItem.separator())

        let zoomGlobe = NSMenuItem(title: "Zoom: Globe", action: #selector(setZoomGlobe(_:)), keyEquivalent: "")
        zoomGlobe.state = .on
        menu.addItem(zoomGlobe)
        let zoomCountry = NSMenuItem(title: "Zoom: Country", action: #selector(setZoomCountry(_:)), keyEquivalent: "")
        menu.addItem(zoomCountry)
        let zoomCity = NSMenuItem(title: "Zoom: City", action: #selector(setZoomCity(_:)), keyEquivalent: "")
        menu.addItem(zoomCity)
        let zoomStreet = NSMenuItem(title: "Zoom: Street", action: #selector(setZoomStreet(_:)), keyEquivalent: "")
        menu.addItem(zoomStreet)
        menu.addItem(NSMenuItem.separator())

        let unitsImperial = NSMenuItem(title: "Units: Imperial (°F, mph)", action: #selector(setUnitsImperial(_:)), keyEquivalent: "")
        unitsImperial.state = currentUnitSystem == "imperial" ? .on : .off
        menu.addItem(unitsImperial)
        let unitsMetric = NSMenuItem(title: "Units: Metric (°C, km/h)", action: #selector(setUnitsMetric(_:)), keyEquivalent: "")
        unitsMetric.state = currentUnitSystem == "metric" ? .on : .off
        menu.addItem(unitsMetric)
        menu.addItem(NSMenuItem.separator())

        let flightsItem = NSMenuItem(title: "Show Flights", action: #selector(toggleFlights(_:)), keyEquivalent: "")
        flightsItem.state = .off
        menu.addItem(flightsItem)
        let weatherItem = NSMenuItem(title: "Show Weather Radar", action: #selector(toggleWeather(_:)), keyEquivalent: "")
        weatherItem.state = .off
        menu.addItem(weatherItem)
        let pollenItem = NSMenuItem(title: "Show Pollen & Air Quality", action: #selector(togglePollen(_:)), keyEquivalent: "")
        pollenItem.state = .off
        menu.addItem(pollenItem)
        let labelsItem = NSMenuItem(title: "Show Labels", action: #selector(toggleLabels(_:)), keyEquivalent: "")
        labelsItem.state = .on
        menu.addItem(labelsItem)
        let spinItem = NSMenuItem(title: "Spin Globe", action: #selector(toggleSpin(_:)), keyEquivalent: "")
        spinItem.state = .off
        menu.addItem(spinItem)
        menu.addItem(NSMenuItem.separator())

        let launchItem = NSMenuItem(title: "Launch at Login", action: #selector(toggleLaunchAtLogin(_:)), keyEquivalent: "")
        launchItem.state = LaunchAtLogin.isEnabled ? .on : .off
        menu.addItem(launchItem)

        menu.addItem(NSMenuItem.separator())
        menu.addItem(NSMenuItem(title: "Quit Weather Wallpaper", action: #selector(quitApp), keyEquivalent: "q"))

        statusItem.menu = menu
    }

    // MARK: - Actions

    @objc private func refreshLocation() {
        locationManager.requestLocation()
    }

    @objc private func searchLocation() {
        let alert = NSAlert()
        alert.messageText = "Search Location"
        alert.informativeText = "Enter a city or place name."
        alert.alertStyle = .informational
        alert.addButton(withTitle: "Set")
        alert.addButton(withTitle: "Cancel")

        let input = NSTextField(frame: NSRect(x: 0, y: 0, width: 300, height: 24))
        input.placeholderString = "e.g. Tokyo, Paris, New York"
        alert.accessoryView = input

        NSApp.activate(ignoringOtherApps: true)

        if alert.runModal() == .alertFirstButtonReturn {
            let query = input.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
            if query.isEmpty { return }

            let geocoder = CLGeocoder()
            geocoder.geocodeAddressString(query) { [weak self] placemarks, error in
                DispatchQueue.main.async {
                    guard let place = placemarks?.first,
                          let loc = place.location else {
                        let err = NSAlert()
                        err.messageText = "Location Not Found"
                        err.informativeText = "Could not find \"\(query)\". Try a different search."
                        err.alertStyle = .warning
                        err.addButton(withTitle: "OK")
                        err.runModal()
                        return
                    }
                    self?.desktopManager.injectLocation(
                        lat: loc.coordinate.latitude,
                        lon: loc.coordinate.longitude
                    )
                }
            }
        }
    }

    @objc private func setMapboxToken() {
        let alert = NSAlert()
        alert.messageText = "Mapbox Access Token"
        alert.informativeText = "Enter your Mapbox public token (pk.eyJ…).\nGet one free at mapbox.com/account/access-tokens"
        alert.alertStyle = .informational
        alert.addButton(withTitle: "Save")
        alert.addButton(withTitle: "Cancel")

        let input = NSTextField(frame: NSRect(x: 0, y: 0, width: 360, height: 24))
        input.placeholderString = "pk.eyJ..."
        input.stringValue = UserDefaults.standard.string(forKey: "mapbox-access-token") ?? ""
        alert.accessoryView = input

        NSApp.activate(ignoringOtherApps: true)

        if alert.runModal() == .alertFirstButtonReturn {
            let token = input.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
            if !token.isEmpty {
                UserDefaults.standard.set(token, forKey: "mapbox-access-token")
                desktopManager.injectMapboxToken(token)
            }
        }
    }

    @objc private func setPollenApiKey() {
        let alert = NSAlert()
        alert.messageText = "Google Pollen API Key"
        alert.informativeText = "Enter your Google Pollen API key.\nGet one at console.cloud.google.com"
        alert.alertStyle = .informational
        alert.addButton(withTitle: "Save")
        alert.addButton(withTitle: "Cancel")

        let input = NSTextField(frame: NSRect(x: 0, y: 0, width: 360, height: 24))
        input.placeholderString = "AIza..."
        input.stringValue = UserDefaults.standard.string(forKey: "google-pollen-api-key") ?? ""
        alert.accessoryView = input

        NSApp.activate(ignoringOtherApps: true)

        if alert.runModal() == .alertFirstButtonReturn {
            let key = input.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
            if !key.isEmpty {
                UserDefaults.standard.set(key, forKey: "google-pollen-api-key")
                desktopManager.injectPollenApiKey(key)
            }
        }
    }

    // MARK: - Zoom

    private func updateZoomCheckmarks() {
        guard let menu = statusItem.menu else { return }
        for item in menu.items {
            if item.title.hasPrefix("Zoom: ") {
                switch item.title {
                case "Zoom: Globe":   item.state = currentZoom == 2.5  ? .on : .off
                case "Zoom: Country": item.state = currentZoom == 5.0  ? .on : .off
                case "Zoom: City":    item.state = currentZoom == 8.0  ? .on : .off
                case "Zoom: Street":  item.state = currentZoom == 12.0 ? .on : .off
                default: break
                }
            }
        }
    }

    @objc private func setZoomGlobe(_ sender: NSMenuItem) {
        currentZoom = 2.5
        desktopManager.injectZoom(currentZoom)
        updateZoomCheckmarks()
    }

    @objc private func setZoomCountry(_ sender: NSMenuItem) {
        currentZoom = 5.0
        desktopManager.injectZoom(currentZoom)
        updateZoomCheckmarks()
    }

    @objc private func setZoomCity(_ sender: NSMenuItem) {
        currentZoom = 8.0
        desktopManager.injectZoom(currentZoom)
        updateZoomCheckmarks()
    }

    @objc private func setZoomStreet(_ sender: NSMenuItem) {
        currentZoom = 12.0
        desktopManager.injectZoom(currentZoom)
        updateZoomCheckmarks()
    }

    private func updateUnitCheckmarks() {
        guard let menu = statusItem.menu else { return }
        for item in menu.items {
            if item.title.hasPrefix("Units: ") {
                switch item.title {
                case "Units: Imperial (°F, mph)": item.state = currentUnitSystem == "imperial" ? .on : .off
                case "Units: Metric (°C, km/h)": item.state = currentUnitSystem == "metric" ? .on : .off
                default: break
                }
            }
        }
    }

    @objc private func setUnitsImperial(_ sender: NSMenuItem) {
        currentUnitSystem = "imperial"
        UserDefaults.standard.set(currentUnitSystem, forKey: "unit-system")
        desktopManager.injectUnitSystem(currentUnitSystem)
        updateUnitCheckmarks()
    }

    @objc private func setUnitsMetric(_ sender: NSMenuItem) {
        currentUnitSystem = "metric"
        UserDefaults.standard.set(currentUnitSystem, forKey: "unit-system")
        desktopManager.injectUnitSystem(currentUnitSystem)
        updateUnitCheckmarks()
    }

    // MARK: - Flights

    @objc private func toggleFlights(_ sender: NSMenuItem) {
        flightsEnabled.toggle()
        sender.state = flightsEnabled ? .on : .off
        desktopManager.injectFlightsToggle(flightsEnabled)
    }

    @objc private func toggleWeather(_ sender: NSMenuItem) {
        weatherEnabled.toggle()
        sender.state = weatherEnabled ? .on : .off
        desktopManager.injectWeatherToggle(weatherEnabled)
    }

    @objc private func togglePollen(_ sender: NSMenuItem) {
        pollenEnabled.toggle()
        sender.state = pollenEnabled ? .on : .off
        desktopManager.injectPollenToggle(pollenEnabled)
    }

    @objc private func toggleLabels(_ sender: NSMenuItem) {
        labelsEnabled.toggle()
        sender.state = labelsEnabled ? .on : .off
        desktopManager.injectLabelsToggle(labelsEnabled)
    }

    @objc private func toggleSpin(_ sender: NSMenuItem) {
        spinEnabled.toggle()
        sender.state = spinEnabled ? .on : .off
        desktopManager.injectSpinToggle(spinEnabled)
    }

    @objc private func toggleLaunchAtLogin(_ sender: NSMenuItem) {
        LaunchAtLogin.isEnabled.toggle()
        sender.state = LaunchAtLogin.isEnabled ? .on : .off
    }

    @objc private func quitApp() {
        NSApp.terminate(nil)
    }

    @objc private func screensChanged() {
        desktopManager.rebuildWindows()
    }
}

// MARK: - Launch at Login helper

enum LaunchAtLogin {
    private static let bundleID = Bundle.main.bundleIdentifier ?? ""

    static var isEnabled: Bool {
        get {
            UserDefaults.standard.bool(forKey: "launchAtLogin")
        }
        set {
            UserDefaults.standard.set(newValue, forKey: "launchAtLogin")
            if newValue {
                enableLoginItem()
            } else {
                disableLoginItem()
            }
        }
    }

    private static func enableLoginItem() {
        if #available(macOS 13.0, *) {
            try? SMAppService.mainApp.register()
        }
    }

    private static func disableLoginItem() {
        if #available(macOS 13.0, *) {
            try? SMAppService.mainApp.unregister()
        }
    }
}

import ServiceManagement
