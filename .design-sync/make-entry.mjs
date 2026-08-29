/*
 * Generate the bundle entry, and check the component map has not rotted.
 *
 * `package.json` `main` points at the Electron main-process bundle, so the
 * converter has to be given an explicit `--entry` or it will happily bundle the
 * wrong thing. This writes one that re-exports every component file.
 *
 * `src/renderer/src/main.tsx` is deliberately not reachable from here: it calls
 * `connect()` at module scope, which would run the preload bridge at bundle load.
 *
 * The check matters more than the file. With an explicit `--entry` the converter
 * does not fall back to src discovery, so a component missing from
 * `cfg.componentSrcMap` is silently absent from the sync with no warning
 * anywhere. Run this before package-build.mjs; it exits non-zero on a mismatch.
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const DIR = 'src/renderer/src/components'
const OUT = '.design-sync/.cache/entry.tsx'

const files = readdirSync(DIR)
  .filter((f) => f.endsWith('.tsx'))
  .sort()

mkdirSync('.design-sync/.cache', { recursive: true })
writeFileSync(OUT, files.map((f) => `export * from '../../${DIR}/${f}'`).join('\n') + '\n')

// Every PascalCase value export across those files is a component the sync
// should carry.
const found = new Map()
for (const f of files) {
  const src = readFileSync(`${DIR}/${f}`, 'utf8')
  const rx = /^export\s+(?:async\s+)?(?:function|const|class)\s+([A-Za-z0-9_]+)/gm
  let m
  while ((m = rx.exec(src))) {
    if (/^[A-Z][A-Za-z0-9]*$/.test(m[1])) found.set(m[1], `${DIR}/${f}`)
  }
}

const cfg = JSON.parse(readFileSync('.design-sync/config.json', 'utf8'))
const mapped = new Set(Object.keys(cfg.componentSrcMap ?? {}))
const missing = [...found.keys()].filter((n) => !mapped.has(n))
const stale = [...mapped].filter((n) => !found.has(n))

console.error(`  entry.tsx: ${files.length} modules, ${found.size} components`)

if (missing.length || stale.length) {
  if (missing.length) {
    console.error(`\n✗ componentSrcMap is missing ${missing.length}:`)
    for (const n of missing) console.error(`    "${n}": "${found.get(n)}",`)
  }
  if (stale.length) console.error(`\n✗ componentSrcMap names components that no longer exist: ${stale.join(', ')}`)
  console.error('\n  Fix .design-sync/config.json before building, or these components sync wrong.')
  process.exit(1)
}
