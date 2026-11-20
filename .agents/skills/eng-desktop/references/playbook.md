# Desktop Engineering Playbook

## 1. Electron Process Isolation & IPC
- Main process owns OS/filesystem/child-process actions; renderer stays untrusted UI.
- Restrict `shell.openExternal()` strictly to `https:` allowlisted URLs; block arbitrary navigation (`will-navigate`) and `new-window` popups.
- Validate all `ipcMain.handle(...)` arguments on receipt before accessing paths or SQLite databases.
- Official docs: https://www.electronjs.org/docs/latest/tutorial/security & https://v2.tauri.app/security/

## 2. Windows Packaging, Auto-Update & Verification
- Test packaged builds (`electron-builder --dir` / installed `.exe`) for ASAR asset resolution, native SQLite/DLL loading, and clean uninstall/upgrade paths.
- Verify SQLite WAL files close cleanly on `before-quit` so Windows file locks do not corrupt local state during updates.
- Never silently terminate unrelated desktop tools or running IDE processes during updater tests.
