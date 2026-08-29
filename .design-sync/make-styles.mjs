/*
 * Compose the stylesheet the sync ships as `_ds_bundle.css`.
 *
 * `cfg.cssEntry` is read verbatim (no @import resolution) and the converter's
 * `tokens/` copier only handles token *packages* under node_modules — ours are
 * plain files in the app. So we concatenate, in the same order main.tsx imports
 * them, into a cache file that cssEntry points at.
 *
 * tokens.css must lead: it carries the `* { border-radius: 0 }` reset and the
 * keyframes app.css references. fonts.css is deliberately absent — cfg.extraFonts
 * ships it into fonts/ with the woff2s and rewritten urls.
 *
 * Run before package-build.mjs. See .design-sync/NOTES.md.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const SOURCES = [
  'src/renderer/src/styles/tokens.css',
  'node_modules/@xterm/xterm/css/xterm.css',
  'src/renderer/src/styles/app.css'
]

mkdirSync('.design-sync/.cache', { recursive: true })
const out = SOURCES.map(
  (p) => `/* ===== ${p} ===== */\n${readFileSync(p, 'utf8')}`
).join('\n\n')
writeFileSync('.design-sync/.cache/ds-styles.css', out)
console.error(`  ds-styles.css: ${SOURCES.length} sources, ${Math.round(out.length / 1024)} KB`)
