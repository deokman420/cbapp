import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'fs';
import path from 'path';

/**
 * axe-core accessibility scan of CB App.
 *
 * The app is one big single-page HTML file whose UI is built by script, so a
 * single scan of the landing state covers almost nothing. Each test drives the
 * app into a distinct state (a note open, the calendar panel up, light mode,
 * ...) and scans that state.
 *
 * Results are also written to test-results/axe-cbapp.json so the raw violation
 * list survives the run for triage.
 */

const URL = '/cbapp.html';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

type Row = {
  state: string;
  id: string;
  impact: string;
  help: string;
  nodes: number;
  targets: string[];
};

const collected: Row[] = [];

async function openFresh(page: Page, options?: { keepNotice?: boolean }) {
  await page.goto(URL);
  /* Boot is done once the toolbar is wired. The aria-label, not visibility:
     from v4.2.0 the toolbar rests collapsed on a phone, so every button but
     the hamburger is display:none until the sheet is opened. */
  await expect(page.locator('nav.nav-menu [data-tooltip="New Note"]')).toHaveAttribute(
    'aria-label',
    /New Note/i
  );
  /* v4.8.0's passphrase notice sits on top of the phone toolbar sheet.
     Leave it up only for the landing scan, which is the state that includes it. */
  if (!options?.keepNotice) {
    const notice = page.locator('#origin-notice');
    if (await notice.isVisible().catch(() => false)) {
      await page.locator('#origin-notice-dismiss').click();
      await expect(notice).toBeHidden();
    }
  }
}

/** Open the mobile toolbar sheet if it is closed. A no-op on desktop. */
async function openNavIfCollapsed(page: Page) {
  const menu = page.locator('nav.nav-menu');
  const collapsed = await menu.evaluate((el) => el.classList.contains('collapsed'));
  if (collapsed) await menu.locator('.nav-toggle').click();
}

async function nav(page: Page, tooltip: string) {
  await openNavIfCollapsed(page);
  await page.locator(`nav.nav-menu [data-tooltip="${tooltip}"]`).first().click();
}

/**
 * Scan the current page state, record every violation, return them.
 * The nav tip fades out over 150ms. Mid-fade, axe composites the text with
 * whatever is behind it and reports a contrast failure that is gone once the
 * tip is either fully shown or fully gone. Wait for that before scanning.
 */
async function scan(page: Page, state: string) {
  await expect
    .poll(async () =>
      page.locator('#nav-tooltip').evaluate((el) => {
        const opacity = parseFloat(getComputedStyle(el).opacity);
        return opacity === 0 || opacity === 1;
      })
    )
    .toBe(true);
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  for (const v of results.violations) {
    collected.push({
      state,
      id: v.id,
      impact: v.impact ?? 'unknown',
      help: v.help,
      nodes: v.nodes.length,
      targets: v.nodes.slice(0, 5).map((n) => String(n.target[0])),
    });
  }
  return results.violations;
}

/** Human-readable failure text so a red test says what to fix. */
function describe(violations: Awaited<ReturnType<typeof scan>>) {
  return violations
    .map(
      (v) =>
        `[${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node(s))\n` +
        v.nodes
          .slice(0, 5)
          .map((n) => `    ${String(n.target[0])}`)
          .join('\n')
    )
    .join('\n');
}

// Tests run in parallel across workers, so each worker owns its own shard of
// the report rather than racing on one file.
test.afterAll(async ({}, testInfo) => {
  const dir = path.join(process.cwd(), 'test-results');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `axe-cbapp-w${testInfo.workerIndex}.json`),
    JSON.stringify(collected, null, 2)
  );
});

test.describe('CB App — axe-core accessibility', () => {
  test('landing state (empty canvas + toolbar)', async ({ page }) => {
    await openFresh(page, { keepNotice: true });
    // v4.8.0: on http(s) the passphrase notice is part of this state.
    await expect(page.locator('#origin-notice')).toBeVisible();
    const v = await scan(page, 'landing');
    expect(describe(v), describe(v)).toBe('');
  });

  test('light mode', async ({ page }) => {
    await openFresh(page);
    await nav(page, 'Toggle Dark/Light Mode');
    // Toggle a panel too, so the active-pill colours are in the scan.
    await nav(page, 'Toggle Calculator');
    await page.waitForTimeout(300);
    const v = await scan(page, 'light-mode');
    expect(describe(v), describe(v)).toBe('');
  });

  test('note window open', async ({ page }) => {
    await openFresh(page);
    await nav(page, 'New Note');
    await expect(page.locator('.window').first()).toBeVisible();
    await page.locator('.window textarea').first().fill('Some text for the scan');
    const v = await scan(page, 'note-open');
    expect(describe(v), describe(v)).toBe('');
  });

  test('task list window open', async ({ page }) => {
    await openFresh(page);
    await nav(page, 'New Task List');
    // Task lists get .task-window, not the plain .window used by notes.
    await expect(page.locator('.task-window').first()).toBeVisible();
    const v = await scan(page, 'task-open');
    expect(describe(v), describe(v)).toBe('');
  });

  test('sticky note open', async ({ page }) => {
    await openFresh(page);
    await nav(page, 'New Sticky Note');
    await page.waitForTimeout(300);
    const v = await scan(page, 'sticky-open');
    expect(describe(v), describe(v)).toBe('');
  });

  test('calculator panel', async ({ page }) => {
    await openFresh(page);
    await nav(page, 'Toggle Calculator');
    await page.waitForTimeout(300);
    const v = await scan(page, 'calculator');
    expect(describe(v), describe(v)).toBe('');
  });

  test('clock panel', async ({ page }) => {
    await openFresh(page);
    await nav(page, 'Toggle Clock');
    await page.waitForTimeout(300);
    const v = await scan(page, 'clock');
    expect(describe(v), describe(v)).toBe('');
  });

  test('log panel', async ({ page }) => {
    await openFresh(page);
    await nav(page, 'Toggle Log');
    await page.waitForTimeout(300);
    const v = await scan(page, 'log');
    expect(describe(v), describe(v)).toBe('');
  });

  test('calendar panel', async ({ page }) => {
    await openFresh(page);
    await nav(page, 'Toggle Calendar');
    await page.waitForTimeout(500);
    const v = await scan(page, 'calendar');
    expect(describe(v), describe(v)).toBe('');
  });

  test('instructions modal', async ({ page }) => {
    await openFresh(page);
    await nav(page, 'View CB App Instructions');
    await page.waitForTimeout(500);
    const v = await scan(page, 'instructions');
    expect(describe(v), describe(v)).toBe('');
  });

  test('search / replace panel', async ({ page }) => {
    await openFresh(page);
    await nav(page, 'New Note');
    await page.locator('.window textarea').first().fill('find me');
    await nav(page, 'Search/Replace in Note');
    await page.waitForTimeout(300);
    const v = await scan(page, 'search-replace');
    expect(describe(v), describe(v)).toBe('');
  });

  test('big canvas mode', async ({ page }) => {
    await openFresh(page);
    await nav(page, 'New Note');
    await nav(page, 'Toggle the big pannable canvas');
    await page.waitForTimeout(500);
    const v = await scan(page, 'big-canvas');
    expect(describe(v), describe(v)).toBe('');
  });

  /* The two surfaces v4.2.0 added, neither of which any scan above reaches.
     Every other test goes through nav(), which opens the sheet, clicks, and
     the bubbled auto-collapse in wireMobileNav() folds it again BEFORE the
     scan runs — so the expanded sheet, twenty-odd buttons and all, was never
     looked at. The switcher is worse: it only renders at two or more windows,
     and no test above opens two. Both were clean when these were written;
     that is the point of writing them down. */
  test('mobile toolbar sheet expanded', async ({ page }) => {
    await openFresh(page);
    await openNavIfCollapsed(page);
    // On desktop the sheet is always open, so this is the toolbar as usual.
    await expect(page.locator('nav.nav-menu')).not.toHaveClass(/collapsed/);
    await page.waitForTimeout(400);
    const v = await scan(page, 'nav-sheet-open');
    expect(describe(v), describe(v)).toBe('');
  });

  test('window switcher strip (two windows)', async ({ page }) => {
    await openFresh(page);
    await nav(page, 'New Note');
    await nav(page, 'New Task List');
    await page.waitForTimeout(400);
    const v = await scan(page, 'window-switcher');
    expect(describe(v), describe(v)).toBe('');
  });
});
