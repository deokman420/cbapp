import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the standalone CB App repo.
 * Serves this directory so /cbapp.html resolves. Only runner output is gitignored.
 */
const PORT = 8788;

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
    // CB App uses clipboard + downloads extensively in the suite.
    acceptDownloads: true,
  },
  /* ThreadingHTTPServer, not `python -m http.server`.
     The CLI form is SINGLE-THREADED: it serves one request at a time and
     queues the rest. With nine projects and a worker per core that is twenty
     browsers competing for one connection, and the symptoms were sporadic and
     looked like anything but a server — a 404 on one project per full run
     (never reproducible alone, five for five). Same class already cost this
     suite a morning; the fix is one line and the module is in the standard
     library. */
  webServer: {
    command:
      `python -c "from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler;` +
      ` ThreadingHTTPServer(('127.0.0.1', ${PORT}), SimpleHTTPRequestHandler).serve_forever()"`,
    port: PORT,
    reuseExistingServer: true,
    timeout: 30_000,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    // Both phone orientations, and both are real gates since CB App v4.2.0 —
    // they are the only projects that exercise the phone shape at all.
    //
    // Landscape is not a formality. A phone on its side is ~844x390: WIDER
    // than the 720px the first draft of the breakpoint keyed on, so it fell
    // straight back to the desktop shape and put the twenty-button toolbar
    // back over the note. Portrait alone would never have caught it.
    { name: 'mobile', use: { ...devices['Pixel 5'] } },
    { name: 'mobile-landscape', use: { ...devices['Pixel 5 landscape'] } },
    /* A real iPhone profile, on WebKit — the phone this app is actually opened
       on. Pixel 5 runs Chromium and cannot see Safari-only behaviour: the whole
       page zooming when you tap a text field under 16px is invisible on every
       other project here, and shipped in v4.2.0 because of it. */
    { name: 'iphone', use: { ...devices['iPhone 12 Pro Max'] } },
    /* The floor. At 375x667 this is BOTH the narrowest and the shortest
       portrait profile here — every other phone above it is 393px or wider and
       727px or taller, so a layout that only just fits on a Pixel 5 has no
       margin left at all here.

       Note it is the 3rd-gen descriptor, not `devices['iPhone SE']`: that one
       is the 2016 original at 320x568, narrower than any phone still in real
       use and below the 560px CSS floor by a margin that makes failures hard
       to read. 375 is the width of a phone people actually still carry. */
    { name: 'iphone-se', use: { ...devices['iPhone SE (3rd gen)'] } },
    /* TABLETS (added v4.6.0). Until then nothing here was a tablet at all, and
       a tablet is not a big phone — it is the shape that lands on BOTH sides
       of the app's one layout boundary depending on which iPad you pick, so
       one project cannot cover it.

       MOBILE_MQ is `(max-width: 720px) and (pointer: coarse)`, plus the two
       clauses for a short landscape phone and a sub-560px window. Both iPads
       below have a coarse pointer; only the width separates them.

       iPad Pro 11 portrait is 834 CSS px — over 720, so it gets the DESKTOP
       shape: free, draggable windows and the bottom toolbar, driven by touch.
       That is the intent, not an oversight; there is room for it.

       iPad (gen 11) portrait is 656 — UNDER 720, so the current entry-level
       iPad gets the phone shape in portrait and the desktop shape the moment
       it is turned (944 landscape). Both are covered, and the pair is the only
       thing in this list that exercises a real device crossing the boundary by
       rotation alone. */
    { name: 'ipad', use: { ...devices['iPad Pro 11'] } },
    { name: 'ipad-small', use: { ...devices['iPad (gen 11)'] } },
    // Cross-browser check. Firefox has no clipboard-permission grant, so the
    // copy test falls back to asserting the Ctrl+C hint instead.
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    // WebKit ≈ Safari's engine, NOT Safari itself. Catches engine-level breakage;
    // will not catch ITP storage eviction or file:// origin rules. See notes below.
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
