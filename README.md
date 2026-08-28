# GRID

A tiling grid of terminals, one per repository — for running several Claude CLI
sessions at once without losing track of which is which.

```
┌─ atlas-api  main  *3 +2 ───────────┬─ ledger-cli  fix/parse  clean ────┐
│ > claude                           │ > npm run test:watch              │
│   waiting on your answer           │   PASS  12 files, 68 tests        │
├─ mercury-web  localhost:5173 ──────┼─ scratch  saved just now ─────────┤
│ ← → ⟳  localhost:5173/checkout     │ ask claude to add the webhook     │
│   NET 3  POST /api/orders  500     │ retry test to atlas-api           │
└────────────────────────────────────┴───────────────────────────────────┘
```

Every pane knows the repository it sits in and what that repository's working
tree is doing. When one needs you — it rang the bell, or went quiet on a
question — it glows red and the taskbar flashes, so you can leave the whole
grid running while you get on with something else.

A pane can also be the page you are building. It tiles like the rest, keeps a
log of every request the page makes, and any one of those requests goes to a
Claude session two panes over with a note attached.

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
| **Where it runs** | a browser pane opened here starts on this URL |

**3. Open terminals.** `+` on a repository row, or `＋ Terminal` in the titlebar,
which reuses the focused pane's repository. The globe next to it opens a browser
pane on the same project.

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

## The browser

`＋ Browser` — or `Ctrl+Alt+G` — puts a page in the grid, next to the terminal
that is building it. Type `:5173` in the bar and it goes to your dev server;
`/checkout` goes to that path on the page you are already on. It reloads,
it goes back and forward, and `⤢` fills the window with it.

`Mobile` and `Tablet` lay the page out at 390 and 834 CSS pixels — with a
matching user agent, touch events and pixel ratio, not just a narrow window —
and scale the result down to fit the pane. `Desktop` gives the page the whole
pane. Split a browser pane and you get the same page twice, which is how you
put a layout next to itself at two widths.

The two buttons after the device switch are the ones that get work done: `⌖`
points at an element, `NET` opens the network log.

### Pointing at something

The crosshair puts the page into pick mode. Hover and every element under the
cursor is outlined with its tag and its size; click one and the pane keeps it.
`Esc` cancels, and so does clicking the crosshair again.

What it keeps is what an argument about layout actually turns on: a CSS path
back to the element, where it sits and how big it is, its text, its markup, and
the computed styles that matter — `display`, `position`, the box, the flex and
grid properties, type and colour. Not the six hundred declarations a browser
will happily give you.

It goes to Claude the same way a request does, and the two travel together: tick
the failing call, point at the thing that looks wrong, and ask one question
about both.

### The network log

`NET` opens a log of everything the page has asked for: status, method, path,
type, size and time, newest first, with a count that turns red when something
failed. Filter it, or tick *failed* for just the 4xx, 5xx and never-arrived.
Click a row to open the whole exchange — request headers, request body,
response headers, response body.

The log survives a reload on purpose, so a request that only fails on the way
in is still there afterwards. `Clear` empties it.

### Sending one to Claude

Tick the requests you care about and press `Claude`, or open a row and use
`Send to Claude`. Write what you actually want to know, and GRID formats the
exchange underneath it and pastes the lot into a session:

- **A session already running** gets it pasted in, without a trailing newline —
  you read it back and press Enter yourself. It answers with whatever `--model`
  and `--effort` that session was started with, because nothing pasted into a
  running CLI can change those. The dialog says which, read out of the command
  the terminal was opened with.
- **A new session** is started for you with the model and effort you pick,
  defaulting to the ones in `Settings`, or to the repository's own
  `Command on open` when that is already a `claude` command.

Credentials are taken out of the headers and the URLs first — `authorization`,
`cookie`, `set-cookie`, API-key headers, tokens in a query string — and the
dialog says how many. Request and response bodies are sent whole, because a
body is usually the thing you are asking about; `Show exactly what is sent`
prints the text before it goes anywhere, and `Copy instead` puts it on the
clipboard rather than in a pane. Tick *Include credentials* when the auth
header is the bug.

Two cases get one line naming a file in `%APPDATA%\GRID\captures\` instead of
the capture itself: anything longer than about nine thousand characters, which
the CLI would fold into a placeholder that can expire; and any pane where GRID
did not itself start Claude and watch it take the Enter — a multi-line paste
into a bare shell is not one message, it is a stack of commands sitting on the
prompt. The dialog says which of the two is about to happen, in the line under
the target.

That is stricter than it looks. A repository's `Command on open` is typed into
every terminal it opens whether or not *Press Enter for me* is set, so a pane
can be configured for `claude` and still be sitting at a shell prompt — GRID
goes by what actually ran, notices when a CLI exits and hands the terminal
back, and checks that the program in the pane is accepting pastes at the moment
you press Send.

## Notes

`＋ Note` opens a scratchpad that tiles and persists exactly like a terminal.
Draft a prompt, then `Ctrl+Enter` (or the send button) pastes it into the
terminal you were last in — *without* a newline, so you read it back and press
Enter yourself. Closing a note's pane keeps the note; `Notes` in the titlebar
lists everything you have kept, and reopens it.

## Settings

`Settings` in the titlebar, saved as you change them: font and size, the default
shell, how long a pane has to stay quiet before it counts as "needs you",
whether closing a busy pane asks first, how much of the last session comes back
when you launch, how many requests a browser pane keeps, and the model and
effort GRID starts a Claude session with when you ask it to.

## Keyboard

Nothing uses a plain `Ctrl` key: Claude and every other CLI keep the whole
keyboard to themselves, `Esc` included.

| | |
|---|---|
| `Ctrl+Alt+T` / `N` / `G` | new terminal / new note / new browser pane |
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

**A browser pane stopped logging requests.** Only one debugger can be attached
to a page at a time, and opening Chrome DevTools on it takes ours. The log says
so and offers `Reattach`; close DevTools first.

---

MIT licensed — see [LICENSE](./LICENSE). The bundled fonts are SIL OFL 1.1;
their licences are in [`licenses/`](./licenses).

Want to work on GRID rather than just use it?
[CONTRIBUTING.md](./CONTRIBUTING.md) has the architecture, the checks, and the
handful of decisions worth knowing before changing anything.
