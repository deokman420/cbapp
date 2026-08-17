# Changelog

All notable changes to CB App. Dates are the release date of the single-file
`cbapp.html` build.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [4.6.3] — 2026-08-17

Three reports from real hardware, and all three are the same kind of bug: the
app worked exactly as designed and *looked* wrong. Nothing here changes what a
control does.

### Fixed — the dot grid turned to noise on the way out

Reported at 62% on a phone: the canvas backdrop was distracting behind the
empty-desk text.

The grid is a fixed backdrop whose *spacing* is scaled by the zoom
(`background-size: 48px * zoom`) while its dot *radius* stays a flat 1.5px. So
zooming out does not shrink the pattern, it packs it — the dots keep their
weight and halve their distance, and the visible density rises as 1/zoom².
At 100% it is a calm grid; at 62% it is stipple; at 25% it is a texture.

The grid now fades as it packs. Full strength at 100% and above, easing to a
0.15 floor at the 25% minimum, on a squared curve — a linear fade was tried
first and still left 62% reading busier than 1:1, which is the case that was
reported. The floor is deliberate: a canvas with no grid at all stops reading
as a canvas.

Applied as an `opacity` on the grid element rather than by re-mixing the
`--canvas-dot` colour. Opacity is a compositor property, and this element
already repaints on every transform — the one thing v4.6.0 rebuilt the grid to
avoid making worse.

### Fixed — a square drawn on the hamburger, on a phone

Collapsed, the mobile toolbar is nothing but its own ☰ button. Both were
exactly 44px: the `.nav-menu` panel — 14px radius, 1px border, card fill, drop
shadow — with the `.nav-toggle` button — 8px radius, 1px border, card fill —
sitting inside it, edge to edge. Two boxes, one inside the other, with the
inner corners cutting across the outer ones. On a phone it reads as a square
scribbled onto the icon.

Collapsed on mobile, the container now gives up its skin — no background, no
border, no shadow, no backdrop blur — and the button *is* the FAB, rounded to
a circle to match `#session-lock` standing next to it. Scoped to
`.collapsed`, so opening the sheet puts the panel's chrome straight back.

### Fixed — blank Start and End boxes in the Time Card on iPad

Reported on an iPad: the two time fields showed nothing at all until they were
tapped.

Chrome draws an unset `input[type="time"]` as greyed `--:-- --` segments, so
you can see there is a control there and where to aim. **Safari on iOS and
iPadOS draws nothing** — an empty time input is an empty rectangle. With Start
and End stacked above a filled-in Break field, the panel looked broken rather
than blank.

There is no `::placeholder` for a time input and no pseudo-element that can be
filled in every engine, so the hint is ours: a `--:--` laid over the field and
hidden the moment it has a value or takes focus (a *focused* time input draws
its own segments everywhere, and two lots of `--:--` on top of each other is
worse than none). It is `pointer-events: none`, so the tap still reaches the
input underneath — that is asserted, because it is the one way this could have
made the field worse than the blank box it replaces.

The two fields moved into a `.time-shell` wrapper to carry the overlay. The
row still lines up on the same label column as every other `.calc-field`, and
that alignment is asserted too.

### Tests

Three gates under *three things seen, not driven* — the grid's opacity across
six zoom steps, the collapsed toolbar's chrome and corner radius, and the time
hint including the hit test and the clear-back-to-empty case. All three are
properties a suite that only drives the app cannot see, which is why all three
shipped.

---

## [4.6.2] — 2026-08-16

### Fixed — pinching the canvas on an iPad zoomed the whole page

Reported on an iPad (7th generation, iPadOS 18.7.5): two fingers on the canvas
scaled the page instead of the world.

Pinch-to-zoom on the canvas is two halves. The app's own handler tracks two
touch pointers and drives `view.zoom` — that half was never phone-only and ran
correctly on the iPad. The other half is `touch-action: none` on the canvas
layer, which is what stops the *browser* acting on the same two fingers first,
and it was keyed on `body.mobile-ui`.

`body.mobile-ui` answers "is this laid out as a phone". The question here is
"can a finger reach this", and those have different answers. **An iPad is 810px
wide in portrait and takes the desktop layout by design** — free, draggable
windows, toolbar along the bottom — so it never matched the rule. Both zooms
ran: the app scaled the world while Safari scaled the page on top of it.

The gate is `any-pointer: coarse` now, which is true whenever a touch input
exists at all, including a touchscreen laptop being driven with a mouse. Still
only on the canvas desk, which does not scroll — the windowed desk is
untouched, so pinch-zooming the page itself, which is an accessibility right
and the reason there is no `user-scalable=no` in the viewport meta, works
exactly where it did before.

**iOS Safari needed both halves separately.** `touch-action` stops the layer's
gestures becoming a scroll, but Safari also raises its non-standard
`gesturestart` / `gesturechange` / `gestureend` events for a pinch and will
still scale the page from them. Those are refused on the canvas layer, and only
while the canvas is on. No other engine fires them and loses nothing by the
listeners existing.

The `touch-action: pan-y` give-back — the exemption that keeps a note on the
canvas scrollable with a finger — moved with the rule it undoes, into the same
block. A layer at `touch-action: none` with nothing exempted is a canvas whose
notes cannot be scrolled, so those two must never drift apart again.

### Fixed — the iPad project was red, and two releases said otherwise

Found while running this release's suite. The `ipad` project added in v4.6.0
had ten failures from the moment it existed, and v4.6.0 and v4.6.1 were both
reported green. They were not.

The cause is the same confusion as the bug above, one level up. Ten tests in
the phone-layout suites gate on Playwright's `isMobile` fixture as a stand-in
for "this project gets the phone shape" — which held for exactly as long as
every touch project in the config was a phone. **Playwright calls an iPad
`isMobile`; the app does not.** So phone-layout assertions ran against a
tablet's desktop layout and failed on every one of them.

The gate is now `phoneShaped(isMobile, viewport)`, a single helper restating
all three clauses of the app's own breakpoint, with `isMobile` used for the one
thing it does answer — whether the pointer is coarse. The desktop-half block
uses the same predicate inverted, so no shape can fall between them and go
uncovered. One test in that block genuinely needs a *mouse* rather than a
desktop layout — it narrows the window to 700px and asserts the app stays
desktop, which is false for a finger — and says so explicitly now.

The six desktop pixel baselines were also stale, from the toolbar moving to
`bottom: 56px` in v4.6.0. Re-recorded, and verified by running twice. The phone
baselines are untouched, which is the right answer: that change was desktop-side.

---

## [4.6.1] — 2026-08-16

### Fixed — the top of the app was behind the clock

Reported from an installed iPhone 13 Pro Max: the note's title bar, its pencil
and its close button were drawn underneath the system clock and the battery.

CB App asks for the pixels behind the status bar on purpose — the viewport is
`viewport-fit=cover` and the status bar style is `black-translucent`, so the
desk background runs to the top edge of the phone rather than stopping at a
grey band. That makes the safe-area inset load-bearing rather than decorative,
and a full-bleed window is offset from the top by one variable, `--stack-top`.

`--stack-top` was the height of the **window-tab strip**, and the tab strip
only exists when there is more than one window to switch between. With one
window open — which is how every fresh install starts — it was zero, and the
window began at y=0. On a 47px inset the title bar sat 22px inside it.

The inset is a floor under that variable now. The tab strip is what varies; the
notch is not, and it was never the switcher's business.

**The same bug on the other axis, fixed with it.** Turn a notched iPhone
sideways and the inset moves to the left or the right. Windows were
`left: 0; width: 100%`, so a note's line-number gutter sat permanently behind
it. They are inset on both sides now; on a phone without a notch every one of
these numbers is zero and the geometry is unchanged.

### Added — a notch can be tested

Nothing emulates a safe-area inset: not Playwright, not the Chrome or WebKit
device profiles, and `env()` cannot be set from script. This class of bug was
invisible to all nine projects and reachable only on a physical phone, which is
exactly how it was found.

So the three insets are named once, in custom properties on `<body>`
(`--safe-top`, `--safe-left`, `--safe-right`, each `env(…)` with a `0px`
fallback), and read from there. Overriding them reproduces a notch on any
device, and the new tests do precisely that — including the "one window, no tab
strip" shape that was reported.

---

## [4.6.0] — 2026-08-16

### Fixed — there are two layouts, not four

Reported from a 641px-wide window: the toolbar was at the top. It is at the
bottom on a desktop and at the bottom on a phone, so that was a third place for
it to be.

CB App has exactly two shapes. **Desktop** — windows you drag, toolbar
bottom-centre. **Mobile** — windows full-bleed, toolbar a sheet, also at the
bottom. Which one you get is one boolean, written by one media query:
`(max-width: 720px) and (pointer: coarse)`, plus a clause for a short landscape
phone and a floor at 560px for any window that narrow.

The CSS did not agree with it. A `max-width: 720px` block top-anchored the
toolbar and flipped the status toast, the search panel and both banners to the
bottom to get out of its way — on **width alone**, with no pointer test. So a
mouse-driven window between 561 and 720px got neither shape: a top bar over
free-floating windows. A `max-width: 600px` block did the same thing 40px
further down, which made a fourth.

The bar stays where the desktop puts it now and only *wraps* when it is narrow.
Everything those blocks shoved to the bottom stays at the top, because the top
is empty again. The rules a phone genuinely needs — the banners and the
minimised chips going above the bottom chrome — moved to `body.mobile-ui`,
where the rest of the phone layout already lives.

**That last move fixes a phone bug on the way past.** A rule keyed on width
does not fire on a phone in landscape, which is 802px wide. The lock banner and
the minimised chips had been sitting on top of the window switcher and the
toolbar pill in that orientation. Third time this file has been bitten by the
same thing; the note above the rules now says so.

### Fixed — the toolbar ran off the screen between 721 and 960px

Found while pinning the above down with a width sweep, and older than the bug
that started it. The desktop toolbar is `width: max-content` — 940px with
today's twenty buttons — and centred. Below about 956px it does not shrink, it
overhangs: **measured at 721px, its left edge was at −109px**, with the whole
Create group off the side of the screen and no way to reach it. The old 720px
breakpoint stopped one pixel short of the band where this happened, and the
top-anchored layout under it hid the rest.

The bar wraps below 1000px now — the bar's own width plus margins, rounded up,
not a device size. Add a button and raise the number with it.

### Fixed — the download chip covered the last two toolbar buttons

Same sweep. The lock button, the minimised chips and the download chip all
stand in a 56px band along the bottom edge at `z-index: 1001`; the toolbar sat
at `bottom: 10px` at `z-index: 1000`, reaching into it. At 1280px that showed
as the chip clipping the toolbar's corner. Between 1001 and about 1318px it
covered **Canvas** and **Reset** outright.

The bar sits at `bottom: 56px` now, clear of the band at every width, which
needs no arithmetic against the chip — whose width is a label and therefore not
a number worth positioning against.

### Added — iPads are tested

They were not, in any orientation. Two projects, because a tablet lands on both
sides of the 720px boundary depending on which one you pick: **iPad Pro 11** is
834px in portrait and gets the desktop shape with a touch pointer, and
**iPad (gen 11)** is 656px in portrait — the phone shape — crossing to desktop
the moment it is turned. That pair is the only thing in the suite that changes
layout by rotation alone.

Nine Playwright projects now, and the new layout suite asserts position rather
than pixels: bottom-anchored at every width, on screen at every width, and no
toolbar button underneath a corner chip.

---

## [4.5.2] — 2026-08-16

### Fixed — the Time Card's clock reads like a clock

`09:00  AM` with gutters in it. The Time Card's start and end are
`input[type="time"]`, which Chrome draws as separate hour, minute and AM/PM
segments with a literal space between the last two — and every calc field
inherited the app's monospace face, where each of those advances is the widest
the font has. The native picker popup inherits the input's font too, so its
columns of numbers were spaced the same way.

The two time fields render in the UI font now. Everything else in a calculator
panel stays monospace: those are fields the app draws text into, and columns of
digits that line up are the reason the mono face is there at all. A time input
draws its own text, in segments, and never lines up with anything.

### Fixed — two console warnings on every open

`Manifest: property 'start_url' ignored, URL is invalid`, and the same for
`scope`. The manifest is assembled at runtime and handed over as a blob: URL,
because this app is a single file with nothing serving alongside it — and a
relative URL inside a manifest resolves against *the manifest's* URL, not the
document's. There is no directory to walk up from `blob:…`, so `"."` was
silently dropped both times.

Both are absolute now, taken from `location`: start_url is the page, scope is
the directory holding it.

From `file://` the manifest is not installed at all. A blob from a file://
document has the opaque origin `blob:null/…`, which makes every URL in it
cross-origin no matter how it is written — and an install prompt needs a secure
origin, which `file://` is not. It was announcing a failure to do something it
could never have done. The hosted copy at phbeks.com/cbapp.html is unaffected
and still installs.

---

## [4.5.1] — 2026-08-16

### Fixed — the history list belongs to one calculator at a time

Reported within an hour of v4.5.0: `7:15 - 5:30 = 1:45 (1.75 h)` showing under
the Energy Cost panel.

v4.5.0 shipped a single unfiltered scrollback on the theory that a shift total,
an energy cost and a conversion in one list was useful. On screen it is not.
The list sits directly beneath the panel with nothing between them, so a row
from the expression calculator reads as the Energy Cost fields' own answer —
and there is no way for the reader to work out that it is not.

Every row is stamped with the calculator that produced it, and the view is
filtered to the one showing. The heading above the list names it
("Energy Cost history"), because an empty list is otherwise ambiguous between
"nothing yet" and "something broke". Switching type swaps the list; nothing is
lost by switching away, and switching back brings it straight back.

**Clear History clears what is on screen** — this calculator's rows and not the
other four's. A button that wipes work you cannot see is worse than one that
needs pressing twice.

The stamp rides the session, so rows land back under the right calculator after
a reload. Sessions written before this release carry no stamp; those rows can
only have come from the expression calculator, which was the only one there
was, so they are read as Standard rather than disappearing into a list nothing
can reach.

Also folded in: the Standard calculator pushed straight at the history array
instead of going through `calcRecord`, which made it the one result that could
outrun `MAX_HISTORY`. It goes through the same path as every other mode now.

---

## [4.5.0] — 2026-08-16

### Added — the Calculator is five calculators now

The Clock has a dropdown that changes what it shows. The Calculator gets the
same control, for a better reason: the toolbar has no room for five more
buttons, and the arithmetic this app kept being used as a staging post for is
worth doing properly.

Pick a **Type** at the top of the window:

- **Standard** — the expression calculator, unchanged, times included (v4.4.0).
- **Time Card** — a start, an end and a break in minutes. *Add shift* keeps a
  running list with the total in both h:mm and decimal hours. An end before the
  start is read as overnight, which is the case the panel exists for: 22:00 to
  06:15 is 8:15, not a negative number. A break longer than the shift is
  refused rather than added, because a negative row in a total someone gets
  paid from is the worst failure this could have. The list is saved with the
  session.
- **Energy Cost** — watts, hours per day, days, rate per kWh. Returns the kWh
  used, the cost, and what that comes to per day and per year. The `/1000` is
  the step people get wrong by a factor of a thousand; it happens here.
- **Ohm's Law** — fill in any two of volts, amps, ohms and watts, press Solve,
  and the other two are worked out *and written into the empty boxes*, so the
  panel reads as a finished circuit. All six pairs are written out rather than
  derived — the square-root cases (R and P) do not fall out of a generic solver
  and getting one wrong is silent.
- **Liquid Volume** — US gallons, imperial gallons, litres, millilitres,
  quarts, pints, cups, fluid ounces and cubic metres, any one to any other.
  Both gallons are here and both are named: "gallon" alone is a 20% error
  between the two systems.

**They share one history and one Clear History button.** A shift total, a
kilowatt-hour cost and a gallons-to-litres conversion in the same scrollback is
the point — the window is a worksheet, not five tools that happen to overlap.

**Enter submits whichever panel you are standing in**, so none of them is
mouse-only.

### The extension point is the registry

`CALC_MODES` is a list of `{ id, label, panel }`. Adding an entry and a handler
gets you the dropdown option, the panel, the show/hide, the saved-mode
allowlist and the restore path with no further edits — the request that
produced this release ended "and others", and the next one will too. The test
suite asserts the registry rather than a hard-coded list of five, so a sixth
calculator is covered the moment it is added.

### Session

The chosen type and the Time Card's rows ride the session, Protect and Backup.
Field values do not: a half-typed voltage is not worth carrying across a
reload, a week of logged shifts is. A saved type this build has never heard of
opens on Standard rather than showing an empty window, and a shift row that
does not parse is dropped rather than failing the whole import.

---

## [4.4.0] — 2026-08-16

### Fixed — narrowing the browser no longer eats the layout

Split a Chrome tab, snap the window to half the screen, or drag the tab edge
in, and every open window slid toward the top-left and stayed there. Widening
it again gave nothing back. It is the same symptom devtools produced before
v4.2.0, arriving by a different route — and this time the cause is not the
phone breakpoint at all.

`clampWindowIntoView()` runs on every viewport resize and pulls anything
hanging off the edge back into view, which is correct. What was wrong is that
it wrote the result back to `dataset.x/y` — the *only* record of where the
window was. A 640px viewport cannot hold a note at x=900, so the clamp moved
it; the coordinate it moved was also the coordinate it would have needed to
put it back. Each resize event overwrote the layout with a squeezed version of
itself, and a save from a narrow window carried that into the session and into
Backup.

So position and *intent* are two fields now. `dataset.homeX/homeY` is where
the user put a window — a drag, a keyboard nudge, a placement, a restore.
`dataset.x/y` is where it currently is. The clamp reads home and never writes
it, which makes it a projection rather than an edit: idempotent, and reversed
the moment the width comes back. What goes into the session is home, for the
same reason `measuredBox()` refuses to persist a phone's full-bleed size.

### Added — the calculator does time

The team using this app tracks time, and the calculator could not do the one
piece of arithmetic that job is made of: `7:30 - 6:15` had to be converted to
minutes by hand, subtracted, and converted back. Every one of those steps is a
chance to be wrong about an hour someone gets paid for.

Values now carry a unit as well as a number, and the operators mean what they
should:

```
7:30 - 6:15   = 1:15 (1.25 h)      what a shift actually came to
1:30 + 0:45   = 2:15 (2.25 h)
1:30 * 3      = 4:30 (4.5 h)       three of them
7:30 / 3      = 2:30 (2.5 h)       split three ways
7:30 / 1:30   = 5                  how many fit
```

- **Both readings, always.** A time answer is shown as `1:15 (1.25 h)`.
  Timesheets take decimal hours, clocks and stopwatches do not, and neither
  conversion should need a second trip through the calculator.
- **Both entry forms too.** `90m` and `1.5h` are durations, and `h:mm:ss` is
  accepted so a stopwatch reading can be pasted in as it stands. Durations are
  held in seconds internally, so `7:30 / 3` lands on 2:30 rather than on a
  rounded remainder.
- **The nonsense combinations are refused, not guessed.** `8:00 + 2` is two of
  what? `0:30 * 0:30` is an area of hours. Each throws with a sentence naming
  the fix, and the display shows that sentence instead of a bare "Error" —
  which is a change to the error path generally: `5/0` now says "Division by
  zero".
- **The 0 key gave up its double width for a `:` key.** A colon is otherwise
  unreachable on a touch keypad, and h:mm is the entry mode this calculator is
  used in most. Tapping it into an empty field types `0:`, because `:30` is not
  a time and `0:30` is.
- **Plain arithmetic is byte-for-byte unchanged.** An expression with no time
  literal and no unit suffix takes the path it always took: `2+3*4` is 14,
  `10/4` is 2.5, `√9` is 3.

### Tests

Nine new assertions across five tests: the full operator table including every
refusal, a shift worked end to end through the real window, the `:` key, and
two geometry tests that narrow the viewport to 700px and assert both that the
layout comes back and that the squeeze never reaches the session.

---

## [4.3.0] — 2026-08-16

### Changed — the calendar window looks like the rest of the app now

The engine is untouched: the store, the recurrence maths, the alert scheduler
and every id in the window are the same. What changed is the surface, which
had quietly grown its own dialect.

- **Buttons.** Every other button in this app is a pill that lights up on
  hover. The calendar's nine were 8px boxes with no `:hover` rule anywhere —
  the whole window was inert under a mouse. They are pills now, Add event
  wears the accent-dim fill the Log window's Add button wears, and the two
  month arrows are circles sized to be a hit area rather than a glyph.

- **Row actions were emoji in boxes.** ✏️ and 🗑 each sat inside a bordered
  button, which made every event row three competing rectangles. They are bare
  glyphs now, like `.log-delete` one window over: `--text-dim` at rest,
  `--accent` and `--danger` on hover.

  🗑 also had to go on its own merits. U+1F5D1 is an astral symbol with TEXT
  presentation by default — the same class of character as the U+1F5D5 that
  shipped as an invisible minimise button on every iPhone in v4.2.3. Delete is
  `×` now, and a new test holds the row to the same glyph allowlist the window
  controls answer to.

- **One class was doing two jobs.** The search + Add row and the "Saturday,
  August 15" heading were both `.cal-section-head`, so the toolbar inherited
  11px uppercase dim heading type and neither could be restyled without moving
  the other. The toolbar is `.cal-toolbar`.

- **The day grid.** Hover tints the cell instead of only ringing it — a ring
  read as a weak second selection next to the solid accent fill that means
  selected. Today is the ring *and* the number in `--orange`, because one
  hairline among six rows of identical cards disappeared the moment a
  neighbouring cell was hovered.

- **Repeat and reminder were a mono string** pinned to the right edge
  (`⟳ weekly  ⏰ -10m`), which on a narrow window sat on top of the row's own
  buttons. They are chips under the title now, on the same line as the text
  they describe, and they wrap. The reminder chip is `--accent`, not
  `--orange`: `--orange` is legible on the dark card but measures under 2:1 on
  the light theme's, and this is 10px text.

- **The event count** ("2 events") is on the day heading, and the empty state
  is the centred muted line `.log-list:empty::before` already uses instead of
  the only italic text in the app.

- **The form is captioned blocks**, not label-then-control on one line. The
  inline version wrapped mid-pair at any width the window can be dragged to:
  "min before" ended up on the row below the number box it belongs to. Save
  and Cancel are right-aligned and pinned to the bottom of the pane, so the
  form can be longer than the window without hiding its own commit button.

- **The scrollbar.** `.cal-lower` was the one scrolling region in the file that
  never joined the shared accent scrollbar treatment.

- **Phone sizing.** Nothing in this window had ever been measured for a finger:
  34px cells and 26px buttons on a screen where the floor is a 375x667 iPhone
  SE. Cells are 42px in portrait, the controls clear 42px, and on a landscape
  phone — where a month grid and an agenda cannot both fit in 309px of window —
  the cells drop to 32px and the month bar sticks to the top of the scroll so
  "which month is this" stays on screen.

### Fixed

- **The calendar opened partly underneath the toolbar.** Its default height was
  a flat 640px; on a 1280x720 screen the band between the top of the page and
  the top of the floating toolbar is ~576px. `placeWindow()` already routes
  *around* the toolbar but cannot shrink a window taller than the space it is
  routing into, so the bottom ~64px — which is where the add/edit form's Save
  and Cancel live — sat under it, and the toolbar ate the clicks. The height is
  clamped to the band it is placed in, with a 420px floor.

### Added

- **A real home-screen icon on iOS and Android.** Saved to a phone's home
  screen, CB App had no icon of its own: iOS fell back to a screenshot of
  whatever was on screen when you saved it, and Android drew the 24px SVG
  pencil favicon scaled up into a mess.

  The icons cannot be files. This app is opened from `file://` on a machine
  that serves nothing alongside it, so `href="icon-180.png"` resolves to
  nothing — every icon travels inside the HTML as a base64 PNG. Three
  `apple-touch-icon` rungs (180/152/120) in `<head>`, and 192/512 plus a
  512 maskable in the manifest.

  The art is generated, not hand-written: `scripts/make-cbapp-icons.mjs`
  draws it as SVG and rasterises it with the Chromium the test suite already
  installs. Edit the script and re-run it; never edit the base64.

  Two details that are not cosmetic. The nib is `--orange`, not paper white —
  it sits *on* the page in the drawing, and at 120px a near-white wedge on a
  near-white page made the pencil look snapped off. And the maskable variant
  is the same drawing at 60%, because Android crops to whatever shape the
  launcher uses and a circle mask takes the corners of the full-bleed art.

- **A web app manifest, built at runtime.** Same constraint: it cannot be a
  second file, so the JSON is assembled in the page, turned into a `blob:`
  URL and linked from `<head>`. That is the one CSP change in this release —
  `manifest-src 'self' blob:`, in both the meta tag and `vercel.json`.
  Installing now gives a standalone window named CB App rather than a browser
  tab named after the file. If the blob is refused, the catch swallows it: an
  install prompt is the least important thing this file does.

### Changed

- **`theme-color` was `#007bff`** — a stock bootstrap blue that appears
  nowhere in the palette. It is `--bg` now, and `setThemeClass()` rewrites it
  when the theme changes, because the theme here is a class the user picks and
  a `prefers-color-scheme` media attribute would answer the wrong question.

- `toggleTheme()` now goes through `setThemeClass()` instead of adding and
  removing the classes itself, which is what the invariant on that function
  already claimed.

---

## [4.2.4] — 2026-08-16

### Fixed

- **The on-screen keyboard covered the bottom of the note you were typing
  into, on iOS only.** A full-bleed window keeps its own controls along its
  bottom edge — the format row and the word count on a note, the Log button,
  the calculator's last row. Tapping into the textarea raised the keyboard
  over exactly those, and nothing moved out of the way.

  Android was never affected, and the reason is the whole shape of the bug:
  `interactive-widget=resizes-content` in the viewport meta makes the keyboard
  shrink the layout viewport there, so `window.innerHeight` drops and the
  existing CSS already had the right number. iOS Safari ignores that hint
  entirely — the keyboard is an overlay, `innerHeight` never moves, and the
  app had no idea the bottom third of the screen was gone.

  The difference between the two viewports *is* the overlay:
  `innerHeight - visualViewport.height - offsetTop`. That resolves to ~0 on
  Android, where both shrank together, and to the keyboard's height on iOS —
  one formula, no platform branch, no user-agent sniff. It is published as a
  third screen-dividing variable, `--keyboard-inset`, alongside the
  `--stack-top` and `--stack-bottom` that already existed, so the windows and
  the bottom chrome each subtract it in one place instead of doing the
  arithmetic twice.

  Two traps are handled explicitly. Pinch-zoom also shrinks the visual
  viewport, and this app deliberately permits zoom — v4.2.1 fixed the tap-zoom
  bug by raising the font size rather than by locking the page down, because
  locking it down is the inaccessible fix — so anything but scale 1 is
  ignored. And iOS reports its own bottom browser toolbar in the same gap, a
  standing ~50px that is not a keyboard; a 100px floor keeps that from
  shrinking every window forever.

### Testing

- Playwright cannot raise a real keyboard on any project, so three new tests
  reproduce iOS's *shape* instead: redefine `innerHeight` taller than the
  visual viewport and fire the `visualViewport` resize the app listens for.
  That tests the handler rather than the platform — it cannot prove iOS
  reports what we think it does, only that the layout responds correctly when
  it does.

  **Confirmed on a real iPhone against the shipped build**, which is the half
  the suite structurally cannot reach: the formula assumes iOS leaves
  `innerHeight` alone while the keyboard is up, and no emulator here can
  falsify that. This is the same boundary that let the v4.2.1 tap-zoom and
  v4.2.3 invisible-glyph bugs ship — a device pass is the last step of an iOS
  fix, not an optional extra.

- New `iphone-se` project at 375x667 — both the narrowest and the shortest
  portrait shape in the matrix, where everything else is 393px or wider and
  727px or taller. It found no new failures, which is itself worth recording.
  Note it is the 3rd-gen descriptor: Playwright's plain `iPhone SE` is the
  2016 original at 320x568, below the app's own 560px CSS floor.

- Two axe states that no scan reached before: the mobile toolbar sheet while
  it is open, and the window switcher strip. Every other a11y test goes
  through a helper that opens the sheet, clicks, and lets the auto-collapse
  fold it again before the scan runs, so the expanded sheet had never been
  looked at; the switcher only renders at two or more windows, and no test
  opened two. Both were clean — the point is that they stay that way.

---

## [4.2.3] — 2026-08-16

### Fixed

- **The minimise button was invisible on every iPhone, in every window and
  every mode — and still worked when tapped.** The glyph was U+1F5D5, a bare
  astral symbol with *text* presentation rather than emoji presentation. iOS
  ships no font covering it, so it rendered as empty space over a button whose
  touch target went on working perfectly. Invisible and fully functional is the
  hardest kind of missing: nothing looks broken, there is just nothing there.

  It is `−` (U+2212) now, which every platform can draw and which pairs with
  the `×` already used for close. The other three controls were never at risk —
  `×` is BMP, and `✏️` and `🔓` carry emoji presentation.

  Nothing in the suite could have caught this by rendering: this machine's
  WebKit resolves U+1F5D5 out of a Windows font, so it drew correctly here and
  vanished on the device. The guard is an allowlist instead — every window
  control glyph must be a BMP symbol or carry emoji presentation, and adding to
  that list is meant to be a decision made with an iPhone in hand.

---

## [4.2.2] — 2026-08-15

### Changed

- **The Download chip moved into the toolbar sheet on a phone, version and
  all.** The bottom edge of a phone had the sheet, the lock button and the
  download chip all competing for it, and the chip is the least urgent of the
  three — it saves a blank copy of the program, not your notes. In the sheet it
  is a full-width row at the bottom of *Session*, which also makes the version
  legible instead of a 10px suffix in a corner.

  It is moved, not duplicated: it carries `#download-app-version`, and two
  nodes with one id is not a thing. It is restored against a placeholder rather
  than a remembered parent, because a copy downloaded *from* a phone has the
  chip inside the nav in its saved markup, and a remembered parent would
  faithfully put it back there on a desktop. The download itself also writes
  the chip back to its canonical spot, so a saved file does not record which
  device exported it.

### Fixed

- **The window title-bar controls failed WCAG AA contrast — badly in light
  mode.** The rename, minimise, freeze and close glyphs used `--text-dim`,
  which measured **4.52:1** on the dark title bar: over the 4.5 line by two
  hundredths, close enough that engines disagreed about it. axe passed it on
  Chromium and failed it on every WebKit build, and that disagreement is the
  "long-standing `.minimize-window` contrast failure" that kept the
  accessibility suite pinned to a single project for months. In **light** mode
  the same token was far worse — and nothing was catching that at all, because
  the suite only ever scanned dark.

  They use `--text` now, and the accessibility suite runs on every project
  again: **72 checks across desktop, both phone orientations, iPhone, Firefox
  and WebKit**, where it had been 12 on desktop alone. These are the controls
  that close and freeze a window; they are worth being able to see.

---

## [4.2.1] — 2026-08-15

### Fixed

- **iOS zoomed the whole page the first time you tapped a text field, and
  stayed zoomed.** Safari on iOS zooms in whenever a focused field's computed
  font-size is under 16px — and the zoom persists after the field is dismissed.
  Every text field in this app was 12–14px, so the first tap into the
  passphrase box left the app rendered wider than the screen with its
  right-hand edge off it, including that modal's own Unlock button. Every field
  is 16px in the phone shape now; `user-scalable=no` would also have stopped it
  and is not on the table, because pinch-zoom is an accessibility right.

  The line-number gutter moved with the textarea it numbers — same size, same
  line-height — or it would have drifted a little further out of step with
  every line down the note.

  This was invisible to the whole test suite. Chromium does not do it, so both
  Pixel projects passed while a real iPhone was unusable, and it is invisible
  to a layout assertion too: the DOM lays out correctly at 428px and reports no
  overflow at all. Playwright now has an `iphone` project (WebKit, iPhone 12
  Pro Max) and a test that asserts no field is under 16px.

- **The search panel covered the toolbar sheet on a phone.** Both moved to the
  bottom edge in v4.2.0 and `#search-replace` sits at z-index 2400 — above the
  sheet *and* above its scrim — so opening search and then reaching for the
  toolbar left the sheet's lower buttons unclickable. It goes behind the scrim
  with everything else while the sheet is open. Found by the new iPhone project
  on its first run.

---

## [4.2.0] — 2026-08-15

CB App has always been shaped for one screen: a wide desktop in the Island
browser. Opened on a phone it technically worked and practically did not — the
toolbar's twenty buttons wrapped into four rows and ate a quarter of the
screen, and the windows underneath were 557px wide on a 393px display, so their
own close and minimise buttons sat past the right edge with no way to reach
them.

This release gives the app a second **shape**. Desktop is byte-for-byte
unchanged and is asserted to be, by a test block whose entire purpose is to
fail if any of this leaks out of the breakpoint.

### Added

- **A phone shape.** Below the breakpoint the app sets `body.mobile-ui` and
  behaves differently in three ways: the toolbar rests collapsed as a bottom
  sheet, windows are full-bleed and stacked rather than floating, and a strip
  of tabs along the top switches between them.

  `stackMode()` — mobile *and* the windowed desk — is the state in which
  windows are full-bleed. The canvas desk is deliberately excluded: windows
  there are placed in world coordinates and reached by panning, and making them
  full-bleed would leave the pan/zoom transform with nothing to move.

- **The toolbar as a bottom sheet.** Collapsed it is a 44px hamburger pill in
  the bottom-left corner — thumb-reachable, and about 6% of the screen where
  the wrapped bar was 25%. Expanded it is a labelled sheet: the four button
  groups, which on desktop read as groups only because vertical rules separate
  them, print their own names when stacked. It closes itself after any action,
  on a tap outside, and on Escape.

- **A window switcher.** Full-bleed windows are opaque and cover each other
  completely, so `#stack-tabs` lists every window on the desk and marks the one
  on top. It carries minimised windows too, which is why `#minimized-bar`
  stands down on a phone: two bars listing overlapping sets of the same windows
  is worse than one listing all of them. It appears at two windows, or at one
  that is minimised and would otherwise be unreachable.

- **The minimap, on a phone.** It was hidden outright below 720px, and a
  phone is the shape that needs it most: the canvas is three viewports wide,
  one finger pans a fraction of it at a time, and there is no wheel, no
  space-drag and no scrollbar. A window panned off-screen was findable only by
  dragging until it came back. It sits in the top-right corner and is a jump
  target, same as on desktop — tap or drag it and the view follows.

  It is scaled to fit a BOX now rather than to a fixed width. Width alone was
  fine while the only client was a desktop, where the world is wider than it is
  tall and 168px across yields ~95px down; on a portrait phone the world
  inherits the viewport's aspect and the same 168px came out ~360px tall, 43%
  of the screen, over the canvas it exists to help you read. A desktop's box
  has no height limit, so the width is still the binding constraint there and
  the map is unchanged.

  The zoom widget moved to the top-left to make room, which also fixed a
  collision the map exposed: the widget's narrow-screen position lived in a
  `max-width: 720px` block that a landscape phone (802px) does not match, so it
  had stayed at the desktop's top-right. The four corners of a phone canvas are
  now zoom widget · map · toolbar pill, lock and chips · download chip.

- **Pinch to zoom the canvas.** Ctrl+wheel is the trackpad pinch and a phone
  has neither; two fingers arrive as two pointers and nothing else.
  `wireCanvasInput()` now tracks them and zooms around their midpoint, exactly
  as the wheel zooms around the cursor. One-finger panning on the background
  already worked — a touch pointer reports button 0.

- **Both phone orientations are real gates now**, not courtesy runs:
  `npm run test:cbapp:mobile` runs Pixel 5 and Pixel 5 landscape. Before this
  release 19 of portrait's 110 tests failed; the whole suite passes on all five
  projects.

- **A `CB App — layout` block that runs everywhere.** It asserts that no window
  hides its own contents (`scrollHeight > clientHeight` on an `overflow: hidden`
  box is invisible, unreachable content), that a new window opens somewhere you
  can see it, and that nothing pushes the page sideways. Those three catch the
  note-height and window-placement bugs below on *every* project, including the
  desktop where one of them had been shipping for a long time.

- **`npm run test:cbapp:visual`** — pixel baselines for six states across
  desktop and both phone orientations. Deliberately outside the default gate:
  a baseline PNG only matches the platform that recorded it. Refresh with
  `-- --update-snapshots`.

  Its first tolerance, 2%, was worse than useless — 2% of a landscape shot is
  ~4700 pixels, more than the entire hamburger button, so it reported green
  while that button was missing from the sheet. It is 0.2% now. A tolerance
  that cannot see a missing control is not a test.

### Fixed

- **A new window was placed underneath the open toolbar, off the bottom of the
  screen.** `canvasBounds()` treats the toolbar as a region to place windows
  *around*, which is right for a bar that is always there and wrong for a sheet
  that is not. The sheet is still open while the button's own handler runs — the
  auto-collapse is a bubbled listener, so it fires after — and a 400px-tall
  sheet measured at that moment reads as an obstacle covering most of the
  screen. Every window opened from the toolbar landed in the strip below it,
  and on the canvas nothing pulls it back. The toolbar is no longer treated as
  an obstacle on a phone; the standing chrome is reserved in CSS instead.

- **`body.className = "dark-mode"` wiped the layout.** Reset, and a boot with
  nothing in storage, both wrote the whole class list to set the theme. `<body>`
  also carries the canvas classes and now the shape, so a Reset on a phone
  silently dropped the mobile layout until the breakpoint was crossed again —
  which on a phone is never. Both sites go through `setThemeClass()`, which
  writes the theme token and nothing else, the way the restore path already
  did.

- **The tab strip was nearly named `#window-switcher`.** Notes are `#window1`,
  `#window2`, … and the canvas layer is `#windows`, so `[id^="window"]` is an
  established way to reach "every note" in this file and in the spec. A chrome
  element in that namespace was picked up as the newest note. It is
  `#stack-tabs`.

- **The scrim sat on top of the sheet for the first 150ms.** `.nav-menu`
  carries `transition: all 0.3s ease` and z-index is an animatable integer, so
  opening the sheet interpolated 1000 → 1004 discretely and held the old value
  for the first half — long enough that the first tap after opening the toolbar
  hit the scrim and closed it again. Nothing about the sheet is worth animating
  on a phone; the transition is off there.

- **Every note in the app clipped its own word count, on every screen.**
  `updateWindowSize()` summed a note's height as header + 22 + buttons + counts
  + logInput, where 22 was "padding plus borders" — and silently omitted the
  three 10px gaps `.window-content` puts between its four children. Every note
  was therefore sized 30px shorter than its own contents, and since `.window`
  is `overflow: hidden` the shortfall was not merely ugly, it was invisible and
  unreachable with no scrollbar to say so. It predates this release by a long
  way and was only *noticed* on a phone, where the same 30px is a much larger
  share of the window. Both that function and `setMaxDimensions()` now measure
  the chrome (`noteChromeHeight()`) instead of adding up constants.

- **A new window on the canvas was placed underneath the chrome.**
  `canvasBounds()` reserved a flat 46px at the top of a phone screen — enough
  for the 38px zoom widget and nothing like enough for the minimap, which is
  132px tall on a portrait phone. A new window landed with its own freeze and
  close buttons under the map: the one control that cannot be moved out of the
  way, because it is how you find the window again. The band is measured off
  the real chrome now, and a new window is sized to the band it will be placed
  in rather than to the viewport.

- **A phone in landscape got the desktop app back.** ~802x293 is wider than
  720px, so the first version of the breakpoint did not match it: the
  twenty-button toolbar reappeared, over the top of a note it now overlapped —
  the exact layout this release exists to remove. See the breakpoint note under
  Changed. `mobile-landscape` is a Playwright project now, so the next one gets
  caught.

- **A restored note was capped to the size of the screen instead of the
  canvas, and had its bottom cut off.** `view.on` is restored *after* the loop
  that rebuilds the windows, so for the whole of that loop `sizingBasis()`
  answered with the viewport rather than the world — and `setMaxDimensions()`,
  which runs inside every `add*()`, wrote each note an inline `max-height`
  sized for a phone screen instead of for a three-viewport canvas. On a
  landscape phone that capped a 400px note at 322px and hid 78px of it behind
  `overflow: hidden`, with no scrollbar to say so. The visible symptom was the
  word count jammed against the bottom border.

  It looked intermittent because each container's ResizeObserver fires its
  first callback after the restore returns, by which time `view.on` is true,
  and that recomputes everything correctly. The bug was a race against the
  observer's schedule — one that both emulated engines win every time, which is
  why it reproduced on a real phone and nowhere else, and why resizing the
  window always appeared to fix it. Restore now re-derives each note's box once
  the view is final, rather than leaving it to the observer.

  Not phone-specific underneath: with the observer stubbed out, the same test
  fails on desktop with 127px of the note cut off.

- **The minimap's window blocks did not follow a viewport change.** The map
  has two update paths: `applyView()` repaints the viewport frame and re-sizes
  the map box, while the blocks inside are rebuilt on a separate debounce fired
  by add / close / minimise / restore / drag / resize-of-a-window. A viewport
  resize is none of those, so the blocks kept the pixel positions they were
  given under the OLD world while the map around them was rescaled to the new
  one. Rotating a phone put every block in the wrong place at the wrong size
  until you happened to touch a window. Latent on desktop — resizing the
  browser with the canvas open is rare — and confirmed there too by the test
  that now covers it.

- **A note's word count lost the space under it on a landscape phone.** The
  short-screen rule that tightens a note to fit a 293px-tall screen took 4px
  off all four sides of `.window-content`, and the bottom one is against an
  edge where its absence shows: the count all but touches the border, which
  reads as the padding having been dropped rather than reduced. The 20px still
  comes out of the three inter-row gaps and the top, none of which are against
  an edge, and the bottom stays at 10px in both orientations.

- **The status toast painted as a giant blob across a landscape phone.**
  `#status` is top-anchored by default (`top: 18px`) and the rule that flips it
  to bottom-anchored lives in a `max-width: 720px` block — which a phone in
  landscape (802px) does not match. The mobile rule set only `bottom`, leaving
  BOTH offsets non-auto, and an absolutely positioned box with both set and
  `height: auto` is stretched to fill the gap between them. The toast became
  422x302 with two lines of text stranded at the top of it, and since it
  carries `border-radius: 999px` for its one-line pill shape, 302px of it
  painted as an enormous dark oval over the middle of the canvas. The search
  panel shares the same slot and the same pair of rules, and had the same
  latent bug.

  This is the third instance of one trap — a narrow-screen rule keyed on width
  alone does not fire in landscape — so it now has a test that measures a
  fixed element's box against the height of the text inside it. Asserting a
  maximum height would not do: a stretched box is one whose height has nothing
  to do with its contents, and a 200px box full of 200px of text is fine.

- **The toolbar sheet dropped its first 70px off the top of itself.**
  `.nav-menu` is `justify-content: center`, which centres a bar's buttons on a
  desktop and does something else entirely once the content is taller than the
  box: overflow in a centred flex container is split evenly between *both*
  ends. On a landscape phone the hamburger and the whole "Create" label sat
  above the sheet's own top edge, where `scrollTop` cannot reach them — scroll
  offsets do not go negative — while `scrollTop` read 0 the entire time.
  Overflow now goes to the end you can scroll to.

- **The sheet laid its second row out sideways.** The 720px block sets
  `flex-wrap: wrap` on `.nav-menu`, from when the toolbar was a top-anchored bar
  that needed to wrap. Combined with the sheet's `flex-direction: column` and
  its height cap, wrap means wrap into *columns* — the Tools and Session groups
  were rendered beside the Create and Edit ones, off the right edge, with a
  sliver of each visible.

### Changed

- **Lint is clean, and stays clean.** `npm run lint` had eleven standing
  warnings; it has none, and it runs at `--max-warnings=0` now so the next one
  fails the check rather than joining a pile nobody reads.

  Six were `consistent-return` on the window-creating helpers, and they were
  pointing at something real rather than being noise: each returns the new
  element normally but did a bare `return;` at the 25-window cap, so it handed
  back `undefined` while the restore path's own comment said *"add\*() returns
  null once MAX_WINDOWS is hit"*. Every caller tests for falsiness, so the
  behaviour is identical — but the code and its documentation now agree, and
  `addCalculator`/`addClock` already did it this way.

  The other five were `no-await-in-loop` in the passphrase retry loops, and
  those are not defects: attempt 2 is a response to attempt 1 having been
  wrong, so running the three concurrently would stack three modal dialogs on
  screen at once. They are suppressed individually, each with the reason
  written next to it.

- **The breakpoint is not width alone, and it is not one clause.** It is
  `(max-width: 720px) and (pointer: coarse)`,
  `(max-height: 520px) and (pointer: coarse)`, `(max-width: 560px)`.

  The pointer test is there because a desktop browser with devtools docked to
  the side is routinely under 720px with a mouse attached, and turning that
  into full-bleed windows with no drag and no resize takes the app away from
  someone who has lost nothing but width. The height clause is there because a
  phone in landscape is ~802x293 — *wider* than 720, so a width-only query
  dropped it straight back to the desktop shape. The last clause is the floor
  under both: below ~560px the toolbar cannot be laid out as a bar by any
  arrangement, mouse or no mouse.

- **Geometry is frozen while the phone layout is on.** A note is 557x429 by
  default; on a 393px screen the CSS stretches it to the viewport, and
  `measuredBox()` must not write that back or a Backup taken on a phone would
  carry 393px notes to the desktop they were built on. `geometryFrozen()` falls
  through to the stored box instead — the same thing a minimised window already
  did — and `updateWindowSize()`, plus the resize handler's
  `clampWindowIntoView()` sweep, stand down with it. A window that has only
  ever existed on a phone still saves its real size; the freeze is not an
  unconditional early return.

- **Dragging and resizing are off in the phone shape**, and the resize grip is
  hidden with them. Every window is the whole screen there, so there is nowhere
  to drag one to, and an affordance that does nothing is worse than no
  affordance.

- **A new window on the canvas is trimmed to fit the screen.** The canvas keeps
  world coordinates on a phone, so nothing else stops a 557x429 note or a
  400x400 Log from opening with its own controls past the edge or below the
  fold. Only brand-new windows; a saved size is the user's.

- **The viewport meta declares `viewport-fit=cover` and
  `interactive-widget=resizes-content`.** The first is what makes
  `env(safe-area-inset-*)` report anything but 0 on a notched phone, which the
  mobile stylesheet leans on throughout. The second shrinks the layout viewport
  when the on-screen keyboard opens, so a note's buttons do not end up
  underneath it while you type. Page zoom is deliberately still allowed.

- **The calendar's event list is keyboard-scrollable.** `.cal-lower` is the
  calendar's one scroller, and on a 293px-tall screen it genuinely overflows —
  a scrollable region with no tab stop cannot be scrolled by keyboard at all.
  It takes `tabindex="0"` and a label. Found by running the axe suite against
  the landscape project.

- **Notes tighten up on a short screen.** Under `max-height: 520px` the flex
  gaps and padding drop from 10px to 6px and the textarea's floor drops to
  60px — the textarea is the only part of a note that can give up height
  without something becoming unreachable, and it is also the part the on-screen
  keyboard is covering. The standing chrome shrinks with it (48px instead of
  56, a 32px tab strip instead of 38), because two bands costing 11% of a
  portrait screen cost 24% of a landscape one.

- **Hover tooltips are suppressed on a phone.** The synthesised `mouseenter`
  arrives with the tap that already ran the button, so the tip appeared over
  the toolbar it was meant to explain, after the fact, with nothing to dismiss
  it.

- **The empty-state hint knows which shape it is in.** The desktop wording
  points at a toolbar along the bottom that a phone does not have. Both
  wordings are spans inside the single `.empty-hint` element, because the
  locked-session message swaps that element's contents wholesale.

---

## [4.1.3] — 2026-08-15

### Fixed

- **A failed session load threw away the reason it failed.** Parsing a stored
  session wrapped every `JSON.parse` failure in a flat "Session is not valid
  JSON", discarding the original `SyntaxError` — and with it the byte offset
  that is the only thing distinguishing a session truncated partway through a
  write from one whose contents are corrupt. The underlying error now rides
  along as `cause`. The message shown to you is unchanged.

### Changed

- **The first static analysis pass.** ESLint had never been run against
  `cbapp.html`; the offline security check only ever parsed the script for
  syntax errors, which catches nothing that still parses. The inline script is
  now linted in place (`npm run lint`) and is clean.

  It found three globals — `activeTool`, `offsetX`, `offsetY` — left behind by
  an older drag implementation. `activeTool` appeared exactly once in the file,
  at its own declaration. The other two were never read: every use inside
  `makeDraggable` bound to same-named locals that shadowed them, so editing the
  globals to change drag behaviour would have done nothing at all. All three are
  gone. A calendar-form local that shadowed the `hasAlert()` predicate is now
  `alertOn`, two silently swallowed resize-observer errors say why they are
  ignored, and a handful of dead initialisers and one unused parameter are gone.

  No behaviour changes beyond the `cause` fix above — the 330-test
  cross-browser suite and the axe-core pass are unchanged.

---

## [4.1.2] — 2026-08-15

### Fixed

- **Restoring with devtools open bunched every window into a corner.** The big
  canvas sizes its world from the browser viewport, which is not a stable
  quantity — opening devtools, snapping the window to half the screen, or
  rotating a tablet all shrink it. A reload starts the world at zero and
  re-derives it, so unlocking a session in that shrunken state computed a world
  smaller than the one the saved coordinates were written against, and the
  restore clamp then dragged every window past the new edge back onto it. The
  view got pinned to the same corner, so it looked like the whole workspace had
  collapsed into a pile — and it was saved that way, so closing devtools did not
  undo it.

  The world now has two floors it can never fall below: its own size, persisted
  with the session, and a measurement of the windows actually on the canvas
  (which is what rescues sessions saved before this release). A narrow viewport
  can still grow the world; it can no longer shrink it. The drag clamp gets the
  same guarantee, so a drag no longer stops dead well inboard of where the
  neighbouring windows are sitting.

---

## [4.1.1] — 2026-08-15

### Fixed

- **The first accessibility audit.** axe-core (WCAG 2.0/2.1 A + AA) had never
  been run against CB App. Twelve app states now get scanned — landing, light
  mode, note, task list, sticky, calculator, clock, log, calendar, instructions,
  search/replace, big canvas — and the first pass found three defects, all fixed
  here.
  - **The clock's 12/24-hour dropdown had no accessible name.** A screen reader
    announced it as an unlabelled combo box; it is now `aria-label="Time format"`.
    Every other control in that window was already labelled, so this was the one
    that got missed.
  - **Active toolbar pills were 2.4:1.** The accent teal sat on the active green,
    well under the 4.5:1 floor — so Calculator, Clock, Calendar, Canvas, and
    Search all failed exactly when they were the toggled-on control the eye needs
    to find. The pill is now a darker green with white text (5.9:1, and 7.7:1 on
    hover), which also reads as "selected" more plainly than the teal did.
  - **The instructions panel scrolled but took no keyboard focus.** A pointer
    could read it and a keyboard could not; it is now a focusable labelled
    region.

---

## [4.1.0] — 2026-08-14

### Added

- **A lock button in the bottom-left corner.** One click seals the session with
  your passphrase, clears every window off the screen, and suspends saving until
  you unlock — for stepping away from the desk. It ends in exactly the state a
  failed unlock at boot produces (`sessionLocked`, ciphertext in storage, every
  write refused, the 🔒 banner offering the passphrase), because that state is
  already built and tested; only the empty-state wording differs, since nothing
  failed here and "was not opened" would read as an error.
  - **It saves before it drops the key.** `clearSessionSecrets()` removes the
    only means of writing, so the desk is persisted first and the lock is
    abandoned — session left open, nothing cleared — if that write does not
    land.
  - **An unprotected session is asked for a passphrase first.** Blanking the
    screen over a plaintext localStorage entry is a lock in appearance only. The
    new-passphrase flow is now shared with Protect rather than duplicated, so
    the two cannot drift on rules or wording.
  - **The screen is cleared, not dimmed** — windows, minimised chips, any alert
    card naming a calendar event, the search bar's contents, and the in-memory
    event store, which unlock reloads from the envelope.
  - The button hides itself while the session is locked (the banner is the way
    back in, and two lock affordances at once read as two different locks), and
    the minimised-window chips start at 62px to leave it the corner. A copy
    saved with "Download CB App" always ships with the button visible, for the
    same reason the locked banner is scrubbed from an export.

---

## [4.0.5] — 2026-08-09

Two bugs in the locked-session path, both found while building a Lock button
that was then dropped. Neither needed that button to reach — the locked state
has always been reachable by getting your own passphrase wrong at boot — so the
fixes ship on their own. No UI changes.

### Fixed

- **A save that was already encrypting when the session locked wrote over the
  ciphertext.** Both gates — `saveSession` and `persistSessionPayload` — read
  `sessionLocked` before the encryption starts, and encryption is 210,000
  PBKDF2 iterations plus AES-GCM, not an instant. A save that began a moment
  before a lock finished a moment after it and stored a pre-lock snapshot over
  the sealed session, which is precisely what those gates exist to prevent. An
  await is not a fence; `persistSessionPayload` re-reads the flag immediately
  before the write and returns `false` rather than reporting a save that did not
  happen. The new test drives the race through the app's internals, because the
  window is a few hundred milliseconds wide inside one function and nothing a
  user can click opens it on demand.
- **A copy downloaded from a locked tab opened by describing the wrong
  session.** `enterLockedState` rewrites the empty-state hint in place and the
  export clones the live DOM, so a blank `cbapp.html` greeted its new owner with
  "your saved session is encrypted and was not opened … nothing is being saved
  until you unlock it" — about a session that copy has never had, and while it
  was in fact saving normally. The original text was already parked on the
  element for the unlock path; the export puts it back, and drops the leftover
  `data-unlocked-text` attribute with it.

---

## [4.0.4] — 2026-08-06

A third pass, this one aimed at 4.0.3's own fixes — new code nobody had reviewed.
The two rewrites held up under 95,040 measured cases (`previousOccurrence` and
`nextOccurrence` against an independently generated occurrence set, in three
timezones, zero mismatches), the freeze bookkeeping leaves no residue after
repeated re-application, and the session round-trip is byte-identical. Eight
smaller things did not hold up.

### Fixed

- **A frozen calendar said "frozen" while doing the thing perfectly well.** 4.0.3
  taught `lockableControls` about `data-lock-exempt` and forgot to teach the
  frozen-window message, so paging the month or typing in the search box worked
  *and* drew "Calendar is frozen — click 🔒…" — on every keystroke, evicting
  whatever the status line was legitimately showing. Two notions of "what a freeze
  covers" have to agree. Mine, from an hour earlier, and the exact class of
  contradiction v3.2.19 existed to end.
- **Recurrence held across a 1-hour DST shift but not a whole missing day.**
  Samoa deleted 30 December 2011 outright, so in `Pacific/Apia` the elapsed 24h
  periods between two local midnights are one *fewer* than the calendar dates
  between them — rounding the millisecond gap cannot recover that. Measured there,
  a daily event anchored before the jump landed on **0 of 31** days in a month.
  `dayDiff` now differences UTC calendar dates, which is exact for any zone and
  any gap: 31 of 31, and the "exact by construction" comment is true rather than
  nearly true.
- **A sweep where everything due was too old now says so.** Reminders older than
  the 7-day catch-up window were stamped in complete silence — the truncation the
  code's own comment claims not to do. They get a status line (no card, no chime:
  it is not actionable, so it should not interrupt). The comment now also states
  plainly that only the *latest* due occurrence per event is examined, so the four
  days a daily event went unseen are counted, never enumerated.
- **The saved month must be an integer.** `Number(["2027"])` is 2027 and
  `Number(null)` is 0, so an array passed the year check and a null month
  validated as January rather than "no opinion" — and `new Date(5, 0, 1)` is 1905,
  so a two-digit year rendered a century away. `Number.isInteger` with a floor of
  100, and the writer emits numbers rather than dataset strings (which would have
  validated to null and quietly lost the month again).
- **The id de-duplication cannot be out-guessed.** `newEventId()` is
  `ev<base36 now><counter>`, so a file that guessed the import millisecond could be
  handed back the very duplicate the guard exists to prevent. The set is now seeded
  with every id in the payload, and it retries rather than minting once.
- **The month label no longer re-announces itself.** It is `aria-live`, and every
  render wrote it unconditionally, so typing seven characters into the search box
  had a screen reader say "August 2026" seven times (measured: 3 identical renders
  → 3 mutations, now 0). A real month change still speaks.
- The focus-restore chain can no longer end in `null` and drop focus to `<body>` —
  unreachable through the UI today, but it was the exact failure that block exists
  to prevent.
- Grammar: "1 event **was** past the 500 limit", not "1 event were".

### Notes

- 306 tests across Chromium, Firefox and WebKit. The Samoa test runs in a
  `Pacific/Apia` context, for the same reason the DST tests pin
  `America/New_York`: the assertion is meaningless anywhere else.
- One thing worth recording about 4.0.3: it deleted `showAppAlert`'s unused
  `chime` parameter as dead code, and within the hour this release wanted exactly
  that parameter for the stale-reminder case. The status line turned out to be the
  better answer, so the parameter stayed dead — but "nothing calls it" is a weaker
  argument for deletion than it looks.

---

## [4.0.3] — 2026-08-06

Two adversarial review passes over everything the calendar shipped in 4.0.0 — one
for security, one for quality. The security pass found **nothing exploitable**: no
XSS through an event title or note, no prototype pollution, no plaintext event
leakage past Protect, no CSP loosening, and no way to make the recurrence maths
loop. The quality pass found two genuine correctness bugs in the occurrence maths,
both mine, both shipped in 4.0.0.

### Fixed — recurrence was wrong across a DST boundary

- **A weekly event landed on the wrong weekday for half the year.** `daily` and
  `weekly` did millisecond arithmetic: `Math.ceil((fromDay - first) / (7 * DAY))`.
  Elapsed milliseconds between two local midnights is **not** a whole number of
  days across a DST change — it is off by an hour — so the division stopped being
  exact, `Math.ceil` rounded a partial week up to a whole extra one, and the
  result landed a day early. A weekly event dated Wednesday 1 July reported
  **Tuesdays** from November onward: 4,592 wrong answers in a year-long sweep, in
  the month-grid dots, the day list *and* the scheduler, because everything asks
  that one function. `daily` failed once a year too, on the spring-forward day —
  the event vanished from the grid and skipped its reminder. `monthly` and
  `yearly` were always safe; they go through the `(y, m, d)` constructor.
- Fixed by counting whole local days (`Math.round`, exact by construction) and
  adding them through the date constructor instead of timestamps. A 97,820-case
  sweep across a year of anchors and queries now has **zero** wrong answers, and
  the changelog claim in 4.0.0 that "no UTC round-trip means no DST drift" is true
  of the storage format but was not true of this arithmetic. It is now.

### Fixed — the scheduler announced the wrong occurrence

- **A reminder with a lead time named an occurrence that had already happened.**
  `dueOccurrence` asked `nextOccurrence` from `now - leadTime`, which returns the
  *first* occurrence in that window — the oldest pending one, the exact opposite
  of what a reminder means. With a one-day lead, a daily event announced
  *yesterday's* occurrence and stamped `lastFired` against it, so today's real
  reminder never fired and the event stayed permanently one lead behind.
- **A lead time over 7 days was silent forever.** The occurrence it picked was
  always older than the `CATCHUP_DAYS` cutoff, so every sweep counted it stale,
  stamped it, and said nothing. The form allows up to 69 days and the code
  documents `1440` (a day) as ordinary, so this was the happy path, not a fuzz
  case. A two-week warning never once appeared.
- It could also skip a genuinely missed reminder, because looking forward from
  `now - lead` steps straight over anything earlier.
- Fixed with a new `previousOccurrence(event, limit)` — the mirror of
  `nextOccurrence`, and the right question to ask, since `fireAt` rises
  monotonically with the occurrence: the reminder that is due is simply the last
  occurrence to have started by `now + leadTime`. One call, no walking, and it
  accounts for the time of day (the 09:00 occurrence has not started at 00:30).

### Fixed — a frozen calendar could still delete an event

- **Freeze did not survive a re-render.** A freeze is applied to nodes, and
  `renderCalendar` replaces every node — including each row's ✏️ and 🗑. Freeze a
  calendar, let anything re-render (a reminder firing, or an edit on the other
  desk's calendar, since both share one store), and the buttons were live again:
  one click silently and permanently deleted an event on a window the user had
  frozen precisely to stop that.
- The lock is re-applied after every render now, and `calDeleteEvent` and
  `calSaveForm` check the frozen state themselves — an attribute is not a
  guarantee once nodes get rebuilt.
- **What freeze means on a calendar is now stated deliberately.** Paging the
  month, picking a day and searching are *reading*, so they are exempt (a new
  `data-lock-exempt`), for the same reason a frozen note's textarea goes readOnly
  rather than disabled. Add, edit and delete are refused. Before this a frozen
  calendar could only ever show the day it was frozen on.

### Fixed — accessibility

- **Clicking a day no longer throws keyboard focus to `<body>`.** Rebuilding the
  grid discarded the focused cell, so a keyboard user pressing Enter on a date had
  to tab from the top of the document to reach the next one. Focus returns to the
  same day, or to the selected day when paging a month.

### Fixed — smaller, all found in review

- The **viewed month is persisted**. It was re-derived from the selected day, so
  paging to November and reloading came back to this month — and
  `calShiftMonth`'s `saveSession()` was a full serialise-and-encrypt per arrow
  click that changed nothing on disk. The block comment claiming it persisted is
  now true.
- **A renamed calendar keeps its name.** The header offers ✏️ Rename and the name
  was written into the session record, but restore never read it back.
- **An imported file cannot make two events share an id.** An id is an identity —
  edit and delete both resolve by it — so repeated ids made one click delete
  several rows and one edit replace them all with the same object reference.
- **Events dropped at the 500 cap are reported**, not swallowed: the import now
  says how many were left out, as the window path already did. `commitEvents`
  also sorts *before* slicing, so the cap drops the latest events rather than
  whichever the caller happened to pass last.
- **Boot survives a browser that refuses `localStorage`.** The retired-calendar
  purge and the session read both sat outside the guarding `try`, and merely
  touching storage throws where site data is blocked by policy — which since
  4.0.0 also meant `startAlertScheduler()` never ran, so reminders silently never
  fired. Both are guarded, and a storage-denied profile now says "not saving"
  instead of looking fine.
- **A day click or a save with text in the search box shows that day** instead of
  leaving the old whole-store matches on screen, which read as a dead click.
- **An unrecognised `repeat` cannot be saved.** The `<select>` can only emit legal
  values so this is defence in depth, but the failure it prevents is silent and
  total: an unknown repeat makes the event show once and never fire.
- **Editing an event the other desk just deleted says so** instead of resurrecting
  it under a new id.
- The blank pad cells before the 1st no longer take a hover border while their own
  cursor says "not clickable"; `eventsOn` runs once per grid cell instead of twice
  (it was 31 extra whole-store scans per render); a long unbroken event title
  wraps in the alert card; and a `hasAlert()` helper replaces four copies of the
  same test, one of which tested only half of it and rendered `⏰ -undefinedm`.
- Dead code removed: `dueEvents()` (nothing called it, and its comment claimed a
  test depended on it), `showAppAlert`'s unused `chime` parameter, `eventFireAt`'s
  unreachable date fallback, the `.cal-spacer` selector, a duplicate `height`, and
  two unreachable negative-period clamps. `startAlertScheduler` no longer
  registers its listeners on every call while claiming to be re-entrant.

### Changed

- The security check's "boot loads only this browser's own session" assertion
  pinned the exact declaration (`const rawToLoad = …`), so wrapping that read in a
  `try` failed a check about a property the change does not touch. It matches the
  read itself now.

### Notes

- 288 tests pass across Chromium, Firefox and WebKit — 15 new. The DST and
  `previousOccurrence` tests pin `timezoneId: 'America/New_York'`, because these
  assertions are meaningless in UTC and a runner there would pass them without
  testing anything. That is exactly why the original suite missed both bugs: every
  date it picked sat inside one DST regime, and every UI test created its events
  "today".

---

## [4.0.2] — 2026-08-06

### Fixed

- **The canvas `1:1` button keeps its label in its accessible name.** Found by
  running Lighthouse against the deployed page rather than the local one, with the
  canvas open — its accessible name was "Reset zoom to 100 percent", which does not
  contain the "1:1" a user can see, so speech control could not reach it (WCAG
  2.5.3, the same fault v4.0.1 fixed in the toolbar). `Zoom out`, `Zoom in` and
  `Fit` already contained their glyph or word.

### Notes

- Lighthouse with a note, the calendar and the canvas all open at 100%:
  **accessibility 100, best practices 100**.
- The first live audit also reported eight failing touch targets at 6–8px. Those
  were an artifact of auditing a restored session that happened to be on the canvas
  desk at 25% zoom — the same controls measure 24px and up at 100%. Worth writing
  down: a Lighthouse run against a *zoomed* canvas is not a fair reading of this
  app, so audit a clean context.

---

## [4.0.1] — 2026-08-06

Reported: the New event title box looked cut off and "min before" was squashed.
Both fixed, and a Lighthouse pass over the new UI turned up four more things
worth fixing — two of which had been in the app since long before the calendar.

### Fixed

- **The New event title box is no longer clipped.** `.cal-lower` scrolls
  vertically, and `overflow-y: auto` forces `overflow-x` to `auto` as well
  (`visible` is not a legal pairing), so the pane clipped sideways too. The global
  focus ring is 2px drawn at a 2px offset — exactly 4px outside the control — so a
  focused full-width field was sliced at both edges. The pane now carries 4px of
  inner padding, which is the ring's width and nothing more.
- **"min before" is not squashed.** Same 4px ring, this time landing on the text
  after the field: the label's flex gap was 4px, so the ring sat straight on top
  of the words. Gap is 10px now, and the number box went from 80px to 96px —
  the spinner arrows are ~17px of the field on their own, which was pushing the
  value into the left padding.
- Every control in the form is now a uniform 28px tall. The native date and time
  widgets carry their own internal padding and came out at 28px and 31px against
  26px for a text field, so a row of them stepped up and down.
- The notes box grew from 46px to 62px, and `.close-calendar` inherits the colour,
  size and cursor rules its siblings in every other title bar already had.

### Fixed — found by Lighthouse (all pre-existing)

- **Title-bar controls are now 24×24**, the WCAG 2.5.8 minimum for a pointer
  target, in *every* window type. They were glyph-sized boxes — the lock 22×22 and
  the close `×` just 9px wide, because a thin text glyph is only as wide as the
  character — so closing a window asked for pixel-accurate aim. The glyphs are
  unchanged; only the box around them grew, sideways and into the header's
  existing padding.
- **The clock's default height is 506px, was 502.** Those 24px controls make a
  header 41px instead of 39px, and the clock is a fixed-size window whose content
  fitted its old height exactly. WebKit reported the missing pixel as a scrollbar
  while Chromium absorbed it silently.
- **Toolbar buttons now keep their visible word in their accessible name.**
  Deriving the name from `data-tooltip` alone gave the button reading "Theme" the
  name "Toggle Dark/Light Mode" — fine for a screen reader, broken for speech
  control, because "click Theme" matches nothing (WCAG 2.5.3 Label in Name). The
  visible word now leads and the description follows it; buttons whose tooltip
  already contains their label are left alone rather than made to stutter.
  `updateProtectButton()` does the same for the one button whose label changes at
  runtime.
- **The build-version chip cleared AA.** 9px at `opacity: 0.65` computed to
  `#5d6777` on `--bg-card` — 3.1:1, under the 4.5:1 minimum, on the one label that
  tells you which build you are looking at. Now `--text-dim` at full opacity
  (5.7:1) and 10px.
- **`role="grid"` removed from the month grid.** An ARIA grid requires
  `row`/`gridcell` descendants and this is a flat CSS grid of buttons, so the role
  was a promise the markup does not keep. It is `role="group"` now; each day button
  already carries its own full date label.

### Notes

- Lighthouse (desktop and mobile, and a snapshot with the calendar and its form
  open): **accessibility 100, best practices 100**. The two remaining failures are
  `robots-txt` and `llms-txt`, which are properties of the host and not of this
  file — they are reported against the local static server used for the audit.
- 243 tests still pass across Chromium, Firefox and WebKit.

---

## [4.0.0] — 2026-08-06

The first feature release since 3.0: a **Calendar** with events and reminders.
Everything from the 3.2.x line is unchanged — nothing was removed and no session
written by an older build needs converting.

### Added

- **Calendar window** — `Calendar` in the toolbar, one per desk like Clock, Calc,
  Log and Help. A month grid with a dot on any day that holds something, today
  outlined and the selected day filled; below it the selected day's events, and a
  form that swaps in over the list rather than opening a modal (a modal would
  cover the grid, and picking a different day mid-edit is a normal thing to want).
- **Events** carry a title, date, time (or **All day**), an optional note, a
  repeat and a reminder. Stored as local wall-clock strings — `2026-08-14` and
  `09:30` mean the same thing in any timezone, and with no UTC round-trip there is
  no DST drift.
- **Repeats**: daily, weekly, monthly, yearly. A monthly event on the 31st falls
  on the **last day** of shorter months instead of sliding into the next one —
  JavaScript rolls Feb 31 into March 3, which would move the appointment out of
  the month the user picked. A yearly event on 29 February lands on the 28th in
  common years.
- **Reminders** are a free-form lead time in minutes, so `0` is at the event and
  `1440` is a day ahead. For an all-day event the lead counts back from a
  documented `ALL_DAY_HOUR` of 9am, which is what gives "all day" something to
  measure from.
- **Search across every event**, by title *and* note, from the box above the
  list — whatever month is showing. The global Search/Replace panel is
  textarea-based and deliberately stays out of it.
- **One set of events for both desks.** A deliberate departure from the
  one-per-desk rule: Clock, Log and Calculator keep independent state per desk
  because a stopwatch is window state, but two desks showing two different sets
  of appointments would be nonsense. Which month is showing and which day is
  selected *are* per window.
- Events live at `session.events`, so they ride **Protect** (AES-GCM) and
  **Backup** like everything else. The calendar deleted in v3.0 kept its events in
  a separate `calendarEvents` localStorage key — outside the session, never
  encrypted, never in a backup. That is the main reason this was rebuilt rather
  than recovered.
- A Calendar section in Help, and `sanitizeCalendarEvent()` in the import
  allowlist: strict date/time formats, `repeat` coerced to the known set, lead
  times clamped, junk `lastFired` treated as "never fired", and dangerous keys
  refused as everywhere else.

### Changed

- **`#timer-alert` is now `#app-alert`**, driven by one `showAppAlert({icon,
  title, detail, actions})`. The countdown and the calendar are two producers of
  the same card, with one dismiss path and one chime, and per-alert buttons are
  built with `createElement` + `textContent` — an event title never goes near
  `innerHTML`. `playTimerJingle()` → `playAlertChime()`.
- The mute preference keeps its stored key `timerSound` so existing sessions are
  unaffected; its meaning widened from "the countdown" to "any alert".
- The security check's version assertion was pinned to `v3.2.x`. A pin that tight
  turns a major release into a test failure, so it now asserts **3.2 or later** —
  still a floor, no longer a ceiling.
- Dead CSS for the v3.0 calendar (`.today-events`, `.events-section`) removed.

### Notes

- **Reminders need CB App open, not the calendar window.** The scheduler is
  app-level: a 20s tick plus an immediate sweep whenever the tab is looked at
  again, because background tabs are throttled to about one timer a minute. It is
  a single file with no service worker, so nothing can run while the tab is
  closed — which is what the catch-up pass is for.
- **Catch-up**: anything that came due while the app was shut is announced once,
  together, in one card with one chime. Bounded to the most recent missed
  occurrence per event within **7 days**; older ones are counted in the card
  rather than dropped in silence.
- An event typed in *after* its own time does not fire on the spot. Adding
  "dentist at 2:30" at nine in the evening is overdue by the scheduler's
  reckoning, and firing there would be reminding someone of what they are
  currently typing.
- Editing an event clears its fired stamp unless nothing about the timing
  changed, so moving an event an hour later is not treated as already announced.
- Deliberately out of scope: `.ics` import/export, timezones beyond local
  wall-clock, OS notifications (`media-src 'none'`, no service worker), snooze,
  and multi-day or timed-duration events.
- 243 tests pass across Chromium, Firefox and WebKit — 13 new, including the
  recurrence and clamping maths called directly, one-shot firing, both sides of
  the "do not remind me of what I am typing" guard, the catch-up bound, the
  validator, and a frozen calendar.

---

## [3.2.19] — 2026-08-06

### Fixed

- **Freezing no longer repaints a window.** v3.2.18's frozen-field styling was
  meant for the clock's countdown boxes and reached every window instead: a
  locked sticky note grew a heavy dashed frame and lost its own colour. Both
  regressions are gone — a frozen note, sticky note or task list now looks
  exactly like an unfrozen one, and only the cursor changes.
- The dashed frame came from `border-style: dashed` meeting `border: none`.
  The shorthand resets the border *width* to the initial `medium`, so the width
  was 3px all along with the style hiding it; naming the style revealed a frame
  nobody asked for. It is now scoped to `.countdown-field input`, which carries
  a real 1px border and is the control the whole report started with.
- `:read-only` was the second half of it. It matches far more than text fields —
  every checkbox, colour swatch and select is permanently read-only by that
  definition — so a frozen sticky note's two colour pickers were outlined too.
- **The readOnly background wash is gone as well**, and it predates v3.2.18.
  `textarea` and `.sticky-note-content` are `background: transparent`, so
  painting the readOnly state replaced whatever showed through: on a sticky note
  that is the note's own colour, including a custom one. Locking a yellow note
  turned it grey. Three separate rules were doing it (`rgba(0,0,0,0.1)`,
  `rgba(0,0,0,0.2)`, then a themed `--bg-card-hover`); all three are removed.

### Notes

- The spoken message from v3.2.18 is unchanged and still covers every window
  type — it costs no pixels, and it is what makes a silent frozen control
  explain itself. The visual signal is what got scoped back to the clock.
- The calculator display is an `<input>`, never a `textarea`, so dropping the
  wash left it untouched.

---

## [3.2.18] — 2026-08-06

### Fixed

- **A frozen window no longer swallows input in silence.** Reported from Island:
  after restoring a backup, "the countdown time cannot be changed". The clock had
  come back **frozen** — `restoreSingleton()` reapplies a saved lock — so its
  number fields were `readOnly` and Start/Reset were `disabled`. Nothing said so:
  a readOnly field takes keystrokes and drops them, a disabled button does not
  even dispatch a click, and the only clue was 16px of 🔒 in the title bar of a
  window the user did not freeze in this sitting. An untouchable timer reads as
  a broken timer.
- Typing or clicking inside a frozen window now says
  `<name> is frozen — click 🔒 in its title bar to unfreeze it.` Wired in
  `wireWindowFocus()`, the one call every window type makes, so it covers notes,
  tasks, sticky notes, the calculator, the log and the clock alike.
- The listener is on the window and in the **capture** phase, because a disabled
  control dispatches no pointer event of its own — the event that arrives has the
  surrounding row as its target.
- **Reading a frozen window stays silent.** Cursor keys, Tab/Escape and the
  Ctrl/Cmd shortcuts (select-all, copy) draw no message. That is the whole reason
  text fields go `readOnly` instead of `disabled`, and the message must not
  punish it.
- Frozen `readOnly` fields now *look* frozen — dashed border, `not-allowed`
  cursor. Disabled buttons dim themselves natively; readOnly inputs did not, so
  a frozen clock's countdown fields looked perfectly editable. The text stays at
  full contrast rather than being faded, since a frozen note still has to be
  readable.

### Notes

- Freeze is unchanged in what it freezes; this is about saying so. It remains
  layout-and-edit only — Protect is the encryption.
- `windowLabel()` extracted from `toggleWindowLock()`, now shared with the
  frozen-input message.

---

## [3.2.17] — 2026-08-05

### Changed

- **The countdown announces itself inside the app, not on the desktop.** The
  OS `Notification` the timer fired is gone. It only ever worked if the
  browser had already been granted permission (the app deliberately never
  asks), several browsers drop it under `file://` without a service worker,
  and on a managed machine it put "CB App" on the desktop.

### Added

- `#timer-alert` — an in-app card, **dead centre of the viewport**, that stays
  up until it is dismissed. The 3s `#status` toast was the wrong surface for a
  timer, which by definition fires while you are looking at something else;
  the centre is where the eye lands, so the one message you actually asked for
  is the one you cannot miss. Under 480px the row stacks rather than squeezing
  the buttons.
- The card names the clock that rang (`Clock 2 reached zero.`) and says so when
  that clock is on the other desk.
- **Show** goes back to it: swaps desks if needed, un-minimizes, raises, and
  centres the canvas on the window. It hides itself if the clock was closed
  while the timer ran.
- **Dismiss** is the acknowledgement, so the title flash and the countdown
  favicon stand down with the card instead of outliving it.
- **A soft jingle when the timer ends** — three sine tones with a bell partial
  and a long decay (D5–A5–D6, ~1.3s, one pass, peak 0.24 with no clipping),
  synthesised with the Web Audio API. Deliberately *not* a base64 audio file: a
  data: URI would add ~40KB to a file people download, force `media-src data:`
  into a CSP that is otherwise `media-src 'none'`, and put an unreviewable blob
  in the repo. An AudioContext is not a media fetch, so the CSP is untouched.
  `TIMER_JINGLE` documents how to swap in a recorded jingle if that is ever
  wanted, CSP edits included.
- The AudioContext is created and unlocked on the **Start** click, not at zero —
  autoplay policy silences a context built without a gesture, and by the time
  the timer ends there is no gesture left to borrow.
- **Mute** on the card, because the moment you hear a sound you did not want is
  the moment you want the switch. It persists as `session.timerSound` and comes
  back on Reset. Where Web Audio does not exist the card appears silently.

### Fixed

- **12-hour time no longer pads the hour.** The clock face and all four
  timezone rows read `7:49:35 PM`, not `07:49:35 PM` — `hour: "2-digit"` was
  used for both formats, and no clock face or phone pads a 12-hour dial.
  24-hour keeps two digits, where `07:49` is the correct form. All five
  readouts now come from one `clockTimeFormat()` instead of five copies of the
  same options object.

### Notes

- Log entry timestamps are unchanged: those are padded records in a log line,
  where the fixed width is the point.
- Starting or resetting a countdown clears that clock's alert; so does closing
  the clock.
- `downloadCbApp()` scrubs the card from the export — it belongs to this tab's
  clock, not to the copy.

---

## [3.2.16] — 2026-08-05

### Changed

- **Import over a protected session needs the passphrase.** Import overwrites
  what is saved here, destroying it exactly as Reset does — and a plaintext
  backup file needs no passphrase of its own, so this was the last way to
  clear the desks without knowing the passphrase. A locked session is checked
  against its ciphertext, with the same ERASE escape Reset has; an open
  protected session is checked against the passphrase in memory.
- The gate is asked **before** the file is parsed. Unlocking an encrypted
  backup caches that file's passphrase into `sessionPassphrase`, which is the
  very thing the protected case has to compare against.
- An unprotected session is unchanged: no passphrase to ask for, and Import
  has never stopped to confirm one.

### Added

- `verifyEnvelopePassphrase()` — answers "is this the passphrase?" from the
  AES-GCM auth tag alone, without going through `ensureSessionKey()`. Asking
  the question must not quietly adopt a session the tab has not opened, which
  is why importing over a locked session still lands as plaintext.
- `confirmDestroyLocked()`, now shared by Reset and Import.

### Notes

- Importing an older plaintext `.json` session is still unchanged.

---

## [3.2.15] — 2026-08-05

### Changed

- **Unprotect needs the passphrase.** Removing protection rewrites the session
  as plaintext, so a click alone let anyone at the keyboard strip the lock off
  and read everything on the next load — the same hole Reset had before
  3.2.14, except the notes are left behind rather than deleted. It now asks
  for the passphrase, three tries, in the app's own dialog rather than a
  `window.confirm`.
- The check Reset introduced is now `requireSessionPassphrase()`, shared by
  both callers so the two cannot drift on tries, wording or what counts as a
  match.

### Notes

- Importing an older plaintext `.json` session is unchanged and still works.

---

## [3.2.14] — 2026-08-05

### Changed

- **Reset asks in the app's own dialog, not the browser's.** The old prompt was
  a `window.confirm` — chrome-styled, headed "phbeks.com says", and unable to
  put any weight on the most destructive question the app asks. It is now the
  same card the passphrase dialog uses, with a red "Reset everything" button
  and focus starting on Cancel, so Enter on a dialog nobody read does nothing.
- **A protected session cannot be reset without the passphrase.** Protection
  used to stop someone reading your desks but not throwing them away, which is
  barely a lock. Reset now asks for the passphrase whenever the session is
  encrypted — checked against the one held in memory if the session is open, or
  against the stored ciphertext if it is locked. Three tries, then it stops.

### Added

- **An ERASE escape for a lost passphrase.** After three wrong tries on a
  locked session, Reset offers to delete it anyway if you type `ERASE`. Without
  it a forgotten passphrase would leave a session that can neither be opened
  nor cleared. It is friction rather than a second lock: anyone who reaches it
  has already failed the passphrase three times.
- `confirmDialog()`, an in-app replacement for `window.confirm()`, sharing the
  passphrase dialog's card, focus trap, Escape handling and backdrop click.

### Notes

- The reset itself is now `performReset()`; `loadSession()` is the gate in
  front of it. Import calls `performReset()` directly, so its synchronous
  ordering is unchanged.

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
