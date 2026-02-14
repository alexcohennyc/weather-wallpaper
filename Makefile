APP_NAME = WeatherWallpaper
BUILD_DIR = build
APP_BUNDLE = $(BUILD_DIR)/$(APP_NAME).app
CONTENTS = $(APP_BUNDLE)/Contents
MACOS = $(CONTENTS)/MacOS
RESOURCES = $(CONTENTS)/Resources

SWIFT_FILES = \
	WeatherWallpaper/main.swift \
	WeatherWallpaper/AppDelegate.swift \
	WeatherWallpaper/DesktopWindowManager.swift \
	WeatherWallpaper/LocationManager.swift

FRAMEWORKS = -framework Cocoa -framework WebKit -framework CoreLocation -framework ServiceManagement
SWIFT_FLAGS = -target arm64-apple-macosx13.0

.PHONY: all clean run

all: $(APP_BUNDLE)

$(APP_BUNDLE): $(SWIFT_FILES) WeatherWallpaper/Web/* WeatherWallpaper/Info.plist
	@mkdir -p $(MACOS) $(RESOURCES)/Web
	swiftc $(SWIFT_FLAGS) $(FRAMEWORKS) -o $(MACOS)/$(APP_NAME) $(SWIFT_FILES)
	@# Info.plist with resolved variables
	@sed -e 's/$$(EXECUTABLE_NAME)/$(APP_NAME)/g' \
	     -e 's/$$(PRODUCT_BUNDLE_IDENTIFIER)/com.weatherwallpaper.app/g' \
	     -e 's/$$(PRODUCT_NAME)/Weather Wallpaper/g' \
	     -e 's/$$(MACOSX_DEPLOYMENT_TARGET)/13.0/g' \
	     WeatherWallpaper/Info.plist > $(CONTENTS)/Info.plist
	@cp -R WeatherWallpaper/Web/* $(RESOURCES)/Web/
	@echo "Built: $(APP_BUNDLE)"

run: $(APP_BUNDLE)
	open $(APP_BUNDLE)

clean:
	rm -rf $(BUILD_DIR)
