/*
 * Emit a declaration tree for the sync's prop extraction.
 *
 * The converter reads `<Name>Props` out of a shipped `.d.ts` tree. DevLobby is
 * an app, not a published package, so it has never emitted one — without this
 * every component's contract degrades to `[key: string]: unknown`, and the
 * design agent gets no API to code against.
 *
 * `types/` is generated and gitignored; `findTypesRoot` picks it up by name.
 * The barrel is what the extractor resolves component symbols through, so it
 * must name every component file.
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, writeFileSync } from 'node:fs'

execFileSync(
  process.execPath,
  ['node_modules/typescript/bin/tsc', '-p', '.design-sync/.cache/tsconfig.types.json'],
  { stdio: 'inherit' }
)

const dir = 'types/renderer/src/components'
const mods = readdirSync(dir)
  .filter((f) => f.endsWith('.d.ts'))
  .map((f) => `export * from './renderer/src/components/${f.replace(/\.d\.ts$/, '')}'`)
writeFileSync('types/index.d.ts', mods.join('\n') + '\n')
console.error(`  types/: ${mods.length} component modules → types/index.d.ts`)
