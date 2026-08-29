# design-sync notes — dev-muxel

Repo-specific gotchas for future syncs. Read this before re-running the converter.

## What this repo is

An Electron app, not a published component library: `private: true`, no `dist/`, no
barrel export. The sync runs in **synthesized-entry mode** against `src/renderer/src/components`.
Everything below follows from that.

## Three generated inputs must be built before the converter

`.design-sync/config.json` points `cssEntry`, the types root and the entry at
generated files. All three scripts are committed; run them from the repo root
before `package-build.mjs`:

```sh
node .design-sync/make-styles.mjs   # → .design-sync/.cache/ds-styles.css
node .design-sync/make-types.mjs    # → types/ (+ types/index.d.ts)
node .design-sync/make-entry.mjs    # → .design-sync/.cache/entry.tsx (exits 1 on map drift)
```

- **`make-styles.mjs`** concatenates `tokens.css` + `@xterm/xterm/css/xterm.css` + `app.css`
  in main.tsx's own order. Needed because `cfg.cssEntry` is read verbatim (no `@import`
  resolution) and the converter's `tokens/` copier only handles token *packages* under
  `node_modules` — DevMuxel's tokens are plain files. Without it, `[TOKENS_MISSING]`
  fires on 49 properties and every card renders unstyled. `fonts.css` is deliberately
  excluded: `cfg.extraFonts` ships it into `fonts/` with the woff2s and rewritten urls.
- **`make-types.mjs`** emits a declaration tree. The repo has never emitted one, and
  without it every `<Name>Props` degrades to `[key: string]: unknown` — the design agent
  gets no API at all. `findTypesRoot` picks `types/` up by name. `types/` is gitignored.

## The entry has to be passed explicitly

`package.json` `main` points at `out/main/index.js` — the **Electron main-process**
bundle. Left to itself the converter picks that up as the dist entry, which is wrong.
`make-entry.mjs` writes `.design-sync/.cache/entry.tsx` (gitignored), which re-exports
every component file. `componentSrcMap` enumerates all 44 components because with an
explicit `--entry` the converter does not fall back to src discovery — so a component
missing from that map is **silently absent from the sync, with no warning anywhere**.
That is what `make-entry.mjs` guards: it exits 1 listing any component missing from the
map, and any mapped name whose component is gone. Run it before every build.

`src/renderer/src/main.tsx` must stay out of the entry: it calls `connect()` at module
scope, which would run the Electron bridge at bundle load. `srcDir` is scoped to
`components/` for this reason.

## The preview harness

`.design-sync/preview-support.tsx` (committed, wired via `extraEntries` + `cfg.provider`)
does three things no card can do without:

- **Paints the chassis.** This is a dark DS; `--ink` is near-white, so an unwrapped
  component on a white card is invisible. It also sets the page background, so short
  components do not sit on a tall black slab.
- **Stubs `window.devmuxel`.** Faithful to `src/preload/index.ts`. Keep it in step:
  a **missing `on.*` channel is not a silent no-op** — components subscribe in mount
  effects, so an absent key throws "is not a function" and React unmounts the card.
  That is exactly how TitleBar failed on the first pass.
- **Seeds one coherent session** — three repos with distinct git states, two grids,
  four panes, two notes — plus the browser pane's network log, picked element and
  comments, which live in `browser/netlog.ts` rather than the store. Settings come from
  the app's own `defaultSettings` rather than a copy, so they cannot drift.

It also exports `writeTerminal(paneId, text)`, which puts real scrollback in a
`TerminalPane` card through the session's own `writeLocal` path. Without it that card
is an empty rectangle.

## Known render warns

- **`[FONT_MISSING] "Cascadia Mono"`** — expected, not actionable. It is the second
  entry in the `--font-mono` stack (`'JetBrains Mono', 'Cascadia Mono', Consolas, monospace`)
  and a Windows system font. The *primary* family ships as woff2, so nothing renders
  in a fallback. Do not chase it.

## Components that cannot render fully, by construction

- **`BrowserPane`** — built on Electron's `<webview>`, which has no browser equivalent.
  The card shows the pane's chrome (url bar, device switcher, scale readout, comment
  badge); the page area is empty on purpose.
- **`TerminalPane`** — real xterm, no pty. Scrollback is written locally (above).

Neither is a failure; both are noted so a future run does not "fix" them.

## Card modes

Fourteen components are `cardMode: "single"`. Two different reasons, both real:

- **Modals and fixed-position surfaces** (`Overlay`, `ConfirmClose`, `ConfirmCloseTab`,
  `SettingsPanel`, `RepositoriesPanel`, `NotesPanel`, `ShortcutsSheet`, `SendToClaude`,
  `MenuPopover`, `Toast`) escape a grid cell — the validator flags them `[GRID_OVERFLOW]`.
- **App singletons** (`TitleBar`, `TabStrip`, `GridView`, `EmptyState`, `NewTerminalMenu`)
  are driven entirely by the module store, and all cells of a card share one page and
  therefore one store. Per-cell state variants are not possible for them; one
  authoritative cell is the honest modelling. Do not add variant exports to these
  expecting them to differ — they will render identically.

`GridView`'s wrapper **must be `display: flex; flex-direction: column`**. `.grid` claims
height with `flex: 1`, and in a non-flex parent it collapses to zero because every pane
inside is absolutely positioned. This regressed once mid-run.

## Three components need hand-written prop bodies

`SendToClaude`, `CommentPopover` and `CommentsPanel` declare props as inline destructured
object types with no named `<Name>Props`, so the extractor falls back to a stub. They are
pinned in `cfg.dtsPropsFor`. **If their signatures change, update those entries** — nothing
will warn you.

## Render check without downloading chromium

`package-validate.mjs` honours `DS_CHROMIUM_PATH`. This machine has Chrome, so:

```sh
export DS_CHROMIUM_PATH="/c/Program Files/Google/Chrome/Application/chrome.exe"
```

`playwright` was installed into `.ds-sync/` with `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`.
No 200MB browser download is needed.

## Re-sync risks

- **`componentSrcMap` rots on every component add**, and a missing entry means the
  component silently does not sync. This was the single most likely way a future run
  went quietly wrong, which is why `make-entry.mjs` now fails the build on it. The risk
  that remains is skipping that script — run it, or the guard buys you nothing.
- **The bridge stub drifts from `src/preload/index.ts`.** New IPC surface used in a mount
  effect breaks that card. Diff the two when previews start failing with
  "is not a function".
- **`dtsPropsFor` is a hand copy of three signatures** and will not warn when it goes stale.
- **Fixtures live in `.design-sync/previews/_fixtures.ts`** and are imported by the harness,
  so a few KB of fixture data is compiled into `_ds_bundle.js`. Deliberate — it is what
  makes the browser-pane cards real — but it is shipped weight.
- **`types/` and `.design-sync/.cache/` are gitignored.** A fresh clone must re-run all
  three generator scripts before the converter, or the build fails on a missing
  entry/css/types root.
- Only partially verified: nothing. All 44 components are authored and graded good, and
  the render check is clean at 44/44.
