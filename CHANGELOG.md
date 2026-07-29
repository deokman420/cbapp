# Changelog

All notable changes to CB App. Dates are the release date of the single-file
`cbapp.html` build.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [3.1.1] — 2026-07-28

### Fixed

- **Windows could not be moved into the bottom corners of the screen.** The
  toolbar is a centred island — on a 1900px display it spans about 560 to 1340,
  roughly 41% of the width — but the drag clamp treated its top edge as a floor
  across the *entire* width. A window parked at the far left, its right edge
  400px clear of the toolbar, still stopped level with the toolbar's top, with
  ~120px of completely empty canvas beneath it. Two dead strips, one down each
  side, for an obstacle that wasn't there. The vertical limit is now resolved
  per window position: anything clear of the toolbar's column gets the full
  height of the viewport, and a window dragged sideways out of that column
  opens up as it goes. A window still can't be pushed under the toolbar itself.
  On a narrow screen the toolbar genuinely does span the full width, so it
  still bounds everything — the rule is geometric, not a special case.
  (Present since 3.0; the big canvas only made the wasted space obvious.)

---

## [3.1.0] — 2026-07-28

### Added

- **A big canvas.** `Canvas` in the toolbar turns on a work surface three
  screens wide and three tall. It is **off by default**, and while it is off
  the app behaves exactly as it did before — the view is the identity
  transform, so world and screen coordinates are the same number and every
  existing path, including sessions saved by earlier versions, is untouched.
  - Pan by dragging the empty background, middle-dragging, holding Space while
    you drag (only when you aren't typing), or with the wheel. `Shift`+wheel
    pans sideways.
  - `Ctrl`+wheel — and a trackpad pinch — zooms around the pointer,
    continuously rather than in steps.
  - A zoom widget in the top-right corner zooms, fits every open window on
    screen, or snaps back to 100%. `Ctrl+Shift+=`, `-`, `9` and `0` do the
    same.
  - An overview map below it shows every window as a block and the part of the
    canvas you are looking at as a frame. Click or drag it to jump.
  - Turning the canvas off pulls any window parked off-screen back into view
    and says how many it moved, so nothing can be stranded out there.
  - The view is saved with your session and restored on load.

### Changed

- **Resizing a window is no longer the browser's native corner.** Native
  `resize` takes its delta in screen pixels and applies it to layout pixels —
  identical until the canvas introduced a scale, after which it ran at 1/zoom
  speed. A custom grip replaces it in both states, converting the delta the
  same way dragging does. It also restores resizing on touch devices, which
  had none: the native corner is unusable with a finger and was already
  switched off there, with nothing in its place.
- Dragging a window no longer measures itself on every pointer event. It read
  the window's size immediately after writing its position, which forces a
  synchronous re-layout each time, and with the canvas off it measured the
  toolbar too. Both are now taken once when the drag starts, and the paint is
  deferred to the animation frame.

### Fixed

- Switching theme wiped the canvas state off `<body>`, so the grid, overview
  map, zoom widget and grab cursor all disappeared until the next pan or zoom
  quietly restored them.
- Wheeling over a note that had nothing to scroll, or was already at its end,
  did nothing at all: the note ignored the event and the canvas never saw it.
  The canvas now takes over at the end of a scroll.
- A sticky note is the one resizable window with no minimum size of its own,
  and could be dragged down to a sliver with its own header clipped out of
  sight.

---

## [3.0.4] — 2026-07-28

### Fixed

- **A sticky note's border pulsed every time it gained or lost focus, worst in
  dark mode.** Sticky notes were the only window type whose `transition`
  included `box-shadow`, so the `.active` accent ring faded in and out over
  0.3s while the `border-color` underneath it switched instantly — the two
  edges of the same 1px line moving out of step, which reads as a pulse. It was
  loudest in dark mode, where the teal ring is high contrast against the
  canvas. Focus now snaps on sticky notes exactly as it does on every other
  window; the background still transitions, so the colour swatch keeps its
  fade.

### Changed

- **Windows are properly translucent while being dragged**, in both themes
  (`opacity: 0.94` → `0.8`). The accent ring and the slight scale added in
  3.0.3 carry the "picked up" read on their own, which frees the opacity to do
  what it looks like it should: let the canvas show through a window in flight.

---

## [3.0.3] — 2026-07-28

### Fixed

- **Dragging a window gave no visible feedback in light mode.** The drag state
  was `opacity: 0.8` and nothing else, which only ever worked by accident:
  compositing a white window over the light canvas at 0.8 lands on
  `rgb(253,253,254)`, a 2/255 shift that is invisible, so the only visible
  result was windows underneath bleeding through — closer to a rendering fault
  than to "picked up". Dark mode got away with it because light text dims
  noticeably against a dark ground. Dragging now lifts the window with an
  accent ring, a raised shadow and a slight scale, which reads the same in both
  themes, with the opacity reduced to a seasoning.
- Sticky notes and the help window had no drag feedback at all — the original
  rule covered only five of the seven window types.

---

## [3.0.2] — 2026-07-28

### Fixed

- **Calc, Clock, Log, Theme and Search did not highlight on hover** while Note,
  Tasks, T2 and the rest did. Those five are the only toolbar buttons with an
  `id`, and a leftover id-specificity rule (0,1,0,0) outranked both
  `.nav-menu button:hover` and `.nav-menu button.active` (0,0,2,0), pinning them
  to the resting colours. The rule existed only to neutralise legacy skins that
  were deleted in v3.0, so it is gone; the shared nav rules already style every
  toolbar button identically. This also restores the active-state highlight on
  the Calc and Clock toggles.

---

## [3.0.1] — 2026-07-28

### Fixed

- **Sticky notes created before v3.0 stayed dark after switching to light
  mode.** v3.0 stopped baking theme colours into new notes, but sessions saved
  earlier already contained them, and the restore path reapplied them
  faithfully — so an existing note kept its dark background while the rest of
  the app went light, with near-invisible toolbar labels on top of it. Notes
  now record whether a colour was a deliberate choice; a stored colour matching
  any default this app has ever shipped is treated as "no choice" and released
  to the theme. Notes you actually recoloured keep their colours.
- A note's title, toolbar labels and buttons now follow its custom text colour
  instead of the theme's, so they stay readable on any background you pick.
- The colour swatches no longer read a mid-transition value (the note animates
  its background over 0.3s, so they could show a colour like `#9a9475` that was
  never chosen and never displayed).

### Added

- **Copy button on sticky notes**, next to Reset — one click copies the note's
  text.
- **Reset button on sticky notes**, returning a note to the theme colours.
  Without it, recolouring a note dark and then switching to light mode (or the
  reverse) left it unreadable with no way back.

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
