# Contributing to DevLobby

Thanks for looking. DevLobby is a small, deliberate codebase: one screen, no
router, no state library, and a short list of dependencies. The notes below are
what you need before changing anything in it.

## Getting set up

```bash
npm install
npm run dev              # electron-vite dev server, hot reload
npm run build            # typecheck + bundle to out/
npm run build:unpacked   # release/<version>/win-unpacked/, no installer
npm run build:win        # installer + portable
npm run icon             # redraw the icon and the renderer's favicons
```

`devlobby.cmd` runs the built output through Electron's own signed binary,
which is handy on machines where Smart App Control blocks the packaged exe.

## How it is put together

```
src/shared/     types, the IPC channel list, the pure layout engine, and the
                pure half of the browser pane (browser.ts, claude.ts)
resources/      the /devlobby-browser skill, shipped with the app and
                inlined into the main bundle with `?raw`
src/main/       ptys, git, the filesystem, the window, menu accelerators, and
                the browser guests' debugger and hardening (main/browser/)
src/preload/    the contextBridge — a fixed, typed list of verbs
src/renderer/   React 19; owns layout/panes/repos/notes/settings
scripts/        checks, the icon generator and the font vendoring script
```

The renderer owns the application state and pushes the whole blob at main to be
persisted, debounced. Main owns everything privileged. Nothing crosses that
line, which is why the renderer runs sandboxed with `contextIsolation`.

Seven decisions worth knowing before you change things:

**Panes are absolutely positioned from a split tree, not nested flexbox.** The
rendered pane list stays flat and keyed by pane id, so reshaping the grid never
unmounts a component — an xterm instance survives being dragged across the
window with its scrollback intact. Zooming is then just a different rect for the
same element, which is why the fullscreen transition is a plain CSS transition.
The engine is `src/shared/layout.ts`; it is pure and covered by `npm run
check:layout`.

**A tab is a whole grid, and its panes are hidden rather than unmounted.**
`session.panes` is every pane in the app; a tab is only a tree naming some of
them, which is why moving a pane between tabs is a change of address and not a
rebuild. `GridView` renders *every* pane, measuring each tab's tree against the
same box, and marks the ones whose tab is off screen `data-hidden` — so a shell
keeps running, an xterm keeps its scrollback, a page stays loaded, and
switching tabs resizes nothing. The CSS is `visibility: hidden`, never
`display: none`: the latter takes the element's layout box away, and a
`<webview>` whose box goes away loses its guest.

The store carries the tab you are looking at in the *top-level* `layout` /
`focusedPaneId` / `zoomedPaneId`, and the copy in `tabs` is stale until
`tabsSnapshot` reconciles them. That is deliberate: every existing reader of
`state.layout` goes on reading the grid on screen without knowing tabs exist,
and one file has to care. Anything reading or rewriting across tabs goes
through `tabsSnapshot`. One pane belongs to exactly one tab and nothing in the
state file enforces it, so `claimLeaves` in the layout engine does — it is pure
and covered by `npm run check:layout`.

**Shortcuts are Electron menu accelerators, not a `keydown` listener.** xterm
calls `stopPropagation()` on every key it handles, so a window listener sees an
arbitrary subset of what you pressed. Accelerators are evaluated before the key
reaches the page. The menu itself is never drawn. `src/main/menu.ts` owns the
bindings; `src/renderer/src/lib/useShortcuts.ts` turns an action name into a
change in the grid, and `src/renderer/src/lib/chords.ts` is the shared list of
what DevLobby claims — every chord there has to be refused by xterm too, or it
never reaches the window.

**Closing something parks it rather than killing it.** For five seconds a
closed pane — or every pane of a closed *grid* — comes out of its tree but
stays in `session.panes`, which by the rule above means it stays **mounted and
hidden**. Nothing is torn down: the pty keeps running, xterm keeps its
scrollback, and a browser pane keeps its page, its scroll position, its network
log and any comments written on it. `Ctrl+Shift+T` then puts the same thing
back rather than building a lookalike, and for a grid it puts the whole tab
back in its old place on the strip.

That is why there is no `park()` on `TerminalSession` any more and no special
case in `TerminalPane`'s cleanup: a parked pane's component never unmounts, so
there is nothing to detach and nothing to re-adopt. `actions.closePane` /
`actions.closeTab` record the entry, `lib/useRecentlyClosed.ts` is the one
place that calls time, and `actions.dropExpired` ends it by dropping the panes
out of the list — which unmounts them, and each kind's own cleanup does its own
killing, the same path as any other close. Keep that split if you touch the
lifecycle: the store holds the data, the hook holds the clock, and a pane
component is the only thing that ever kills a pane.

A parked pane is in no tab, so anything asking "what panes are there" for a
reason other than drawing them has to skip it — `isParked` is that test, and
the taskbar count, the browser bridge and the send-to-Claude target list all
use it.

**Git state comes from one `git status --porcelain=v2 --branch` call per repo,
always with `--no-optional-locks`.** That flag is load-bearing, not an
optimisation: measured on this machine, a status poll running alongside a
`git add` loop made **19% of the user's own git commands fail** with `Unable to
create index.lock` — and zero with the flag. Repos are also watched with
`fs.watch` on `.git`, so switching a branch shows up immediately rather than at
the next poll.

**A browser pane is a `<webview>` element, not a `WebContentsView`.** The
main-process view was the obvious choice and is the wrong one here: it is
composited *above* the page, so it would cover the zoom scrim, the drop
indicator, every dialog and the toast, and its rectangle would have to be
mirrored out of the layout engine on every splitter drag. An element obeys the
same absolute rect, the same stacking order and the same CSS transition as
every other pane, and survives being dragged across the grid for the same
reason xterm does — the pane list never reorders, so React never moves the
node. The costs are real and paid deliberately: `webviewTag: true` on the
window, `frame-src http: https:` in the renderer's CSP, and every guest
preference overwritten in `will-attach-webview` because an HTML attribute is
not a security boundary. That hardening lives in `src/main/browser/guest.ts`
and is the first thing to read before changing anything about guests.

Comments go the other way round from everything else here, and that is the
point of them. DevLobby does not push them at a session; a session comes and
asks. `/devlobby-browser` runs a script that talks to the running app over a
loopback port DevLobby publishes in `bridge.json` — a running Electron app
cannot be driven by pointing at its executable, so it listens instead, on a
port the OS picks behind a token generated fresh each launch, with the manifest
removed on the way out. One waiter at a time, because two sessions holding the
line for the same comments is a race with no right answer.
`src/main/browser/bridge.ts`.

The element picker is a script injected into the guest with
`executeJavaScript`, and it has to be: hit-testing an element inside a separate
WebContents cannot be done from outside it, and an overlay drawn in the host
document would sit above the guest without knowing what is underneath. The
result comes back as the promise that call resolves — that is the whole
channel, with no preload and nothing left in the page once a pick ends. It is
written in plain ES5-flavoured JavaScript because it runs in whatever page the
pane happens to be on.

The network log behind it comes from the Chrome DevTools protocol —
`webContents.debugger` on the guest, from main — because `session.webRequest`
can see requests go past but never what came back in them, which is exactly the
half worth sending to Claude. Only one debugger client can attach at a time, so
opening DevTools on a guest takes ours; that is reported to the pane rather
than swallowed. Entries are batched on a 16ms timer for the same reason pty
output is, and bodies stay in main until something asks for one.

The last link in that chain is the one to be careful with. A capture is bytes a
website chose, and it ends up pasted into a terminal — so every page-derived
string goes through `clean()` in `src/shared/claude.ts`, which strips control
characters. Without it a response body containing `ESC[201~` would close the
bracketed paste and everything after it would arrive as live keystrokes in
whatever is running in that pane.

For the same reason a capture is only pasted in whole when three things hold at
once, and any one of them failing sends it to a file instead:

- DevLobby itself typed a `claude` command into that pane **and pressed
  Enter** — recorded as `ranStartup` on the pane's runtime. A repository's command on
  open is typed into every terminal whether or not "press Enter for me" is
  set, and a restored pane does not replay it at all, so the configuration
  alone says nothing about what is running.
- Nothing has handed the terminal back since. `TerminalSession` watches
  `term.modes.bracketedPasteMode` for a **falling** edge, which is a
  full-screen program exiting, and clears `ranStartup` when it sees one.
- The mode is on at the moment of sending, re-read rather than remembered.

The obvious shortcut — "bracketed paste is on, so a paste is safe" — is wrong,
and was tried: readline 8.1 and later leave it on at an idle bash prompt, so it
is true for Git Bash and WSL sitting at a prompt with nothing running. It is a
necessary condition, not a sufficient one.

One residual, worth knowing rather than papering over: if a CLI exits *without*
restoring the mode there is no falling edge to see, and `ranStartup` stays set
until the shell itself exits. The file path is always available from the same
dialog, and it is what everything unproven falls back to.

`npm run check:browser` asserts the sanitising and the one-line form.

The far end of that bridge — the skill itself — ships in `resources/skills/`
and is written into `~/.claude/skills/` by a button in the comments bar. Both
halves are one protocol, so they live in one repository and the skill stamps
the version that wrote it; a copy without that stamp was written by hand and
counts as out of date. `src/main/browser/skill.ts` imports the two files with
`?raw`, which inlines them at build time — so they stay real files a human can
read and copy, and there is nothing to unpack out of the asar at runtime.

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
npm run check         # layout engine + git parser + browser pane + migration
```

`scripts/check-layout.mts` asserts the layout engine's invariants — that rects
tile the box without overlapping, that trees stay normalised, that no drag can
squeeze a pane out of existence, and that a closed pane's address puts it back
where it was. `scripts/check-git.mts` asserts the porcelain=v2 parser against
real repositories in every state a header can show. `scripts/check-browser.mts`
asserts the browser pane's pure half: what the URL bar will and will not load,
the CDP-to-log reducer including redirect chains and the ring buffer, and the
exact text sent to Claude — including the credentials it takes out of it.
`scripts/check-migrate.mts` asserts the move of a profile written under either
earlier name — the app has been `GRID`, then `DevMuxel` — onto the DevLobby
name: that everything comes across from whichever one an install is sitting at,
that the browser partition follows `BROWSER_PARTITION`, that where both are
present the newer wins and the older only fills gaps, that a profile already
under the new name is never clobbered, and that re-running it changes nothing. All four run
under Node's type stripping, so there is no build step.

That last one is why `src/shared/browser.ts` and `src/shared/claude.ts` import
each other's *types* only. Type stripping erases a type import but would have to
resolve a value one, and a bare extensionless specifier does not resolve under
Node's ESM loader. If you add a value import between shared modules, the check
script stops running.

Please keep new behaviour covered by one of those three, and keep comments
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

## Brand

[`brand-kit/`](./brand-kit) is the reference: the mark's construction, the
lockups, the clear space, the minimum sizes and the whole icon set, with
`DevLobby-Brand-Guide.html` as the page that explains them. Open that before
changing anything the app shows as a logo.

The mark is a `D` built out of the product — a narrow pane, the gutter between
them, and a wide pane crossed by its header rule — drawn on a 64-unit grid with
two radii, `r7.5` on the stem and `r17.5` on the bowl. That asymmetry is what
makes it read as a letter at 16px, and it is the one place the system's square
corners do not apply.

Every measure is a fraction of the canvas, so nothing needs a design tool to
regenerate. `npm run icon` redraws all of it from those fractions:

| File | Who reads it |
|---|---|
| `build/icon.ico` | electron-builder — the exe, installer, shortcuts, taskbar |
| `build/icon.png` | the large electron-builder targets, and eyeballing a change |
| `src/renderer/public/favicon.{ico,svg}` | the tab `npm run dev` opens in a browser |

Each of the seven sizes in the `.ico` gets its own layout rather than being
downscaled from one bitmap, so the gutter is never allowed below one pixel —
at 16px it is exactly one, which is the floor the brand gives the mark.

In the app itself the mark is `BrandMark`, whose paths are `brand-kit/svg/mark.svg`
verbatim. `BrandLockup` pairs it with the wordmark at the brand's own ratios
(gap `0.28`, wordmark `0.72` of the mark), which is why the titlebar carries a
plain app name beside a 16px mark instead: below a 24px mark the lockup is not
allowed, and the mark stands alone.

## Known rough edges

**node-pty prints `Error: AttachConsole failed` on every pane close.** Its
console-process-list helper is broken on Windows 11 build 26200 and dies
immediately. It is noise, not a failure — the pty is killed correctly, and
DevLobby force-reaps the process tree 1.5s later in case a grandchild allocated
its own console.

**`npmRebuild` is off and must stay off.** node-pty 1.1.0 ships N-API prebuilds,
which are ABI-stable across Node and Electron, so there is nothing to rebuild —
and `@electron/rebuild` cannot run on a machine without a Windows SDK anyway.

**Opening DevTools on a browser pane's page stops its network log.** Chromium
allows one debugger client per target, and DevTools takes it. The pane says so
and offers a reattach; there is nothing to fix.

**`Emulation.setDeviceMetricsOverride` may be refused on a guest.** Chromium
documents that command as top-level-target only and a `<webview>` guest is an
inner one. Each emulation command is therefore sent independently: if the
device pixel ratio is refused, the user agent and touch emulation — which is
most of what a responsive layout keys off — still apply, and the pane says
which part did not.

**TypeScript is pinned to 6.0.3.** TypeScript 7 is the Go compiler; it removes
the compiler API from the main export, and typescript-eslint refuses to load
against it. Builds never invoke tsc (Vite strips types), so this only affects
`npm run typecheck` and `npm run lint`.

By contributing you agree that your work is licensed under the repository's
[MIT licence](./LICENSE).
