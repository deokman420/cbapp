import { test, expect, type Page } from '@playwright/test';

/**
 * CB App — pixel baselines.
 *
 * Separate from cbapp.spec.ts on purpose, and NOT part of the default gate.
 * The geometry assertions in `CB App — layout` are the ones that catch layout
 * breakage on any machine; these are a second, blunter opinion about whole
 * screens.
 *
 * WHAT THESE CANNOT DO — read this before trusting a green run
 *   These are FULL-PAGE shots compared by a ratio of differing pixels, so
 *   their sensitivity is diluted by page area. A small control can change
 *   completely without moving the needle: reverting the title-bar glyphs from
 *   --text back to --text-dim, a plainly visible colour change on four
 *   controls per window, does not fail a single one of these. Neither would
 *   most single-button changes.
 *
 *   That is inherent to a full-page ratio, not a tolerance that needs another
 *   turn of the screw — catching small controls would mean element-scoped
 *   shots (`locator.toHaveScreenshot()`) instead. What these DO catch is
 *   change at the scale of a screen: a layout reflowing, a panel moving, a
 *   region appearing or vanishing. That is what they caught on the minimap
 *   rework and on the landscape toolbar.
 *
 *   So: never let a green run here stand in for a behavioural test. The glyph
 *   contrast above is guarded by cbapp-a11y (24 failures the moment it
 *   regresses); the Download chip's placement is guarded by named tests in
 *   cbapp.spec.ts. Those are the real guards.
 *
 * WHAT THESE COST
 *   A baseline PNG is specific to the platform that recorded it. Font
 *   rasterisation, scrollbar width and emoji glyphs all differ between
 *   Windows, macOS and a CI container, so a baseline recorded here will not
 *   match one recorded there. The files in cbapp-visual.spec.ts-snapshots/
 *   are Windows (win32) baselines. Playwright looks up a snapshot by the
 *   runner's platform, so a Linux run asks for *-linux.png, does not find
 *   them, and fails. That is not a pixel diff against the win32 files. Do
 *   not refresh them with --update-snapshots unless you are on Windows and
 *   the desk itself changed. The v4.8.0 origin notice is hidden below, the
 *   same way the status toast is, so it does not force a new baseline.
 *
 * WHAT IS FROZEN FIRST
 *   Anything that moves or reads the clock is neutralised before the shot, or
 *   the baseline is a coin flip: the toast, the caret, transitions, and the
 *   Clock window itself (which renders the current time four times over).
 */

const URL = '/cbapp.html';
/*
 * TWO knobs, and the second one is the one that matters on a dark UI.
 *
 * `maxDiffPixelRatio` alone was not enough, twice over. It started at 2% —
 * more than the whole hamburger button on a landscape shot — and reporting
 * green while that button was missing is what got it cut to 0.2%. Then 0.2%
 * missed the Download chip disappearing out of the corner, a ~150x30 block of
 * pixels, because of the OTHER knob: `threshold` is a per-pixel colour
 * distance, and at its 0.2 default two dark greys count as the same colour.
 * On a UI that is mostly near-black, most of a change simply does not register
 * as differing pixels at all.
 *
 * Measured, not guessed: at threshold 0 the same run showed 22 of 24 shots
 * differing while the suite was passing 22 of 24.
 *
 * So: a tight per-pixel threshold to make dark-on-dark changes count, and a
 * small ratio budget to absorb the text anti-aliasing that genuinely varies
 * run to run. Verify any change to these by recording, then running twice —
 * if the second run is not clean, the threshold is too tight, not the app.
 */
const SHOT = {
  threshold: 0.05,
  maxDiffPixelRatio: 0.002,
  animations: 'disabled' as const,
};

async function openFresh(page: Page) {
  await page.goto(URL);
  await expect(page.locator('nav.nav-menu [data-tooltip="New Note"]')).toHaveAttribute(
    'aria-label',
    /New Note/i
  );
  // Everything non-deterministic, held still. The status toast is the loud
  // one — it appears on almost every action and fades on its own timer, so
  // without this a baseline captures whatever the toast happened to be doing.
  // #origin-notice is the v4.8.0 http(s) banner. It is tab state (dismissed
  // or not), not a layout of the desk, and the committed shots are win32
  // baselines from before it existed. Hold it out, and dismiss it so a
  // later click cannot land on it.
  const notice = page.locator('#origin-notice');
  if (await notice.isVisible().catch(() => false)) {
    await page.locator('#origin-notice-dismiss').click();
  }
  await page.addStyleTag({
    content: `
      *, *::before, *::after { transition: none !important; animation: none !important; }
      #status, #nav-tooltip, #app-alert, #origin-notice { visibility: hidden !important; }
      textarea, input { caret-color: transparent !important; }
    `,
  });
}

/** The toolbar rests collapsed on a phone and open on a desktop. */
async function openNavIfCollapsed(page: Page) {
  const menu = page.locator('nav.nav-menu');
  if (await menu.evaluate((el) => el.classList.contains('collapsed'))) {
    await menu.locator('.nav-toggle').click();
  }
}

async function nav(page: Page, selector: string) {
  await openNavIfCollapsed(page);
  await page.locator(selector).first().click();
}

/** A stable name per project, so the four shapes keep separate baselines. */
function shot(name: string) {
  return `${name}.png`;
}

/**
 * Baselines exist for these three shapes and no others. Without this guard a
 * plain `npx playwright test tests/` runs the suite on firefox and webkit too,
 * where every shot is a first-run baseline and therefore a failure — twelve
 * red tests that mean nothing except "no baseline here". Adding an engine
 * means recording its baselines, deliberately, not discovering it by accident.
 */
const HAS_BASELINES = [
  'desktop',
  'mobile',
  'mobile-landscape',
  'iphone',
  // Recorded deliberately, per the note above, when the 375x667 profile was
  // added — the narrowest and shortest portrait shape in the matrix.
  'iphone-se',
];

test.describe('CB App — visual', () => {
  // beforeEach rather than a describe-level test.skip(condition): the
  // condition form is handed the fixtures object only, so testInfo — and with
  // it the project name — is undefined there. A hook gets both.
  test.beforeEach(({}, testInfo) => {
    test.skip(
      !HAS_BASELINES.includes(testInfo.project.name),
      'no pixel baselines recorded for this project'
    );
  });

  test('empty state', async ({ page }) => {
    await openFresh(page);
    await expect(page).toHaveScreenshot(shot('empty'), SHOT);
  });

  test('toolbar open', async ({ page }) => {
    await openFresh(page);
    await openNavIfCollapsed(page);
    await expect(page).toHaveScreenshot(shot('toolbar'), SHOT);
  });

  test('one note', async ({ page }) => {
    await openFresh(page);
    await nav(page, '[data-tooltip="New Note"]');
    await page.locator('textarea').first().fill('The quick brown fox.\nSecond line.');
    await page.locator('.window-header .window-title').first().click();
    await expect(page).toHaveScreenshot(shot('note'), SHOT);
  });

  test('three windows', async ({ page }) => {
    await openFresh(page);
    await nav(page, '[data-tooltip="New Note"]');
    await nav(page, '[data-tooltip="New Task List"]');
    await nav(page, '[data-tooltip="New Sticky Note"]');
    await expect(page).toHaveScreenshot(shot('three-windows'), SHOT);
  });

  test('canvas', async ({ page }) => {
    await openFresh(page);
    await nav(page, '#canvas-toggle');
    await nav(page, '[data-tooltip="New Note"]');
    await expect(page).toHaveScreenshot(shot('canvas'), SHOT);
  });

  test('light mode', async ({ page }) => {
    await openFresh(page);
    await nav(page, '#theme-toggle');
    await nav(page, '[data-tooltip="New Note"]');
    await expect(page).toHaveScreenshot(shot('light'), SHOT);
  });
});
