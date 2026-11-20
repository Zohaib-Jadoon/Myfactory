# Mobile Engineering Playbook

## 1. Expo / React Native & Flutter Lifecycle
- Handle background/foreground AppState transitions so camera streams and GPS listeners pause/release cleanly without battery drain or native crashes.
- Use native error boundaries and defensive handling for slow/offline mobile networks.
- Official docs: https://docs.expo.dev/ & https://docs.flutter.dev/

## 2. Permissions, Camera, GPS & Notifications
- Request least-privilege permissions strictly at point of use (`whenInUse` location before `always` unless background tracking is explicitly needed and disclosed).
- Validate GPS accuracy radius, timestamp freshness, and mock-location flags cleanly rather than silently trusting spoofable client flags.

## 3. Accessibility & Device Testing Discipline
- Minimum 44x44pt / 48x48dp touch targets, semantic accessibility labels (`accessibilityLabel` / `Semantics`), and Dynamic Type scaling support.
- Mark automated Jest/widget tests and emulator runs accurately; physical hardware camera/fingerprint/GPS verification on a real device remains `NOT VERIFIED` until executed on actual hardware.

## 4. Build & Release Signing Gate
- Verify `eas build` / `flutter build apk` environment configs cleanly while keeping keystore passwords/service accounts out of git.
- Require explicit owner approval before generating signed release bundles or uploading to Google Play / App Store Connect.
