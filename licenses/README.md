# Third-party licences

DevMuxel vendors two fonts as variable woff2 files under
`src/renderer/src/styles/fonts/`. Both are SIL Open Font License 1.1, which
permits bundling with an application provided the licence travels with them.

| Font | Copyright | Licence |
|---|---|---|
| JetBrains Mono | 2020 The JetBrains Mono Project Authors | [OFL-JetBrainsMono.txt](./OFL-JetBrainsMono.txt) |
| Space Grotesk | 2020 The Space Grotesk Project Authors | [OFL-SpaceGrotesk.txt](./OFL-SpaceGrotesk.txt) |

Neither declares a Reserved Font Name, so the OFL's renaming clause does not
apply. Regenerate the font files with `npm run fonts`.

Everything else DevMuxel ships is either its own code (MIT, see the repository
root) or an npm dependency under its own licence.
