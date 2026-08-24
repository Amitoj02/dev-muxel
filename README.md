# GRID

A tiling grid of terminals, one per repository, for running several Claude CLI
sessions at once without losing track of which is which.

Every pane knows the repo it sits in and the state of that repo's working tree.
Panes tile, resize, drag into new sections, and fill the window on demand. Notes
are first-class cells: they tile and persist exactly like a terminal. Close the
app and it reopens where you left it.

Windows only. Electron + xterm.js + ConPTY.

---

## Installing it

```bash
npm install
npm run build:win
```

That produces two things in `release/<version>/`:

| | |
|---|---|
| `grid-1.0.0-setup.exe` | installs to `%LOCALAPPDATA%\Programs\GRID`, adds Start Menu and desktop shortcuts, and registers in Apps & Features |
| `grid-1.0.0-portable.exe` | single file, no install, no shortcuts |

The installer is per-user, so it never asks for admin. Uninstalling leaves your
declared repositories and notes alone — they live in `%APPDATA%\GRID`.

If Windows Smart App Control blocks the unsigned build (see
[Caveats](#caveats)), `grid.cmd` runs the same app through Electron's own signed
binary instead.

### Working on it

```bash
npm run dev              # dev server with hot reload
npm run build            # typecheck + bundle to out/
npm run build:unpacked   # release/<version>/win-unpacked/GRID.exe, no installer
npm run icon             # regenerate build/icon.ico from scripts/make-icon.mjs
```

---

## Using it

**Declare your repositories first.** `Repositories` in the titlebar, then either
`Add repository` for one folder, or `Scan folder` to point it at the directory
your projects live in and take them all at once. You can also drop a folder
anywhere on the window.

Per repository you can set:

| | |
|---|---|
| **Shell** | overrides the default for terminals opened here |
| **Command on open** | typed into every new terminal on this repo — set it to `claude` |
| **Press Enter for me** | run that command rather than just typing it |

**Open a terminal** with `+` on a repository row, or `＋ Terminal` in the
titlebar (which reuses the focused pane's repo).

**Build the grid.** Drag a pane by its header onto another pane; the half you
hover becomes the split. Drop in the middle to swap the two. Drag the gutters to
resize. `⤢` fills the window with a pane, leaving the rest of the grid visible
around the edges.

**The pane header** carries, in order: the repo name, the branch, a red `●N`
dirty count, a `+N` untracked count, and `↑N ↓N` against the upstream. `clean`
in green means nothing to commit. A narrow pane sheds these from the right as it
shrinks; the name and the dirty count are the last to go.

**Attention.** When a pane rings the bell or goes quiet on a question while you
are looking elsewhere, its border glows red, a `NEEDS YOU` badge appears, and
the titlebar shows `N waiting` — click that to jump straight to it. If GRID
itself is behind another window, its taskbar button flashes and the window title
becomes `N waiting - GRID`, so you can leave it running while you work
elsewhere.

**Notes.** `＋ Note` opens a scratchpad. Draft a prompt, then `Ctrl+Enter` (or
the send button) pastes it into the focused terminal — *without* a newline, so
you read it back and press Enter yourself. Closing a note's pane keeps the note;
`Notes` in the titlebar lists everything you have kept, and reopens it.

### Keyboard

Nothing uses a plain `Ctrl` key. Claude and every other CLI keep the whole
keyboard to themselves, `Esc` included.

| | |
|---|---|
| `Ctrl+Alt+T` / `N` | new terminal / new note |
| `Ctrl+Alt+D` / `S` | split the focused pane right / down |
| `Ctrl+Alt+W` | close the focused pane |
| `Ctrl+Alt+Z` | fill the window, and back again |
| `Ctrl+Alt+←↑→↓` | move focus that way |
| `Ctrl+Alt+1…9` | focus pane N, in reading order |
| `Ctrl+Alt+E` | even out every split |
| `Ctrl+Alt+O` | open the focused pane's folder in VS Code |
| `Ctrl+Alt+R` or `Ctrl+Alt+P` | repositories |
| `Ctrl+Alt+B` | notes |
| `Ctrl+Alt+,` / `Ctrl+Alt+/` | settings / this list |
| `Ctrl+Shift+C` / `V` | copy selection / paste |
| `Ctrl+Shift+F` / `K` | find in terminal / clear |
| `Ctrl+=` `Ctrl+-` `Ctrl+0` | font size |

---

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

Four decisions worth knowing before you change things:

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
change in the grid.

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

### Checks

```bash
npm run typecheck     # main+preload and renderer, separately
npm run lint
npm run fixtures:git  # builds .git-fixtures/ — dirty, clean, behind, conflicted
npm run check         # layout engine (607 assertions) + git parser
```

`scripts/check-git.mts` asserts the porcelain=v2 parser against real
repositories in every state a header can show. `scripts/check-layout.mts`
asserts the layout engine's invariants — that rects tile the box without
overlapping, that trees stay normalised, and that no drag can squeeze a pane out
of existence. Both run under Node's type stripping, so there is no build step.

---

## Caveats

**Windows Smart App Control may block the packaged `GRID.exe`.** It is enforced
on some machines and judges per binary hash, so a build that ran yesterday can
be blocked today with *"An Application Control policy has blocked this file"*.
Shipping a signed build would fix it properly; until then, `grid.cmd` runs the
same app through Electron's own signed binary and is unaffected.

**`Ctrl+Alt+R` is a popular global hotkey** — screen recorders claim it most
often. If it does nothing on your machine, something else got there first;
`Ctrl+Alt+P` is bound to the same thing.

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

---

## Design

The visual design is Claude Design's *Multi-repo CLI manager* handoff — layout
`1a` (pure tiling) with header `1d` (one dense line). Every colour, size and
motion curve comes from `src/renderer/src/styles/tokens.css`; nothing else in
the app hard-codes a hex.

Space Grotesk and JetBrains Mono are vendored as variable woff2 (~97 KB total)
so the renderer never touches the network and the CSP can stay strict.
Regenerate with `npm run fonts`; their SIL OFL 1.1 licences are in
[`licenses/`](./licenses).

---

## Licence

MIT, except the vendored fonts — see [`licenses/`](./licenses).
