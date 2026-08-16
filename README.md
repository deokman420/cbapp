# CB App

> A self-contained, offline-first multi-window productivity app that runs as a single HTML file.

**Version:** `v4.2.4`  
**Released:** August 16, 2026  
**Size:** ~525 KB (single file)  
**License:** Provided as-is

![HTML](https://img.shields.io/badge/HTML-5-E34F26?logo=html5&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-ES6+-F7DF1E?logo=javascript&logoColor=black)
![Offline](https://img.shields.io/badge/Offline-First-10b981)
![Accessibility](https://img.shields.io/badge/WCAG-AA-0f766e)

CB App is a lightweight, offline-first productivity tool that runs entirely in the browser as a single HTML file. It provides a desktop-like multi-window environment with notes, task lists, a calculator, clock, and more.

It was originally built to work inside highly restricted **Enterprise Browser** environments (where external clipboard access and many web features are blocked), but works great in any modern browser.

---

## Features

- **Multi-window interface** — Drag, resize, minimize, and lock individual windows
- **Notes** with line numbers, word/character counts, case conversion, and per-note logging
- **Task Lists** with checkboxes, per-task deletion, and completion tracking
- **Sticky Notes** with customizable colors
- **Built-in Calculator** with history, correct operator precedence, and square root
- **Clock** with multiple timezones, stopwatch, and a countdown timer that ends
  in an in-app alert card and a soft synthesised chime (mutable) — no OS
  notifications, no permission prompts
- **Calendar** with events, all-day entries, daily/weekly/monthly/yearly
  repeats and in-app reminders (a soft chime and a card, no OS notifications).
  One set of events shared by both workspaces; reminders missed while the app
  was closed are listed once when it reopens
- **Log** with timestamped entries and per-entry deletion
- **Session persistence** — Everything is automatically saved to localStorage
- **Optional passphrase protection** — AES-GCM encrypts your session in the browser; the passphrase is entered masked, with a Show toggle, and is never stored
- **Always-encrypted Backup** — Backup writes your session out as an AES-GCM `.json` file and never as plaintext. With Protect on it reuses that passphrase; with Protect off it asks for one for that file. Import reads a backup back, through strict schema validation
- **One-click HTML download** — Save a blank standalone `cbapp.html`; copies carry the program only, never your notes
- **Dark & Light themes**, both meeting WCAG AA contrast
- **Keyboard shortcuts** and full focus-ring support
- **Two layouts, chosen by the device** — the familiar windowed desktop, and a
  phone layout where the toolbar is a bottom sheet and windows fill the screen
  (see [Two shapes](#two-shapes))
- **Touch and pen support** — drag, resize and pinch-zoom on tablets and phones
- **T2 Template** — Quick support ticket template for enterprise workflows
- Fully offline — no external dependencies after the initial load

---

## Two shapes

CB App lays itself out two different ways, chosen by the device rather than by
you. Both are the same app and the same session — only the arrangement differs.

**Desktop** is the original: a toolbar along the bottom, windows you drag and
resize freely.

**Phone** (new in v4.2.0):

- the toolbar rests collapsed as a **☰ bottom sheet** that closes itself again
  after any action, instead of twenty buttons wrapped into four rows
- windows are **full-bleed and stacked** rather than floating, with a tab strip
  along the top to switch between them
- dragging and resizing are off — every window is already the whole screen
- the canvas keeps its world, and gains **pinch-to-zoom** and a phone-sized
  minimap

The switch happens at `(max-width: 720px) and (pointer: coarse)`,
`(max-height: 520px) and (pointer: coarse)`, or `(max-width: 560px)`. The
pointer test earns its place: a desktop browser with devtools docked is often
under 720px wide but still has a mouse, and it keeps the desktop layout. So
does the height clause — a phone in landscape is *wider* than 720px.

Nothing about the phone layout reaches a desktop, and the test suite has a
block whose only job is to fail if it ever does.

---

## Getting Started

- **Primary file:** [`cbapp.html`](cbapp.html) — The complete application (v4.2.4)

Simply save the file and open it in your browser.

### Quick Start

1. Save `cbapp.html` to your computer
2. Open it in any modern browser (best in Chrome / Edge / Enterprise Browser)
3. Create notes, tasks, sticky notes, etc.
4. Click **Backup** in the toolbar to save an encrypted copy of your notes

No installation or server required.

### Table of Contents

- [Features](#features)
- [Two shapes](#two-shapes)
- [Getting Started](#getting-started)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [Recommended Usage](#recommended-usage-enterprise-browser)
- [What's New in v4.2.0 – v4.2.4](#whats-new-in-v420--v424)
- [What's New in v3.1](#whats-new-in-v31)
- [What's New in v3.0](#whats-new-in-v30)
- [Technical Notes](#technical-notes)

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>N</kbd> | New note |
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>T</kbd> | New task list |
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd> | Search / replace |
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>W</kbd> | Close the active window |
| <kbd>Esc</kbd> | Close search, or cancel a rename |
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+arrows | Move the active window |
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>=</kbd> / <kbd>-</kbd> | Zoom the canvas in / out |
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>0</kbd> | Canvas back to 100% |
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>9</kbd> | Fit all windows on the canvas |

The window with the highlighted outline is the active one — Copy, Paste and
Search all act on it.

---

## Recommended Usage (Enterprise Browser)

- Keep `cbapp.html` in your Documents folder or a dedicated location
- Create a bookmark or desktop shortcut for quick access
- Use the in-app **Backup** button regularly to back up your work — it writes an
  encrypted `.json` file, and **Import** reads it back. This is the only way to
  move notes off a browser. **Download CB App** is a different thing: it saves a
  blank copy of the *program*, with none of your notes in it.
- The app works best when opened from within an active Enterprise Browser session

> **Note on pasting:** the asynchronous clipboard API is unavailable when a page
> is opened from `file://`. The **Paste** button will focus the target note and
> prompt you to press <kbd>Ctrl</kbd>+<kbd>V</kbd>, which the browser handles
> natively.

---

## What's New in v3.0

A UX and accessibility overhaul. Highlights:

- **The `Download .html` export actually works.** It previously baked open
  windows in as dead, empty markup — no content, no event listeners, duplicated
  on load. It now exports a clean document with your session embedded.
- **Windows cascade** instead of stacking on top of each other, stay clear of
  the toolbar, and can never render above it.
- **You can see which window is focused.** The active-window styling existed in
  the code but was never actually drawn.
- **Status messages are visible** — they used to render behind the toolbar.
- **Locking works on every window type**, not just notes and sticky notes.
- **Touch and pen support** — windows previously could not be moved at all on a
  tablet or phone.
- **WCAG AA contrast** across 84 elements in both themes.
- The calculator respects operator precedence (`2+3*4` was returning 20).
- Keyboard shortcuts, focus rings, screen-reader labels, `prefers-reduced-motion`,
  and a responsive toolbar that fits a phone screen.
- **Removed:** the Calendar window, and the long-dead Drawing window.

**v3.0.1–3.0.4** fix sticky notes created before v3.0 staying dark after
switching to light mode, restore the hover and active highlight on the Calc,
Clock, Log, Theme and Search buttons, give dragging a window visible feedback
in light mode, stop a sticky note's border pulsing on every focus change, make
a window properly translucent while it is being dragged, and add one-click
**Copy** and **Reset** buttons to the sticky note toolbar.

## What's New in v3.1

**A big canvas.** `Canvas` in the toolbar turns on a work surface three screens
wide and three tall, so a session can be laid out rather than stacked.

- **Off by default.** While it is off, the app behaves exactly as it did
  before — the view is the identity transform, so window coordinates are the
  same numbers they always were and old sessions are untouched.
- **Pan** by dragging the empty background, middle-dragging, holding `Space`
  while you drag (only when you aren't typing), or with the wheel.
  `Shift`+wheel pans sideways.
- **Zoom** with `Ctrl`+wheel or a trackpad pinch, around the pointer.
- A **zoom widget** zooms, fits every open window on screen, or snaps back to
  100% — `Ctrl+Shift+=`, `-`, `9`, `0` do the same.
- An **overview map** shows every window and where you are looking. Click or
  drag it to jump.
- Turning the canvas off **pulls any off-screen window back into view**, so
  nothing can be stranded out there.

Resizing also changed: the browser's native corner ran at the wrong speed once
a zoom existed, so a custom grip replaces it everywhere. That also restores
resizing on touch devices, which never had it — the native corner is unusable
with a finger and was already disabled there.

See [CHANGELOG.md](CHANGELOG.md) for the full list.

---

## What's New in v4.2.0 – v4.2.4

**A phone layout** — see [Two shapes](#two-shapes). Until now the app was
shaped for one screen: on a phone the toolbar's twenty buttons wrapped into
four rows and ate a quarter of the display, and the 557px windows underneath
put their own close and minimise buttons past the right edge with no way to
reach them.

Building it turned up four bugs that were never phone-specific:

- **Every note in the app clipped its own word count.** The height arithmetic
  summed the window chrome from constants and omitted three 10px flex gaps, so
  every note was 30px shorter than its own contents — invisible, because
  windows are `overflow: hidden`, with no scrollbar to say so. It only became
  *noticeable* on a phone, where the same 30px is a much larger share of the
  window.
- **A restored note was capped to the size of the screen instead of the
  canvas**, hiding the bottom of it. A `ResizeObserver` usually raced in and
  corrected it afterwards — which is why it looked intermittent, why resizing
  the window appeared to fix it, and why it reproduced on a real phone and on
  no emulator.
- **The minimap's blocks stopped tracking the world after a viewport change.**
  They kept their old pixel positions while the map around them was rescaled,
  so rotating a phone put every block in the wrong place until you touched a
  window.
- **Reset wiped the layout** along with the theme.

Also in this release: pinch-to-zoom on the canvas, a minimap sized for a phone,
a keyboard-scrollable calendar list, and a lint pass that took the project from
eleven standing warnings to zero — now gated, so the next one fails the check.

Testing grew with it: both phone orientations are gates now rather than
courtesy runs, alongside a layout suite that asserts no window ever hides its
own contents, and pixel baselines for each shape.

**v4.2.1** fixes the one thing none of that caught. Safari on iOS zooms the
whole page whenever a focused text field's computed font-size is under 16px,
and the zoom stays after the field is dismissed — so the first tap into the
passphrase box left the app rendered wider than the screen with its right-hand
edge, and that modal's own Unlock button, off it. Every field is 16px in the
phone shape now (`user-scalable=no` was not on the table; pinch-zoom is an
accessibility right), and the line-number gutter moved with the textarea it
numbers. It also stops the search panel covering the toolbar sheet, which both
now share the bottom edge.

Chromium does not zoom, so the entire suite passed while a real iPhone was
unusable. There is an `iphone` project on WebKit now, and it found the
search-panel collision on its first run.

**v4.2.2** moves the Download chip into the toolbar sheet on a phone, as a
full-width row at the bottom of *Session* — the bottom edge had the sheet, the
lock button and the chip all competing for it, and the chip is the least urgent
of the three. It also shows the version there, legibly, instead of as a 10px
suffix in a corner.

It also fixes the window title-bar controls — rename, minimise, freeze and
close — which failed WCAG AA contrast. They used a dim token measuring 4.52:1
on the dark title bar: over the 4.5 line by two hundredths, close enough that
axe passed it on Chromium and failed it on every WebKit build. In light mode it
was far worse, and nothing was catching that because the accessibility suite
only ever scanned dark. They are full-contrast now and that suite runs on every
project again — 72 checks across six, where it had been 12 on one.

**v4.2.3** makes the minimise button visible on an iPhone. It used U+1F5D5, a
bare astral symbol with *text* rather than emoji presentation, and iOS ships no
font covering it — so the button rendered as empty space over a touch target
that went on working perfectly. Invisible and fully functional is the hardest
kind of missing. It is `−` (U+2212) now, which every platform can draw and
which pairs with the `×` already used for close.

**v4.2.4** gets the on-screen keyboard off the note you are typing into. A
full-bleed window keeps its controls along its bottom edge — the format row and
word count on a note, the Log button, the calculator's last row — and on iOS
the keyboard landed on exactly those. Android was never affected, which is the
whole shape of the bug: `interactive-widget=resizes-content` makes the keyboard
shrink the layout viewport there, so the existing CSS already had the right
number. iOS Safari ignores that hint — the keyboard is an overlay and
`window.innerHeight` never moves.

The difference between the two viewports *is* the overlay
(`innerHeight - visualViewport.height - offsetTop`): ~0 on Android, the
keyboard's height on iOS, one formula with no platform branch. Pinch-zoom
shrinks the visual viewport too, so anything but scale 1 is ignored — this app
permits zoom on purpose, since v4.2.1 fixed tap-zoom by raising the font size
rather than by locking the page down.

> **Between v3.1 and v4.2.0**, the Calendar returned (v4.0.0, rebuilt so its
> events ride Protect and Backup), Backup became always-encrypted, and the
> corner lock button and first axe-core pass landed in v4.1. See
> [CHANGELOG.md](CHANGELOG.md).

---

## Technical Notes

- **Single file** — The entire application (HTML + CSS + JavaScript) lives in one `~525KB` file, with no build step.
- **Persistence** — Uses `localStorage` under the key `notepadSession`.
- **Download behavior** — "Download CB App" writes a pristine, *blank* copy of the app. It carries no session, so opening a copy can never touch what is already saved in your browser. Use Backup + Import to move content.
- **Backup format** — AES-GCM-256 over a PBKDF2-SHA256 (210,000 iteration) key, with a fresh salt and IV per file. There is no plaintext backup path.
- **Window limit** — 25 windows. A session containing more restores what fits and reports what was skipped.
- **Browser support** — Works in any modern Chromium-based browser. Best experience in Chrome/Edge.

---

## File Structure

```
cbapp/
├── cbapp.html          # The complete application (v4.2.4)
├── CHANGELOG.md        # Release history
└── README.md           # This file
```

---

## License

This project is provided as-is for internal and personal use.

---

**CB App v4.2.4** — A self-contained productivity workspace that just works.
