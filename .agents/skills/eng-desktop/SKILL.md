---
name: eng-desktop
description: Desktop engineering standards for Electron/Tauri process isolation, preload IPC security, filesystem permissions, installers, and packaged startup verification.
---
# Engineering Standards — Desktop

Load `references/playbook.md` for Electron/Tauri IPC contracts, auto-updates, Windows MSI/NSIS packaging, or startup verification.

## Core Checklist
1. Enforce `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` (or Tauri capability allowlists) in every renderer window.
2. Expose minimal explicit IPC methods through `preload.js` with schema validation and path boundary checks (`assertInsideRoot`).
3. Verify cold startup, file permissions, and auto-update rollback against the **packaged executable**, never relying solely on dev hot-reload.
4. Keep code-signing certificates/secrets out of repositories; gate signed installer distribution on explicit human approval.
