#!/usr/bin/env bash
# B-SDK-06 simulator check: what the no-prompt pasteboard questions answer for the
# clipboard the tap page leaves (navigator.clipboard.writeText = plain text).
# Needs Xcode. Creates a throwaway simulator, prints PROBE lines, deletes it.
set -euo pipefail
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
here="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"; app="$work/PasteProbe.app"; mkdir -p "$app"
cp "$here/Info.plist" "$app/"
xcrun --sdk iphonesimulator swiftc -suppress-warnings -target arm64-apple-ios16.0-simulator "$here/main.swift" -o "$app/PasteProbe"
codesign -s - "$app" >/dev/null 2>&1
runtime="$(xcrun simctl list runtimes | sed -n 's/.*\(com.apple.CoreSimulator.SimRuntime.iOS-[0-9-]*\).*/\1/p' | tail -1)"
udid="$(xcrun simctl create strait-paste-probe "iPhone 17e" "$runtime")"
trap 'xcrun simctl shutdown "$udid" >/dev/null 2>&1 || true; xcrun simctl delete "$udid" >/dev/null 2>&1 || true; rm -rf "$work"' EXIT
xcrun simctl boot "$udid"; xcrun simctl bootstatus "$udid" -b >/dev/null
xcrun simctl install "$udid" "$app"
probe() { xcrun simctl launch --console-pty --terminate-running-process "$udid" in.straitlink.pasteprobe "$1" 2>&1 | grep PROBE; }
printf 'https://demo.strait.link/h/AAAAAAAAAAAAAAAAAAAAAA' | xcrun simctl pbcopy "$udid"; probe text-handoff-url
printf 'hello world' | xcrun simctl pbcopy "$udid"; probe text-plain
probe url-type
