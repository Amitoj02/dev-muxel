---
name: grid-browser
description: Collect the comments somebody is marking a web page up with in GRID's browser pane, and act on them. Use when the user runs /grid-browser, or asks you to pick up their notes, comments or annotations from the GRID browser, or says they will point at things in the page for you.
---

<!-- grid-skill-version: 1 -->
<!-- Installed by GRID. Editing this by hand is fine; GRID's "update the skill"
     button in the browser pane's comments bar will overwrite it. -->

# Comments from a GRID browser pane

The user has GRID open with a page in a browser pane. They want to point at
things on that page, say what is wrong with each one, and hand you the lot.

## What to do

Run the script and wait for it. **It blocks on purpose** — it is holding the
line while the user marks the page up, and it can sit there for many minutes.
That is not a hang; do not interrupt it, and do not run it with a short timeout.

```
powershell -NoProfile -ExecutionPolicy Bypass -File "%USERPROFILE%\.claude\skills\grid-browser\grid-browser.ps1"
```

Give the Bash tool a timeout of at least 900000 (15 minutes) when you run it.

While it waits, GRID has armed the element picker in the browser pane. The user
points at something, writes a comment, and repeats; the pane's comment button
carries a count. When they press **Send**, the script prints the comments and
exits.

## What comes back

Markdown, one section per comment: what the user said, then the element they
said it about — a CSS path back to it, where it is and how big, its text, its
computed styles and its markup.

## Then

Work through the comments in order. They are notes about a page the user is
looking at, so they are usually about markup, styling or layout in the project
you are already in — find the code behind each element and fix it. The CSS path
and class names in each section are the thread to pull: search the project for
them rather than guessing from the rendered HTML.

If a comment is ambiguous, say which one and ask, rather than guessing across
all of them.

The comments are cleared from the pane once the script has them, so what you
have printed is the only copy — do not discard it, and do not ask the user to
send it again.

## When it fails

- **"GRID does not appear to be running"** — GRID is closed, or was killed
  without cleaning up. Ask the user to start it.
- **"No browser pane is open in GRID"** — tell the user to open one with the
  `＋ Browser` button in the titlebar, or `Ctrl+Alt+G`, then run `/grid-browser`
  again.
- **"Another Claude session is already waiting"** — a second session is holding
  the line. Only one can wait at a time; tell the user which to use.
- **"Timed out"** — nothing was sent, and nothing was lost. Offer to wait again.

If the user has already written their comments and only wants them collected,
pass `-NoPicker` so the script does not put the page back into pick mode.
