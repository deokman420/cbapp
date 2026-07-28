# Changelog

All notable changes to CB App. Dates are the release date of the single-file
`cbapp.html` build.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [3.0] — 2026-07-28

A UX and accessibility overhaul. Every change below was verified in a real
browser rather than by inspection; the notes call out what was actually
measured.

### Fixed — window management

- **Windows no longer spawn on top of each other.** Every window type opened at
  one of three fixed positions (notes, calculator, clock and help all
  dead-centre; task lists at 50,50; the log at 0,0), so opening three things
  buried them in one pile. Windows now cascade in a predictable staircase from
  a shared anchor and restart at the top-left before running off-canvas.
- **Sticky notes and the log window ignored their own position and size.**
  `left`/`top` on sticky notes and `width`/`height` on the log were set without
  a unit (`"50"`, `"400"`), so the declarations were invalid and silently
  dropped — the log collapsed to its 350×150 minimum in the corner.
- Windows can no longer be created or dragged underneath the toolbar.
- Sessions saved on a large display used to restore partly off-screen on a
  smaller one with no way to drag them back. Positions are now clamped into
  view on restore and on viewport resize.
- **Window z-indices could climb over the interface.** The counter rose without
  bound (ceiling 2,147,483,640) while the toolbar sits at 1000, so after enough
  focus changes a window would render on top of the toolbar and the download
  button. Windows are now capped below 900 and the stack compacts itself when
  it reaches the ceiling.

### Fixed — the "Download .html" export

The headline feature did not work. It serialised the live DOM verbatim, which
baked every open window into the file as static markup. The exported copy
contained:

- windows with **no event listeners** — they could not be dragged, closed or
  edited;
- windows with **no content**, because a textarea's value is not part of its
  serialised HTML;
- **duplicates**, since those dead copies loaded alongside the ones restored
  from `localStorage`;
- a second `#nav-tooltip` sharing an id with the real one, and window counters
  reset to zero so new windows collided with the baked-in ids.

The export now writes a pristine document and carries the session as embedded
JSON. Opening an exported file restores it exactly once; edits made inside that
copy take precedence from then on.

### Fixed — focus and interaction

- **Nothing indicated which window was focused.** The code set an `.active`
  class that had no styling rule anywhere, while Copy, Paste and Search all
  acted on it. The active window now carries a visible outline and tinted
  title bar; hover was demoted to a neutral tint so it stops impersonating
  focus.
- The calculator had no click handler at all, so clicking it never raised it.
- Minimising hid a window with no way to get it back short of an undiscoverable
  hover menu. Minimised windows now appear as chips in the bottom-left corner.
- **Minimising a singleton then clicking its toolbar button destroyed it.**
  Clock, calculator, log and help now restore instead of closing.
- Windows raise on pointer-down rather than click, which no longer feels a beat
  behind the cursor.

### Fixed — status, search and the calculator

- **Status messages were invisible.** `#status` sat at `bottom: 50px`, directly
  behind the bottom-centre toolbar, so every confirmation and error rendered
  underneath it. Moved opposite the toolbar, with overlapping timers cancelled.
- Search and replace was an unstyled element dropped mid-canvas. It is now a
  proper panel, reports how many matches were replaced, and treats the query as
  literal text — previously it went straight into `RegExp`, so `(` threw and
  `.` matched anything.
- **The calculator ignored operator precedence**: `2+3*4` returned 20 instead
  of 14. Multiplication and division are now resolved before addition and
  subtraction.

### Fixed — clipboard

- Paste used `navigator.clipboard.readText()`, which does not exist under
  `file://` — the way this app is designed to be run. It now falls back to
  focusing the note and telling you to press <kbd>Ctrl</kbd>+<kbd>V</kbd>.
- Paste **replaced the entire note** instead of inserting at the cursor.
- Copy left the note text selected afterwards, so the next keystroke could wipe
  it. Copy now runs through an offscreen field and leaves your caret alone.

### Fixed — theming and contrast

- **The design system was not actually being applied.** Legacy `.dark-mode X`
  rules outranked the token-based styling on specificity, so windows painted
  `rgba(0,0,0,0.3)` over a grey border instead of the intended card colour.
  Seventeen blocks of dead overrides were removed.
- **Sticky notes broke when switching themes.** Their colours were baked into
  inline styles at creation, so a note made in dark mode kept its dark
  background but picked up light-mode dark text — a contrast ratio of 1.27:1.
- Sticky notes are visually distinct again instead of identical to every other
  window.
- Contrast now passes WCAG AA across **84 elements in both themes**. Fixes
  included the line-number gutter (2.19:1), the light-mode accent used for
  active titles and links (2.9:1), and the destructive controls (4.02:1 and
  3.3:1 for white-on-red).

### Added

- **Locking works on every window type.** Previously only notes and sticky
  notes could be locked; the clock, calculator, task lists, log and help window
  now lock too. Locking freezes content, dragging and resizing while leaving
  text readable, scrollable and selectable.
- **Touch and pen support.** Dragging was mouse-only, so windows could not be
  moved at all on a tablet or phone. Rewritten on Pointer Events.
- Keyboard shortcuts: <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>N</kbd> new note,
  <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>T</kbd> new task list,
  <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd> search,
  <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>W</kbd> close, <kbd>Esc</kbd> to
  dismiss.
- Individual task and log entries can be deleted; both were previously
  all-or-nothing.
- An empty-canvas hint on first open, replacing a featureless void.
- Focus rings throughout, accessible names on every toolbar button, and
  <kbd>Enter</kbd>/<kbd>Space</kbd> support on title-bar controls.
- Confirmation prompts on Reset and Clear, which destroy work irreversibly.
- A responsive layout — the toolbar previously ran off the side of a phone
  screen with no way to reach the right-hand buttons.
- `prefers-reduced-motion` support.

### Changed

- The download button highlights red rather than the interface accent colour,
  marking it out as the one control that writes a file to disk.
- Toolbar tooltips no longer show a redundant second line for single-instance
  windows; they list a window only when doing so adds something, such as
  restoring it while minimised.
- The clock window is sized to fit its contents — it was ~40px too short, which
  sliced the stopwatch buttons in half.
- The in-app help text now documents the interface rather than only the
  Enterprise Browser setup.
- The window limit is counted consistently. Each creation path previously
  counted a different subset, and the clock and calculator were not counted at
  all, so the cap could be walked past two windows at a time. Sessions holding
  more windows than the cap now restore what fits and say what was skipped,
  rather than aborting the restore and losing everything after the limit.

### Removed

- **The Calendar window.** Retired in this release.
- The Drawing window, which had been unreachable behind a commented-out button
  for several releases, along with roughly 120 lines of supporting code.
- A duplicate `openInstructions` definition, an orphaned `toggleLock` and its
  backing map, and a large body of superseded styling.

---

## [2.1] — 2026-05-30

### Changed

- Major UI consistency improvements across headers, scrollbars and controls
- Unified custom scrollbar styling
- Note headers place their controls on the right, matching sticky notes
- Updated in-app instructions and help text
- Visual and layout normalisation across windows and panels

### Fixed

- Hardened security and stability: XSS fixes, `localStorage` guards, observer
  cleanup, debounced saves
- Improved the self-download experience

### Removed

- Dead and legacy code, for a smaller file

---

## [2.0] — 2026-05-28

- Initial tracked release of the multi-window workspace: notes, task lists,
  sticky notes, calculator, clock, log, session persistence, import/export,
  dark and light themes, and the T2 template.
