# CB App

> A self-contained, offline-first multi-window productivity app that runs as a single HTML file.

**Version:** `v2.1`  
**Released:** May 30, 2026  
**Size:** ~160 KB (single file)  
**License:** Provided as-is

![HTML](https://img.shields.io/badge/HTML-5-E34F26?logo=html5&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-ES6+-F7DF1E?logo=javascript&logoColor=black)
![Offline](https://img.shields.io/badge/Offline-First-10b981)

CB App is a lightweight, offline-first productivity tool that runs entirely in the browser as a single HTML file. It provides a desktop-like multi-window environment with notes, task lists, a calculator, clock, and more.

It was originally built to work inside highly restricted **Enterprise Browser** environments (where external clipboard access and many web features are blocked), but works great in any modern browser.

---

## Features

- **Multi-window interface** — Drag, resize, minimize, and lock individual windows
- **Notes** with line numbers, word/character counts, case conversion, and per-note logging
- **Task Lists** with checkboxes and completion tracking
- **Sticky Notes** with customizable colors
- **Built-in Calculator** with history and support for basic operations + square root
- **Clock** with multiple timezones, stopwatch, and countdown timer (with desktop notifications)
- **Session persistence** — Everything is automatically saved to localStorage
- **Import / Export** — Save and load full sessions as JSON
- **One-click HTML download** — Export your current workspace (all open windows + content) as a standalone `cbapp.html` file
- **Dark & Light themes**
- **T2 Template** — Quick support ticket template for enterprise workflows
- Fully offline — no external dependencies after the initial load

---

## Getting Started

### Download

- **Primary file:** [`cbapp.html`](cbapp.html) — The complete application (v2.1)

Simply save the file and open it in your browser.

### Quick Start

1. Save `cbapp.html` to your computer
2. Open it in any modern browser (best in Chrome / Edge / Enterprise Browser)
3. Create notes, tasks, sticky notes, etc.
4. Click **Download current session as .html** at the bottom to export your workspace

No installation or server required.

### Table of Contents

- [Features](#features)
- [Getting Started](#getting-started)
- [Recommended Usage](#recommended-usage-enterprise-browser)
- [What's New in v2.1](#whats-new-in-v21)
- [Technical Notes](#technical-notes)

---

## Recommended Usage (Enterprise Browser)

- Keep `cbapp.html` in your Documents folder or a dedicated location
- Create a bookmark or desktop shortcut for quick access
- Use the in-app **Download .html** button regularly to back up your work
- The app works best when opened from within an active Enterprise Browser session

---

## What's New in v2.1

- Major UI consistency improvements (headers, scrollbars, controls)
- All scrollbars now use a unified custom style matching the clock
- Regular note headers now correctly place controls on the right (matching sticky notes)
- Hardened security & stability (XSS fixes, localStorage guards, observer cleanup, debounced saves)
- Removed dead/legacy code for a cleaner, smaller file
- Improved self-download experience (`Download .html`)
- Updated in-app instructions and help text
- Various visual and layout normalization across windows and panels

---

## Technical Notes

- **Single file** — The entire application (HTML + CSS + JavaScript) lives in one `~160KB` file.
- **Persistence** — Uses `localStorage` under the key `notepadSession`.
- **Download behavior** — The "Download .html" feature captures the current live DOM state, so your open windows and notes are preserved in the exported file.
- **Browser support** — Works in any modern Chromium-based browser. Best experience in Chrome/Edge.

---

## File Structure

```
phbeks-site/
├── cbapp.html          # The complete application (v2.1)
├── README.md           # This file
└── ...
```

---

## License

This project is provided as-is for internal and personal use.

---

**CB App v2.1** — A self-contained productivity workspace that just works.
