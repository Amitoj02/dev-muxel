electron-builder's `buildResources` directory.

`icon.ico` and `icon.png` are **generated** — run `npm run icon`, which redraws
the mark from the construction in [`../brand-kit`](../brand-kit) at every size
the installer and the shell need. Do not hand-edit them and do not drop a
replacement here; change `scripts/make-icon.mjs` instead, so the renderer's
favicons stay the same shape.

Without an `icon.ico` electron-builder falls back to the default Electron icon,
which is what "default Electron icon is used" in the `npm run build:win` log
means.
