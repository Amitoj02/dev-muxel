# GRID

A tiling grid of terminals, one per repository — for running several Claude CLI
sessions at once without losing track of which is which.

```
┌─ atlas-api  main  *3 +2 ───────────┬─ ledger-cli  fix/parse  clean ────┐
│ > claude                           │ > npm run test:watch              │
│   waiting on your answer           │   PASS  12 files, 68 tests        │
├─ mercury-web  main  clean ─────────┼─ scratch  saved just now ─────────┤
│ > npm run dev                      │ ask claude to add the webhook     │
│   ready on http://localhost:3000   │ retry test to atlas-api           │
└────────────────────────────────────┴───────────────────────────────────┘
```

Every pane knows the repository it sits in and what that repository's working
tree is doing. When one needs you — it rang the bell, or went quiet on a
question — it glows red and the taskbar flashes, so you can leave the whole
grid running while you get on with something else.

Windows only.

---

## Install

Grab `grid-<version>-setup.exe` from the
[Releases page](https://github.com/Amitoj02/grid-cli/releases) and run it. It
installs to your own user folder, so it never asks for admin, and it adds Start
Menu and desktop shortcuts. There is a portable `.exe` there too — one file, no
install, no shortcuts.

Or build it yourself:

```bash
npm install
npm run build:win     # installer and portable, into release/<version>/
```

Your repositories, notes and layout live in `%APPDATA%\GRID`. Uninstalling
leaves them alone.

## Start here

**1. Declare your repositories.** `Repositories` in the titlebar, then
`Add repository` for one folder — or `Scan folder` to point GRID at the
directory your projects live in and take them all at once. Dropping a folder
anywhere on the window works too.

**2. Say what each one opens with.** The `⋯` button on a repository row opens
its settings:

| | |
|---|---|
| **Command on open** | typed into every new terminal here — set it to `claude` |
| **Press Enter for me** | actually run that command, rather than just typing it |
| **Colour** | tints the header of every terminal on this repository |
| **Shell** | overrides the default shell for this repository |

**3. Open terminals.** `+` on a repository row, or `＋ Terminal` in the titlebar,
which reuses the focused pane's repository.

**4. Build the grid.** Drag a pane by its header onto another pane; the half you
hover over becomes the split. Drop it in the middle to swap the two. Drag the
gutters between panes to resize. `⤢` fills the window with one pane, and `Esc`
puts it back.

## Reading a pane

The header carries, in order: the repository name, the branch, a red `●N` dirty
count, a `+N` untracked count, and `↑N ↓N` against the upstream. `clean` in
green means nothing to commit. A narrow pane drops these from the right as it
shrinks — the name and the dirty count are the last to go.

Give a repository a colour and every terminal opened on it wears that colour in
its header, which is the fastest way to pick one project out of a wall of
near-identical panes.

## When a pane needs you

A pane that rings the bell, or goes quiet on a question while you are looking
elsewhere, glows red and grows a `NEEDS YOU` badge, and the titlebar shows
`N waiting` — click that to jump straight to it. If GRID itself is behind
another window, its taskbar button flashes and the window title becomes
`N waiting - GRID`.

## Closed one by mistake

`Ctrl+Shift+T` brings back the pane you just closed. For five seconds after a
close the shell is still running and its scrollback is still in memory, so you
get the same session back, in the same slot in the grid — not a new terminal
that looks like it. Press it again to walk further back through anything else
you closed inside that window. After five seconds it is properly gone.

## Notes

`＋ Note` opens a scratchpad that tiles and persists exactly like a terminal.
Draft a prompt, then `Ctrl+Enter` (or the send button) pastes it into the
terminal you were last in — *without* a newline, so you read it back and press
Enter yourself. Closing a note's pane keeps the note; `Notes` in the titlebar
lists everything you have kept, and reopens it.

## Settings

`Settings` in the titlebar, saved as you change them: font and size, the default
shell, how long a pane has to stay quiet before it counts as "needs you",
whether closing a busy pane asks first, and how much of the last session comes
back when you launch.

## Keyboard

Nothing uses a plain `Ctrl` key: Claude and every other CLI keep the whole
keyboard to themselves, `Esc` included.

| | |
|---|---|
| `Ctrl+Alt+T` / `N` | new terminal / new note |
| `Ctrl+Alt+D` / `S` | split the focused pane right / down |
| `Ctrl+Alt+W` | close the focused pane |
| `Ctrl+Shift+T` | bring back the pane you just closed |
| `Ctrl+Alt+Z` | fill the window, and back again |
| `Ctrl+Alt+←↑→↓` | move focus that way |
| `Ctrl+Alt+1…9` | focus pane N, in reading order |
| `Ctrl+Alt+E` | even out every split |
| `Ctrl+Alt+O` | open the focused pane's folder in VS Code |
| `Ctrl+Alt+R` or `Ctrl+Alt+P` | repositories |
| `Ctrl+Alt+B` | notes |
| `Ctrl+Alt+,` / `Ctrl+Alt+/` | settings / the full list |
| `Ctrl+Shift+C` / `V` | copy selection / paste |
| `Ctrl+Shift+F` / `K` | find in terminal / clear |
| `Ctrl+=` `Ctrl+-` `Ctrl+0` | font size |

## If something goes wrong

**Windows blocked GRID.exe.** Smart App Control is enforced on some machines and
judges each binary by its hash, so an unsigned build that ran yesterday can be
blocked today with *"An Application Control policy has blocked this file"*. If
you built from source, `grid.cmd` runs the same app through Electron's own
signed binary and is unaffected.

**`Ctrl+Alt+R` does nothing.** It is a popular global hotkey — screen recorders
claim it most often — so something else got there first. `Ctrl+Alt+P` opens
repositories too.

**A terminal opened but nothing runs in it.** Check `Settings → Default shell`;
if the shell it points at is not installed on this machine, pick one that is.

---

MIT licensed — see [LICENSE](./LICENSE). The bundled fonts are SIL OFL 1.1;
their licences are in [`licenses/`](./licenses).

Want to work on GRID rather than just use it?
[CONTRIBUTING.md](./CONTRIBUTING.md) has the architecture, the checks, and the
handful of decisions worth knowing before changing anything.
