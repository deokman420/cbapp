# CB App

> A self-contained, offline-first multi-window productivity app that runs as a single HTML file.

**Version:** `v3.2.19`  
**Released:** August 5, 2026  
**Size:** ~253 KB (single file)  
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
- **Log** with timestamped entries and per-entry deletion
- **Session persistence** — Everything is automatically saved to localStorage
- **Optional passphrase protection** — AES-GCM encrypts your session in the browser; the passphrase is entered masked, with a Show toggle, and is never stored
- **Always-encrypted Backup** — Backup writes your session out as an AES-GCM `.json` file and never as plaintext. With Protect on it reuses that passphrase; with Protect off it asks for one for that file. Import reads a backup back, through strict schema validation
- **One-click HTML download** — Save a blank standalone `cbapp.html`; copies carry the program only, never your notes
- **Dark & Light themes**, both meeting WCAG AA contrast
- **Keyboard shortcuts** and full focus-ring support
- **Touch and pen support** — works on tablets and phones
- **T2 Template** — Quick support ticket template for enterprise workflows
- Fully offline — no external dependencies after the initial load

---

## Getting Started

- **Primary file:** [`cbapp.html`](cbapp.html) — The complete application (v3.2.19)

Simply save the file and open it in your browser.

### Quick Start

1. Save `cbapp.html` to your computer
2. Open it in any modern browser (best in Chrome / Edge / Enterprise Browser)
3. Create notes, tasks, sticky notes, etc.
4. Click **Backup** in the toolbar to save an encrypted copy of your notes

No installation or server required.

### Table of Contents

- [Features](#features)
- [Getting Started](#getting-started)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [Recommended Usage](#recommended-usage-enterprise-browser)
- [What's New in v3.0](#whats-new-in-v30)
- [What's New in v3.1](#whats-new-in-v31)
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

The window with the highlighted outline is the active one — Copy, Paste and
Search all act on it.

---

## Recommended Usage (Enterprise Browser)

- Keep `cbapp.html` in your Documents folder or a dedicated location
- Create a bookmark or desktop shortcut for quick access
- Use the in-app **Download .html** button regularly to back up your work
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

## Technical Notes

- **Single file** — The entire application (HTML + CSS + JavaScript) lives in one `~253KB` file.
- **Persistence** — Uses `localStorage` under the key `notepadSession`.
- **Download behavior** — "Download CB App" writes a pristine, *blank* copy of the app. It carries no session, so opening a copy can never touch what is already saved in your browser. Use Backup + Import to move content.
- **Backup format** — AES-GCM-256 over a PBKDF2-SHA256 (210,000 iteration) key, with a fresh salt and IV per file. There is no plaintext backup path.
- **Window limit** — 25 windows. A session containing more restores what fits and reports what was skipped.
- **Browser support** — Works in any modern Chromium-based browser. Best experience in Chrome/Edge.

---

## File Structure

```
cbapp/
├── cbapp.html          # The complete application (v3.2.19)
├── CHANGELOG.md        # Release history
└── README.md           # This file
```

---

## License

This project is provided as-is for internal and personal use.

---

**CB App v3.2.19** — A self-contained productivity workspace that just works.
