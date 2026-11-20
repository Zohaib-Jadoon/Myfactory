---
name: eng-mobile
description: Mobile standards for Expo, React Native, Flutter, device permissions, offline queues, camera/GPS, accessibility, and APK signing gates.
---
# Engineering Standards — Mobile

Load `references/playbook.md` for Expo/React Native/Flutter lifecycle, permissions, offline storage, camera/GPS, or Android APK/iOS build flows.

## Core Checklist
1. Handle permission prompts, permanent denials, and deep-link settings redirects cleanly (`camera`, `location`, `notifications`).
2. Store auth tokens only in encrypted OS secure storage (`SecureStore` / `flutter_secure_storage`), never plain AsyncStorage/SharedPreferences.
3. Design offline-tolerant queues with idempotency keys for poor connectivity (attendance/fleet check-ins).
4. Separate debug/preview APK builds from signed release APKs (require human approval); distinguish emulator checks from physical hardware verification.
