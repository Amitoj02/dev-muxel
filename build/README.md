electron-builder's `buildResources` directory.

Drop `icon.ico` (256x256 or larger) here and electron-builder will use it for
the window, the installer and the taskbar. Without one it falls back to the
default Electron icon, which is why `npm run build:win` logs
"default Electron icon is used".
