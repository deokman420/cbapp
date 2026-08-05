# Changelog

All notable changes to CB App. Dates are the release date of the single-file
`cbapp.html` build.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [3.2.13] — 2026-08-05

### Changed

- **Clock, Calc, Log and Help are one window per workspace, not one in total.**
  You can have a calculator on the canvas and another in the plain view, and
  they are genuinely independent: separate log entries, separate calculator
  history, separate stopwatch and countdown. Previously a single fixed id meant
  a second one could not exist, so pressing the button from the other desk
  could only drag the one window across.
- Each window's inner elements are now suffixed with their owner's id
  (`calculator-input-calculator`, `stopwatch-display-clock-canvas`), which is
  the convention notes (`clipboard-<id>`) and the clock (`clock-time-<id>`)
  already used. Two windows sharing one set of ids would have been two elements
  answering to `calculator-input`, and `getElementById` returns the first — so
  the canvas keypad would have driven the plain view's calculator.
- The mutable state that used to be module-level globals — one calculator
  history, one array of log entries, one stopwatch, one countdown, one 1-second
  clock tick — belongs to a window now, keyed by window id. One shared interval
  meant the second clock to open silently stopped the first.
- Sessions store up to two records per kind, under the window's own key
  (`log`, `log-canvas`). A session written by any earlier version carries one
  unsuffixed record and restores onto the desk its own `mode` names, so a
  calculator saved on the canvas comes back on the canvas.
- `claimSingleton()` and `adoptIntoCurrentMode()` are gone with the behaviour
  they existed for, and `closeWindow()` no longer needs to route these four
  through their toggles: the lit button is derived and the timers hang off the
  instance, so one path closes every window type. The `calculatorCount` and
  `clockCount` counters went too — both were write-only, and with a fixed name
  and at most one per desk they could never have numbered anything.

### Fixed

- **The Calc, Clock and Log buttons no longer claim a window is open when it is
  on the other workspace.** Open all three in the plain view, switch to the
  canvas, and all three stayed lit while the windows were correctly back on the
  other desk. The lit state was bookkept — written at open, cleared at close —
  but "is the Log open?" is a question about the desk you are looking at, and
  its answer changes when nobody has touched the Log at all. It is derived in
  `refreshChrome()` now.
- Closing any of the three from the toolbar never called `refreshChrome()`, so
  it left the empty-state hint suppressed by a window that no longer existed,
  and a stale block in the canvas minimap.
- The session validator drops unknown top-level keys on purpose, for forward
  compatibility — which meant a key missing from its allowlist was not a
  validation error anyone would see, but a window that silently failed to come
  back. The allowlist is built from the singleton registry now rather than
  hand-written, which is how `log-canvas` was caught.

---

## [3.2.12] — 2026-08-05

### Fixed

- **The big canvas opens in the middle of the world again, not in its top-left
  corner.** The corner is the worst place to start: it is empty, and because
  pan is capped at 0 there is no world above or to the left of it, so half the
  drag directions are dead on arrival.
- The centring itself was never the broken part — `toggleCanvasMode()` had a
  "first visit centres" branch all along. What defeated it was the *save*.
  Every save made with the canvas off wrote a viewpoint of `{0, 0, zoom 1}` as
  a placeholder, and (0, 0) is precisely the corner. On the next boot that
  placeholder was indistinguishable from a real remembered position, so the
  first-visit branch never ran again. Opening CB App once and reloading was
  enough to poison it permanently.
- Sessions now record `canvas.seen` — whether there is a viewpoint to remember
  at all — so an unvisited canvas stops masquerading as one parked at the
  corner. Sessions written by 3.2.9–3.2.11 say nothing about `seen`, so a
  viewpoint of exactly `{0, 0, zoom 1}` is read back as the "never been" it
  stood for; any other saved viewpoint from that era still restores exactly.
  The only case given up is a user who deliberately parked at the exact corner
  at 1:1, who gets centred once.
- Booting straight onto a canvas that has never been positioned also centres
  now. It previously used a `{0, 0, zoom 1}` fallback of its own, so it landed
  in the corner even when the session carried no viewpoint at all.
- `centerCanvasView()` is now one function serving the first visit, the boot
  path, and the 1:1 button, which had three copies of the same arithmetic
  between them.

---

## [3.2.11] — 2026-08-05

### Security

- **Backups are always encrypted.** Backup used to mirror the session's own
  state: Protect on gave you an encrypted `.json`, Protect off wrote every note
  you had in plaintext. That is exactly backwards for the one artefact designed
  to leave the machine — a backup gets mailed to yourself, dropped on a share,
  or left sitting in Downloads, where the browser profile's protections do not
  reach. There is no plaintext path left. With Protect on the backup reuses
  that passphrase, so one secret opens both. With Protect off, Backup asks for
  a passphrase (entered twice, 6+ characters) for that file alone; cancel and
  **no file is written at all**. Same envelope as before — AES-GCM-256 over a
  PBKDF2-SHA256/210k key, fresh salt and IV per file — and the download is now
  always named `cbapp-session.encrypted.json`.
- A per-file backup passphrase is sealed by `encryptForExport()`, which
  deliberately bypasses the `ensureSessionKey()` cache. The old encrypt path
  writes `sessionPassphrase` / `sessionCryptoKey` / `sessionKeySalt` as a side
  effect, so routing a throwaway backup passphrase through it would silently
  re-key — or newly encrypt — this browser's own localStorage session under a
  secret the user never meant to keep.
- For the same reason Backup no longer does a raw `setItem` of the bytes it
  just exported. It syncs storage through `persistSessionPayload()`, so an
  unprotected session stays plaintext-in-browser rather than being locked
  behind a passphrase chosen for a file.
- Backup now refuses to run when the session is locked (it would have backed up
  the empty screen, not the ciphertext) or when `crypto.subtle` is missing
  (previously that threw its way into a plaintext-shaped failure).
- Importing an encrypted backup already adopted its passphrase for this
  browser; the status message now says so, since with backups always encrypted
  that path is the common one and the next reload will ask for it.

---

## [3.2.10] — 2026-08-05

### Fixed

- **A window created in one mode no longer appears in both.** 3.2.9 gave each
  mode its own *positions* while every window stayed in both, which is the
  wrong half of the problem: opening a T2 template on the canvas also put one
  in the plain view, and closing it in one place left the other behind. The two
  modes are two desks, and **membership** is what has to be per-mode. Once it
  is, positions follow for free — a window that only ever exists on one desk
  never needs a second coordinate — so the whole per-mode position bank added
  in 3.2.9 is gone, along with the id-reuse pruning it needed.

  A window is stamped with the desk it was created on, in `wireWindowFocus()` —
  the one call every window type makes on the way in, because a per-creator
  stamp would have been seven chances to forget one. Hiding is a class rather
  than `style.display`, which is the minimise flag: a window minimised on the
  canvas has to come back minimised when you return, so the two states must not
  share a channel.

  Everything that asks "what is open" now means the desk on screen — the
  empty-state hint, the minimised bar, the overview map, zoom-to-fit, the
  cascade staircase, the nav tooltips, and what gets focused when the active
  window closes. Asking the DOM directly is what the bug *was*. The window cap
  is the deliberate exception: it guards how big a session can get, and a window
  costs the same on either desk.

  Turning the canvas on for the first time now shows an empty workspace, which
  is correct but looks exactly like having lost everything, so the status
  message says where the windows went.

- **The four singleton windows can no longer be destroyed from the mode that
  cannot see them.** Clock, Calc, Log and Help have fixed ids, so a second one
  cannot exist. Pressing Clock while the only clock was on the other desk fell
  through to the toggle's "it exists → remove it" branch and deleted it from a
  mode that was not even showing it. The button now brings that window across,
  which doubles as the way to move one between desks.

- **A minimised window no longer loses its size.** `offsetWidth`/`offsetHeight`
  read 0 on anything `display:none`, so the first save after a minimise wrote
  `width: 0, height: 0` into the record and restore faithfully rebuilt a 0px
  window that came back from the chip bar invisible. This was already true in
  3.2.9 and earlier — mode-hiding would have widened it to every window on the
  desk you were not looking at, on every save. Sizes are now remembered from
  the last time the window was actually rendered, and a stored zero is treated
  as "no saved size" so existing broken sessions heal on load.

- **Switching desks no longer shrinks every note to 32px.** Hiding a window
  fires the ResizeObserver — its box genuinely did change, to nothing — and
  `updateWindowSize()` measured the collapsed box and wrote the result straight
  back as `style.width`. It now declines to measure a window that is not being
  rendered.

### Upgrade

- Sessions written before 3.2.10 say nothing about modes. An absent mode is
  deliberately not read as "the plain view": a session saved with the canvas on
  would then restore every window onto the desk the user was not looking at, and
  the canvas would come up empty — indistinguishable from having lost the lot.
  Untagged windows are adopted by whichever desk was active when the session was
  saved. A *malformed* mode is a different case and is coerced, not dropped.

### Tests

- Nine new Playwright cases covering the reported bug directly, the empty-state
  hint on a fresh canvas, membership surviving a reload, minimise being
  independent of which desk is showing, the singleton move, the remembered
  viewpoint, both size regressions, the pre-3.2.10 upgrade path, and a malformed
  mode. The toolbar smoke test now asserts the round trip rather than expecting
  windows to be visible from both modes. 117 pass across Chromium, Firefox and
  WebKit.

---

## [3.2.9] — 2026-08-05

### Added

- **The Download chip shows the build version in small print.** The saved file
  is always called `cbapp.html`, so a copy pulled down months ago was
  indistinguishable from a current one without opening it and reading the
  release comment in the source. The chip now reads `DOWNLOAD CB APP v3.2.9`,
  and because the download clones the live DOM the stamp travels with the copy.

  `CB_APP_VERSION` is the single place a release changes it; the stamp is
  written into the chip at boot rather than sitting in the markup, so the two
  cannot drift. A test asserts the rendered stamp matches the release comment
  at the top of the file and that a downloaded copy still carries it.

- **Canvas and windowed mode each keep their own layout.** They are two desks,
  not two views of one: windowed is a single screen you arrange tightly, the
  canvas is three screens you spread out across. Until now a single set of
  coordinates served both, so every trip through the toggle destroyed the
  arrangement you were leaving — entering shoved every window into the middle
  cell, and leaving clamped everything spread across the world back onto one
  screen. Glancing at windowed mode collapsed a canvas you had spent time
  laying out, with no way to get it back.

  Each mode now banks where its windows sat, and the canvas banks its pan and
  zoom alongside them, so you return to the viewpoint you left rather than the
  default one. Toggling saves the desk you are leaving and replays the desk you
  are entering. Both snapshots persist with the session, so a reload does not
  cost you the mode you are not currently looking at.

  Windows the destination mode has never seen — opened since the last toggle —
  are carried across by inverting the view rather than by copying raw numbers,
  so they arrive on the patch of screen the user last saw them on instead of a
  viewport away. Coming back to windowed mode, they are still clamped into the
  viewport; a window opened out on the canvas would otherwise land off-screen
  with no way to pan to it.

  Two details that would have bitten later: banked positions are pruned against
  the live DOM on every save, because window ids come from a counter that
  restore replays from zero — a stale entry for a closed `window3` would
  otherwise be applied to whatever inherited the id after a reload. And Reset
  clears both banks, or the first canvas toggle after a reset would replay the
  layout of the session just deleted.

### Fixed

- **The band of dead space in the Clock window.** The countdown timer was a
  sibling *below* `.clock-content`, which is `flex: 1` — so every pixel the
  window was taller than its content was absorbed by the scroller and opened as
  a gap between the stopwatch buttons and the countdown heading, rather than as
  ordinary slack at the bottom. The default height of 566 overshot the content
  by about 30px, which is exactly what that gap was.

  The countdown now lives inside `.clock-content` with the other three
  sections, so surplus height falls below everything as it should, and the
  default size (410x502) is the measured height of the content with no
  scrollbar in Chromium, Firefox or WebKit.

  Moving it in switched on two `.clock-content .countdown-controls` rules that
  had been inert since it was moved out — a wider gap plus 8px on either side
  of both number inputs — which was enough to wrap **Reset** onto a line of its
  own. Those are trimmed back to the top margin they were meant to contribute.
  The window is 20px wider because inside the scroller the controls also have
  to clear its 10px side margins.

### Tests

- Five new Playwright cases: the toggle round trip restores each mode's
  positions and the canvas zoom; both layouts survive a reload; a window opened
  on the canvas lands on screen when leaving; a malformed `layouts` block is
  dropped without taking the session with it; and the clock fits its default
  size with no scrollbar and no wrapped countdown row. 96 pass across Chromium,
  Firefox and WebKit.

---

## [3.2.8] — 2026-07-30

### Fixed

- **Reloading twice in a row no longer clears the session.** Boot is async: it
  reads storage, then waits on the unlock prompt for as long as the user takes
  to answer it. Reloading during that wait fired `beforeunload`, which called
  `saveSession()` — and at that moment the screen was blank, the DOM had not
  been restored yet, and no passphrase had been entered. The blank screen was
  serialized as a *plaintext* session and written over the ciphertext. The next
  load then "restored" that empty session successfully, so the app reported
  **Session restored** over an empty canvas with the work already gone.

  Saving is now refused outright until boot has decided what this browser's
  session is. Nothing is lost by waiting — storage already holds the truth, and
  no edit can have happened before the session is on screen. Three boot
  outcomes release the gate: a successful restore, an empty first run, and a
  locked session (where `sessionLocked` takes over as the guard so Unlock still
  works). Two do not: a stored value that fails to parse, and one that is not
  an envelope we can offer to unlock. In both, the unreadable copy is still the
  user's only copy, so the app stays read-only and raises the save-failure
  badge — Backup and Reset remain the ways out.

  Regression test: `reloading while the unlock prompt is open does not wipe the
  session` reloads mid-prompt and asserts the stored envelope is byte-identical
  across the second load, then unlocks and checks the note came back.

---

## [3.2.7] — 2026-07-30

### Security

- **The HTML download no longer carries your notes, and an opened file can no
  longer touch the session already in your browser.** Since 3.2.0 the export
  baked the session into the file and restored it on open. Two things went
  wrong with that, and 3.2.6 removing the confirm dialog made both reachable
  without a click:

  1. **Protect was silently switched off.** `parseAndUnlockSession` only sets
     `sessionPassphrase` when the payload *it loads* is an AES-GCM envelope. A
     plaintext embedded session left it null, so the `saveSession()` right
     after the restore wrote **plaintext** to `localStorage` and the toolbar
     button flipped back to "Protect". Nothing was leaked — the old ciphertext
     went to `notepadSession.prev` — but a user who had protected their session
     went on typing into unencrypted storage with only a 15-second bar to
     notice.
  2. **A stale snapshot displaced live work.** On `file://` every copy shares
     one opaque `"null"` origin, so the export in your Documents folder and the
     browser session are the same bucket. Opening a file exported from an empty
     workspace replaced everything on screen with nothing.

  Both were reproduced on a `file://` build: protect a session, hard-reload the
  exported copy, and it comes back empty, unprotected, and plaintext.

  **Download HTML is now "Download CB App" and ships the program only** — a
  blank single file, no notes in it. **Backup (`.json`, encrypted when Protect
  is on) is the only path that moves content off this browser.** Boot reads
  `localStorage` and nothing else.

  The restore path is removed rather than guarded: `readEmbeddedSession`,
  `undoEmbeddedRestore`, the undo bar and `EMBEDDED_SESSION_ID` are all gone.
  A payload left in a pre-3.2.7 export is inert — such a file opens as a blank
  CB App and your browser session is untouched. `notepadSession.prev` and
  `cbappConsumedExport` are purged at boot, since a leftover `.prev` is the
  wreckage of this bug and nothing will ever offer it back.

  `cbapp-security-check.mjs` asserted the mechanism that was removed, so four
  checks failed on this change — correctly. They now assert the opposite: no
  payload is written, no restore path exists, boot reads only `SESSION_KEY`,
  and the retired keys get purged. Two Playwright tests cover it, including a
  regression that serves the document with an old payload spliced in and
  asserts the browser's own session still wins.

### Known issues

- The Help window is a fixed 620px wide and is not clamped to the viewport, so
  on a phone-width screen (393px) its header — including the close button —
  sits off the right edge. Pre-existing, unrelated to this release, and the
  reason `Help opens and documents Protect + Freeze` fails on the `mobile`
  project.

---

## [3.2.6] — 2026-07-30

### Changed

- **Opening an export no longer blocks on a confirm dialog.** 3.2.0 added a
  `window.confirm` before an embedded session was allowed to replace whatever
  the browser had saved. That was written for the hosted build, where each
  origin has its own storage and the collision is rare. It reads very
  differently from a `file://` copy: every `file://` page in a Chromium browser
  shares one opaque `"null"` origin, so *every* export — in any folder, on any
  drive — reads and writes the same single bucket. `existing` was therefore
  almost always set, and the modal fired on essentially every open. Reported
  against Island Browser, but it was never Island-specific.

  The file you opened now simply loads. The session it displaced is still
  stashed under `notepadSession.prev` exactly as before, and a top-centred bar
  offers **Undo — keep my browser session** for 15 seconds. Undo writes the
  stash back and reloads, which reuses the whole boot path — including the
  passphrase prompt, if the displaced session was protected.

  The security property here was never the dialog; it was that displaced work
  survives and is recoverable. `cbapp-security-check.mjs` asserted the dialog's
  message string, so it failed on this change — correctly. It now asserts the
  actual invariant: the stash write, the undo affordance, and that Reset still
  wipes `notepadSession.prev` along with everything else.

### Notes

- `Unsafe attempt to load URL file://… 'file:' URLs are treated as unique
  security origins` in the console on a `file://` copy is **not** from CB App.
  A four-line HTML file with no script, no CSP and no images reproduces it
  identically; it is Chromium's favicon lookup against an opaque origin. CB App
  makes no network or file requests at all (`connect-src 'none'`, and there is
  no `fetch`, `XMLHttpRequest`, `<img>`, `<iframe>` or external `<link>`
  anywhere in the file). Nothing is broken and there is nothing to fix.

---

## [3.2.5] — 2026-07-29

### Fixed

- **A wrong or cancelled passphrase destroyed the session outright.** Boot
  failed to decrypt, showed "Session not loaded", and then carried on as an
  ordinary empty session — so the very next write (a keystroke, a resize, or
  the `beforeunload` save on closing the tab) called `saveSession()`, found no
  passphrase in memory, and wrote a *plaintext snapshot of the empty screen*
  over the ciphertext. One mistyped passphrase and the only copy of the work
  was gone, with no warning and nothing to recover from.

  A failed unlock now enters a **locked state** instead: `saveSession()` and
  `persistSessionPayload()` both refuse to write, so the ciphertext cannot be
  touched no matter what the user does next. A 🔒 banner (and the toolbar
  button, which reads **Unlock**) re-opens the prompt — three tries per round,
  unlimited rounds, no reload needed. On success the session is restored and
  saving resumes.

  Unlocking with scratch windows on screen asks before replacing them, since
  anything typed while locked was by definition never saved. Reset and Import
  remain the only ways to delete a locked session, and both now confirm first.

- **A top-left badge covered the mobile toolbar.** Below 720px the toolbar is
  top-anchored and full-width, so `#save-warning` — and the new lock banner,
  which is a *button* — sat on top of it and swallowed the clicks. Both now
  move above the minimized chips, matching `#canvas-controls`.

### Tests

- New: a locked session survives further edits byte-for-byte and unlocks from
  the banner with the right passphrase. The wrong-passphrase test now also
  asserts the stored blob is still encrypted and still free of the plaintext.

---

## [3.2.4] — 2026-07-29

### Changed

- **T2 field 10 is now "Screen share code".** It read "Glance Screen share
  Code", naming a tool the template should not be tied to.
- **The big canvas is no longer labelled experimental.** It shipped in 3.1.0
  and has had a regression suite since 3.2.1; the word was stale in the help
  window and in three source-section headers.

### Removed

- **The console easter egg.** `phbeks // cbapp` plus a `cbappEgg()` hint
  printed on every load, and the function stayed on `window`. Nothing else
  logs on a clean load now.
- **The Source link from the instructions window.** The repo URL no longer
  ships inside the app.

---

## [3.2.3] — 2026-07-29

### Fixed

- **Chrome logged `[DOM] Password field is not contained in a form`.** The
  passphrase dialog put a `type="password"` input straight in a `<div>`, which
  trips Blink's password-form heuristic — harmless, but it is console noise on
  every Protect/Unlock and the fix is the correct markup anyway. The dialog
  card is now a real `<form>`, so Enter-to-submit comes from the platform
  instead of a `keydown` special-case and the OK button is a proper
  `type="submit"`.

  Submission is always `preventDefault()`ed, so nothing is ever navigated or
  serialised into a URL — verified: pressing Enter advances the dialog with
  `location.href` unchanged. The CSP's `form-action 'none'` is the belt to
  that brace.

---

## [3.2.2] — 2026-07-29

### Security

- **The session passphrase was typed in the clear.** Protect, Confirm and
  Unlock all used `window.prompt()`, which renders its input as plain text —
  so the one string guarding the encrypted session was legible to anyone
  looking at the screen, and to a screen share or recording. Replaced with an
  in-page dialog whose field is `type="password"` by default, with a
  **Show / Hide** toggle for checking a typo deliberately.

  The field clears and re-masks on every open, so the passphrase is never
  carried on screen between the "choose" and "confirm" steps, and never
  lingers in the DOM after the dialog closes.

### Changed

- Passphrase dialog is a real modal: `role="dialog"` + `aria-modal`, Enter to
  submit, Escape or a backdrop click to cancel, Tab trapped inside it, focus
  starting on the field and returning to the triggering button on close. It
  renders outside `.whiteboard` so canvas pan/zoom transforms cannot move it,
  and falls back to `window.prompt()` if the dialog markup is ever absent.

### Tests

- `tests/cbapp.spec.ts`: new masking test (field starts `password`, Show flips
  to `text` and sets `aria-pressed`, Cancel clears and re-masks, Escape closes
  without protecting). The Protect and wrong-passphrase tests now drive the
  modal instead of the dialog queue.

---

## [3.2.1] — 2026-07-29

### Fixed

- **Zooming out past 33% stranded a dead margin the canvas could not reach
  into.** The world was sized at 3 viewports (`CANVAS_MULTIPLE`), but
  `ZOOM_MIN` of 0.25 let the screen span 4 of them. Below 1/3 zoom the scaled
  world was smaller than the viewport, so `clampPan()` took its centring branch
  and parked it in the middle — 160×156px of unusable margin at 25% on a
  1278×1248 screen. Because `clampBounds()` works in world coordinates, a
  dragged window stopped dead at the world edge, well inboard of the screen
  edge, which read as windows being forced back toward the centre. The grid is
  a fixed backdrop so it kept painting across the margin, making it look like
  canvas that should have been reachable.

  The world multiple is now `max(CANVAS_MULTIPLE, 1 / ZOOM_MIN)`, so the world
  always covers the screen at maximum zoom-out. `computeWorldSize()` remains
  grow-only, so no window already parked out in the world can be stranded.

  Pre-existing since the canvas shipped in 3.1.0 — not introduced by the 3.2.0
  security work, despite surfacing alongside it.

### Tests

- Regression coverage in `tests/cbapp.spec.ts`: dead margin must be zero across
  zooms 1 → 0.25, and an end-to-end drag past the screen corner at `ZOOM_MIN`
  must land the window within 4px of the true corner. Verified to fail against
  the old constant.

---

## [3.2.0] — 2026-07-29

Security hardening from the `CBAPP-SECURITY-REVIEW.md` assessment. No push/merge
gate: `node scripts/cbapp-security-check.mjs` must pass.

### Security

- **Hardened Content-Security-Policy.** Replaced the single flat `default-src`
  allowlist (`'unsafe-inline'`, `data:`, unused `cdnjs`, Google Fonts) with
  split directives: `default-src 'none'`, `script-src` / `style-src` self +
  unsafe-inline (still required for the single-file architecture), `img-src`
  self + data/blob (favicon + canvas), `connect-src 'none'`, `object-src 'none'`,
  `base-uri 'none'`, `form-action 'none'`. `data:` can no longer load scripts via
  default-src fallback.
- **HTTP security headers for hosted `/cbapp`.** `vercel.json` sets CSP (with
  `frame-ancestors 'none'`), `X-Frame-Options: DENY`, `X-Content-Type-Options`,
  `Referrer-Policy: no-referrer`, and a locked-down `Permissions-Policy`.
- **Removed third-party fonts.** Dropped Google Fonts preconnect/CSS links;
  system UI + mono stacks only. No font CDN network dependency, tighter privacy
  for online use, works fully offline.
- **Optional passphrase encryption (Protect).** AES-256-GCM with
  PBKDF2-SHA-256 (210k iterations). Wraps `localStorage`, Backup JSON, and
  Download .html embedded sessions. Passphrase is memory-only for the tab;
  derived key is cached so saves do not re-run PBKDF2 every keystroke.
- **Strict session import / restore validation.** Allowlisted keys, type and
  length bounds, colour sanitisation, rejects `__proto__` / `constructor` /
  `prototype`. Applies to Import, embedded export boot, and decrypt.
- **Confirm before replacing the browser session** with an embedded export when
  a session already exists (still stashes the outgoing one under
  `notepadSession.prev`).
- **Reset clears all CB App storage keys** (`notepadSession`,
  `notepadSession.prev`, `cbappConsumedExport`) and in-memory passphrase state —
  not just the primary session key.
- **Freeze ≠ security.** Window lock control titles, status toasts, and help
  text now say *freeze* and state explicitly that this is layout-only, not
  encryption. Use **Protect** for secrecy.

### Added

- Toolbar **Protect** / **Unprotect** control next to Backup.
- Offline verifier: `node scripts/cbapp-security-check.mjs` (syntax, CSP surface,
  Vercel headers, AES-GCM round-trip).

### Changed

- Help → Saving section documents Protect, Freeze, and Reset wipe behaviour.
- Backup filename uses `.encrypted.json` when Protect is active.

---

## [3.1.3] — 2026-07-29

A critical-review pass over the whole file. Two persistent script-injection
sinks, one data-loss bug in the app's core object, and the last of the
dark-first colour debt.

### Security

- **The calculator history executed whatever you typed into it.** The history
  rows were built by interpolating the expression into `innerHTML`, and the
  expression is stored on the *error* path too — so it did not even have to be
  valid arithmetic. It was persisted verbatim, replayed by `addCalculator()` on
  every restore, and carried inside both `Backup` and `Download .html`. Since
  the whole point of the file is that you hand a copy to someone, that copy ran
  arbitrary script in the recipient's origin, where it could read every note in
  their `localStorage`. The CSP allows `'unsafe-inline'`, so it offered no
  mitigation. Rows are now built with `createElement` + `textContent`.
- **A renamed window title did the same thing from the nav tooltip.** Titles are
  user-editable (`contentEditable` behind the ✏️), persisted, and were
  interpolated into the tooltip's `innerHTML` — so the payload fired on nothing
  more than hovering a toolbar button. The tooltip's list is now built as real
  nodes.

### Fixed

- **Resizing a note was destroyed by the next reload.** A note's size lives on
  its `.textarea-container`; the window box is *derived* from it. Only the
  derived box was saved, so restore rebuilt the container at its hardcoded
  525×287 default, the `ResizeObserver`'s first callback recomputed the window
  from that default, and the debounced save then wrote the shrunken size back
  over the real one. An 880×560 note came back at 525×287 **and** lost its saved
  size permanently. The container's own box is now persisted and reapplied
  before the observer's first callback. Sessions written before this release
  keep the old behaviour rather than being resized to something arbitrary.
- **The Log window's rename did nothing.** `startRename()` looked for
  `.window-title, .task-title, .sticky-note-title`; the log's title is
  `.log-title`, so clicking its ✏️ threw on a null element and the exception was
  swallowed by the inline `onclick`. `endRename()` has had a dedicated `"log"`
  branch the whole time, so this was intended to work.
- **Ctrl+Shift+W on the Clock, Calculator or Log leaked state.** `closeWindow()`
  only removed the element, while the singleton bookkeeping lives in the
  `toggle*()` functions — so the toolbar button stayed lit as though the window
  were still open, and the clock's 1-second interval ran for the rest of the
  tab's life. Those three ids now route through the toggle that owns their
  state.
- **Zoom was never saved.** `setZoom()` and `zoomToFit()` both ended at the view
  update, and the wheel handler's save sits *after* its `if (e.ctrlKey) … return`
  — so Ctrl+wheel, the `+`/`−` buttons and `Fit` all reverted to 100% on reload,
  at a pan that *had* been saved. You came back somewhere you had never been.
- **A failed save was completely silent.** Above 4.5 MB `saveSession()` returned
  without a word, so every subsequent write — including the one on
  `beforeunload` — was a no-op while the app looked entirely normal, and the
  next reload dropped everything since the threshold was crossed. There is now a
  sticky **⚠ Not saving** badge and a one-time toast, cleared when a save
  succeeds.
- **An exported copy could burn its own payload.** The "already consumed" flag
  was written *before* the restore ran, so a restore that threw made the
  embedded session permanently unreachable — every later open took the
  already-consumed branch. It is now set only after the restore returns.
  Opening an export also no longer silently overwrites a newer session on that
  origin: the outgoing one is kept under `notepadSession.prev`.

### Accessibility

- **Windows can be moved and resized from the keyboard.** `makeDraggable` is
  pointer-only and the resize grip is `aria-hidden` with no tab stop, while CSS
  turns off native `resize` — so a keyboard-only user could create, lock,
  minimise and close a window but never move or size one. `Ctrl+Shift+Arrow`
  moves the active window, `Ctrl+Alt+Arrow` sizes it, both in 20px steps, both
  respecting the lock and the canvas clamp. Arrow keys inside a textarea are
  untouched.
- **The overview map answers the keyboard.** It advertised `role="button"` and
  sat in the tab order with only pointer handlers bound — reachable and
  completely inert, which is worse than not being focusable. Arrows now pan;
  Enter and Space fit every window on screen.
- **The timer no longer flashes the tab title under `prefers-reduced-motion`.**
  The CSS reduced-motion block cannot reach `document.title`, so the 14-second,
  20-cycle flash was the one piece of motion that ignored the preference
  outright. It now settles on a single title; the toast and the OS notification
  already carry the message.
- The calculator's result field had no accessible name — it is now labelled and
  announced politely.

### Contrast

Every one of these was measured live rather than eyeballed. The app now has
**zero** WCAG AA failures across all eight window types in both themes.

- **Calculator key hovers: 1.87:1 → 8.63:1 (dark), 4.66:1 → 6.92:1 (light).**
  Two legacy `:hover` rules at `(0,3,0)` out-specified the token rule at
  `(0,2,1)` — but only on `background`, so the modern rule still won `color`.
  Every operator key hovered accent teal on raw orange. Deleted; the token rules
  already cover both states.
- **Placeholders: 3.86:1 → 5.62:1 (dark), 3.24:1 → 4.73:1 (dark sticky note).**
  The app had no `::placeholder` rule *anywhere*, so every prompt in it fell
  through to the UA default `#757575` in both themes — under AA in the theme the
  app boots into. Now routed through `--text-dim`. `color-scheme` is also
  declared per theme so native widget chrome follows.
- **Completed tasks: 3.54:1 → 7.5:1 (light).** `#888`, hardcoded and never
  themed, so a ticked task was struck through *and* under-contrast.
- **Minimap blocks: 1.54:1 → ~4.6:1.** `--text-muted` at `opacity: 0.55` on a
  dim panel made the blocks — the map's entire payload — effectively invisible,
  so the map read as "one window exists".
- **Log row dividers** were `rgba(255,255,255,0.1)` with no light-mode override:
  white on white.

### Changed

- The overview map and the zoom widget now change layout at 720px, matching the
  toolbar's own breakpoint. Between 721 and 760px the map used to disappear
  while the toolbar was still bottom-anchored, for no reason.
- Exporting within the 3 seconds a toast is up no longer ships a file that opens
  with a blank status pill pinned top-centre and no timer to clear it.

### Known, not fixed

- On the big canvas a window can still be parked under the toolbar. The world
  clamp carries no toolbar band, because the toolbar is screen-fixed while
  windows live in world space — "under the toolbar" moves as you pan. It is
  recoverable by panning or by `Fit`, and a wrong fix here would break the
  drag-tracking maths, so it is left alone deliberately.

---

## [3.1.2] — 2026-07-28

### Added

- **Source link in the help window.** The help text now ends with a `Source`
  section pointing at `https://github.com/deokman420/cbapp`, so anyone handed
  a copy of the file can find where it came from. Plain text rather than an
  anchor — the help body is a `<pre>`, and a default-styled link would sit
  badly against the dark theme.

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
