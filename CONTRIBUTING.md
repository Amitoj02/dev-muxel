# Contributing to GRID

Thanks for looking. GRID is a small, deliberate codebase: one screen, no router,
no state library, and a short list of dependencies. The notes below are what you
need before changing anything in it.

## Getting set up

```bash
npm install
npm run dev              # electron-vite dev server, hot reload
npm run build            # typecheck + bundle to out/
npm run build:unpacked   # release/<version>/win-unpacked/GRID.exe, no installer
npm run build:win        # installer + portable
npm run icon             # regenerate build/icon.ico
```

`grid.cmd` runs the built output through Electron's own signed binary, which is
handy on machines where Smart App Control blocks the packaged exe.

## How it is put together

```
src/shared/     types, the IPC channel list, and the pure layout engine
src/main/       ptys, git, the filesystem, the window, menu accelerators
src/preload/    the contextBridge — a fixed, typed list of verbs
src/renderer/   React 19; owns layout/panes/repos/notes/settings
scripts/        checks, the icon generator and the font vendoring script
```

The renderer owns the application state and pushes the whole blob at main to be
persisted, debounced. Main owns everything privileged. Nothing crosses that
line, which is why the renderer runs sandboxed with `contextIsolation`.

Five decisions worth knowing before you change things:

**Panes are absolutely positioned from a split tree, not nested flexbox.** The
rendered pane list stays flat and keyed by pane id, so reshaping the grid never
unmounts a component — an xterm instance survives being dragged across the
window with its scrollback intact. Zooming is then just a different rect for the
same element, which is why the fullscreen transition is a plain CSS transition.
The engine is `src/shared/layout.ts`; it is pure and covered by `npm run
check:layout`.

**Shortcuts are Electron menu accelerators, not a `keydown` listener.** xterm
calls `stopPropagation()` on every key it handles, so a window listener sees an
arbitrary subset of what you pressed. Accelerators are evaluated before the key
reaches the page. The menu itself is never drawn. `src/main/menu.ts` owns the
bindings; `src/renderer/src/lib/useShortcuts.ts` turns an action name into a
change in the grid, and `src/renderer/src/lib/chords.ts` is the shared list of
what GRID claims — every chord there has to be refused by xterm too, or it never
reaches the window.

**Closing a pane parks it rather than killing it.** For five seconds the pty
keeps running and the xterm buffer stays in memory, so `Ctrl+Shift+T` adopts the
same session back into a new pane component instead of spawning a lookalike.
`actions.closePane` records it, `TerminalPane`'s cleanup parks instead of
killing, and `lib/useRecentlyClosed.ts` is the one place that reaps an expired
entry. If you touch the pane lifecycle, keep that split: the store holds the
data, the hook holds the axe.

**Git state comes from one `git status --porcelain=v2 --branch` call per repo,
always with `--no-optional-locks`.** That flag is load-bearing, not an
optimisation: measured on this machine, a status poll running alongside a
`git add` loop made **19% of the user's own git commands fail** with `Unable to
create index.lock` — and zero with the flag. Repos are also watched with
`fs.watch` on `.git`, so switching a branch shows up immediately rather than at
the next poll.

**Pty output is coalesced in main and flow-controlled.** A build emits thousands
of tiny writes (measured: 1.17 MB arriving as 7,497 separate events); they are
batched on an 8ms timer. The renderer acks bytes as xterm writes them, and the
pty is paused past a high-water mark, so `cat` on a huge file slows down instead
of locking up the window.

## Before you open a pull request

```bash
npm run typecheck     # main+preload and renderer, separately
npm run lint
npm run fixtures:git  # builds .git-fixtures/ — dirty, clean, behind, conflicted
npm run check         # layout engine + git parser
```

`scripts/check-layout.mts` asserts the layout engine's invariants — that rects
tile the box without overlapping, that trees stay normalised, that no drag can
squeeze a pane out of existence, and that a closed pane's address puts it back
where it was. `scripts/check-git.mts` asserts the porcelain=v2 parser against
real repositories in every state a header can show. Both run under Node's type
stripping, so there is no build step.

Please keep new behaviour covered by one of those two, and keep comments
explaining *why* rather than *what* — that is the house style throughout.

## Design

The visual design is Claude Design's *Multi-repo CLI manager* handoff — layout
`1a` (pure tiling) with header `1d` (one dense line). Every colour, size and
motion curve comes from `src/renderer/src/styles/tokens.css`; nothing else in
the app hard-codes a hex. Square corners everywhere.

Space Grotesk and JetBrains Mono are vendored as variable woff2 (~97 KB total)
so the renderer never touches the network and the CSP can stay strict.
Regenerate with `npm run fonts`; their SIL OFL 1.1 licences are in
[`licenses/`](./licenses).

## Known rough edges

**node-pty prints `Error: AttachConsole failed` on every pane close.** Its
console-process-list helper is broken on Windows 11 build 26200 and dies
immediately. It is noise, not a failure — the pty is killed correctly, and GRID
force-reaps the process tree 1.5s later in case a grandchild allocated its own
console.

**`npmRebuild` is off and must stay off.** node-pty 1.1.0 ships N-API prebuilds,
which are ABI-stable across Node and Electron, so there is nothing to rebuild —
and `@electron/rebuild` cannot run on a machine without a Windows SDK anyway.

**TypeScript is pinned to 6.0.3.** TypeScript 7 is the Go compiler; it removes
the compiler API from the main export, and typescript-eslint refuses to load
against it. Builds never invoke tsc (Vite strips types), so this only affects
`npm run typecheck` and `npm run lint`.

By contributing you agree that your work is licensed under the repository's
[MIT licence](./LICENSE).
