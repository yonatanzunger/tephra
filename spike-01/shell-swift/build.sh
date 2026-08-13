#!/bin/bash
# A hand-assembled .app: no Xcode, no project file, no signing. Part of the
# measurement — this is what the native path costs before you write any features.
set -e
cd "$(dirname "$0")"
APP="Tephra.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
swiftc -O -o "$APP/Contents/MacOS/Tephra" harness.swift main.swift
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleExecutable</key><string>Tephra</string>
  <key>CFBundleIdentifier</key><string>dev.tephra.spike</string>
  <key>CFBundleName</key><string>Tephra</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict></plist>
PLIST
echo "built $APP  ($(wc -l < main.swift) lines of Swift)"
