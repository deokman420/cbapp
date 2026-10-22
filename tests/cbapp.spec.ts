import { test, expect, type Page, type Dialog } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';

const URL = '/cbapp.html';

/* CB App is one classic <script>, so its top-level declarations live in the
   page's global lexical scope — reachable from page.evaluate() by name, but
   not on `window` (a top-level `let` never is). Declared here so the handful
   of white-box tests below read as intentional rather than as typos. These
   exist only inside the browser context. */
declare function persistSessionPayload(session: unknown): Promise<boolean>;
declare function buildSessionSnapshot(): unknown;
declare let sessionLocked: boolean;
// v4.4.0: the calculator's unit-aware engine, and the one write that sets a
// window's home position. Both are exercised directly by the suites at the
// end of this file.
declare function evaluateExpression(expression: string): unknown;
declare function formatResult(result: unknown): string;
declare function moveWindowTo(element: HTMLElement, x: number, y: number): void;
// v4.5.0: the calculator-type registry. Asserted rather than duplicated, so a
// new calculator does not need this file edited to be covered.
declare const CALC_MODES: Array<{ id: string; label: string }>;

/**
 * MOBILE_MQ, restated for the runner.
 *
 * `isMobile` on its own used to stand in for "this project gets the phone
 * shape", and it was true for as long as every touch project in the config was
 * a phone. The iPad projects added in v4.6.0 broke that silently: Playwright
 * calls an iPad `isMobile`, and the app does not — an iPad Pro 11 is 834px
 * wide in portrait and takes the DESKTOP layout by design. Ten phone-layout
 * tests ran against a desktop layout and failed for two releases.
 *
 * So the gate is the app's own breakpoint, all three clauses of it, rather
 * than the fixture that happens to correlate with it:
 *
 *   (max-width: 720px) and (pointer: coarse)     a phone held upright
 *   (max-height: 520px) and (pointer: coarse)    the same phone turned
 *   (max-width: 560px)                           any window this narrow
 *
 * `isMobile` is the pointer half and only the pointer half.
 */
function phoneShaped(
  isMobile: boolean | undefined,
  viewport: { width: number; height: number } | null | undefined
) {
  const w = viewport?.width ?? Infinity;
  const h = viewport?.height ?? Infinity;
  if (w <= 560) return true;
  return Boolean(isMobile) && (w <= 720 || h <= 520);
}

/**
 * Boot is finished once the toolbar has been wired — the aria-labels are
 * written from data-tooltip in one pass at the end of the script.
 *
 * Asserts the label rather than visibility, which is what this used to do:
 * from v4.2.0 the toolbar rests COLLAPSED on a phone, so on the mobile
 * project every button but the hamburger is display:none until the sheet is
 * opened. The wiring runs identically either way, so this reads the same on
 * both projects while visibility no longer does.
 */
async function expectBooted(page: Page) {
  await expect(page.locator('nav.nav-menu [data-tooltip="New Note"]')).toHaveAttribute(
    'aria-label',
    /New Note/i
  );
}

/**
 * Minimised windows come back from #minimized-bar on a desktop and from
 * #stack-tabs on a phone, where full-bleed windows made a separate chip bar
 * redundant and the tab strip lists every window, minimised ones included.
 */
async function restoreFirstMinimised(page: Page) {
  const tabs = page.locator('#stack-tabs .window-tab.hidden-window');
  if (await tabs.first().isVisible().catch(() => false)) {
    await tabs.first().click();
    return;
  }
  await page.locator('#minimized-bar button').first().click();
}

/**
 * From v4.2.0 the toolbar rests COLLAPSED on a phone: every button but the ☰
 * is display:none until the sheet is open, and the sheet folds itself again
 * after each action, so it has to be re-opened per click. On desktop the nav
 * is never collapsed and both of these are no-ops — which is why they can be
 * applied unconditionally rather than branched on the project name.
 */
async function openNavIfCollapsed(page: Page) {
  const nav = page.locator('nav.nav-menu');
  const collapsed = await nav.evaluate((el) => el.classList.contains('collapsed'));
  if (collapsed) await nav.locator('.nav-toggle').click();
}

/** clickNav() by element id, for the toggles the suite reaches for directly. */
async function clickNavId(page: Page, selector: string) {
  await openNavIfCollapsed(page);
  await page.locator(selector).click();
}

/**
 * Toolbar buttons set aria-label from data-tooltip ("New Note"), while the
 * visible label stays short ("Note"). Prefer data-tooltip, then visible text
 * inside .nav-menu.
 */
async function clickNav(page: Page, opts: { tooltip?: string; text?: string | RegExp }) {
  await openNavIfCollapsed(page);
  const nav = page.locator('nav.nav-menu');
  if (opts.tooltip) {
    await nav.locator(`[data-tooltip="${opts.tooltip}"]`).first().click();
    return;
  }
  if (opts.text) {
    await nav
      .locator('button, a')
      .filter({ hasText: opts.text })
      .first()
      .click();
  }
}

/** Sequential dialog handler: string → accept(value), true → accept(), false/null → dismiss */
function installDialogQueue(page: Page, answers: Array<string | boolean | null>) {
  const queue = [...answers];
  const handler = async (dialog: Dialog) => {
    const next = queue.shift();
    if (next === undefined) {
      await dialog.dismiss().catch(() => {});
      return;
    }
    if (next === false || next === null) {
      await dialog.dismiss();
    } else if (next === true) {
      await dialog.accept();
    } else {
      await dialog.accept(String(next));
    }
  };
  page.on('dialog', handler);
  return () => page.off('dialog', handler);
}

/**
 * Passphrase entry is an in-page modal (v3.2.2), not window.prompt — the
 * secret must never render as plain text. Fills the masked field and confirms.
 */
async function enterPassphrase(page: Page, value: string, title?: RegExp) {
  const input = page.locator('#pass-modal-input');
  await expect(input).toBeVisible({ timeout: 10000 });
  if (title) {
    // Consecutive prompts reuse one element, so match the step before typing.
    await expect(page.locator('#pass-modal-title')).toHaveText(title);
  }
  await expect(input).toHaveAttribute('type', 'password');
  await input.fill(value);
  await page.locator('#pass-modal-ok').click();
}

/**
 * The in-app confirm box (v3.2.14). Optionally asserts the heading first, then
 * answers. Cancel is the default focus on destructive prompts, so both buttons
 * are clicked explicitly rather than relying on Enter.
 */
async function confirmInApp(page: Page, title?: RegExp, accept = true) {
  const modal = page.locator('#confirm-modal');
  await expect(modal).toBeVisible({ timeout: 10000 });
  if (title) {
    await expect(page.locator('#confirm-modal-title')).toHaveText(title);
  }
  await page
    .locator(accept ? '#confirm-modal-ok' : '#confirm-modal-cancel')
    .click();
  await expect(modal).toBeHidden();
}

/**
 * v4.8.0 shows #origin-notice on http(s) until this tab dismisses it. It sits
 * over the corner the lock button and the phone sheet use, so the rest of the
 * suite dismisses it the way a person clicks "Not now". Tests of the notice
 * itself go through goto and leave it up.
 */
async function dismissOriginNotice(page: Page) {
  const notice = page.locator('#origin-notice');
  if (await notice.isVisible().catch(() => false)) {
    await page.locator('#origin-notice-dismiss').click();
    await expect(notice).toBeHidden();
  }
}

async function openFresh(page: Page) {
  await page.goto(URL);
  await expect(page).toHaveTitle(/CB App/i);
  await page.waitForLoadState('domcontentloaded');
  await expectBooted(page);
  await dismissOriginNotice(page);
}

/** v4.8.0: a file that is not an encrypted backup asks before it replaces the session. */
async function acceptPlainImport(page: Page, accept = true) {
  await confirmInApp(page, /Import an unencrypted file\?/i, accept);
}

/**
 * With Protect off, v4.7.0+ stores a device envelope (mode "device"), not
 * JSON the note text can be read out of. `secret` must not appear in it.
 */
async function expectDeviceEnvelope(page: Page, secret: string) {
  await expect
    .poll(async () => {
      const raw = await page.evaluate(() => localStorage.getItem('notepadSession'));
      if (!raw || raw.includes(secret)) return 'waiting';
      try {
        const env = JSON.parse(raw);
        return env.enc === true && env.mode === 'device' && !('kdf' in env)
          ? 'device'
          : 'other';
      } catch {
        return 'waiting';
      }
    })
    .toBe('device');
}

async function statusText(page: Page) {
  return (await page.locator('#status').textContent())?.trim() || '';
}

async function forceSave(page: Page) {
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    if (typeof w.saveSession === 'function') w.saveSession();
  });
  await page.waitForTimeout(250);
}

// Counts oscillators instead of listening: the jingle is synthesised, so
// "did it play" is "did it build voices on an AudioContext".
async function countJingleVoices(page: Page) {
  await page.addInitScript(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    w.__voices = 0;
    // Playwright's WebKit build ships no Web Audio at all, so there may be
    // nothing to wrap — the app's own guard covers that case.
    const Real = w.AudioContext || w.webkitAudioContext;
    if (typeof Real !== 'function') return;
    w.AudioContext = class extends Real {
      createOscillator() {
        w.__voices++;
        return super.createOscillator();
      }
    };
  });
}

const hasWebAudio = (page: Page) =>
  page.evaluate(
    () =>
      typeof (window as any).AudioContext === 'function' ||
      typeof (window as any).webkitAudioContext === 'function'
  );

test.describe('CB App — security surface', () => {
  test('loads without third-party font/CDN requests and with hardened CSP', async ({
    page,
  }) => {
    const thirdParty: string[] = [];
    page.on('request', (req) => {
      const u = req.url();
      if (/fonts\.googleapis|fonts\.gstatic|cdnjs\.cloudflare/i.test(u)) {
        thirdParty.push(u);
      }
    });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await openFresh(page);

    const csp = await page
      .locator('meta[http-equiv="Content-Security-Policy"]')
      .getAttribute('content');
    expect(csp).toBeTruthy();
    expect(csp!).toContain("default-src 'none'");
    expect(csp!).toContain("object-src 'none'");
    expect(csp!).toContain("base-uri 'none'");
    expect(csp!).toContain("connect-src 'none'");
    expect(csp!).not.toMatch(/default-src[^;]*data:/);

    await expect(page.locator('link[href*="fonts.googleapis"]')).toHaveCount(0);
    await expect(page.locator('link[href*="fonts.gstatic"]')).toHaveCount(0);

    expect(thirdParty).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('Protect toolbar control is present', async ({ page }) => {
    await openFresh(page);
    // Present in the toolbar either way; only reachable once the toolbar is,
    // which on a phone means opening the sheet first (v4.2.0).
    await expect(page.locator('#protect-toggle')).toHaveText(/Protect/i);
    await openNavIfCollapsed(page);
    await expect(page.locator('#protect-toggle')).toBeVisible();
  });
});

test.describe('CB App — core windows', () => {
  test('Note: create, type, counts, transform, freeze, minimize, restore, close', async ({
    page,
  }) => {
    await openFresh(page);
    await expect(page.locator('#empty-state')).toBeVisible();

    await clickNav(page, { tooltip: 'New Note' });
    const note = page.locator('.window').first();
    await expect(note).toBeVisible();
    await expect(page.locator('#empty-state')).toBeHidden();

    const ta = note.locator('textarea').first();
    await ta.fill('Hello World\nSecond line');
    // Split on whitespace: Hello, World, Second, line → 4 words
    await expect(note.locator('.counts')).toContainText(/Words:\s*4/i);
    await expect(note.locator('.line-numbers')).toContainText('1');
    await expect(note.locator('.line-numbers')).toContainText('2');

    await note.locator('button', { hasText: /^Uppercase$/i }).click();
    await expect(ta).toHaveValue('HELLO WORLD\nSECOND LINE');
    await note.locator('button', { hasText: /^Lowercase$/i }).click();
    await expect(ta).toHaveValue('hello world\nsecond line');

    await note.locator('.lock-window').click();
    await expect(note).toHaveAttribute('data-locked', 'true');
    await expect(ta).toHaveAttribute('readonly', '');
    await expect
      .poll(async () => statusText(page), { timeout: 4000 })
      .toMatch(/frozen/i);

    await note.locator('.lock-window').click();
    await expect(note).not.toHaveAttribute('data-locked', 'true');

    await note.locator('.minimize-window').click();
    await expect(note).toBeHidden();
    // Whichever bar this build puts minimised windows in — see
    // restoreFirstMinimised, which is the chip bar on a desktop and the tab
    // strip on a phone.
    await restoreFirstMinimised(page);
    await expect(note).toBeVisible();

    await note.locator('.clear-note-button').click();
    await expect(ta).toHaveValue('');

    await note.locator('.close-window').click();
    await expect(page.locator('.window')).toHaveCount(0);
    await expect(page.locator('#empty-state')).toBeVisible();
  });

  test('Tasks: add, complete, delete, clear-all confirm', async ({ page }) => {
    await openFresh(page);
    await clickNav(page, { tooltip: 'New Task List' });
    const win = page.locator('.task-window').first();
    await expect(win).toBeVisible();

    const input = win.locator('.task-input');
    await input.fill('Buy milk');
    await win.locator('button', { hasText: /^Add$/i }).click();
    await expect(win.locator('.task-item')).toHaveCount(1);
    await expect(win.locator('.task-item span')).toHaveText('Buy milk');

    await input.fill('Walk dog');
    await win.locator('button', { hasText: /^Add$/i }).click();
    await expect(win.locator('.task-item')).toHaveCount(2);

    await win.locator('.task-item input[type="checkbox"]').first().check();
    await expect(win.locator('.task-item').first()).toHaveClass(/completed/);

    await win.locator('.task-delete').first().click();
    await expect(win.locator('.task-item')).toHaveCount(1);

    const unqueue = installDialogQueue(page, [true]);
    await win.locator('.clear-note-button').click();
    unqueue();
    await expect(win.locator('.task-item')).toHaveCount(0);

    await win.locator('.close-task').click();
  });

  test('Sticky note: create, type, freeze titles mention not encryption', async ({
    page,
  }) => {
    await openFresh(page);
    await clickNav(page, { tooltip: 'New Sticky Note' });
    const sticky = page.locator('.sticky-note-window').first();
    await expect(sticky).toBeVisible();
    const lock = sticky.locator('.sticky-lock-window');
    await expect(lock).toHaveAttribute('title', /not encryption/i);
    await sticky.locator('.sticky-note-content').fill('sticky body');
    await sticky.locator('.close-sticky-note').click();
    await expect(page.locator('.sticky-note-window')).toHaveCount(0);
  });

  test('T2 template loads content into a note', async ({ page }) => {
    await openFresh(page);
    await clickNav(page, { tooltip: 'View T2 Template' });
    const note = page.locator('.window').first();
    await expect(note).toBeVisible();
    const val = await note.locator('textarea').inputValue();
    expect(val.length).toBeGreaterThan(20);
    await expect(note.locator('.window-title')).toContainText(/T2/i);
  });

  test('Calculator: evaluate expression, history uses text nodes, toggle off', async ({
    page,
  }) => {
    await openFresh(page);
    await clickNavId(page, '#calculator-toggle');
    const calc = page.locator('#calculator');
    await expect(calc).toBeVisible();

    // Type expression into the field (avoids × / close-button name collisions)
    await calc.locator('.calculator-input').fill('2+3*4');
    await calc.locator('.calculator-buttons button.operation', { hasText: '=' }).click();
    await expect(calc.locator('.calculator-display')).toHaveValue('14');

    const history = calc.locator('.calculator-history');
    await expect(history).toContainText('14');
    expect(await history.locator('p').count()).toBeGreaterThan(0);

    await clickNavId(page, '#calculator-toggle');
    await expect(page.locator('#calculator')).toHaveCount(0);
  });

  test('Clock and Log toggle', async ({ page }) => {
    await openFresh(page);

    await clickNavId(page, '#clock-toggle');
    await expect(page.locator('#clock')).toBeVisible();
    await expect(page.locator('#clock-time-clock')).not.toBeEmpty();
    await clickNavId(page, '#clock-toggle');
    await expect(page.locator('#clock')).toHaveCount(0);

    await clickNavId(page, '#log-toggle');
    const log = page.locator('#log');
    await expect(log).toBeVisible();
    await log.locator('input.log-input, .log-input, input[type="text"]').first().fill('did a thing');
    await log.locator('button', { hasText: /^Log$/i }).click();
    await expect(log.locator('.log-item')).toHaveCount(1);
    await clickNavId(page, '#log-toggle');
    await expect(page.locator('#log')).toHaveCount(0);
  });

  test('Help opens and documents Protect + Freeze', async ({ page }) => {
    await openFresh(page);
    await clickNav(page, { tooltip: 'View CB App Instructions' });
    const help = page.locator('.help-window').first();
    await expect(help).toBeVisible();
    const text = await help.locator('.help-text').innerText();
    expect(text).toMatch(/Protect/i);
    expect(text).toMatch(/Freeze|freezes/i);
    expect(text).toMatch(/not encryption|not a password/i);
    await help.locator('.close-window').click();
  });
});

test.describe('CB App — toolbar tools', () => {
  test('Search/replace in active note', async ({ page }) => {
    await openFresh(page);
    await clickNav(page, { tooltip: 'New Note' });
    const ta = page.locator('.window textarea').first();
    await ta.fill('alpha beta alpha');
    await page.locator('.window').first().click();

    await clickNavId(page, '#search-btn');
    await expect(page.locator('#search-replace')).toHaveClass(/active/);
    await page.locator('#search-input').fill('alpha');
    await page.locator('#replace-input').fill('gamma');
    await page.locator('#search-replace button', { hasText: /^Apply$/i }).click();
    await expect(ta).toHaveValue('gamma beta gamma');
    await page.locator('#search-replace button', { hasText: /^Close$/i }).click();
  });

  test('Theme toggles light/dark class on body', async ({ page }) => {
    await openFresh(page);
    await expect(page.locator('body')).toHaveClass(/dark-mode/);
    await clickNavId(page, '#theme-toggle');
    await expect(page.locator('body')).toHaveClass(/light-mode/);
    await clickNavId(page, '#theme-toggle');
    await expect(page.locator('body')).toHaveClass(/dark-mode/);
  });

  test('Canvas mode + zoom controls', async ({ page }) => {
    await openFresh(page);
    await clickNavId(page, '#canvas-toggle');
    await expect(page.locator('body')).toHaveClass(/canvas-on/);
    await expect(page.locator('#canvas-controls')).toBeVisible();

    await page.locator('#canvas-controls button[aria-label="Zoom in"]').click();
    await expect
      .poll(async () => (await page.locator('#zoom-level').textContent())?.trim(), {
        timeout: 3000,
      })
      .not.toBe('100%');

    // Matched on a prefix, not the whole string: v4.0.2 folded the visible "1:1"
    // into the accessible name so speech control can reach the button.
    await page.locator('#canvas-controls button[aria-label^="1:1"]').click();
    await expect
      .poll(async () => (await page.locator('#zoom-level').textContent())?.trim(), {
        timeout: 3000,
      })
      .toBe('100%');

    await clickNavId(page, '#canvas-toggle');
    await expect(page.locator('body')).not.toHaveClass(/canvas-on/);
  });

  test('Canvas world covers the viewport at every zoom, so drags reach the edges', async ({
    page,
  }) => {
    await openFresh(page);
    await clickNavId(page, '#canvas-toggle');
    await expect(page.locator('body')).toHaveClass(/canvas-on/);

    // Regression: the world was 3 viewports (CANVAS_MULTIPLE) while ZOOM_MIN
    // 0.25 let the screen span 4 of them. Below 1/3 zoom the scaled world was
    // smaller than the viewport, clampPan() centred it, and clampBounds() —
    // which is in world coordinates — stopped a dragged window well inboard of
    // the screen edge. It read as the window being forced back to the centre.
    const margins = await page.evaluate(() => {
      const w = window as any;
      // `view` is a top-level `const`, so it is a lexical global and never
      // lands on `window`. screenToWorld() is a function declaration and does,
      // so read the transform back out through it instead.
      const readView = () => {
        const o = w.screenToWorld(0, 0);
        const zoom = 1 / (w.screenToWorld(1, 0).x - o.x);
        return { zoom, x: -o.x * zoom, y: -o.y * zoom };
      };
      const out: { zoom: number; marginX: number; marginY: number }[] = [];
      for (const z of [1, 0.5, 0.34, 0.33, 0.3, 0.25]) {
        w.setZoom(z, window.innerWidth / 2, window.innerHeight / 2);
        const world = w.computeWorldSize();
        const v = readView();
        out.push({
          zoom: z,
          marginX: Math.max(0, (window.innerWidth - world.w * v.zoom) / 2),
          marginY: Math.max(0, (window.innerHeight - world.h * v.zoom) / 2),
        });
      }
      return out;
    });
    for (const m of margins) {
      expect(m.marginX, `dead margin at zoom ${m.zoom}`).toBeLessThanOrEqual(0);
      expect(m.marginY, `dead margin at zoom ${m.zoom}`).toBeLessThanOrEqual(0);
    }

    // And prove it end to end: at maximum zoom-out, drag a window past the
    // bottom-right of the screen and check where its corner actually lands.
    const corner = await page.evaluate(() => {
      const w = window as any;
      const readView = () => {
        const o = w.screenToWorld(0, 0);
        const zoom = 1 / (w.screenToWorld(1, 0).x - o.x);
        return { zoom, x: -o.x * zoom, y: -o.y * zoom };
      };
      w.setZoom(0.25, window.innerWidth / 2, window.innerHeight / 2);
      w.addWindow();
      const el = [...document.querySelectorAll('[id^="window"]')].pop() as HTMLElement;
      const header = el.querySelector('.window-header') as HTMLElement;
      const r = el.getBoundingClientRect();
      const send = (type: string, x: number, y: number) =>
        header.dispatchEvent(
          new PointerEvent(type, {
            pointerId: 9,
            clientX: x,
            clientY: y,
            button: 0,
            buttons: 1,
            bubbles: true,
            cancelable: true,
          })
        );
      send('pointerdown', r.left + 20, r.top + 5);
      send('pointermove', window.innerWidth + 4000, window.innerHeight + 4000);
      const x = Number(el.dataset.x);
      const y = Number(el.dataset.y);
      send('pointerup', window.innerWidth + 4000, window.innerHeight + 4000);
      const v = readView();
      return {
        screenX: (x + el.offsetWidth) * v.zoom + v.x,
        screenY: (y + el.offsetHeight) * v.zoom + v.y,
        vw: window.innerWidth,
        vh: window.innerHeight,
      };
    });
    // The 12px world pad, scaled by 0.25, is the only gap allowed.
    expect(corner.vw - corner.screenX).toBeLessThanOrEqual(4);
    expect(corner.vh - corner.screenY).toBeLessThanOrEqual(4);
  });

  test('Copy button on note reports success or fallback', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
    await openFresh(page);
    await clickNav(page, { tooltip: 'New Note' });
    const note = page.locator('.window').first();
    await note.locator('textarea').fill('copy-me-please');
    await note.locator('button', { hasText: /^Copy$/i }).click();
    await expect
      .poll(async () => statusText(page), { timeout: 4000 })
      .toMatch(/Copied|clipboard|Ctrl\+C/i);
  });
});

/**
 * v3.2.10 — the two modes are two desks and a window belongs to the one it was
 * created on. v3.2.9 gave each mode its own positions while every window stayed
 * in both, so opening a T2 template on the canvas also put one in windowed
 * mode. Membership is what has to be per-mode.
 */
test.describe('CB App — windows belong to the mode they were created in', () => {
  /** id, mode and whether each window is actually rendered. */
  const desks = (page: Page) =>
    page.evaluate(() =>
      [
        ...document.querySelectorAll(
          '.window, .task-window, .sticky-note-window, .t2-window, .clock-window, .calculator-window, .log-window, .help-window'
        ),
      ].map((el) => ({
        id: el.id,
        mode: (el as HTMLElement).dataset.mode,
        rendered: (el as HTMLElement).offsetWidth > 0,
      }))
    );

  test('a window created on the canvas does not appear in the plain view', async ({
    page,
  }) => {
    await openFresh(page);
    await clickNav(page, { tooltip: 'New Note' });
    const windowed = await page.locator('.window').first().getAttribute('id');

    await clickNavId(page, '#canvas-toggle');
    await expect(page.locator('body')).toHaveClass(/canvas-on/);
    // The windowed note is not on this desk.
    expect((await desks(page)).find((w) => w.id === windowed)?.rendered).toBe(false);

    // This is the reported bug: a T2 template opened here used to appear in
    // both modes at once.
    await clickNav(page, { tooltip: 'View T2 Template' });
    const onCanvas = (await desks(page)).filter((w) => w.rendered);
    expect(onCanvas).toHaveLength(1);
    const canvasWindow = onCanvas[0].id;
    expect(canvasWindow).not.toBe(windowed);
    expect(onCanvas[0].mode).toBe('canvas');

    await clickNavId(page, '#canvas-toggle');
    await expect(page.locator('body')).not.toHaveClass(/canvas-on/);
    const back = await desks(page);
    expect(back.find((w) => w.id === windowed)?.rendered).toBe(true);
    expect(back.find((w) => w.id === canvasWindow)?.rendered).toBe(false);
  });

  test('an empty canvas shows the empty-state hint rather than nothing', async ({
    page,
  }) => {
    await openFresh(page);
    await clickNav(page, { tooltip: 'New Note' });
    // The hint is suppressed while a window is open...
    await expect(page.locator('#empty-state')).toBeHidden();
    await clickNavId(page, '#canvas-toggle');
    // ...and must come back on a canvas that has none of its own, or the
    // toggle just looks like everything was deleted.
    await expect(page.locator('#empty-state')).toBeVisible();
  });

  test('mode membership survives a reload', async ({ page }) => {
    await openFresh(page);
    await clickNav(page, { tooltip: 'New Note' });
    const windowed = await page.locator('.window').first().getAttribute('id');
    await clickNavId(page, '#canvas-toggle');
    await clickNav(page, { tooltip: 'New Note' });
    await forceSave(page);

    await page.reload();
    await expectBooted(page);
    await expect(page.locator('body')).toHaveClass(/canvas-on/);
    const onCanvas = (await desks(page)).filter((w) => w.rendered);
    expect(onCanvas).toHaveLength(1);
    expect(onCanvas[0].id).not.toBe(windowed);

    await clickNavId(page, '#canvas-toggle');
    const inWindowed = (await desks(page)).filter((w) => w.rendered);
    expect(inWindowed).toHaveLength(1);
    expect(inWindowed[0].id).toBe(windowed);
  });

  test('minimising is per-window and independent of which desk is showing', async ({
    page,
  }) => {
    await openFresh(page);
    await clickNav(page, { tooltip: 'New Note' });
    await clickNavId(page, '#canvas-toggle');
    await clickNav(page, { tooltip: 'New Note' });
    const canvasNote = (await desks(page)).filter((w) => w.rendered)[0].id;
    await page.locator('#' + canvasNote + ' .minimize-window').click();
    await expect(page.locator('#minimized-bar button')).toHaveCount(1);

    // The other desk's windows are not open as far as this desk is concerned,
    // so they must not appear in its chip bar — minimised or otherwise.
    await clickNavId(page, '#canvas-toggle');
    await expect(page.locator('#minimized-bar button')).toHaveCount(0);

    // And the canvas note is still minimised when we come back to it.
    await clickNavId(page, '#canvas-toggle');
    await expect(page.locator('#minimized-bar button')).toHaveCount(1);
  });

  test('each desk gets its own Clock, and neither disturbs the other', async ({
    page,
  }) => {
    await openFresh(page);
    await clickNavId(page, '#clock-toggle');
    await expect(page.locator('#clock')).toBeVisible();

    // v3.2.13: pressing Clock on the canvas builds a *second* clock rather
    // than dragging the one across. Before that a single fixed id meant the
    // button here could only move — or, earlier still, destroy — the clock
    // belonging to a desk this one cannot even see.
    await clickNavId(page, '#canvas-toggle');
    await expect(page.locator('#clock')).toBeHidden();
    await clickNavId(page, '#clock-toggle');
    await expect(page.locator('#clock-canvas')).toBeVisible();
    expect(await page.locator('#clock-canvas').getAttribute('data-mode')).toBe(
      'canvas'
    );
    expect(await page.locator('.clock-window').count()).toBe(2);

    // Closing one leaves the other alone.
    await clickNavId(page, '#clock-toggle');
    await expect(page.locator('#clock-canvas')).toHaveCount(0);
    await clickNavId(page, '#canvas-toggle');
    await expect(page.locator('#clock')).toBeVisible();
  });

  /* The canvas world is several viewports wide, so "centred" means a negative
     pan of half the overhang. Read the world off the layer rather than
     recomputing WORLD_MULTIPLE here, so the test doesn't have to track it. */
  async function canvasGeometry(page: Page) {
    return page.evaluate(() => {
      const layer = document.getElementById('windows') as HTMLElement;
      const s = JSON.parse(localStorage.getItem('notepadSession') as string);
      return {
        worldW: layer.offsetWidth,
        worldH: layer.offsetHeight,
        x: s.canvas.x as number,
        y: s.canvas.y as number,
        seen: s.canvas.seen as boolean | undefined,
        vw: window.innerWidth,
        vh: window.innerHeight,
      };
    });
  }

  async function expectCentred(page: Page) {
    const g = await canvasGeometry(page);
    expect(g.worldW).toBeGreaterThan(g.vw);
    /* Within a pixel, not toBeCloseTo(_, 0), which is a strict "< 0.5". An
       odd-width viewport — 393px on the mobile project — makes the exact
       centre land on a half pixel, and the layout rounds it away. A one-pixel
       tolerance still catches the corner-anchored regression this guards,
       which was off by hundreds. */
    expect(Math.abs(g.x - (g.vw - g.worldW) / 2)).toBeLessThanOrEqual(1);
    expect(Math.abs(g.y - (g.vh - g.worldH) / 2)).toBeLessThanOrEqual(1);
  }

  test('the canvas opens centred, not in the top-left corner', async ({ page }) => {
    await openFresh(page);
    await clickNavId(page, '#canvas-toggle');
    await forceSave(page);
    await expectCentred(page);
  });

  test('a session that saved with the canvas off still opens it centred', async ({
    page,
  }) => {
    /* The v3.2.11 bug. Any save made with the canvas off wrote a placeholder
       viewpoint of {0, 0, zoom 1} — the top-left corner — and the next boot
       read that back as a real remembered position, so the "first visit
       centres" branch never ran again. Merely opening the app once and
       reloading was enough to poison it. */
    await openFresh(page);
    await forceSave(page);
    expect(await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('notepadSession') as string);
      return s.canvas.seen;
    })).toBe(false);

    await page.reload();
    await expectBooted(page);
    await clickNavId(page, '#canvas-toggle');
    await forceSave(page);
    await expectCentred(page);
  });

  test('a pre-3.2.12 corner viewpoint is read as "never been", and boots centred', async ({
    page,
  }) => {
    await openFresh(page);
    await forceSave(page);
    // Exactly what 3.2.9–3.2.11 wrote for a session that had never opened the
    // canvas, plus canvas:on so the corner is what boot would land on.
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).saveSession = () => {};
      const raw = JSON.parse(localStorage.getItem('notepadSession') as string);
      raw.canvas = { on: true, x: 0, y: 0, zoom: 1 };
      localStorage.setItem('notepadSession', JSON.stringify(raw));
    });

    await page.reload();
    await expectBooted(page);
    await expect(page.locator('body')).toHaveClass(/canvas-on/);
    await forceSave(page);
    await expectCentred(page);
  });

  test('a real pre-3.2.12 viewpoint is not mistaken for the placeholder', async ({
    page,
  }) => {
    await openFresh(page);
    await forceSave(page);
    // Same era, same silence about `seen` — but a position the user actually
    // panned to. The upgrade must leave it exactly where it is.
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).saveSession = () => {};
      const raw = JSON.parse(localStorage.getItem('notepadSession') as string);
      raw.canvas = { on: true, x: -512, y: -384, zoom: 1 };
      localStorage.setItem('notepadSession', JSON.stringify(raw));
    });

    await page.reload();
    await expectBooted(page);
    await forceSave(page);
    const g = await canvasGeometry(page);
    expect(g.x).toBe(-512);
    expect(g.y).toBe(-384);
  });

  /* v4.1.2. The world is derived from window.innerWidth/Height, which is not a
     stable quantity — docking devtools, snapping the browser to half the
     screen, or rotating a tablet all shrink it. A reload starts the world at
     zero and re-derives it, so restoring in that shrunken state computed a
     world smaller than the one the saved coordinates were laid out on, and the
     restore clamp then dragged every far-flung window back onto the new edge.
     They ended up piled in a corner, and saveSession() wrote the pile straight
     back out, so closing devtools could not undo it.

     Put a note out past where a 700px-wide viewport's world would end, then
     reload at that width and check it has not moved. */
  async function noteParkedFarOut(page: Page) {
    /* The scenario is "was on a big screen, then the viewport shrank", so the
       big screen has to be real regardless of which project is running. On the
       mobile project the default 393px viewport built a world barely wider
       than the 700px this later shrinks to, and the test's own precondition
       (the shrunken world cannot hold the note) stopped being true. */
    await page.setViewportSize({ width: 1280, height: 800 });
    await openFresh(page);
    await clickNavId(page, '#canvas-toggle');
    await expect(page.locator('body')).toHaveClass(/canvas-on/);
    await clickNav(page, { tooltip: 'New Note' });
    await expect(page.locator('#windows .window').first()).toBeVisible();

    // Park it near the far corner of the world this (wide) viewport built.
    return page.evaluate(() => {
      const layer = document.getElementById('windows') as HTMLElement;
      const el = layer.querySelector('.window') as HTMLElement;
      const x = layer.offsetWidth - el.offsetWidth - 200;
      const y = layer.offsetHeight - el.offsetHeight - 200;
      // moveWindowTo(), not three hand-written property writes: from v4.4.0 a
      // position and a HOME position are two different fields, and the one
      // that is saved is home. Standing in for a drag means setting both,
      // which is the whole reason that helper exists.
      moveWindowTo(el, x, y);
      return { id: el.id, x, y, worldW: layer.offsetWidth };
    });
  }

  async function noteSpot(page: Page, id: string) {
    return page.evaluate((noteId) => {
      const el = document.getElementById(noteId) as HTMLElement;
      return { x: parseFloat(el.dataset.x || '0'), y: parseFloat(el.dataset.y || '0') };
    }, id);
  }

  test('restoring on a shrunken viewport leaves canvas windows where they are', async ({
    page,
  }) => {
    const parked = await noteParkedFarOut(page);
    await forceSave(page);

    // Devtools docked to the side: the viewport loses most of its width, and
    // the world derived from it would be far too small to hold that note.
    await page.setViewportSize({ width: 700, height: 500 });
    await page.reload();
    await expectBooted(page);
    await expect(page.locator('body')).toHaveClass(/canvas-on/);

    expect(700 * 4).toBeLessThan(parked.x); // the shrunken world really is too small
    const after = await noteSpot(page, parked.id);
    expect(after.x).toBeCloseTo(parked.x, 0);
    expect(after.y).toBeCloseTo(parked.y, 0);
  });

  test('a session saved before the world was persisted is rescued by measuring the windows', async ({
    page,
  }) => {
    const parked = await noteParkedFarOut(page);
    await forceSave(page);
    // Exactly what every build up to 4.1.1 wrote: a viewpoint, no world.
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).saveSession = () => {};
      const raw = JSON.parse(localStorage.getItem('notepadSession') as string);
      delete raw.canvas.worldW;
      delete raw.canvas.worldH;
      localStorage.setItem('notepadSession', JSON.stringify(raw));
    });

    await page.setViewportSize({ width: 700, height: 500 });
    await page.reload();
    await expectBooted(page);

    const after = await noteSpot(page, parked.id);
    expect(after.x).toBeCloseTo(parked.x, 0);
    expect(after.y).toBeCloseTo(parked.y, 0);
  });

  /* Calc / Clock / Log are one window each, and that window lives on one desk.
     The lit toolbar button has to answer "is it open *here*", which changes
     when you switch desks without anyone touching the window. */
  async function litToggles(page: Page) {
    return page.evaluate(() =>
      ['calculator-toggle', 'clock-toggle', 'log-toggle'].filter((id) =>
        document.getElementById(id)!.classList.contains('active')
      )
    );
  }

  test('the singleton toggles only light up for the desk showing them', async ({
    page,
  }) => {
    await openFresh(page);
    await clickNavId(page, '#calculator-toggle');
    await clickNavId(page, '#clock-toggle');
    await clickNavId(page, '#log-toggle');
    expect(await litToggles(page)).toEqual([
      'calculator-toggle',
      'clock-toggle',
      'log-toggle',
    ]);

    // All three are on the plain view. The canvas is a different desk, so
    // nothing is open there and nothing may claim to be.
    await clickNavId(page, '#canvas-toggle');
    await expect(page.locator('#calculator')).toBeHidden();
    expect(await litToggles(page)).toEqual([]);

    await clickNavId(page, '#canvas-toggle');
    expect(await litToggles(page)).toEqual([
      'calculator-toggle',
      'clock-toggle',
      'log-toggle',
    ]);
  });

  test('opening one on the canvas lights that desk only', async ({ page }) => {
    await openFresh(page);
    await clickNavId(page, '#calculator-toggle');
    await clickNavId(page, '#clock-toggle');

    // A calculator on the canvas is a second, independent window. The plain
    // view keeps its own, so coming back both of its buttons are still lit.
    await clickNavId(page, '#canvas-toggle');
    expect(await litToggles(page)).toEqual([]);
    await clickNavId(page, '#calculator-toggle');
    await expect(page.locator('#calculator-canvas')).toBeVisible();
    expect(await litToggles(page)).toEqual(['calculator-toggle']);

    await clickNavId(page, '#canvas-toggle');
    expect(await litToggles(page)).toEqual([
      'calculator-toggle',
      'clock-toggle',
    ]);
    expect(await page.locator('.calculator').count()).toBe(2);
  });

  test('the two Logs keep separate entries', async ({ page }) => {
    await openFresh(page);
    await clickNavId(page, '#log-toggle');
    const plainLog = page.locator('#log');
    await plainLog.locator('.log-input').fill('plain-view-entry');
    await plainLog.locator('button', { hasText: /^Log$/i }).click();
    await expect(plainLog.locator('.log-item')).toHaveCount(1);

    await clickNavId(page, '#canvas-toggle');
    await clickNavId(page, '#log-toggle');
    const canvasLog = page.locator('#log-canvas');
    await expect(canvasLog.locator('.log-item')).toHaveCount(0);
    await canvasLog.locator('.log-input').fill('canvas-entry');
    await canvasLog.locator('button', { hasText: /^Log$/i }).click();
    await expect(canvasLog.locator('.log-item')).toHaveCount(1);
    await expect(canvasLog).toContainText('canvas-entry');
    await expect(canvasLog).not.toContainText('plain-view-entry');

    // Both survive a reload, still on their own desks and still separate.
    await forceSave(page);
    await page.reload();
    await expectBooted(page);
    await expect(page.locator('#log-canvas')).toContainText('canvas-entry');
    await expect(page.locator('#log-canvas')).not.toContainText('plain-view-entry');
    await clickNavId(page, '#canvas-toggle');
    await expect(page.locator('#log')).toContainText('plain-view-entry');
    await expect(page.locator('#log')).not.toContainText('canvas-entry');
  });

  test('the two Calculators keep separate histories', async ({ page }) => {
    await openFresh(page);
    await clickNavId(page, '#calculator-toggle');
    await page.locator('#calculator .calculator-input').fill('2+2');
    await page
      .locator('#calculator .calculator-buttons button.operation', { hasText: '=' })
      .click();
    await expect(page.locator('#calculator .calculator-display')).toHaveValue('4');

    await clickNavId(page, '#canvas-toggle');
    await clickNavId(page, '#calculator-toggle');
    // A fresh history, and its own keypad: with one shared set of element ids
    // this "=" drove the plain view's calculator instead.
    await expect(page.locator('#calculator-canvas .calculator-history')).toBeEmpty();
    await page.locator('#calculator-canvas .calculator-input').fill('10*10');
    await page
      .locator('#calculator-canvas .calculator-buttons button.operation', {
        hasText: '=',
      })
      .click();
    await expect(page.locator('#calculator-canvas .calculator-display')).toHaveValue(
      '100'
    );
    await expect(page.locator('#calculator-canvas .calculator-history')).toContainText(
      '100'
    );
    await expect(
      page.locator('#calculator-canvas .calculator-history')
    ).not.toContainText('2+2');

    await clickNavId(page, '#canvas-toggle');
    await expect(page.locator('#calculator .calculator-display')).toHaveValue('4');
    await expect(page.locator('#calculator .calculator-history')).toContainText('2+2');
  });

  test('the two Clocks tick independently and keep separate stopwatches', async ({
    page,
  }) => {
    await openFresh(page);
    await clickNavId(page, '#clock-toggle');
    await clickNavId(page, '#canvas-toggle');
    await clickNavId(page, '#clock-toggle');

    // One shared interval meant opening the second clock stopped the first.
    await expect(page.locator('#clock-time-clock')).not.toBeEmpty();
    await expect(page.locator('#clock-time-clock-canvas')).not.toBeEmpty();

    // Run the canvas stopwatch; the plain view's must stay at zero.
    await page
      .locator('#clock-canvas button', { hasText: /^Start$/ })
      .first()
      .click();
    await expect
      .poll(async () =>
        page.locator('#stopwatch-display-clock-canvas').textContent()
      )
      .not.toBe('00:00:00.000');
    expect(
      await page.locator('#stopwatch-display-clock').textContent()
    ).toBe('00:00:00.000');
  });

  test('Help opens per desk too', async ({ page }) => {
    await openFresh(page);
    await clickNav(page, { tooltip: 'View CB App Instructions' });
    await expect(page.locator('#help-window')).toBeVisible();
    await clickNavId(page, '#canvas-toggle');
    await expect(page.locator('#help-window')).toBeHidden();
    await clickNav(page, { tooltip: 'View CB App Instructions' });
    await expect(page.locator('#help-window-canvas')).toBeVisible();
    expect(await page.locator('.help-window').count()).toBe(2);
  });

  test('closing a singleton from the toolbar clears its button and the chrome', async ({
    page,
  }) => {
    await openFresh(page);
    await clickNavId(page, '#log-toggle');
    await expect(page.locator('#empty-state')).toBeHidden();
    expect(await litToggles(page)).toEqual(['log-toggle']);

    // This path never called refreshChrome(), so the empty-state hint stayed
    // suppressed by a window that had just been removed.
    await clickNavId(page, '#log-toggle');
    await expect(page.locator('#log')).toHaveCount(0);
    expect(await litToggles(page)).toEqual([]);
    await expect(page.locator('#empty-state')).toBeVisible();
  });

  test('the lit buttons survive a reload on the desk that owns them', async ({
    page,
  }) => {
    await openFresh(page);
    await clickNavId(page, '#clock-toggle');
    await clickNavId(page, '#canvas-toggle');
    await clickNavId(page, '#log-toggle'); // log opens on the canvas
    await forceSave(page);

    await page.reload();
    await expectBooted(page);
    await expect(page.locator('body')).toHaveClass(/canvas-on/);
    expect(await litToggles(page)).toEqual(['log-toggle']);
    await clickNavId(page, '#canvas-toggle');
    expect(await litToggles(page)).toEqual(['clock-toggle']);
  });

  test('the canvas viewpoint is remembered across a round trip', async ({ page }) => {
    await openFresh(page);
    await clickNavId(page, '#canvas-toggle');
    await page.evaluate(() =>
      (window as any).setZoom(0.5, window.innerWidth / 2, window.innerHeight / 2)
    );
    await expect
      .poll(async () => (await page.locator('#zoom-level').textContent())?.trim())
      .toBe('50%');

    await clickNavId(page, '#canvas-toggle');
    await clickNavId(page, '#canvas-toggle');
    await expect
      .poll(async () => (await page.locator('#zoom-level').textContent())?.trim())
      .toBe('50%');
  });

  test('a minimised window keeps its size across a reload', async ({ page }) => {
    await openFresh(page);
    await clickNav(page, { tooltip: 'New Note' });
    const id = await page.locator('.window').first().getAttribute('id');
    /* The width the app itself considers this window's, read through the same
       fallback chain measuredBox() uses. On a desktop that is the rendered
       box. On a phone the rendered box is full-bleed CSS and deliberately not
       the window's size at all — v4.2.0 freezes geometry in stack mode so a
       390px screen cannot overwrite the size the note was given on a real
       one — and the stored box is the honest answer on both. */
    const believedWidth = () =>
      page.evaluate((id) => {
        const el = document.getElementById(id!) as HTMLElement;
        return (
          parseFloat(el.dataset.boxW || '') ||
          parseFloat(el.dataset.width || '') ||
          el.offsetWidth
        );
      }, id);
    const before = await believedWidth();
    expect(before).toBeGreaterThan(0);

    // Regression: offsetWidth reads 0 while display:none, so the save that
    // followed a minimise wrote width:0 into the record and restore rebuilt a
    // 0px window that came back from the chip bar invisible.
    await page.locator('#' + id + ' .minimize-window').click();
    await forceSave(page);
    const saved = await page.evaluate((id) => {
      const s = JSON.parse(localStorage.getItem('notepadSession') as string);
      return s[id!].width;
    }, id);
    expect(saved).toBe(before);

    await page.reload();
    await expectBooted(page);
    await restoreFirstMinimised(page);
    await expect.poll(believedWidth).toBe(before);
  });

  test('a window keeps its size while the other desk is showing', async ({ page }) => {
    await openFresh(page);
    await clickNav(page, { tooltip: 'New Note' });
    const id = await page.locator('.window').first().getAttribute('id');
    const width = (id: string | null) =>
      page.evaluate((id) => document.getElementById(id!)!.offsetWidth, id);
    const before = await width(id);
    expect(before).toBeGreaterThan(100);

    /* Regression: hiding a window fires the ResizeObserver, because its box
       genuinely did change — to nothing. updateWindowSize() then measured a
       collapsed box and wrote the result straight back as style.width, so a
       trip to the canvas and back permanently shrank every note to 32px. */
    await clickNavId(page, '#canvas-toggle');
    await page.waitForTimeout(300);
    await clickNavId(page, '#canvas-toggle');
    await expect.poll(() => width(id)).toBe(before);

    // And the size that reaches storage is the real one, not the collapsed one.
    await forceSave(page);
    const saved = await page.evaluate((id) => {
      const s = JSON.parse(localStorage.getItem('notepadSession') as string);
      return s[id!].width;
    }, id);
    expect(saved).toBe(before);
  });

  test('a pre-3.2.13 session restores its one Calc/Clock/Log onto the desk it names', async ({
    page,
  }) => {
    await openFresh(page);
    await forceSave(page);
    /* Exactly what 3.2.10-3.2.12 wrote: one record per kind, under the
       unsuffixed key, carrying the desk in its own `mode`. The calculator was
       on the canvas, the log in the plain view — so they must come back on
       different desks, under different ids, from keys that say neither. */
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).saveSession = () => {};
      const raw = JSON.parse(localStorage.getItem('notepadSession') as string);
      raw.calculator = {
        visible: true,
        mode: 'canvas',
        history: [{ expression: '6*7', result: '42' }],
        position: { left: '80', top: '90' },
        width: '350',
        locked: false,
        minimized: false,
      };
      raw.log = {
        visible: true,
        mode: 'windowed',
        position: { left: '60', top: '70' },
        width: '400',
        height: '400',
        name: 'Log',
        locked: false,
        minimized: false,
        logs: [{ timestamp: '01/01/2026', description: 'legacy-entry' }],
      };
      raw.canvas = { on: false, seen: true, x: -100, y: -100, zoom: 1 };
      localStorage.setItem('notepadSession', JSON.stringify(raw));
    });

    await page.reload();
    await expectBooted(page);

    // Plain view: the log, with its entry. No calculator here.
    await expect(page.locator('#log')).toBeVisible();
    await expect(page.locator('#log')).toContainText('legacy-entry');
    expect(await page.locator('.calculator').count()).toBe(1);
    await expect(page.locator('#calculator-canvas')).toBeHidden();

    // Canvas: the calculator, under its canvas id, history intact.
    await clickNavId(page, '#canvas-toggle');
    await expect(page.locator('#calculator-canvas')).toBeVisible();
    await expect(
      page.locator('#calculator-canvas .calculator-history')
    ).toContainText('42');
    await expect(page.locator('#log')).toBeHidden();
  });

  test('a pre-3.2.10 session lands on the desk it was saved looking at', async ({
    page,
  }) => {
    await openFresh(page);
    await clickNav(page, { tooltip: 'New Note' });
    await page.locator('.window').first().locator('textarea').fill('legacy-note');
    await clickNavId(page, '#canvas-toggle');
    await forceSave(page);

    // Strip the modes, exactly as a session written by 3.2.9 or earlier has
    // them: absent. Reading that silence as "the plain view" would restore
    // this note onto the desk the user was not looking at, and the canvas
    // would come up empty — indistinguishable from having lost it.
    //
    // saveSession is neutered first, in the same evaluate: the app has
    // debounced saves in flight after a canvas toggle, and one landing between
    // the rewrite and the reload puts the modes straight back. (It is a
    // top-level function declaration, so the global property IS the binding
    // the app's own internal calls resolve.)
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).saveSession = () => {};
      const raw = JSON.parse(localStorage.getItem('notepadSession') as string);
      for (const k of Object.keys(raw)) {
        if (raw[k] && typeof raw[k] === 'object') delete raw[k].mode;
      }
      localStorage.setItem('notepadSession', JSON.stringify(raw));
    });

    await page.reload();
    await expectBooted(page);
    await expect(page.locator('body')).toHaveClass(/canvas-on/);
    const note = page.locator('.window').first();
    await expect(note).toBeVisible();
    await expect(note.locator('textarea')).toHaveValue('legacy-note');
    expect(await note.getAttribute('data-mode')).toBe('canvas');
  });

  test('a malformed mode is coerced, not fatal to the session', async ({ page }) => {
    await openFresh(page);
    await clickNav(page, { tooltip: 'New Note' });
    await page.locator('.window').first().locator('textarea').fill('survive-me');
    await forceSave(page);
    await page.evaluate(() => {
      // Same reason as the legacy test above: stop the app writing over the
      // payload we are planting before the reload picks it up.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).saveSession = () => {};
      const raw = JSON.parse(localStorage.getItem('notepadSession') as string);
      const key = Object.keys(raw).find((k) => k.startsWith('window'));
      raw[key as string].mode = { evil: true };
      localStorage.setItem('notepadSession', JSON.stringify(raw));
    });
    await page.reload();
    await expectBooted(page);
    const note = page.locator('.window').first();
    await expect(note.locator('textarea')).toHaveValue('survive-me');
    // Anything that is not "canvas" means the plain view.
    expect(await note.getAttribute('data-mode')).toBe('windowed');
  });
});

test.describe('CB App — clock layout', () => {
  test('no dead space between the stopwatch and the countdown', async ({ page }) => {
    await openFresh(page);
    await clickNavId(page, '#clock-toggle');
    const m = await page.evaluate(() => {
      const c = document.getElementById('clock') as HTMLElement;
      const content = c.querySelector('.clock-content') as HTMLElement;
      const countdown = c.querySelector('.countdown-timer-container') as HTMLElement;
      const stopwatch = (
        c.querySelector('[id^="stopwatch-display"]') as HTMLElement
      ).parentElement as HTMLElement;
      return {
        // The countdown used to be a sibling *below* the flex:1 scroller, so
        // every surplus pixel of window height opened as a gap right here.
        countdownInsideContent: content.contains(countdown),
        gap: countdown.getBoundingClientRect().top - stopwatch.getBoundingClientRect().bottom,
        vScroll: content.scrollHeight - content.clientHeight,
        hScroll: content.scrollWidth - content.clientWidth,
        controlsH: (c.querySelector('.countdown-controls') as HTMLElement).offsetHeight,
        contentW: content.clientWidth,
        contentH: content.clientHeight,
        overflowY: getComputedStyle(content).overflowY,
      };
    });
    expect(m.countdownInsideContent).toBe(true);
    expect(m.gap).toBeLessThanOrEqual(16);
    /* The default size fits every section exactly: no scrollbar either way.
       Except where the screen itself is shorter than the clock — a phone on
       its side gives the page 293px, and four timezones plus a stopwatch plus
       a countdown do not go into that at any spacing. There the requirement
       is that it SCROLLS rather than clipping, since .clock-window is
       overflow:hidden and anything past its box would be gone. */
    expect(m.hScroll).toBe(0);
    if (m.contentH >= 380) expect(m.vScroll).toBe(0);
    else expect(m.overflowY).toBe('auto');
    /* ...and the countdown row stays on one line rather than wrapping Reset —
       where there is room for it. On a phone the clock is full-bleed at 393px
       and the row genuinely does not fit, which is what wrapping is for; the
       regression this guards was a wrap on a window with room to spare. */
    expect(m.controlsH).toBeLessThan(m.contentW >= 420 ? 60 : 100);
  });

  test('12-hour time has no leading zero, 24-hour keeps it', async ({ page }) => {
    await openFresh(page);
    await clickNavId(page, '#clock-toggle');
    const face = page.locator('[id^="clock-time"]');
    const zones = page.locator('[id^="clock-eastern"], [id^="clock-pacific"]');

    await page.locator('[id^="clock-format"]').selectOption('12');
    // "7:44:17 PM", never "07:44:17 PM" — no clock face or phone pads a
    // 12-hour dial.
    await expect(face).toHaveText(/^(1[0-2]|[1-9]):\d{2}:\d{2}\s?[AP]M$/);
    for (const zone of await zones.all()) {
      await expect(zone).toHaveText(/^(1[0-2]|[1-9]):\d{2}:\d{2}\s?[AP]M$/);
    }

    // 24-hour is the format where 07:44 is the correct form.
    await page.locator('[id^="clock-format"]').selectOption('24');
    await expect(face).toHaveText(/^\d{2}:\d{2}:\d{2}$/);
    for (const zone of await zones.all()) {
      await expect(zone).toHaveText(/^\d{2}:\d{2}:\d{2}$/);
    }
  });

  test('the Zulu row reads real UTC, not a re-parsed local string', async ({ page }) => {
    await openFresh(page);
    await clickNavId(page, '#clock-toggle');
    const zulu = page.locator('[id^="clock-zulu"]');
    await expect(zulu).not.toBeEmpty();

    // 24-hour, because that is the form ISO gives us to check against.
    await page.locator('[id^="clock-format"]').selectOption('24');
    await expect(zulu).toHaveText(/^\d{2}:\d{2}:\d{2}$/);

    // The whole point of the row: hh:mm must match the instant's UTC, which
    // the toLocaleString round-trip the US rows use would lose. Minutes are
    // compared as well as hours so a whole-hour offset bug cannot pass, and
    // the reading is taken from the page's own clock to avoid a race with
    // the test runner's.
    const drift = await page.evaluate(() => {
      const shown = document
        .querySelector('[id^="clock-zulu"]')!
        .textContent!.trim();
      const iso = new Date().toISOString().slice(11, 19);
      const secs = (t: string) =>
        t.split(':').reduce((a, p) => a * 60 + Number(p), 0);
      // Signed, then wrapped, so a reading either side of midnight is small.
      let d = secs(shown) - secs(iso);
      if (d > 43200) d -= 86400;
      if (d < -43200) d += 86400;
      return Math.abs(d);
    });
    // The row repaints once a second, so a couple of seconds of lag is the
    // clock working. An offset bug is off by 15 minutes at the very least.
    expect(drift).toBeLessThan(120);
  });

  test('a finished countdown raises the in-app card, not an OS notification', async ({ page }) => {
    await openFresh(page);
    await clickNavId(page, '#clock-toggle');
    // The app must not so much as name the OS surface any more.
    expect(await page.content()).not.toContain('new Notification(');

    const alertCard = page.locator('#app-alert');
    await expect(alertCard).toBeHidden();

    // 1 second is the shortest run the inputs allow; the tick is every 500ms.
    await page.locator('[id^="countdown-minutes"]').fill('0');
    await page.locator('[id^="countdown-seconds"]').fill('1');
    await page.locator('.countdown-controls button', { hasText: 'Start' }).click();

    await expect(alertCard).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#app-alert-detail')).toContainText('reached zero');

    // Dead centre of the viewport, so a finished timer cannot be missed.
    const centred = await page.evaluate(() => {
      const r = (document.getElementById('app-alert') as HTMLElement).getBoundingClientRect();
      return {
        dx: Math.abs(r.left + r.width / 2 - window.innerWidth / 2),
        dy: Math.abs(r.top + r.height / 2 - window.innerHeight / 2),
      };
    });
    expect(centred.dx).toBeLessThan(2);
    expect(centred.dy).toBeLessThan(2);
    // The title flash alternates on a 700ms beat, so poll for the on phase.
    await expect
      .poll(() => page.evaluate(() => document.title), { timeout: 3000 })
      .toContain('Timer finished');

    // Dismiss is the acknowledgement: the card, the flashing title and the
    // countdown favicon all stand down together.
    await alertCard.locator('button', { hasText: 'Dismiss' }).click();
    await expect(alertCard).toBeHidden();
    await expect
      .poll(() => page.evaluate(() => document.title), { timeout: 3000 })
      .toBe('CB App');
  });

  const runOneSecondTimer = async (page: Page) => {
    await page.locator('[id^="countdown-minutes"]').fill('0');
    await page.locator('[id^="countdown-seconds"]').fill('1');
    await page.locator('.countdown-controls button', { hasText: 'Start' }).click();
    await expect(page.locator('#app-alert')).toBeVisible({ timeout: 5000 });
  };

  test('a finished timer plays the synthesised jingle, and Mute silences it', async ({
    page,
  }) => {
    await countJingleVoices(page);
    await openFresh(page);
    await clickNavId(page, '#clock-toggle');

    await runOneSecondTimer(page);
    // Three notes, each a fundamental plus an octave partial — or nothing at
    // all where Web Audio does not exist, which must still leave the card up.
    const expected = (await hasWebAudio(page)) ? 6 : 0;
    expect(await page.evaluate(() => (window as any).__voices)).toBe(expected);

    await page.locator('#app-alert-mute').click();
    await expect(page.locator('#app-alert-mute')).toHaveText('Unmute');
    await page.locator('#app-alert button', { hasText: 'Dismiss' }).click();

    await runOneSecondTimer(page);
    // Unchanged: the second run made no sound at all.
    expect(await page.evaluate(() => (window as any).__voices)).toBe(expected);
  });

  test('the mute preference survives a reload', async ({ page }) => {
    await countJingleVoices(page);
    await openFresh(page);
    await clickNavId(page, '#clock-toggle');
    await page.locator('#app-alert-mute').isVisible(); // hidden card, button exists
    await page.evaluate(() => (window as any).toggleAlertSound());
    await forceSave(page);

    await page.reload();
    await expectBooted(page);
    await expect(page.locator('#app-alert-mute')).toHaveText('Unmute');
    await runOneSecondTimer(page);
    expect(await page.evaluate(() => (window as any).__voices)).toBe(0);
  });

  test('closing the clock takes its timer card with it', async ({ page }) => {
    await openFresh(page);
    await clickNavId(page, '#clock-toggle');
    await page.locator('[id^="countdown-minutes"]').fill('0');
    await page.locator('[id^="countdown-seconds"]').fill('1');
    await page.locator('.countdown-controls button', { hasText: 'Start' }).click();
    await expect(page.locator('#app-alert')).toBeVisible({ timeout: 5000 });
    await page.locator('#clock .close-clock').click();
    await expect(page.locator('#app-alert')).toBeHidden();
  });
});

/**
 * Reported from Island: after restoring a backup, "the countdown time cannot be
 * changed". The clock came back frozen — readOnly fields and disabled buttons —
 * and nothing said so, so an untouchable timer read as a broken timer.
 */
test.describe('CB App — a frozen window says so', () => {
  // #status keeps its text after hiding, so only `display` answers "is it up".
  const visibleStatus = (page: Page) =>
    page.evaluate(() => {
      const s = document.getElementById('status') as HTMLElement;
      return getComputedStyle(s).display !== 'none' ? (s.textContent || '').trim() : '';
    });

  async function importSession(page: Page, session: unknown, name: string) {
    const tmp = path.join(os.tmpdir(), `cbapp-${name}-${Date.now()}.json`);
    fs.writeFileSync(tmp, JSON.stringify(session), 'utf8');
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      clickNav(page, { tooltip: 'Import Session File' }),
    ]);
    await chooser.setFiles(tmp);
    await acceptPlainImport(page);
  }

  test('a restored frozen clock explains itself, and unfreezing frees the countdown', async ({
    page,
  }) => {
    await openFresh(page);
    await importSession(
      page,
      {
        theme: 'dark-mode',
        clock: {
          visible: true,
          position: { left: '60', top: '60' },
          locked: true,
          minimized: false,
          mode: 'windowed',
          clockFormat: '12',
        },
      },
      'frozen-clock'
    );
    await expect(page.locator('#clock')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#clock .lock-window')).toHaveText('🔒');
    // The state the bug report described: the fields refuse input.
    await expect(page.locator('#countdown-seconds-clock')).toHaveAttribute('readonly', '');

    // Typing now draws an explanation instead of nothing at all.
    await page.waitForTimeout(3200); // let the import toast expire first
    await page.locator('#countdown-seconds-clock').click();
    await page.keyboard.type('7');
    expect(await visibleStatus(page)).toMatch(/frozen/i);

    // A disabled button dispatches no click of its own; the message still fires.
    await page.waitForTimeout(3200);
    await page
      .locator('.countdown-controls button', { hasText: 'Start' })
      .click({ force: true });
    expect(await visibleStatus(page)).toMatch(/frozen/i);

    // And the way out works: unfreeze, then the timer is editable again.
    await page.locator('#clock .lock-window').click();
    await page.locator('#countdown-minutes-clock').fill('0');
    await page.locator('#countdown-seconds-clock').fill('7');
    await expect(page.locator('#countdown-seconds-clock')).toHaveValue('7');
  });

  /**
   * v3.2.19. Freezing is a behaviour, not a skin. v3.2.18's dashed-border rule
   * hit every readOnly field in a frozen window, and `border: none` on notes and
   * sticky notes resets the *width* to `medium`, so revealing the style painted
   * a 3px frame from nowhere; `:read-only` also matches colour swatches and
   * selects, so those were outlined too. The older readOnly background wash had
   * the same class of bug: those fields are transparent, so painting them
   * replaced the sticky note's own colour.
   */
  test('freezing a window does not repaint it', async ({ page }) => {
    await openFresh(page);
    const paint = (sel: string) =>
      page.evaluate((s) => {
        const cs = getComputedStyle(document.querySelector(s) as HTMLElement);
        return {
          background: cs.backgroundColor,
          borderStyle: cs.borderStyle,
          borderWidth: cs.borderWidth,
        };
      }, sel);

    await clickNav(page, { tooltip: 'New Sticky Note' });
    const sticky = page.locator('.sticky-note-window').first();
    await sticky.locator('.sticky-note-content').fill('remember the milk');
    const stickyBefore = await paint('.sticky-note-content');
    await sticky.locator('.sticky-lock-window, .lock-window').first().click();
    await expect(sticky.locator('.sticky-note-content')).toHaveAttribute('readonly', '');
    // The note keeps its own colour and grows no frame — only the cursor moves.
    expect(await paint('.sticky-note-content')).toEqual(stickyBefore);
    expect(
      await page.evaluate(() =>
        Array.from(document.querySelectorAll('.sticky-note-window input')).map(
          (i) => getComputedStyle(i).borderStyle
        )
      )
    ).not.toContain('dashed');

    await clickNav(page, { tooltip: 'New Note' });
    const note = page.locator('.window').first();
    await note.locator('textarea').fill('note body');
    const noteBefore = await paint('.window textarea');
    await note.locator('.lock-window').first().click();
    await expect(note.locator('textarea')).toHaveAttribute('readonly', '');
    expect(await paint('.window textarea')).toEqual(noteBefore);

    // The countdown fields are the one deliberate exception: they carry a real
    // 1px border, so dashing it costs no layout and reads as "refuses digits".
    await clickNavId(page, '#clock-toggle');
    await page.locator('#clock .lock-window').click();
    const countdown = await paint('#countdown-minutes-clock');
    expect(countdown.borderStyle).toBe('dashed');
    /* Hairline, not literally "1px": WebKit snaps a 1px border to the device
       pixel grid, and the iPad (gen 11) profile has a deviceScaleFactor of
       2.5, where it computes to 0.8px. The assertion is about the border still
       being a hairline that costs no layout — a repaint would show up as the
       3px `medium` default, which is what this test exists to catch. */
    expect(parseFloat(countdown.borderWidth)).toBeGreaterThan(0);
    expect(parseFloat(countdown.borderWidth)).toBeLessThanOrEqual(1);
  });

  test('reading a frozen note stays silent', async ({ page }) => {
    await openFresh(page);
    await importSession(
      page,
      {
        theme: 'dark-mode',
        window1: {
          position: { left: '40', top: '40' },
          width: 400,
          height: 300,
          content: 'frozen but readable',
          name: 'Notes',
          isTaskWindow: false,
          locked: true,
          minimized: false,
          tasks: [],
        },
      },
      'frozen-note'
    );
    const textarea = page.locator('.window textarea').first();
    await expect(textarea).toHaveValue('frozen but readable', { timeout: 10000 });

    await textarea.click();
    await page.waitForTimeout(3200); // clear the message the click drew

    // Select-all, copy and cursor keys are reading, not editing — text fields go
    // readOnly rather than disabled precisely so this keeps working.
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Control+c');
    expect(await visibleStatus(page)).toBe('');
    await page.keyboard.press('ArrowDown');
    expect(await visibleStatus(page)).toBe('');

    // A real keystroke is an edit attempt, and the content survives it.
    await page.keyboard.type('x');
    expect(await visibleStatus(page)).toMatch(/frozen/i);
    await expect(textarea).toHaveValue('frozen but readable');
  });
});

test.describe('CB App — session persistence & security edits', () => {
  test('a normal website shows the passphrase notice until this tab dismisses it', async ({
    page,
    context,
  }) => {
    await page.goto(URL);
    await expectBooted(page);
    const notice = page.locator('#origin-notice');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText(/other pages on this website/i);
    await page.locator('#origin-notice-dismiss').click();
    await expect(notice).toBeHidden();
    await page.reload();
    await expectBooted(page);
    await expect(notice).toBeHidden();
    const again = await context.newPage();
    await again.goto(URL);
    await expectBooted(again);
    await expect(again.locator('#origin-notice')).toBeVisible();
    await again.close();
  });

  test('a new passphrase shorter than 12 characters is refused', async ({ page }) => {
    await openFresh(page);
    const messages: string[] = [];
    page.on('dialog', async (dialog) => {
      messages.push(dialog.message());
      await dialog.accept();
    });
    await clickNavId(page, '#protect-toggle');
    await enterPassphrase(page, 'too-short-1', /Protect this session/i);
    await expect.poll(() => messages.join('\n')).toMatch(/at least 12 characters/);
    await expect(page.locator('#pass-modal')).not.toHaveClass(/open/);
    await expect(page.locator('#protect-toggle')).toHaveText(/^Protect$/i);
  });

  test('cancelling an unencrypted import leaves the saved session', async ({ page }) => {
    await openFresh(page);
    await clickNav(page, { tooltip: 'New Note' });
    await page.locator('.window textarea').fill('keep-me-please');
    await forceSave(page);
    await expectDeviceEnvelope(page, 'keep-me-please');
    const before = await page.evaluate(() => localStorage.getItem('notepadSession'));
    const tmp = path.join(os.tmpdir(), `cbapp-plain-cancel-${Date.now()}.json`);
    fs.writeFileSync(
      tmp,
      JSON.stringify({
        theme: 'dark-mode',
        window1: {
          position: { left: '40', top: '40' },
          width: 400,
          height: 300,
          content: 'should-not-land',
          name: 'Nope',
          isTaskWindow: false,
          locked: false,
          minimized: false,
          tasks: [],
        },
      }),
      'utf8'
    );
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      clickNav(page, { tooltip: 'Import Session File' }),
    ]);
    await chooser.setFiles(tmp);
    await acceptPlainImport(page, false);
    await expect
      .poll(async () => statusText(page), { timeout: 8000 })
      .toMatch(/Import cancelled/i);
    expect(await page.evaluate(() => localStorage.getItem('notepadSession'))).toBe(before);
    await expect(page.locator('.window textarea')).toHaveValue('keep-me-please');
  });

  test('session survives reload via localStorage', async ({ page }) => {
    await openFresh(page);
    await clickNav(page, { tooltip: 'New Note' });
    await page.locator('.window textarea').fill('persist-me-123');
    await forceSave(page);

    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.window textarea')).toHaveValue('persist-me-123', {
      timeout: 8000,
    });
  });

  test('Reset confirms and clears windows + storage keys', async ({ page }) => {
    await openFresh(page);
    await clickNav(page, { tooltip: 'New Note' });
    await page.locator('.window textarea').fill('will-be-wiped');
    await forceSave(page);

    // v3.2.14: the confirm is the app's own dialog, not window.confirm.
    await clickNav(page, { tooltip: 'Reset to Fresh UI' });
    await confirmInApp(page, /Reset CB App\?/);

    await expect(page.locator('.window')).toHaveCount(0);
    await expect(page.locator('#empty-state')).toBeVisible();

    const keys = await page.evaluate(() => ({
      session: localStorage.getItem('notepadSession'),
      prev: localStorage.getItem('notepadSession.prev'),
      consumed: localStorage.getItem('cbappConsumedExport'),
    }));
    expect(keys.session).toBeNull();
    expect(keys.prev).toBeNull();
    expect(keys.consumed).toBeNull();
  });

  test('Reset can be cancelled and leaves everything alone', async ({ page }) => {
    await openFresh(page);
    await clickNav(page, { tooltip: 'New Note' });
    await page.locator('.window textarea').fill('keep-me');
    await forceSave(page);

    await clickNav(page, { tooltip: 'Reset to Fresh UI' });
    await confirmInApp(page, /Reset CB App\?/, false);

    await expect(page.locator('.window')).toHaveCount(1);
    await expect(page.locator('.window textarea')).toHaveValue('keep-me');
    expect(
      await page.evaluate(() => localStorage.getItem('notepadSession'))
    ).toBeTruthy();
  });

  /**
   * v3.2.14. A passphrase that stops someone reading the desks but not
   * throwing them away is barely a lock, so Reset asks for it too.
   */
  test('Reset on a protected session needs the passphrase', async ({ page }) => {
    await openFresh(page);
    await clickNav(page, { tooltip: 'New Note' });
    await page.locator('.window textarea').fill('guarded-note');
    await forceSave(page);

    await clickNavId(page, '#protect-toggle');
    await enterPassphrase(page, 'reset-guard-1', /Protect this session/i);
    await enterPassphrase(page, 'reset-guard-1', /Confirm passphrase/i);
    await expect(page.locator('#protect-toggle')).toHaveText(/Unprotect/i, {
      timeout: 15000,
    });

    // Wrong passphrase: the prompt comes back and nothing is destroyed.
    const unqueue = installDialogQueue(page, [true]);
    await clickNav(page, { tooltip: 'Reset to Fresh UI' });
    await enterPassphrase(page, 'not-the-passphrase', /Reset CB App\?/);
    await expect(page.locator('#pass-modal-input')).toBeVisible({
      timeout: 10000,
    });
    // Second prompt of the same round — cancel out of it.
    await page.locator('#pass-modal-cancel').click();
    unqueue();

    await expect(page.locator('.window')).toHaveCount(1);
    await expect(page.locator('.window textarea')).toHaveValue('guarded-note');
    expect(
      await page.evaluate(() => localStorage.getItem('notepadSession'))
    ).toBeTruthy();

    // Right passphrase: it goes through, and the confirm box never appears —
    // the passphrase prompt is the confirmation.
    await clickNav(page, { tooltip: 'Reset to Fresh UI' });
    await enterPassphrase(page, 'reset-guard-1', /Reset CB App\?/);

    await expect(page.locator('.window')).toHaveCount(0);
    expect(
      await page.evaluate(() => localStorage.getItem('notepadSession'))
    ).toBeNull();
    await expect(page.locator('#protect-toggle')).toHaveText(/^Protect$/i);
  });

  /**
   * v3.2.14. Locked means this tab never opened the session, so the ciphertext
   * is the only thing that can judge a passphrase — and three wrong answers
   * open the ERASE escape, so a lost passphrase is not a permanent brick.
   */
  test('Reset on a locked session verifies against the ciphertext, then offers ERASE', async ({
    page,
  }) => {
    await openFresh(page);
    await clickNav(page, { tooltip: 'New Note' });
    await page.locator('.window textarea').fill('locked-away');
    await forceSave(page);

    await clickNavId(page, '#protect-toggle');
    await enterPassphrase(page, 'locked-pass-7', /Protect this session/i);
    await enterPassphrase(page, 'locked-pass-7', /Confirm passphrase/i);
    await expect(page.locator('#protect-toggle')).toHaveText(/Unprotect/i, {
      timeout: 15000,
    });

    // Reload and refuse to unlock: the app is now locked out of its own data.
    await page.reload();
    await expect(page.locator('#pass-modal-input')).toBeVisible({
      timeout: 10000,
    });
    await page.locator('#pass-modal-cancel').click();
    await expect(page.locator('#protect-toggle')).toHaveText(/Unlock/i, {
      timeout: 10000,
    });

    const before = await page.evaluate(() =>
      localStorage.getItem('notepadSession')
    );

    // Three wrong tries, then decline the ERASE box: the ciphertext is intact.
    const unqueue = installDialogQueue(page, [true, true, true]);
    await clickNav(page, { tooltip: 'Reset to Fresh UI' });
    for (let i = 0; i < 3; i++) {
      await enterPassphrase(page, `wrong-${i}`, /Reset a protected session\?/);
    }
    const eraseInput = page.locator('#pass-modal-input');
    await expect(page.locator('#pass-modal-title')).toHaveText(
      /Erase the session without the passphrase\?/,
      { timeout: 10000 }
    );
    // Not a secret, so it is not masked and the Show toggle is gone.
    await expect(eraseInput).toHaveAttribute('type', 'text');
    await expect(page.locator('#pass-modal-reveal')).toBeHidden();
    // Anything other than ERASE is a no.
    await eraseInput.fill('erase it');
    await page.locator('#pass-modal-ok').click();
    unqueue();

    expect(
      await page.evaluate(() => localStorage.getItem('notepadSession'))
    ).toBe(before);

    // The real passphrase resets straight away, no ERASE needed.
    await clickNav(page, { tooltip: 'Reset to Fresh UI' });
    await enterPassphrase(page, 'locked-pass-7', /Reset a protected session\?/);

    // Decrypting is a 600k-round PBKDF2, so wait for the state to settle
    // rather than reading storage the instant OK is clicked.
    await expect(page.locator('#protect-toggle')).toHaveText(/^Protect$/i, {
      timeout: 15000,
    });
    expect(
      await page.evaluate(() => localStorage.getItem('notepadSession'))
    ).toBeNull();
  });

  test('Protect encrypts localStorage; reload requires passphrase', async ({
    page,
  }) => {
    await openFresh(page);
    await clickNav(page, { tooltip: 'New Note' });
    await page.locator('.window textarea').fill('top-secret-note');
    await forceSave(page);

    await clickNavId(page, '#protect-toggle');
    await enterPassphrase(page, 'test-pass-99', /Protect this session/i);
    await enterPassphrase(page, 'test-pass-99', /Confirm passphrase/i);
    await expect(page.locator('#protect-toggle')).toHaveText(/Unprotect/i, {
      timeout: 15000,
    });

    const raw = await page.evaluate(() => localStorage.getItem('notepadSession'));
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.enc).toBe(true);
    expect(parsed.alg).toBe('AES-GCM-256');
    expect(parsed.ct).toBeTruthy();
    expect(JSON.stringify(parsed)).not.toContain('top-secret-note');

    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await enterPassphrase(page, 'test-pass-99');
    await expect(page.locator('.window textarea')).toHaveValue('top-secret-note', {
      timeout: 15000,
    });
    await expect(page.locator('#protect-toggle')).toHaveText(/Unprotect/i);
  });

  test('reloading while the unlock prompt is open does not wipe the session', async ({
    page,
  }) => {
    await openFresh(page);
    await clickNav(page, { tooltip: 'New Note' });
    await page.locator('.window textarea').fill('survives-double-reload');
    await forceSave(page);

    await clickNavId(page, '#protect-toggle');
    await enterPassphrase(page, 'double-reload-1', /Protect this session/i);
    await enterPassphrase(page, 'double-reload-1', /Confirm passphrase/i);
    await expect(page.locator('#protect-toggle')).toHaveText(/Unprotect/i, {
      timeout: 15000,
    });

    // Reload, then reload again while boot is still sitting in the unlock
    // prompt. beforeunload used to autosave the blank pre-restore screen over
    // the ciphertext, so the second load came up empty and the note was gone.
    await page.reload();
    await expect(page.locator('#pass-modal-input')).toBeVisible({
      timeout: 10000,
    });
    // Baseline taken here, not before the first reload: Protect's final
    // encrypt lands asynchronously and legitimately rewrites the envelope.
    const before = await page.evaluate(() =>
      localStorage.getItem('notepadSession')
    );
    await page.reload();
    await expect(page.locator('#pass-modal-input')).toBeVisible({
      timeout: 10000,
    });

    // Storage must be byte-identical: nothing ran between the two loads that
    // had any business writing.
    const after = await page.evaluate(() =>
      localStorage.getItem('notepadSession')
    );
    expect(after).toBe(before);
    expect(JSON.parse(after!).enc).toBe(true);

    await enterPassphrase(page, 'double-reload-1');
    await expect(page.locator('.window textarea')).toHaveValue(
      'survives-double-reload',
      { timeout: 15000 }
    );
  });

  /**
   * v3.2.15. Unprotect needs the passphrase. v4.8.0 then reseals with the
   * device key rather than writing the note back as plaintext, so the text
   * must still be absent from localStorage.
   */
  test('Unprotect needs the passphrase', async ({ page }) => {
    await openFresh(page);
    await clickNav(page, { tooltip: 'New Note' });
    await page.locator('.window textarea').fill('still-secret');
    await forceSave(page);

    await clickNavId(page, '#protect-toggle');
    await enterPassphrase(page, 'unprotect-me-2', /Protect this session/i);
    await enterPassphrase(page, 'unprotect-me-2', /Confirm passphrase/i);
    await expect(page.locator('#protect-toggle')).toHaveText(/Unprotect/i, {
      timeout: 15000,
    });

    // Wrong passphrase: still protected, still ciphertext.
    const unqueue = installDialogQueue(page, [true]);
    await clickNavId(page, '#protect-toggle');
    await enterPassphrase(page, 'wrong-one', /Remove passphrase protection\?/);
    await expect(page.locator('#pass-modal-input')).toBeVisible({
      timeout: 10000,
    });
    await page.locator('#pass-modal-cancel').click();
    unqueue();

    await expect(page.locator('#protect-toggle')).toHaveText(/Unprotect/i);
    const stillEncrypted = await page.evaluate(() =>
      localStorage.getItem('notepadSession')
    );
    expect(JSON.parse(stillEncrypted!).enc).toBe(true);

    // Right passphrase: protection comes off and the session is resealed
    // with the device key. The note text stays out of localStorage.
    await clickNavId(page, '#protect-toggle');
    await enterPassphrase(page, 'unprotect-me-2', /Remove passphrase protection\?/);
    await expect(page.locator('#protect-toggle')).toHaveText(/^Protect$/i, {
      timeout: 15000,
    });
    await expectDeviceEnvelope(page, 'still-secret');
  });

  test('passphrase field is masked until the Show toggle is pressed', async ({
    page,
  }) => {
    await openFresh(page);
    await clickNavId(page, '#protect-toggle');

    const input = page.locator('#pass-modal-input');
    const reveal = page.locator('#pass-modal-reveal');
    await expect(input).toBeVisible();
    await input.fill('peek-a-boo-1');
    await expect(input).toHaveAttribute('type', 'password');
    await expect(reveal).toHaveAttribute('aria-pressed', 'false');

    await reveal.click();
    await expect(input).toHaveAttribute('type', 'text');
    await expect(reveal).toHaveAttribute('aria-pressed', 'true');
    await expect(reveal).toHaveText(/Hide/i);

    // Cancel must clear the secret and re-mask, so the next open never shows it.
    await page.locator('#pass-modal-cancel').click();
    await expect(page.locator('#pass-modal')).not.toHaveClass(/open/);
    await expect(input).toHaveValue('');
    await expect(input).toHaveAttribute('type', 'password');

    // Escape closes without protecting.
    await clickNavId(page, '#protect-toggle');
    await expect(input).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#pass-modal')).not.toHaveClass(/open/);
    await expect(page.locator('#protect-toggle')).toHaveText(/^Protect$/i);
  });

  test('wrong passphrase does not restore session content', async ({ page }) => {
    await openFresh(page);
    await clickNav(page, { tooltip: 'New Note' });
    await page.locator('.window textarea').fill('hidden-payload');
    await forceSave(page);

    await clickNavId(page, '#protect-toggle');
    await enterPassphrase(page, 'good-passphrase1', /Protect this session/i);
    await enterPassphrase(page, 'good-passphrase1', /Confirm passphrase/i);
    await expect(page.locator('#protect-toggle')).toHaveText(/Unprotect/i, {
      timeout: 15000,
    });
    await expect
      .poll(async () => {
        const raw = await page.evaluate(() => localStorage.getItem('notepadSession'));
        return raw ? JSON.parse(raw).kdf : '';
      })
      .toBe('PBKDF2-SHA256-600000');

    // 3 wrong passphrase attempts; each failure raises an alert to accept.
    const u2 = installDialogQueue(page, [true, true, true]);
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    for (let i = 0; i < 3; i++) {
      await enterPassphrase(page, 'wrong');
    }
    await page.waitForTimeout(500);
    u2();

    const count = await page.locator('.window').count();
    if (count > 0) {
      await expect(page.locator('.window textarea').first()).not.toHaveValue(
        'hidden-payload'
      );
    } else {
      await expect(page.locator('#empty-state')).toBeVisible();
    }

    // A failed unlock must never cost the user their work: the ciphertext is
    // their only copy, and the app used to overwrite it with an empty
    // plaintext session on the very next autosave.
    await expect(page.locator('#locked-banner')).toBeVisible();
    const stored = await page.evaluate(() =>
      localStorage.getItem('notepadSession')
    );
    expect(JSON.parse(stored!).enc).toBe(true);
    expect(stored!).not.toContain('hidden-payload');
  });

  test('a locked session survives further edits and unlocks with the right passphrase', async ({
    page,
  }) => {
    await openFresh(page);
    await clickNav(page, { tooltip: 'New Note' });
    await page.locator('.window textarea').fill('survive-the-lock');
    await forceSave(page);

    await clickNavId(page, '#protect-toggle');
    await enterPassphrase(page, 'lock-pass-7ok', /Protect this session/i);
    await enterPassphrase(page, 'lock-pass-7ok', /Confirm passphrase/i);
    await expect(page.locator('#protect-toggle')).toHaveText(/Unprotect/i, {
      timeout: 15000,
    });

    // Reload and cancel the unlock, then keep using the app.
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#pass-modal-input')).toBeVisible({ timeout: 10000 });
    await page.locator('#pass-modal-cancel').click();

    await expect(page.locator('#locked-banner')).toBeVisible();
    await expect(page.locator('#protect-toggle')).toHaveText(/Unlock/i);

    // Baseline taken inside the locked state — from here nothing may write.
    const encrypted = await page.evaluate(() =>
      localStorage.getItem('notepadSession')
    );

    await clickNav(page, { tooltip: 'New Note' });
    await page.locator('.window textarea').first().fill('typed-while-locked');
    await forceSave(page);
    await page.waitForTimeout(400);

    // Byte-for-byte the same ciphertext — no write got through.
    expect(
      await page.evaluate(() => localStorage.getItem('notepadSession'))
    ).toBe(encrypted);

    // The banner is the way back in, without a reload. The scratch window
    // typed while locked was never saved, so unlocking asks before replacing it.
    const uConfirm = installDialogQueue(page, [true]);
    await page.locator('#locked-banner').click();
    await enterPassphrase(page, 'lock-pass-7ok');
    await page.waitForTimeout(300);
    uConfirm();
    await expect(page.locator('#locked-banner')).toBeHidden();
    await expect(page.locator('#protect-toggle')).toHaveText(/Unprotect/i);
    await expect(page.locator('.window textarea').first()).toHaveValue(
      'survive-the-lock',
      { timeout: 10000 }
    );
  });

  /**
   * v4.1.0. The bottom-left lock button. It arrives at the same locked state a
   * failed unlock at boot produces, so the assertions are the same ones: banner
   * up, ciphertext in storage, nothing on screen, nothing being written.
   */
  test('the lock button seals a protected session and clears the screen', async ({
    page,
  }) => {
    await openFresh(page);
    await clickNav(page, { tooltip: 'New Note' });
    await page.locator('.window textarea').fill('lock-me-away');
    await forceSave(page);

    await clickNavId(page, '#protect-toggle');
    await enterPassphrase(page, 'corner-pass-1', /Protect this session/i);
    await enterPassphrase(page, 'corner-pass-1', /Confirm passphrase/i);
    await expect(page.locator('#protect-toggle')).toHaveText(/Unprotect/i, {
      timeout: 15000,
    });

    await expect(page.locator('#session-lock')).toBeVisible();
    await page.locator('#session-lock').click();

    // The whole point: the desk is gone from the screen, not just dimmed.
    await expect(page.locator('#locked-banner')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.window')).toHaveCount(0);
    await expect(page.locator('#empty-state')).toBeVisible();
    // Only one lock affordance is ever on screen; the banner is now the way in.
    await expect(page.locator('#session-lock')).toBeHidden();
    await expect(page.locator('#protect-toggle')).toHaveText(/Unlock/i);

    const stored = await page.evaluate(() =>
      localStorage.getItem('notepadSession')
    );
    expect(JSON.parse(stored!).enc).toBe(true);
    expect(stored!).not.toContain('lock-me-away');

    // And nothing may be written while it is locked, exactly as at boot.
    await clickNav(page, { tooltip: 'New Note' });
    await page.locator('.window textarea').first().fill('typed-after-lock');
    await forceSave(page);
    await page.waitForTimeout(400);
    expect(
      await page.evaluate(() => localStorage.getItem('notepadSession'))
    ).toBe(stored);

    // The banner takes the passphrase and the sealed desk comes back.
    const uConfirm = installDialogQueue(page, [true]);
    await page.locator('#locked-banner').click();
    await enterPassphrase(page, 'corner-pass-1');
    await page.waitForTimeout(300);
    uConfirm();
    await expect(page.locator('#locked-banner')).toBeHidden();
    await expect(page.locator('#session-lock')).toBeVisible();
    await expect(page.locator('.window textarea').first()).toHaveValue(
      'lock-me-away',
      { timeout: 10000 }
    );
  });

  /**
   * v4.1.0. Edits made since the last write have to be sealed BY the lock: the
   * key is dropped on the way into the locked state, so anything not persisted
   * first can never be persisted at all.
   */
  test('the lock button saves what is on screen before it drops the key', async ({
    page,
  }) => {
    await openFresh(page);
    await clickNav(page, { tooltip: 'New Note' });
    await page.locator('.window textarea').fill('first-draft');
    await forceSave(page);

    await clickNavId(page, '#protect-toggle');
    await enterPassphrase(page, 'seal-pass-3ok', /Protect this session/i);
    await enterPassphrase(page, 'seal-pass-3ok', /Confirm passphrase/i);
    await expect(page.locator('#protect-toggle')).toHaveText(/Unprotect/i, {
      timeout: 15000,
    });

    // Typed and immediately locked — no forceSave in between.
    await page.locator('.window textarea').fill('second-draft-unsaved');
    await page.locator('#session-lock').click();
    await expect(page.locator('#locked-banner')).toBeVisible({ timeout: 15000 });

    await page.locator('#locked-banner').click();
    await enterPassphrase(page, 'seal-pass-3ok');
    await expect(page.locator('.window textarea').first()).toHaveValue(
      'second-draft-unsaved',
      { timeout: 10000 }
    );
  });

  /**
   * v4.1.0. Locking an unprotected session would blank the screen over a
   * device-key localStorage entry — a lock in appearance only. It asks for a
   * passphrase first instead, and locks once it has one.
   */
  test('locking an unprotected session sets up a passphrase first', async ({
    page,
  }) => {
    await openFresh(page);
    await clickNav(page, { tooltip: 'New Note' });
    await page.locator('.window textarea').fill('was-plaintext');
    await forceSave(page);
    await expectDeviceEnvelope(page, 'was-plaintext');

    await page.locator('#session-lock').click();
    await enterPassphrase(page, 'fresh-pass-9', /Lock this session/i);
    await enterPassphrase(page, 'fresh-pass-9', /Confirm passphrase/i);

    await expect(page.locator('#locked-banner')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.window')).toHaveCount(0);
    const stored = await page.evaluate(() =>
      localStorage.getItem('notepadSession')
    );
    expect(JSON.parse(stored!).enc).toBe(true);
    expect(stored!).not.toContain('was-plaintext');
  });

  /**
   * v4.1.0. Cancelling that prompt must leave everything as it was — an
   * unprotected session half-locked would be the worst of both.
   */
  test('cancelling the lock passphrase leaves the session open and unprotected', async ({
    page,
  }) => {
    await openFresh(page);
    await clickNav(page, { tooltip: 'New Note' });
    await page.locator('.window textarea').fill('still-here');
    await forceSave(page);

    await page.locator('#session-lock').click();
    await expect(page.locator('#pass-modal-input')).toBeVisible({
      timeout: 10000,
    });
    await page.locator('#pass-modal-cancel').click();

    await expect(page.locator('#locked-banner')).toBeHidden();
    await expect(page.locator('#session-lock')).toBeVisible();
    await expect(page.locator('#protect-toggle')).toHaveText(/^Protect$/i);
    await expect(page.locator('.window textarea').first()).toHaveValue(
      'still-here'
    );
    await forceSave(page);
    await expectDeviceEnvelope(page, 'still-here');
  });

  /**
   * v4.0.5. The two gates in saveSession/persistSessionPayload both read
   * `sessionLocked` before the encryption starts, and encryption is thousands
   * of PBKDF2 iterations long — so a save that began a moment before a lock
   * finished a moment after it, and wrote a pre-lock snapshot over the
   * ciphertext the lock had just sealed.
   *
   * Driven through the app's own internals rather than the UI: the whole
   * defect is a window of a few hundred milliseconds inside one function, and
   * nothing a user can click opens it on demand. `persistSessionPayload`,
   * `buildSessionSnapshot` and `sessionLocked` are top-level declarations, so
   * they are reachable from the page's global scope.
   */
  test('a save already encrypting when the session locks does not overwrite the ciphertext', async ({
    page,
  }) => {
    await openFresh(page);
    await clickNav(page, { tooltip: 'New Note' });
    await page.locator('.window textarea').fill('sealed-content');
    await forceSave(page);

    await clickNavId(page, '#protect-toggle');
    await enterPassphrase(page, 'race-pass-5ok', /Protect this session/i);
    await enterPassphrase(page, 'race-pass-5ok', /Confirm passphrase/i);
    await expect(page.locator('#protect-toggle')).toHaveText(/Unprotect/i, {
      timeout: 15000,
    });

    const result = await page.evaluate(async () => {
      const before = localStorage.getItem('notepadSession');
      // Starts with the session open, so the gate at the top of the function
      // passes exactly as it does for any ordinary autosave.
      const inFlight = persistSessionPayload(buildSessionSnapshot());
      // ...and the lock lands while it is still deriving the key.
      sessionLocked = true;
      const ok = await inFlight;
      const after = localStorage.getItem('notepadSession');
      sessionLocked = false;
      return { ok, unchanged: before === after, before, after };
    });

    // Refused, and said so — a silent true would have callers believe the
    // session is saved when it is not.
    expect(result.ok).toBe(false);
    expect(result.unchanged).toBe(true);
    // Still the sealed session, not a re-encryption of the same desk: a fresh
    // AES-GCM write differs byte-for-byte (new IV) even for identical input,
    // which is what makes the equality check above meaningful.
    expect(JSON.parse(result.after!).enc).toBe(true);
    expect(result.after!).not.toContain('sealed-content');
  });

  /**
   * v4.0.5. enterLockedState() rewrites the empty-state hint in place and the
   * export clones the live DOM, so a copy taken from a locked tab opened by
   * telling its new owner that their session was encrypted, was not opened,
   * and that nothing is being saved — none of it true of a blank copy.
   */
  test('a copy downloaded from a locked tab opens with the ordinary empty-state text', async ({
    page,
  }) => {
    await openFresh(page);
    await clickNav(page, { tooltip: 'New Note' });
    await page.locator('.window textarea').fill('not-in-the-copy');
    await forceSave(page);

    await clickNavId(page, '#protect-toggle');
    await enterPassphrase(page, 'copy-pass-2ok', /Protect this session/i);
    await enterPassphrase(page, 'copy-pass-2ok', /Confirm passphrase/i);
    await expect(page.locator('#protect-toggle')).toHaveText(/Unprotect/i, {
      timeout: 15000,
    });

    // Reload and decline the unlock: this is the only way into the locked
    // state, and it is the state the export used to leak.
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#pass-modal-input')).toBeVisible({
      timeout: 10000,
    });
    await page.locator('#pass-modal-cancel').click();
    await expect(page.locator('#locked-banner')).toBeVisible();
    await expect(page.locator('#empty-state .empty-hint')).toContainText(
      /was not opened/i
    );

    const downloadPromise = page.waitForEvent('download');
    await openNavIfCollapsed(page); // phone: the chip is inside the sheet (v4.2.2)
    await page.locator('.download-app-link').click();
    const download = await downloadPromise;
    const tmp = path.join(os.tmpdir(), 'cbapp-locked-copy.html');
    await download.saveAs(tmp);
    const html = fs.readFileSync(tmp, 'utf8');

    /* Scoped to the element, not the whole file: that sentence is also a
       string literal inside enterLockedState(), which of course ships with the
       program. Only the rendered hint is the claim under test. */
    const hint = html.match(/class="empty-hint"[^>]*>([\s\S]*?)<\/p>/);
    expect(hint).not.toBeNull();
    expect(hint![1]).not.toContain('was not opened');
    expect(hint![1]).toContain('Nothing open yet');
    expect(html).not.toContain('data-unlocked-text');
    // And the copy still carries no notes, locked or not.
    expect(html).not.toContain('not-in-the-copy');

    // The live tab is untouched by the export — still locked, still sealed.
    await expect(page.locator('#locked-banner')).toBeVisible();
    expect(
      await page.evaluate(() =>
        JSON.parse(localStorage.getItem('notepadSession')!).enc
      )
    ).toBe(true);
  });

  test('Backup is always encrypted — an unprotected session is asked for a passphrase', async ({
    page,
  }) => {
    await openFresh(page);
    await clickNav(page, { tooltip: 'New Note' });
    await page.locator('.window textarea').fill('backup-body');
    await forceSave(page);

    // Protect is OFF: localStorage is a device envelope, and the backup must
    // still be a passphrase file. Two prompts — choose, then confirm.
    await expectDeviceEnvelope(page, 'backup-body');

    const downloadPromise = page.waitForEvent('download');
    await clickNav(page, { tooltip: 'Download an encrypted backup (.json)' });
    await enterPassphrase(page, 'backup-pass-1', /Encrypt this backup/i);
    await enterPassphrase(page, 'backup-pass-1', /Confirm passphrase/i);
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('cbapp-session.encrypted.json');
    const tmp = path.join(os.tmpdir(), 'cbapp-backup-encrypted.json');
    await download.saveAs(tmp);
    const raw = fs.readFileSync(tmp, 'utf8');
    expect(raw).not.toContain('backup-body');
    const json = JSON.parse(raw);
    expect(json.enc).toBe(true);
    expect(json.alg).toBe('AES-GCM-256');
    expect(json.kdf).toBe('PBKDF2-SHA256-600000');
    expect(json.ct).toBeTruthy();

    // The one-off backup passphrase must not leak into this browser's own
    // session — storage stays a device envelope and Protect stays off.
    await expect(page.locator('#protect-toggle')).toHaveText(/Protect/i);
    await expectDeviceEnvelope(page, 'backup-body');

    // And it round-trips: Import asks for that passphrase and restores.
    await page.evaluate(() => localStorage.clear());
    await openFresh(page);
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      clickNav(page, { tooltip: 'Import Session File' }),
    ]);
    await chooser.setFiles(tmp);
    await enterPassphrase(page, 'backup-pass-1');
    await expect(page.locator('.window textarea').first()).toHaveValue(
      'backup-body',
      { timeout: 10000 }
    );
  });

  test('Cancelling the backup passphrase writes no file', async ({ page }) => {
    await openFresh(page);
    await clickNav(page, { tooltip: 'New Note' });
    await page.locator('.window textarea').fill('never-exported');
    await forceSave(page);

    let downloaded = false;
    page.on('download', () => {
      downloaded = true;
    });
    await clickNav(page, { tooltip: 'Download an encrypted backup (.json)' });
    await expect(page.locator('#pass-modal-input')).toBeVisible();
    await page.locator('#pass-modal-cancel').click();
    await expect(page.locator('#pass-modal')).not.toHaveClass(/open/);
    expect(await statusText(page)).toMatch(/cancelled/i);
    await page.waitForTimeout(500);
    expect(downloaded).toBe(false);
  });

  test('Backup reuses the session passphrase when Protect is on', async ({
    page,
  }) => {
    await openFresh(page);
    await clickNav(page, { tooltip: 'New Note' });
    await page.locator('.window textarea').fill('protected-backup-body');
    await forceSave(page);

    await clickNavId(page, '#protect-toggle');
    await enterPassphrase(page, 'protect-pass-9');
    await enterPassphrase(page, 'protect-pass-9');
    await expect(page.locator('#protect-toggle')).toHaveText(/Unprotect/i);

    // No further prompt — the session passphrase already covers the file.
    const downloadPromise = page.waitForEvent('download');
    await clickNav(page, { tooltip: 'Download an encrypted backup (.json)' });
    const download = await downloadPromise;
    await expect(page.locator('#pass-modal')).not.toHaveClass(/open/);
    expect(download.suggestedFilename()).toBe('cbapp-session.encrypted.json');
    const tmp = path.join(os.tmpdir(), 'cbapp-backup-protected.json');
    await download.saveAs(tmp);
    const raw = fs.readFileSync(tmp, 'utf8');
    expect(raw).not.toContain('protected-backup-body');
    expect(JSON.parse(raw).enc).toBe(true);
  });

  test('Download CB App ships the program only — no notes, no embedded session', async ({
    page,
  }) => {
    await openFresh(page);
    await clickNav(page, { tooltip: 'New Note' });
    await page.locator('.window textarea').fill('export-html-body');
    await forceSave(page);

    const downloadPromise = page.waitForEvent('download');
    await openNavIfCollapsed(page); // phone: the chip is inside the sheet (v4.2.2)
    await page.locator('a.download-app-link').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/cbapp\.html$/i);
    const tmp = path.join(os.tmpdir(), `cbapp-export-${Date.now()}.html`);
    await download.saveAs(tmp);
    const html = fs.readFileSync(tmp, 'utf8');
    // Still self-contained and CSP-locked...
    expect(html).not.toContain('fonts.googleapis.com');
    expect(html).toContain("default-src 'none'");
    // ...but the copy carries no content whatsoever. Backup is the only
    // path that moves notes off this browser.
    //
    // Match the payload *tag*, not the bare id: the id also appears as a
    // string in the app's own source (the scrub in downloadCbApp), so a
    // toContain check on it would fail for the wrong reason forever.
    expect(html).not.toMatch(/<script[^>]+id="cbapp-embedded-session"/);
    expect(html).not.toContain('export-html-body');
  });

  test('the Download chip carries the build version, and the copy keeps it', async ({
    page,
  }) => {
    await openFresh(page);
    const shown = (await page.locator('#download-app-version').textContent())?.trim() ?? '';
    expect(shown).toMatch(/^v\d+\.\d+\.\d+$/);
    const version = shown.slice(1);

    // The stamp and the release comment at the top of the file are two
    // statements of the same fact and must agree, or a copy saved to disk
    // would claim a build it isn't. (CB_APP_VERSION is a top-level `const` in
    // a classic script, so it is not reachable as a window property — the
    // rendered stamp is the observable side of it.)
    const source = await page.content();
    expect(source).toMatch(new RegExp(`CB App v${version.replace(/\./g, '\\.')} —`));

    // The stamp is written at boot, not baked into the markup, so it only
    // travels with a download because the clone is taken from the live DOM.
    // On a phone the chip lives inside the toolbar sheet (v4.2.2), so it has
    // to be opened before the chip can be clicked. No-op on a desktop, where
    // the chip is a fixed corner control.
    await openNavIfCollapsed(page);
    const downloadPromise = page.waitForEvent('download');
    await page.locator('a.download-app-link').click();
    const download = await downloadPromise;
    const tmp = path.join(os.tmpdir(), `cbapp-version-${Date.now()}.html`);
    await download.saveAs(tmp);
    const html = fs.readFileSync(tmp, 'utf8');
    expect(html).toMatch(
      new RegExp(`id="download-app-version"[^>]*>v${version.replace(/\./g, '\\.')}<`)
    );
  });

  /**
   * Regression: v3.2.6 and earlier restored a session baked into the file on
   * open. That displaced whatever the browser had, and a plaintext payload
   * never set sessionPassphrase — so opening any export silently turned
   * Protect off and wrote the next autosave in the clear. The payload must
   * now be inert, whoever put it there.
   */
  test('a pre-3.2.7 embedded session in the file is ignored', async ({ page }) => {
    await openFresh(page);
    await clickNav(page, { tooltip: 'New Note' });
    await page.locator('.window textarea').fill('my-real-work');
    await forceSave(page);

    const before = await page.evaluate(() =>
      localStorage.getItem('notepadSession')
    );
    expect(before).toContain('my-real-work');

    // Serve the document with the payload an old export shipped. It has to
    // arrive in the HTML — a DOM injection would not survive the reload —
    // and via route() so the origin, and therefore localStorage, is the same.
    const payload = JSON.stringify({
      exportId: '1785422357922-0-0',
      session: { theme: 'dark-mode', zIndexCounter: 1 },
    });
    await page.route('**/cbapp.html', async (route) => {
      const res = await route.fetch();
      const body = (await res.text()).replace(
        '</body>',
        `<script type="application/json" id="cbapp-embedded-session">${payload}</script></body>`
      );
      await route.fulfill({ response: res, body });
    });
    await page.reload();
    await expectBooted(page);
    // The payload really is in the served document.
    expect(await page.content()).toContain('cbapp-embedded-session');

    // The browser's own session still wins, untouched.
    const after = await page.evaluate(() => ({
      session: localStorage.getItem('notepadSession'),
      prev: localStorage.getItem('notepadSession.prev'),
      consumed: localStorage.getItem('cbappConsumedExport'),
    }));
    expect(after.session).toContain('my-real-work');
    // Boot purges the retired keys rather than writing them.
    expect(after.prev).toBeNull();
    expect(after.consumed).toBeNull();
    await expect(page.locator('.window textarea')).toHaveValue('my-real-work');
  });

  test('Import validates and restores a session JSON file', async ({ page }) => {
    await openFresh(page);

    const session = {
      theme: 'dark-mode',
      zIndexCounter: 2,
      window1: {
        position: { left: '40', top: '40' },
        width: 400,
        height: 300,
        content: 'imported-from-file',
        name: 'Imported',
        isTaskWindow: false,
        locked: false,
        minimized: false,
        tasks: [],
      },
    };
    const tmp = path.join(os.tmpdir(), `cbapp-import-${Date.now()}.json`);
    fs.writeFileSync(tmp, JSON.stringify(session), 'utf8');

    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      clickNav(page, { tooltip: 'Import Session File' }),
    ]);
    await chooser.setFiles(tmp);
    await acceptPlainImport(page);

    await expect(page.locator('.window textarea')).toHaveValue(
      'imported-from-file',
      { timeout: 10000 }
    );
    await expect(page.locator('.window-title').first()).toHaveText(/Imported/i);
  });

  /**
   * v3.2.16. Import overwrites the saved session, so it destroys it exactly as
   * Reset does — and a plaintext backup file needs no passphrase of its own,
   * so before this the protection could be walked straight past.
   */
  test('Import over a protected session needs the passphrase', async ({
    page,
  }) => {
    await openFresh(page);
    await clickNav(page, { tooltip: 'New Note' });
    await page.locator('.window textarea').fill('do-not-replace-me');
    await forceSave(page);

    await clickNavId(page, '#protect-toggle');
    await enterPassphrase(page, 'import-guard-3', /Protect this session/i);
    await enterPassphrase(page, 'import-guard-3', /Confirm passphrase/i);
    await expect(page.locator('#protect-toggle')).toHaveText(/Unprotect/i, {
      timeout: 15000,
    });

    // A plaintext backup: nothing about the file itself asks for a passphrase.
    const tmp = path.join(os.tmpdir(), `cbapp-guard-${Date.now()}.json`);
    fs.writeFileSync(
      tmp,
      JSON.stringify({
        theme: 'dark-mode',
        zIndexCounter: 2,
        window1: {
          position: { left: '40', top: '40' },
          width: 400,
          height: 300,
          content: 'the-replacement',
          name: 'Imported',
          isTaskWindow: false,
          locked: false,
          minimized: false,
          tasks: [],
        },
      }),
      'utf8'
    );

    // Wrong passphrase, then cancel: the session on screen and in storage stays.
    const unqueue = installDialogQueue(page, [true]);
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      clickNav(page, { tooltip: 'Import Session File' }),
    ]);
    await chooser.setFiles(tmp);
    await enterPassphrase(page, 'nope', /Replace this protected session\?/);
    await expect(page.locator('#pass-modal-input')).toBeVisible({
      timeout: 10000,
    });
    await page.locator('#pass-modal-cancel').click();
    unqueue();

    await expect
      .poll(async () => statusText(page), { timeout: 8000 })
      .toMatch(/Import cancelled/i);
    await expect(page.locator('.window textarea')).toHaveValue(
      'do-not-replace-me'
    );
    const untouched = await page.evaluate(() =>
      localStorage.getItem('notepadSession')
    );
    expect(JSON.parse(untouched!).enc).toBe(true);

    // Right passphrase: the import goes through.
    const [chooser2] = await Promise.all([
      page.waitForEvent('filechooser'),
      clickNav(page, { tooltip: 'Import Session File' }),
    ]);
    await chooser2.setFiles(tmp);
    await enterPassphrase(page, 'import-guard-3', /Replace this protected session\?/);
    await acceptPlainImport(page);
    await expect(page.locator('.window textarea')).toHaveValue(
      'the-replacement',
      { timeout: 15000 }
    );
  });

  test('Import over a locked session verifies against the ciphertext', async ({
    page,
  }) => {
    await openFresh(page);
    await clickNav(page, { tooltip: 'New Note' });
    await page.locator('.window textarea').fill('locked-and-kept');
    await forceSave(page);

    await clickNavId(page, '#protect-toggle');
    await enterPassphrase(page, 'locked-import-4', /Protect this session/i);
    await enterPassphrase(page, 'locked-import-4', /Confirm passphrase/i);
    await expect(page.locator('#protect-toggle')).toHaveText(/Unprotect/i, {
      timeout: 15000,
    });

    await page.reload();
    await expect(page.locator('#pass-modal-input')).toBeVisible({
      timeout: 10000,
    });
    await page.locator('#pass-modal-cancel').click();
    await expect(page.locator('#protect-toggle')).toHaveText(/Unlock/i, {
      timeout: 10000,
    });

    const before = await page.evaluate(() =>
      localStorage.getItem('notepadSession')
    );

    const tmp = path.join(os.tmpdir(), `cbapp-locked-${Date.now()}.json`);
    fs.writeFileSync(
      tmp,
      JSON.stringify({ theme: 'dark-mode', zIndexCounter: 1 }),
      'utf8'
    );

    // Cancelling the gate leaves the ciphertext byte-for-byte intact.
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      clickNav(page, { tooltip: 'Import Session File' }),
    ]);
    await chooser.setFiles(tmp);
    await expect(page.locator('#pass-modal-title')).toHaveText(
      /Replace a protected session\?/,
      { timeout: 10000 }
    );
    await page.locator('#pass-modal-cancel').click();

    await expect
      .poll(async () => statusText(page), { timeout: 8000 })
      .toMatch(/locked session is untouched/i);
    expect(
      await page.evaluate(() => localStorage.getItem('notepadSession'))
    ).toBe(before);

    // The real passphrase lets it through. The file is not an encrypted
    // backup, so v4.8.0 asks again. Verifying must not adopt a passphrase
    // for a session this tab never opened, so the import lands as a device
    // envelope rather than plaintext.
    const [chooser2] = await Promise.all([
      page.waitForEvent('filechooser'),
      clickNav(page, { tooltip: 'Import Session File' }),
    ]);
    await chooser2.setFiles(tmp);
    await enterPassphrase(page, 'locked-import-4', /Replace a protected session\?/);
    await acceptPlainImport(page);

    await expect(page.locator('#protect-toggle')).toHaveText(/^Protect$/i, {
      timeout: 15000,
    });
    await expectDeviceEnvelope(page, 'locked-and-kept');
  });

  test('Import rejects dangerous keys / invalid payload', async ({ page }) => {
    await openFresh(page);
    const tmp = path.join(os.tmpdir(), `cbapp-bad-${Date.now()}.json`);
    fs.writeFileSync(
      tmp,
      JSON.stringify({
        theme: 'dark-mode',
        __proto__: { polluted: true },
        'sticky-note-1': {
          position: { left: '1', top: '1' },
          content: 'x',
          color: 'url(javascript:alert(1))',
          textColor: '',
        },
      }),
      'utf8'
    );

    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      clickNav(page, { tooltip: 'Import Session File' }),
    ]);
    await chooser.setFiles(tmp);
    await acceptPlainImport(page);

    await expect
      .poll(async () => statusText(page), { timeout: 8000 })
      .toMatch(/Failed to import|Invalid session|dangerous/i);

    await expect(page.locator('.sticky-note-window')).toHaveCount(0);
  });
});

/**
 * v4.0.0. The calendar: a month grid, one shared event store, and an app-level
 * scheduler that fires the same alert card the countdown uses.
 *
 * The occurrence helpers are function declarations in a classic script, so they
 * live on `window` and can be called directly — no clock mocking needed to test
 * the recurrence and clamping rules.
 */
test.describe('CB App — calendar', () => {
  const openCalendar = async (page: Page) => {
    await openFresh(page);
    await clickNavId(page, '#calendar-toggle');
    await expect(page.locator('#calendar')).toBeVisible();
  };

  // #status keeps its text after hiding, so only `display` answers "is it up".
  const visibleStatusText = (page: Page) =>
    page.evaluate(() => {
      const s = document.getElementById('status') as HTMLElement;
      return getComputedStyle(s).display !== 'none' ? (s.textContent || '').trim() : '';
    });

  // Put an event into the store the way the app does: through commitEvents.
  const seed = (page: Page, event: Record<string, unknown>) =>
    page.evaluate((e) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const win = window as any;
      win.commitEvents(win.calendarEventsSnapshot().concat([e]));
    }, event);

  const eventRecord = (over: Record<string, unknown> = {}) => ({
    id: 'seeded',
    title: 'Standup',
    date: '2026-08-14',
    time: '09:00',
    allDay: false,
    note: '',
    repeat: 'none',
    alertMinutes: null,
    lastFired: null,
    ...over,
  });

  test('occurrence maths: repeats, month-end clamping and lead times', async ({
    page,
  }) => {
    await openCalendar(page);
    const m = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const win = window as any;
      const ev = (o: Record<string, unknown>) => ({
        id: 'x',
        title: 't',
        date: '2026-01-31',
        time: '10:00',
        allDay: false,
        note: '',
        repeat: 'none',
        alertMinutes: null,
        lastFired: null,
        ...o,
      });
      const from = (s: string) => win.parseDateKey(s);
      return {
        // JS rolls Feb 31 into March 3; the appointment must stay in February.
        monthlyClampsToFebEnd: win.nextOccurrence(
          ev({ repeat: 'monthly' }),
          from('2026-02-01')
        ),
        // ...and returns to the 31st in a month that has one.
        monthlyReturnsTo31: win.nextOccurrence(
          ev({ repeat: 'monthly' }),
          from('2026-03-01')
        ),
        yearlyLeapDay: win.nextOccurrence(
          ev({ date: '2024-02-29', repeat: 'yearly' }),
          from('2026-01-01')
        ),
        dailyIsArithmetic: win.nextOccurrence(
          ev({ date: '2026-01-01', repeat: 'daily' }),
          from('2026-08-06')
        ),
        weeklyKeepsWeekday: win.nextOccurrence(
          ev({ date: '2026-01-01', repeat: 'weekly' }),
          from('2026-08-06')
        ),
        pastOneOffHasNone: win.nextOccurrence(
          ev({ date: '2020-01-01' }),
          from('2026-08-06')
        ),
        onTheDayItself: win.nextOccurrence(
          ev({ date: '2026-08-06' }),
          from('2026-08-06')
        ),
        // An all-day event starts at ALL_DAY_HOUR (9am), so 540 minutes before
        // it is midnight that morning.
        allDayLeadReachesMidnight: win
          .eventFireAt(
            ev({ date: '2026-08-10', allDay: true, time: null, alertMinutes: 540 }),
            '2026-08-10'
          )
          .getHours(),
        timedLead: win
          .eventFireAt(ev({ alertMinutes: 30 }), '2026-01-31')
          .toTimeString()
          .slice(0, 5),
        noAlertNeverFires: win.eventFireAt(
          ev({ alertMinutes: null }),
          '2026-01-31'
        ),
      };
    });
    expect(m.monthlyClampsToFebEnd).toBe('2026-02-28');
    expect(m.monthlyReturnsTo31).toBe('2026-03-31');
    expect(m.yearlyLeapDay).toBe('2026-02-28');
    expect(m.dailyIsArithmetic).toBe('2026-08-06');
    // Jan 1 2026 and Aug 6 2026 are both Thursdays.
    expect(m.weeklyKeepsWeekday).toBe('2026-08-06');
    expect(m.pastOneOffHasNone).toBeNull();
    expect(m.onTheDayItself).toBe('2026-08-06');
    expect(m.allDayLeadReachesMidnight).toBe(0);
    expect(m.timedLead).toBe('09:30');
    expect(m.noAlertNeverFires).toBeNull();
  });

  test('an event is added, shown, searched, edited and deleted', async ({
    page,
  }) => {
    await openCalendar(page);
    await page.locator('#cal-add-calendar').click();
    await page.locator('#cal-f-title-calendar').fill('Dentist');
    await page.locator('#cal-f-time-calendar').fill('14:30');
    await page.locator('#cal-f-note-calendar').fill('bring the card');
    await page.locator('#cal-f-save-calendar').click();

    const rows = page.locator('#cal-lower-calendar .cal-event');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Dentist');
    await expect(rows.first()).toContainText('bring the card');
    // A dot marks the day on the grid.
    await expect(page.locator('.cal-day.cal-has-events')).toHaveCount(1);

    // The filter searches titles and notes across the whole store, which is what
    // "searchable" means here — the global Search panel is textarea-only.
    await page.locator('#cal-filter-calendar').fill('bring the');
    await expect(rows).toHaveCount(1);
    await page.locator('#cal-filter-calendar').fill('nothing-matches-this');
    await expect(rows).toHaveCount(0);
    await expect(page.locator('#cal-lower-calendar')).toContainText('No matches');
    await page.locator('#cal-filter-calendar').fill('');

    await page.locator('.cal-event button[aria-label^="Edit"]').click();
    await expect(page.locator('#cal-f-title-calendar')).toHaveValue('Dentist');
    await page.locator('#cal-f-title-calendar').fill('Dentist (moved)');
    await page.locator('#cal-f-save-calendar').click();
    await expect(rows.first()).toContainText('Dentist (moved)');

    await page.locator('.cal-event button[aria-label^="Delete"]').click();
    await expect(rows).toHaveCount(0);
    await expect(page.locator('.cal-day.cal-has-events')).toHaveCount(0);
  });

  /* The clock is frozen for this one, on the 1st of a 30-day month. The event
     form defaults to today, so "how many weekly occurrences are left in the
     month" was really "what day is it today": this test asserted four or five
     dots and failed outright whenever the suite ran in the last week of a month
     (three left), and a February run could leave exactly one. Pinning the date
     makes the expected days a fixed list rather than a range, which also says
     more than a count did — four consecutive marked days used to pass. */
  test('an all-day repeating event marks every occurrence in the month', async ({
    page,
  }) => {
    await page.clock.install({ time: new Date('2026-09-01T10:00:00') });
    await openCalendar(page);
    await page.locator('#cal-add-calendar').click();
    await page.locator('#cal-f-title-calendar').fill('Bin day');
    await page.locator('#cal-f-allday-calendar').check();
    // All day means no time of its own — the field is disabled, not ignored.
    await expect(page.locator('#cal-f-time-calendar')).toBeDisabled();
    await page.locator('#cal-f-repeat-calendar').selectOption('weekly');
    await page.locator('#cal-f-save-calendar').click();

    await expect(page.locator('#cal-lower-calendar .cal-event')).toContainText(
      'All day'
    );

    // The event took the frozen date, so the grid is September 2026 and weekly
    // from the 1st is every seventh day to the 29th. The month grid renders no
    // cells either side of itself, so this is the whole list.
    const { start, marked } = await page.evaluate(() => ({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      start: (window as any).calendarEventsSnapshot()[0].date as string,
      marked: Array.from(
        document.querySelectorAll('.cal-day.cal-has-events')
      ).map((cell) => Number(cell.textContent)),
    }));
    expect(start).toBe('2026-09-01');
    expect(marked).toEqual([1, 8, 15, 22, 29]);
  });

  test('a due reminder fires the alert card exactly once', async ({ page }) => {
    await countJingleVoices(page);
    await openCalendar(page);
    const alertCard = page.locator('#app-alert');
    await expect(alertCard).toBeHidden();

    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const win = window as any;
      const now = new Date();
      const hh = String(now.getHours()).padStart(2, '0');
      const mm = String(now.getMinutes()).padStart(2, '0');
      win.commitEvents([
        {
          id: 'live1',
          title: 'Standup',
          date: win.dateKey(now),
          time: `${hh}:${mm}`,
          allDay: false,
          note: '',
          repeat: 'none',
          alertMinutes: 0,
          lastFired: null,
        },
      ]);
      win.sweepDueEvents();
    });

    await expect(alertCard).toBeVisible();
    await expect(page.locator('#app-alert-title')).toHaveText('Reminder');
    await expect(page.locator('#app-alert-detail')).toContainText('Standup');
    const expected = (await hasWebAudio(page)) ? 6 : 0;
    expect(await page.evaluate(() => (window as any).__voices)).toBe(expected);

    // lastFired is stamped, so further sweeps say nothing.
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const win = window as any;
      win.dismissAppAlert();
      win.sweepDueEvents();
      win.sweepDueEvents();
    });
    await expect(alertCard).toBeHidden();
  });

  test('an event typed in after its own time does not fire on the spot', async ({
    page,
  }) => {
    await openCalendar(page);
    await page.locator('#cal-add-calendar').click();
    await page.locator('#cal-f-title-calendar').fill('Already happened');
    await page.locator('#cal-f-time-calendar').fill('00:01');
    await page.locator('#cal-f-save-calendar').click();
    await page.evaluate(() => (window as any).sweepDueEvents());
    // You cannot be reminded of something you are entering by hand right now.
    await expect(page.locator('#app-alert')).toBeHidden();
  });

  /**
   * The other side of the guard above, and the case that caught it out: an event
   * still to come whose lead time has already elapsed. "Remind me a minute
   * before" something 40 seconds away has a fire time in the past, and it must
   * still be announced — the test is the event's own start, not the alert's.
   */
  test('an imminent event whose lead time has already elapsed still fires', async ({
    page,
  }) => {
    await openCalendar(page);
    /* Three minutes out with a ten-minute lead: the fire time is seven minutes
       past and the event's own minute is still comfortably ahead. An earlier
       version of this test used 40 seconds and a one-minute lead, which Firefox
       failed honestly — it was slow enough filling the form that the event's
       minute had begun by the time it saved, so the app was right to treat it as
       history. The margin is the fix, not the assertion. */
    const soon = new Date(Date.now() + 3 * 60000);
    await page.locator('#cal-add-calendar').click();
    await page.locator('#cal-f-title-calendar').fill('Imminent');
    await page
      .locator('#cal-f-time-calendar')
      .fill(
        `${String(soon.getHours()).padStart(2, '0')}:${String(
          soon.getMinutes()
        ).padStart(2, '0')}`
      );
    await page.locator('#cal-f-alert-calendar').fill('10');
    await page.locator('#cal-f-save-calendar').click();
    // Not suppressed on save...
    expect(
      await page.evaluate(
        () => (window as any).calendarEventsSnapshot()[0].lastFired
      )
    ).toBeNull();
    // ...and announced on the next sweep.
    await page.evaluate(() => (window as any).sweepDueEvents());
    await expect(page.locator('#app-alert-detail')).toContainText('Imminent');
  });

  test('reminders missed while the app was shut are caught up, older ones passed over', async ({
    page,
  }) => {
    await openFresh(page);
    const session = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const win = window as any;
      const day = (offset: number) =>
        win.dateKey(new Date(Date.now() + offset * 86400000));
      const base = {
        time: '09:00',
        allDay: false,
        note: '',
        repeat: 'none',
        alertMinutes: 0,
        lastFired: null,
      };
      return {
        theme: 'dark-mode',
        events: [
          { id: 'missed1', title: 'Yesterday standup', date: day(-1), ...base },
          { id: 'ancient', title: 'Long forgotten', date: day(-30), ...base },
        ],
      };
    });
    const tmp = path.join(os.tmpdir(), `cbapp-catchup-${Date.now()}.json`);
    fs.writeFileSync(tmp, JSON.stringify(session), 'utf8');
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      clickNav(page, { tooltip: 'Import Session File' }),
    ]);
    await chooser.setFiles(tmp);
    await acceptPlainImport(page);
    await page.waitForTimeout(500);

    // Import restores the events; the sweep announces what was missed.
    await page.evaluate(() => (window as any).sweepDueEvents());
    const card = page.locator('#app-alert');
    await expect(card).toBeVisible();
    const detail = page.locator('#app-alert-detail');
    await expect(detail).toContainText('Yesterday standup');
    // Older than the 7-day catch-up window: counted, never enumerated — and
    // never silently dropped either.
    await expect(detail).not.toContainText('Long forgotten');
    await expect(detail).toContainText('passed over');

    // Both are stamped now, so reopening does not replay them.
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const win = window as any;
      win.dismissAppAlert();
      win.sweepDueEvents();
    });
    await expect(card).toBeHidden();
  });

  test('alerts do not need the calendar window open', async ({ page }) => {
    await openCalendar(page);
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const win = window as any;
      const now = new Date();
      win.commitEvents([
        {
          id: 'headless',
          title: 'Fires anyway',
          date: win.dateKey(now),
          time: `${String(now.getHours()).padStart(2, '0')}:${String(
            now.getMinutes()
          ).padStart(2, '0')}`,
          allDay: false,
          note: '',
          repeat: 'none',
          alertMinutes: 0,
          lastFired: null,
        },
      ]);
    });
    await page.locator('#calendar .close-calendar').click();
    await expect(page.locator('#calendar')).toHaveCount(0);
    await page.evaluate(() => (window as any).sweepDueEvents());
    await expect(page.locator('#app-alert-detail')).toContainText('Fires anyway');
    // Open calendar rebuilds the window on the day the reminder was about.
    await page.locator('#app-alert button', { hasText: 'Open calendar' }).click();
    await expect(page.locator('#calendar')).toBeVisible();
  });

  test('events survive a reload and are encrypted by Protect', async ({ page }) => {
    await openCalendar(page);
    await seed(
      page,
      eventRecord({ id: 'keep1', title: 'Rent due', date: '2026-09-01' })
    );
    await forceSave(page);

    await page.reload();
    await expect(page.locator('#calendar')).toBeVisible({ timeout: 10000 });
    expect(
      await page.evaluate(() => (window as any).calendarEventsSnapshot().length)
    ).toBe(1);

    // Protect: the title must not be readable in storage afterwards.
    await clickNavId(page, '#protect-toggle');
    await enterPassphrase(page, 'cal-passphrase1');
    await enterPassphrase(page, 'cal-passphrase1');
    await page.waitForTimeout(500);
    const stored = await page.evaluate(() =>
      localStorage.getItem('notepadSession')
    );
    expect(stored).not.toContain('Rent due');
    expect(JSON.parse(stored as string).enc).toBe(true);
  });

  test('the validator refuses bad events and clamps silly lead times', async ({
    page,
  }) => {
    await openFresh(page);
    const verdicts = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const win = window as any;
      const base = {
        id: 'v',
        title: 'x',
        date: '2026-08-14',
        time: '09:00',
        allDay: false,
        note: '',
        repeat: 'none',
        alertMinutes: 0,
        lastFired: null,
      };
      const check = (over: Record<string, unknown>) => {
        try {
          return {
            ok: true,
            value: win.sanitizeCalendarEvent({ ...base, ...over }, 'e'),
          };
        } catch (e) {
          return { ok: false, value: null };
        }
      };
      return {
        // "2026-02-30" passes a regex and is still not a day.
        fakeDay: check({ date: '2026-02-30' }).ok,
        badFormat: check({ date: '14/08/2026' }).ok,
        badTime: check({ time: '25:00' }).ok,
        allDayNeedsNoTime: check({ allDay: true, time: null }).ok,
        unknownRepeat: check({ repeat: 'fortnightly' }).value?.repeat,
        hugeLead: check({ alertMinutes: 9e9 }).value?.alertMinutes,
        junkLead: check({ alertMinutes: 'soon' }).value?.alertMinutes,
        negativeLead: check({ alertMinutes: -5 }).value?.alertMinutes,
        junkLastFired: check({ lastFired: 'whenever' }).value?.lastFired,
        longNote: check({ note: 'z'.repeat(5000) }).value?.note.length,
      };
    });
    expect(verdicts.fakeDay).toBe(false);
    expect(verdicts.badFormat).toBe(false);
    expect(verdicts.badTime).toBe(false);
    expect(verdicts.allDayNeedsNoTime).toBe(true);
    expect(verdicts.unknownRepeat).toBe('none');
    expect(verdicts.hugeLead).toBe(100000);
    expect(verdicts.junkLead).toBeNull();
    expect(verdicts.negativeLead).toBe(0);
    expect(verdicts.junkLastFired).toBeNull();
    expect(verdicts.longNote).toBe(2000);
  });

  test('a dangerous key in an event is refused outright', async ({ page }) => {
    await openFresh(page);
    const tmp = path.join(os.tmpdir(), `cbapp-evil-event-${Date.now()}.json`);
    // Written as text: JSON.stringify of an object literal would not carry a
    // __proto__ key through at all.
    fs.writeFileSync(
      tmp,
      '{"theme":"dark-mode","events":[{"date":"2026-08-14","time":"09:00","title":"x","__proto__":{"polluted":true}}]}',
      'utf8'
    );
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      clickNav(page, { tooltip: 'Import Session File' }),
    ]);
    await chooser.setFiles(tmp);
    await acceptPlainImport(page);
    await page.waitForTimeout(500);
    expect(await visibleStatusText(page)).toMatch(/invalid|failed|dangerous/i);
    expect(
      await page.evaluate(() => (window as any).calendarEventsSnapshot().length)
    ).toBe(0);
  });

  test('both desks share one set of events', async ({ page }) => {
    await openCalendar(page);
    await seed(page, eventRecord({ id: 'shared1', title: 'Shared event' }));
    // The canvas desk gets its own calendar window, not its own events.
    await clickNavId(page, '#canvas-toggle');
    await clickNavId(page, '#calendar-toggle');
    await expect(page.locator('#calendar-canvas')).toBeVisible();
    expect(
      await page.evaluate(() => (window as any).calendarEventsSnapshot().length)
    ).toBe(1);
    await page.locator('#cal-filter-calendar-canvas').fill('Shared');
    await expect(page.locator('#cal-lower-calendar-canvas .cal-event')).toHaveCount(
      1
    );
  });

  test('a frozen calendar refuses edits and says so', async ({ page }) => {
    await openCalendar(page);
    await page.locator('#calendar .lock-window').click();
    /* v4.0.3 changed what a frozen calendar freezes. This used to assert the
       search box went readOnly with everything else; it is deliberately exempt
       now, because searching is reading and a frozen calendar you cannot look
       through is not what "freeze editing" promises. Add event is the thing that
       must be refused. */
    await expect(page.locator('#cal-add-calendar')).toBeDisabled();
    await page.waitForTimeout(3200); // let the freeze toast clear
    await page.locator('#cal-add-calendar').click({ force: true });
    // No form opens, and there is an explanation rather than silence.
    await expect(page.locator('#cal-f-title-calendar')).toHaveCount(0);
    expect(await visibleStatusText(page)).toMatch(/frozen/i);
  });
});

/**
 * v4.0.3 — findings from the round-1 security review, each pinned here.
 * The headline one: a freeze is applied to nodes, and renderCalendar replaces
 * every node, so a frozen calendar re-armed its own delete button.
 */
test.describe('CB App — calendar review round 1', () => {
  const visibleStatusText = (page: Page) =>
    page.evaluate(() => {
      const s = document.getElementById('status') as HTMLElement;
      return getComputedStyle(s).display !== 'none' ? (s.textContent || '').trim() : '';
    });

  async function importJson(page: Page, text: string, name: string) {
    const tmp = path.join(os.tmpdir(), `cbapp-${name}-${Date.now()}.json`);
    fs.writeFileSync(tmp, text, 'utf8');
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      clickNav(page, { tooltip: 'Import Session File' }),
    ]);
    await chooser.setFiles(tmp);
    await acceptPlainImport(page);
    await page.waitForTimeout(500);
  }

  const EVENT_BASE = {
    time: '09:00',
    allDay: false,
    note: '',
    repeat: 'none',
    alertMinutes: null,
    lastFired: null,
  };

  test('a frozen calendar keeps refusing edits after a re-render', async ({ page }) => {
    await openFresh(page);
    await clickNavId(page, '#calendar-toggle');
    await page.locator('#cal-add-calendar').click();
    await page.locator('#cal-f-title-calendar').fill('Do not delete me');
    await page.locator('#cal-f-save-calendar').click();
    await expect(page.locator('#cal-lower-calendar .cal-event')).toHaveCount(1);

    await page.locator('#calendar .lock-window').click();
    /* The bug: any re-render rebuilt the row buttons without the disabled
       attribute the freeze had put on them. A reminder firing does this, and so
       does an edit on the other desk's calendar, since both share one store. */
    await page.evaluate(() => (window as any).renderCalendar('calendar'));

    const del = page.locator('.cal-event button[aria-label^="Delete"]');
    await expect(del).toBeDisabled();
    await expect(page.locator('.cal-event button[aria-label^="Edit"]')).toBeDisabled();
    await expect(page.locator('#cal-add-calendar')).toBeDisabled();

    // Belt and braces: forcing the click, and calling the API directly, are both
    // refused — an attribute is not a guarantee once nodes get rebuilt.
    await del.click({ force: true });
    await page.evaluate(() => {
      const win = window as any;
      win.calDeleteEvent('calendar', win.calendarEventsSnapshot()[0].id);
    });
    expect(
      await page.evaluate(() => (window as any).calendarEventsSnapshot().length)
    ).toBe(1);

    // Unfreezing hands it back.
    await page.locator('#calendar .lock-window').click();
    await del.click();
    expect(
      await page.evaluate(() => (window as any).calendarEventsSnapshot().length)
    ).toBe(0);
  });

  test('a frozen calendar can still be read: month, day and search all work', async ({
    page,
  }) => {
    await openFresh(page);
    await clickNavId(page, '#calendar-toggle');
    await page.locator('#cal-add-calendar').click();
    await page.locator('#cal-f-title-calendar').fill('Readable while frozen');
    await page.locator('#cal-f-save-calendar').click();
    await page.locator('#calendar .lock-window').click();

    /* Paging the month and searching are reading, not editing — the same reason
       a frozen note's textarea goes readOnly instead of disabled. Without the
       exemption a frozen calendar could only ever show the day it was frozen on. */
    const month = () =>
      page.evaluate(() => document.getElementById('calendar')!.dataset.viewMonth);
    const before = await month();
    await page.locator('.cal-monthbar button').first().click();
    expect(await month()).not.toBe(before);
    await page.locator('.cal-monthbar button', { hasText: 'Today' }).click();

    await expect(page.locator('#cal-filter-calendar')).not.toHaveAttribute('readonly', '');
    await page.locator('#cal-filter-calendar').fill('Readable');
    await expect(page.locator('#cal-lower-calendar .cal-event')).toHaveCount(1);
  });

  test('an imported file cannot make two events share an id', async ({ page }) => {
    await openFresh(page);
    /* An id is an identity: edit and delete both resolve by it, so repeated ids
       made one click delete several rows and one edit replace them all with the
       same object reference. */
    await importJson(
      page,
      JSON.stringify({
        theme: 'dark-mode',
        events: [
          { id: 'same', title: 'First', date: '2026-08-10', ...EVENT_BASE },
          { id: 'same', title: 'Second', date: '2026-08-11', ...EVENT_BASE },
          { id: 'same', title: 'Third', date: '2026-08-12', ...EVENT_BASE },
        ],
      }),
      'dupe-ids'
    );
    const ids = await page.evaluate(() =>
      (window as any).calendarEventsSnapshot().map((e: { id: string }) => e.id)
    );
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);

    await clickNavId(page, '#calendar-toggle');
    await page.evaluate(() => {
      const win = window as any;
      win.calDeleteEvent('calendar', win.calendarEventsSnapshot()[0].id);
    });
    // Exactly one, not all three.
    expect(
      await page.evaluate(() => (window as any).calendarEventsSnapshot().length)
    ).toBe(2);
  });

  test('events dropped at the cap are reported, not swallowed', async ({ page }) => {
    await openFresh(page);
    const events = Array.from({ length: 505 }, (_, i) => ({
      id: `e${i}`,
      title: `E${i}`,
      date: '2026-08-10',
      ...EVENT_BASE,
    }));
    await importJson(page, JSON.stringify({ theme: 'dark-mode', events }), 'over-cap');
    expect(
      await page.evaluate(() => (window as any).calendarEventsSnapshot().length)
    ).toBe(500);
    // The window path counts what it skips and says so; events now do too.
    // (v4.0.4 fixed the verb: "5 events were", "1 event was".)
    expect(await visibleStatusText(page)).toMatch(/5 events were past the 500 limit/i);
  });

  test('boot survives a browser that refuses localStorage', async ({ page }) => {
    /* The retired-calendar purge ran outside the try that guards the session
       load, and merely touching localStorage throws SecurityError where site
       data is blocked by policy. Unguarded it took window.onload down with it —
       which since v4.0.0 also means the alert scheduler never starts, so the
       calendar silently never fires a reminder. */
    await page.addInitScript(() => {
      const boom = () => {
        throw new DOMException('denied', 'SecurityError');
      };
      const stub = {
        getItem: boom,
        setItem: boom,
        removeItem: boom,
        clear: boom,
        key: boom,
        length: 0,
      };
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        get: () => stub,
      });
    });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(URL);
    await expectBooted(page);

    /* Proof that boot ran to the END, not merely that the script parsed: the
       save-failure badge is only written by the storage catch, and a due reminder
       only fires if startAlertScheduler()/sweepDueEvents() at the last line of
       window.onload were reached. Asserting `typeof sweepDueEvents` would prove
       nothing — it is a top-level declaration that exists whether onload
       completed or threw on its first line. */
    // The badge is a short "⚠ Not saving"; the sentence lives in its title.
    await expect(page.locator('#save-warning')).toHaveAttribute(
      'title',
      /not allowing CB App to store/i
    );

    await clickNavId(page, '#calendar-toggle');
    await expect(page.locator('#calendar')).toBeVisible();
    await page.evaluate(() => {
      const win = window as any;
      const now = new Date();
      win.commitEvents([
        {
          id: 'nostorage1',
          title: 'Fires without storage',
          date: win.dateKey(now),
          time: `${String(now.getHours()).padStart(2, '0')}:${String(
            now.getMinutes()
          ).padStart(2, '0')}`,
          allDay: false,
          note: '',
          repeat: 'none',
          alertMinutes: 0,
          lastFired: null,
        },
      ]);
      win.sweepDueEvents();
    });
    await expect(page.locator('#app-alert-detail')).toContainText('Fires without storage');
    expect(errors.join(' ')).not.toMatch(/SecurityError/);
  });

  test('a long unbroken event title cannot burst the alert card', async ({ page }) => {
    await openFresh(page);
    await clickNavId(page, '#calendar-toggle');
    await page.evaluate(() => {
      const win = window as any;
      const now = new Date();
      win.commitEvents([
        {
          id: 'wide1',
          title: 'z'.repeat(200),
          date: win.dateKey(now),
          time: `${String(now.getHours()).padStart(2, '0')}:${String(
            now.getMinutes()
          ).padStart(2, '0')}`,
          allDay: false,
          note: '',
          repeat: 'none',
          alertMinutes: 0,
          lastFired: null,
        },
      ]);
      win.sweepDueEvents();
    });
    await expect(page.locator('#app-alert')).toBeVisible();
    const fits = await page.evaluate(() => {
      const card = document.getElementById('app-alert') as HTMLElement;
      const detail = document.getElementById('app-alert-detail') as HTMLElement;
      return {
        wraps: getComputedStyle(detail).overflowWrap,
        noSideScroll: detail.scrollWidth <= detail.clientWidth,
        insideViewport:
          card.getBoundingClientRect().left >= 0 &&
          card.getBoundingClientRect().right <= window.innerWidth,
      };
    });
    expect(fits.wraps).toBe('anywhere');
    expect(fits.noSideScroll).toBe(true);
    expect(fits.insideViewport).toBe(true);
    // Dismiss stays reachable, which is the thing that actually matters.
    await page.locator('#app-alert button', { hasText: 'Dismiss' }).click();
    await expect(page.locator('#app-alert')).toBeHidden();
  });
});

/**
 * v4.0.3 — findings from the round-2 quality review. The two that mattered were
 * both in the occurrence maths I shipped in 4.0.0, and neither was reachable by
 * the original tests because they picked all their dates inside one DST regime
 * and created every event "today".
 *
 * The timezone is pinned: these assertions are only meaningful somewhere that
 * observes DST, and a runner in UTC would pass them without testing anything.
 */
test.describe('CB App — calendar review round 2', () => {
  test.use({ timezoneId: 'America/New_York' });

  const openCal = async (page: Page) => {
    await openFresh(page);
    await clickNavId(page, '#calendar-toggle');
    await expect(page.locator('#calendar')).toBeVisible();
  };

  test('recurrence survives a DST boundary', async ({ page }) => {
    await openCal(page);
    const m = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const win = window as any;
      const ev = (o: Record<string, unknown>) => ({
        id: 'x',
        title: 't',
        date: '2026-07-01', // a Wednesday, in summer time
        time: '09:00',
        allDay: false,
        note: '',
        repeat: 'none',
        alertMinutes: null,
        lastFired: null,
        ...o,
      });
      const from = (s: string) => win.parseDateKey(s);
      const weekly = ev({ repeat: 'weekly' });
      const dowOf = (s: string) => win.parseDateKey(s).getDay();
      /* A year-long sweep, because the original bug was not a single wrong date:
         elapsed ms between two local midnights is off by an hour across a DST
         boundary, so `Math.ceil(ms / 7 days)` rounded a partial week up to a whole
         extra one and every weekly answer after November was a day early. */
      let wrongWeekday = 0;
      for (let a = 0; a < 365; a += 7) {
        const anchor = win.dateKey(new Date(2026, 0, 1 + a));
        const anchorDow = dowOf(anchor);
        const e = ev({ date: anchor, repeat: 'weekly' });
        for (let q = 1; q < 400; q += 11) {
          const got = win.nextOccurrence(e, new Date(2026, 0, 1 + a + q));
          if (!got || dowOf(got) !== anchorDow) wrongWeekday++;
        }
      }
      return {
        wrongWeekday,
        // December is standard time; the event was created in summer time.
        weeklyIntoWinter: win.nextOccurrence(weekly, from('2026-12-02')),
        weeklyIntoWinterDow: dowOf(win.nextOccurrence(weekly, from('2026-12-02'))),
        occursOnTheRealDay: win.eventOccursOn(weekly, '2026-12-02'),
        occursOnTheDayBefore: win.eventOccursOn(weekly, '2026-12-01'),
        // Daily used to fail exactly once a year, on the spring-forward day.
        dailyOverSpringForward: win.nextOccurrence(
          ev({ date: '2026-03-09', repeat: 'daily' }),
          from('2027-03-14')
        ),
      };
    });
    // Every weekly occurrence must keep the anchor's weekday, all year.
    expect(m.wrongWeekday).toBe(0);
    expect(m.weeklyIntoWinter).toBe('2026-12-02');
    expect(m.weeklyIntoWinterDow).toBe(3); // still a Wednesday
    expect(m.occursOnTheRealDay).toBe(true);
    expect(m.occursOnTheDayBefore).toBe(false);
    expect(m.dailyOverSpringForward).toBe('2027-03-14');
  });

  test('previousOccurrence is the exact mirror of nextOccurrence', async ({ page }) => {
    await openCal(page);
    const m = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const win = window as any;
      const ev = (o: Record<string, unknown>) => ({
        id: 'x',
        title: 't',
        date: '2026-07-01',
        time: '09:00',
        allDay: false,
        note: '',
        repeat: 'none',
        alertMinutes: null,
        lastFired: null,
        ...o,
      });
      const from = (s: string) => win.parseDateKey(s);
      return {
        // Midnight on the 2nd: that day's 09:00 has not started, so the answer is
        // the previous week's.
        weeklyAtMidnight: win.previousOccurrence(
          ev({ repeat: 'weekly' }),
          from('2026-12-02')
        ),
        // Later the same day it is the 2nd itself.
        weeklyAfterItStarts: win.previousOccurrence(
          ev({ repeat: 'weekly' }),
          new Date(2026, 11, 2, 10, 0)
        ),
        monthlyClamps: win.previousOccurrence(
          ev({ date: '2026-01-31', repeat: 'monthly' }),
          from('2026-03-15')
        ),
        yearlyClamps: win.previousOccurrence(
          ev({ date: '2024-02-29', repeat: 'yearly' }),
          from('2026-06-01')
        ),
        // Nothing has occurred before the event exists.
        beforeItExists: win.previousOccurrence(ev({}), from('2026-01-01')),
      };
    });
    expect(m.weeklyAtMidnight).toBe('2026-11-25');
    expect(m.weeklyAfterItStarts).toBe('2026-12-02');
    expect(m.monthlyClamps).toBe('2026-02-28');
    expect(m.yearlyClamps).toBe('2026-02-28');
    expect(m.beforeItExists).toBeNull();
  });

  test('a reminder announces the occurrence it is actually about', async ({ page }) => {
    await openCal(page);
    const m = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const win = window as any;
      const now = new Date();
      const day = (o: number) => win.dateKey(new Date(Date.now() + o * 86400000));
      const ev = (o: Record<string, unknown>) => ({
        id: 'x',
        title: 't',
        date: day(-30),
        time: '09:00',
        allDay: false,
        note: '',
        repeat: 'daily',
        alertMinutes: 0,
        lastFired: null,
        ...o,
      });
      /* The old search asked nextOccurrence from `now - lead`, which returns the
         FIRST occurrence in that window — the oldest pending one. With a one-day
         lead it announced yesterday's occurrence and stamped it, so today's real
         reminder never fired and the event stayed permanently one lead behind. */
      const oneDay = win.dueOccurrence(ev({ alertMinutes: 1440 }), now);
      const twoWeeks = win.dueOccurrence(ev({ alertMinutes: 20160 }), now);
      return {
        // Today's 09:00, whose 24h-ahead alert fell due yesterday.
        oneDayLead: oneDay,
        oneDayLeadIsNotYesterday: oneDay !== day(-1),
        // 14 days out — this used to resolve older than the catch-up cutoff every
        // single sweep, so it was counted stale and never announced at all.
        twoWeekLead: twoWeeks,
        twoWeekLeadIsFuture: twoWeeks > win.dateKey(now),
        // Nothing due yet stays silent.
        notYet: win.dueOccurrence(
          ev({ date: day(5), repeat: 'none', alertMinutes: 0 }),
          now
        ),
      };
    });
    expect(m.oneDayLeadIsNotYesterday).toBe(true);
    expect(m.twoWeekLeadIsFuture).toBe(true);
    expect(m.notYet).toBeNull();
  });

  test('a long lead time still reaches the card', async ({ page }) => {
    await openCal(page);
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const win = window as any;
      const day = (o: number) => win.dateKey(new Date(Date.now() + o * 86400000));
      win.commitEvents([
        {
          id: 'long1',
          title: 'Two week warning',
          date: day(-30),
          time: '09:00',
          allDay: false,
          note: '',
          repeat: 'daily',
          alertMinutes: 20160, // 14 days
          lastFired: null,
        },
      ]);
      win.sweepDueEvents();
    });
    // Silent forever before v4.0.3.
    await expect(page.locator('#app-alert-detail')).toContainText('Two week warning');
  });

  test('keyboard focus survives clicking a day', async ({ page }) => {
    await openCal(page);
    const cell = page.locator('.cal-day:not(.cal-empty)').nth(12);
    await cell.focus();
    const key = await page.evaluate(
      () => (document.activeElement as HTMLElement).dataset.dayKey
    );
    await page.keyboard.press('Enter');
    /* renderCalendarGrid rebuilds all 31 cells, which threw the focused one away
       and dropped focus to <body> — so a keyboard user had to tab from the top of
       the document to reach the next day. */
    const after = await page.evaluate(() => ({
      tag: document.activeElement?.tagName,
      dayKey: (document.activeElement as HTMLElement).dataset?.dayKey,
    }));
    expect(after.tag).toBe('BUTTON');
    expect(after.dayKey).toBe(key);
  });

  test('the viewed month and a rename both survive a reload', async ({ page }) => {
    await openCal(page);
    await page.evaluate(() => (window as any).calShiftMonth('calendar', 3));
    const shifted = (await page.locator('#cal-month-calendar').textContent())?.trim();
    await page.evaluate(() => {
      const title = document.querySelector('#calendar .calendar-title') as HTMLElement;
      title.textContent = 'My Cal';
      (window as any).saveSession();
    });
    await page.waitForTimeout(400);
    await page.reload();
    await expect(page.locator('#calendar')).toBeVisible({ timeout: 10000 });
    // The month was re-derived from the selected day before v4.0.3, so paging
    // three months ahead and reloading came back to this month.
    await expect(page.locator('#cal-month-calendar')).toHaveText(shifted as string);
    // The header offers ✏️ Rename; the name was written to the record but never
    // read back, so the rename was silently discarded.
    await expect(page.locator('#calendar .calendar-title')).toHaveText('My Cal');
  });

  test('a day click with the search box full shows that day, not the old matches', async ({
    page,
  }) => {
    await openCal(page);
    await page.locator('#cal-add-calendar').click();
    await page.locator('#cal-f-title-calendar').fill('Standup');
    await page.locator('#cal-f-save-calendar').click();
    await page.locator('#cal-filter-calendar').fill('Standup');
    await expect(page.locator('#cal-lower-calendar .cal-event')).toHaveCount(1);

    // Clicking a day used to move the highlight and change nothing below it,
    // because a non-empty filter makes the lower pane show whole-store matches.
    await page.locator('.cal-day:not(.cal-empty)').nth(5).click();
    await expect(page.locator('#cal-filter-calendar')).toHaveValue('');
    await expect(page.locator('#cal-lower-calendar .cal-section-head').first()).toContainText(
      /day,/i
    );
  });

  test('the blank cells before the 1st are not offered as clickable', async ({ page }) => {
    await openCal(page);
    // August 2026 starts on a Saturday, so there are six leading pads.
    await page.evaluate(() => {
      const win = window as any;
      const el = document.getElementById('calendar')!;
      el.dataset.viewYear = '2026';
      el.dataset.viewMonth = '7';
      win.renderCalendar('calendar');
    });
    const pads = page.locator('.cal-day.cal-empty');
    expect(await pads.count()).toBeGreaterThan(0);
    await pads.first().hover();
    // The pads carry .cal-day too, so they used to take the accent hover border
    // while their own cursor said "not clickable".
    expect(
      await page.evaluate(
        () => getComputedStyle(document.querySelector('.cal-day.cal-empty')!).borderColor
      )
    ).toBe('rgba(0, 0, 0, 0)');
  });

  test('an unrecognised repeat cannot be saved from the form', async ({ page }) => {
    await openCal(page);
    await page.locator('#cal-add-calendar').click();
    await page.locator('#cal-f-title-calendar').fill('Tampered');
    // The select can only emit legal values, so this is the tampered case: an
    // unrecognised repeat makes the event show once and never fire, silently.
    await page.evaluate(() => {
      const sel = document.getElementById('cal-f-repeat-calendar') as HTMLSelectElement;
      const opt = document.createElement('option');
      opt.value = 'fortnightly';
      sel.appendChild(opt);
      sel.value = 'fortnightly';
    });
    await page.locator('#cal-f-save-calendar').click();
    expect(
      await page.evaluate(() => (window as any).calendarEventsSnapshot()[0].repeat)
    ).toBe('none');
  });
});

/**
 * v4.0.4 — the round-2 pass over v4.0.3's own fixes. The headline one is mine
 * from an hour earlier: v4.0.3 taught `lockableControls` about `data-lock-exempt`
 * and forgot to teach the frozen-window message, so a frozen calendar paged its
 * month perfectly well while insisting it was frozen.
 */
test.describe('CB App — calendar review round 3', () => {
  const visibleStatus = (page: Page) =>
    page.evaluate(() => {
      const s = document.getElementById('status') as HTMLElement;
      return getComputedStyle(s).display !== 'none' ? (s.textContent || '').trim() : '';
    });

  test('a frozen calendar is silent about the things it still allows', async ({
    page,
  }) => {
    await openFresh(page);
    await clickNavId(page, '#calendar-toggle');
    await page.locator('#cal-add-calendar').click();
    await page.locator('#cal-f-title-calendar').fill('Dentist');
    await page.locator('#cal-f-save-calendar').click();
    await page.waitForTimeout(3300); // let "Event added." expire
    await page.locator('#calendar .lock-window').click();
    await page.waitForTimeout(3300); // and the freeze notice

    // Reading is exempt, so it must not draw the "this is frozen" message — which
    // would also evict whatever the status line was legitimately showing.
    const before = await page.locator('#cal-month-calendar').textContent();
    await page.locator('.cal-monthbar button').first().click();
    expect(await page.locator('#cal-month-calendar').textContent()).not.toBe(before);
    expect(await visibleStatus(page)).toBe('');

    await page.locator('#cal-filter-calendar').fill('Den');
    await expect(page.locator('#cal-lower-calendar .cal-event')).toHaveCount(1);
    expect(await visibleStatus(page)).toBe('');

    // An actual edit attempt still explains itself.
    await page.locator('#cal-add-calendar').click({ force: true });
    expect(await visibleStatus(page)).toMatch(/frozen/i);
  });

  test('recurrence holds in a zone that deleted a whole calendar day', async ({
    browser,
  }) => {
    /* Samoa skipped 30 December 2011 outright, so elapsed 24h periods between two
       local midnights are one FEWER than the calendar dates between them —
       rounding the millisecond gap cannot recover that, which is why dayDiff
       counts UTC dates instead. A daily event anchored before the jump used to
       vanish from the grid completely. */
    const context = await browser.newContext({ timezoneId: 'Pacific/Apia' });
    const page = await context.newPage();
    await page.goto(URL);
    await expectBooted(page);
    const m = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const win = window as any;
      const ev = {
        id: 'x',
        title: 't',
        date: '2010-05-05',
        time: '09:00',
        allDay: false,
        note: '',
        repeat: 'daily',
        alertMinutes: null,
        lastFired: null,
      };
      let hits = 0;
      for (let d = 1; d <= 31; d++) {
        if (win.eventOccursOn(ev, win.dateKey(new Date(2026, 7, d)))) hits++;
      }
      return {
        gap: win.dayDiff(win.parseDateKey('2010-05-05'), win.parseDateKey('2026-08-06')),
        augustHits: hits,
        next: win.nextOccurrence(ev, win.parseDateKey('2026-08-06')),
      };
    });
    expect(m.gap).toBe(5937); // 5936 when counted as elapsed 24h periods
    expect(m.augustHits).toBe(31); // a daily event lands on every day
    expect(m.next).toBe('2026-08-06');
    await context.close();
  });

  test('a sweep with nothing recent enough to announce still says so', async ({
    page,
  }) => {
    await openFresh(page);
    await clickNavId(page, '#calendar-toggle');
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const win = window as any;
      const old = win.dateKey(new Date(Date.now() - 10 * 86400000));
      win.commitEvents([
        {
          id: 'stale1',
          title: 'Long gone',
          date: old,
          time: '09:00',
          allDay: false,
          note: '',
          repeat: 'none',
          alertMinutes: 0,
          lastFired: null,
        },
      ]);
      win.sweepDueEvents();
    });
    /* Older than CATCHUP_DAYS, so no card and no chime — but it used to be stamped
       in complete silence, which is the truncation the code claims not to do. */
    await expect(page.locator('#app-alert')).toBeHidden();
    expect(await visibleStatus(page)).toMatch(/1 reminder passed while CB App was closed/i);
    // Stamped, so it does not say it again on the next sweep.
    expect(
      await page.evaluate(() => (window as any).calendarEventsSnapshot()[0].lastFired)
    ).not.toBeNull();
  });

  test('the saved month must be an integer, not anything Number() will take', async ({
    page,
  }) => {
    await openFresh(page);
    const verdicts = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const win = window as any;
      const base = {
        visible: true,
        position: { left: '60', top: '60' },
        locked: false,
        minimized: false,
        mode: 'windowed',
        clockFormat: '12',
        selected: '2026-08-06',
      };
      const check = (over: Record<string, unknown>) =>
        win.validateSessionObject({ theme: 'dark-mode', calendar: { ...base, ...over } })
          .calendar;
      return {
        // Number(["2027"]) is 2027, so an array used to pass.
        arrayYear: check({ viewYear: ['2027'], viewMonth: 1 }).viewYear,
        // Number(null) is 0, so a null month used to validate as January.
        nullMonth: check({ viewYear: 2027, viewMonth: null }).viewMonth,
        // new Date(5, 0, 1) is 1905, not year 5.
        twoDigitYear: check({ viewYear: 5, viewMonth: 0 }).viewYear,
        stringYear: check({ viewYear: '2027', viewMonth: 1 }).viewYear,
        good: check({ viewYear: 2027, viewMonth: 11 }),
      };
    });
    expect(verdicts.arrayYear).toBeNull();
    expect(verdicts.nullMonth).toBeNull();
    expect(verdicts.twoDigitYear).toBeNull();
    expect(verdicts.stringYear).toBeNull();
    expect(verdicts.good.viewYear).toBe(2027);
    expect(verdicts.good.viewMonth).toBe(11);
  });

  test('the month label does not re-announce itself on an unchanged render', async ({
    page,
  }) => {
    await openFresh(page);
    await clickNavId(page, '#calendar-toggle');
    /* The label is aria-live, and every render wrote it unconditionally — so
       typing seven characters into the search box, each of which re-renders, had a
       screen reader say the month seven times. */
    const writes = await page.evaluate(async () => {
      const el = document.getElementById('cal-month-calendar') as HTMLElement;
      let n = 0;
      new MutationObserver((recs) => {
        n += recs.length;
      }).observe(el, { childList: true, characterData: true, subtree: true });
      const win = window as any;
      win.renderCalendar('calendar');
      win.renderCalendar('calendar');
      win.renderCalendar('calendar');
      await new Promise((r) => setTimeout(r, 50));
      return n;
    });
    expect(writes).toBe(0);
    // ...but a real month change still speaks.
    const changed = await page.evaluate(async () => {
      const el = document.getElementById('cal-month-calendar') as HTMLElement;
      let n = 0;
      new MutationObserver((recs) => {
        n += recs.length;
      }).observe(el, { childList: true, characterData: true, subtree: true });
      (window as any).calShiftMonth('calendar', 1);
      await new Promise((r) => setTimeout(r, 50));
      return n;
    });
    expect(changed).toBeGreaterThan(0);
  });

  test('one dropped event reads as one', async ({ page }) => {
    await openFresh(page);
    const events = Array.from({ length: 501 }, (_, i) => ({
      id: `g${i}`,
      title: `G${i}`,
      date: '2026-08-10',
      time: '09:00',
      allDay: false,
      note: '',
      repeat: 'none',
      alertMinutes: null,
      lastFired: null,
    }));
    const tmp = path.join(os.tmpdir(), `cbapp-one-over-${Date.now()}.json`);
    fs.writeFileSync(tmp, JSON.stringify({ theme: 'dark-mode', events }), 'utf8');
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      clickNav(page, { tooltip: 'Import Session File' }),
    ]);
    await chooser.setFiles(tmp);
    await acceptPlainImport(page);
    await page.waitForTimeout(500);
    expect(await visibleStatus(page)).toMatch(/1 event was past the 500 limit/i);
  });
});

test.describe('CB App — smoke all toolbar buttons', () => {
  test('click through primary toolbar actions without pageerror', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await openFresh(page);

    await clickNav(page, { tooltip: 'New Note' });
    await clickNav(page, { tooltip: 'New Task List' });
    await clickNav(page, { tooltip: 'New Sticky Note' });
    await clickNavId(page, '#calculator-toggle');
    await clickNavId(page, '#clock-toggle');
    await clickNavId(page, '#log-toggle');
    await clickNav(page, { tooltip: 'View CB App Instructions' });
    await clickNavId(page, '#theme-toggle');
    await clickNavId(page, '#canvas-toggle');
    await clickNavId(page, '#search-btn');

    // Everything above was opened in the plain view, and since v3.2.10 a
    // window lives on the desk it was created on — so on the canvas none of it
    // is showing. Come back to assert it all survived the round trip. The
    // canvas-on assertion below moved with it.
    await expect(page.locator('body')).toHaveClass(/canvas-on/);
    await expect(page.locator('.window').first()).toBeHidden();
    await clickNavId(page, '#canvas-toggle');
    await expect(page.locator('body')).not.toHaveClass(/canvas-on/);

    await expect(page.locator('.window').first()).toBeVisible();
    await expect(page.locator('.task-window').first()).toBeVisible();
    await expect(page.locator('.sticky-note-window').first()).toBeVisible();
    await expect(page.locator('#calculator')).toBeVisible();
    await expect(page.locator('#clock')).toBeVisible();
    await expect(page.locator('#log')).toBeVisible();
    await expect(page.locator('.help-window').first()).toBeVisible();
    await expect(page.locator('#search-replace')).toHaveClass(/active/);

    const lockTitle = await page
      .locator('.window .lock-window')
      .first()
      .getAttribute('title');
    expect(lockTitle || '').toMatch(/not encryption/i);

    expect(errors).toEqual([]);
  });
});

/* ===========================================================================
   CB App v4.2.0 — the phone layout
   ---------------------------------------------------------------------------
   Two shapes, one app. On a phone (body.mobile-ui, set by syncMobileUI from a
   matchMedia listener) the toolbar rests collapsed as a bottom sheet and
   windows are full-bleed and stacked. On a desktop nothing about either
   changes, which the second block here asserts directly rather than trusting.

   Split by project because the two halves are contradictory by design: every
   assertion in the first block would be wrong in the second.
   =========================================================================== */
test.describe('CB App — the phone layout', () => {
  // phoneShaped(), not the isMobile fixture: Playwright calls an iPad mobile
  // and the app does not, so the fixture alone ran every assertion below
  // against a tablet's desktop layout. See the helper at the top of the file.
  test.skip(
    ({ isMobile, viewport }) => !phoneShaped(isMobile, viewport),
    'phone-only behaviour; the desktop half is the block below'
  );

  const stackTabs = (page: Page) => page.locator('#stack-tabs .window-tab');

  test('the toolbar rests collapsed and folds itself again after an action', async ({
    page,
  }) => {
    await openFresh(page);
    const menu = page.locator('nav.nav-menu');
    await expect(menu).toHaveClass(/collapsed/);
    // Collapsed, the hamburger IS the toolbar: everything else is hidden.
    await expect(page.locator('nav.nav-menu .nav-toggle')).toBeVisible();
    await expect(page.locator('#protect-toggle')).toBeHidden();

    await page.locator('nav.nav-menu .nav-toggle').click();
    await expect(menu).not.toHaveClass(/collapsed/);
    await expect(page.locator('#protect-toggle')).toBeVisible();
    await expect(page.locator('nav.nav-menu .nav-toggle')).toHaveAttribute(
      'aria-expanded',
      'true'
    );

    // Any action folds it: the sheet covers most of the screen, so leaving it
    // open over the thing the action just created would be its own bug.
    await page.locator('nav.nav-menu [data-tooltip="New Note"]').click();
    await expect(menu).toHaveClass(/collapsed/);
    await expect(page.locator('.window').first()).toBeVisible();
  });

  test('the scrim and Escape both close the sheet', async ({ page }) => {
    await openFresh(page);
    const menu = page.locator('nav.nav-menu');
    const scrim = page.locator('#nav-scrim');
    await expect(scrim).toBeHidden();

    await page.locator('nav.nav-menu .nav-toggle').click();
    await expect(scrim).toBeVisible();
    /* Regression: `transition: all` on .nav-menu animated z-index 1000 -> 1004
       over 300ms, and discrete interpolation holds the old value for the first
       half — so for ~150ms the scrim sat ON TOP of the sheet and the first tap
       after opening the toolbar closed it again. The sheet must out-rank the
       scrim the instant it opens. */
    const stacking = await page.evaluate(() => ({
      menu: Number(getComputedStyle(document.querySelector('.nav-menu')!).zIndex),
      scrim: Number(getComputedStyle(document.getElementById('nav-scrim')!).zIndex),
    }));
    expect(stacking.menu).toBeGreaterThan(stacking.scrim);

    /* Top-left, not the scrim's centre: the scrim covers the whole viewport
       INCLUDING the area behind the sheet, and its centre point is over the
       sheet's own buttons. Tapping "the page behind the sheet" means tapping
       somewhere the sheet is not. */
    await scrim.click({ position: { x: 10, y: 10 } });
    await expect(menu).toHaveClass(/collapsed/);

    await page.locator('nav.nav-menu .nav-toggle').click();
    await expect(menu).not.toHaveClass(/collapsed/);
    await page.keyboard.press('Escape');
    await expect(menu).toHaveClass(/collapsed/);
  });

  test('windows fill the screen, clear of the chrome at both ends', async ({
    page,
  }) => {
    await openFresh(page);
    await clickNav(page, { tooltip: 'New Note' });
    const box = await page.evaluate(() => {
      const el = document.querySelector('#windows > .window') as HTMLElement;
      const r = el.getBoundingClientRect();
      return { ...r.toJSON(), vw: window.innerWidth, vh: window.innerHeight };
    });
    expect(box.left).toBe(0);
    expect(box.width).toBe(box.vw);
    // One window means no tab strip, so it starts at the very top...
    expect(box.top).toBe(0);
    // ...and stops short of the standing bottom chrome (toolbar pill, lock,
    // download chip), which would otherwise sit on the note's own buttons.
    expect(box.vh - box.bottom).toBeGreaterThanOrEqual(40);

    // Every control in the note is on screen, which is the whole point: at
    // 557px wide the close button used to be past the right edge.
    for (const sel of ['.close-window', '.minimize-window', '.clear-note-button']) {
      const r = await page.locator(`#windows > .window ${sel}`).boundingBox();
      expect(r, sel).not.toBeNull();
      expect(r!.x + r!.width, sel).toBeLessThanOrEqual(box.vw);
    }
  });

  test('the tab strip appears at two windows and raises the one tapped', async ({
    page,
  }) => {
    await openFresh(page);
    await clickNav(page, { tooltip: 'New Note' });
    await expect(page.locator('#stack-tabs')).toBeHidden();

    await clickNav(page, { tooltip: 'New Task List' });
    await expect(stackTabs(page)).toHaveCount(2);
    // The newest window is on top, and the strip says so.
    await expect(stackTabs(page).nth(1)).toHaveClass(/current/);

    // Full-bleed windows are opaque and cover each other completely, so the
    // z-order is the only thing deciding what you are looking at.
    await stackTabs(page).nth(0).click();
    await expect(stackTabs(page).nth(0)).toHaveClass(/current/);
    const top = await page.evaluate(() => {
      const zs = [
        ...document.querySelectorAll('#windows > .window, #windows > .task-window'),
      ]
        .map((el) => ({ id: el.id, z: Number((el as HTMLElement).style.zIndex) }))
        .sort((a, b) => b.z - a.z);
      return zs[0].id;
    });
    expect(top).toMatch(/^window/);

    // And the strip takes its space out of the windows rather than over them.
    const gap = await page.evaluate(
      () =>
        (
          document.querySelector('#windows > .window') as HTMLElement
        ).getBoundingClientRect().top
    );
    expect(gap).toBeGreaterThan(0);
  });

  test('a minimised window is reachable from the tab strip', async ({ page }) => {
    await openFresh(page);
    await clickNav(page, { tooltip: 'New Note' });
    await clickNav(page, { tooltip: 'New Task List' });
    /* The task list is on top and full-bleed, so it covers the note's title
       bar completely — the note has to be raised before its own minimise
       button is reachable, which is the stacking model working, not fighting
       it. The strip is how you raise it. */
    const note = page.locator('#windows > .window').first();
    const id = await note.getAttribute('id');
    await stackTabs(page).nth(0).click();
    await page.locator(`#${id} .minimize-window`).click();
    await expect(note).toBeHidden();

    /* #minimized-bar stands down here — two bars listing overlapping sets of
       the same windows is worse than one listing all of them — so the strip
       has to carry minimised windows or they are lost outright. */
    await expect(page.locator('#minimized-bar')).toBeHidden();
    const hidden = page.locator('#stack-tabs .window-tab.hidden-window');
    await expect(hidden).toHaveCount(1);
    await hidden.click();
    await expect(note).toBeVisible();
  });

  test('the full-bleed size is never saved over the size a real screen gave it', async ({
    page,
  }) => {
    /* The geometry freeze. A note is 557x429 by default; on a 393px phone the
       CSS stretches it to the viewport, and measuredBox() must NOT write that
       back — a Backup taken on a phone would otherwise carry 393px notes to
       the desktop they were built on. */
    await openFresh(page);
    await clickNav(page, { tooltip: 'New Note' });
    const id = await page.locator('#windows > .window').first().getAttribute('id');
    await forceSave(page);
    const saved = await page.evaluate((id) => {
      const s = JSON.parse(localStorage.getItem('notepadSession') as string);
      return {
        width: s[id!].width as number,
        rendered: document.getElementById(id!)!.offsetWidth,
        vw: window.innerWidth,
      };
    }, id);
    // Against the viewport, not a magic number: full-bleed on a phone turned
    // sideways is 802px, which is WIDER than the 557 it must not overwrite.
    expect(saved.rendered).toBe(saved.vw);
    expect(saved.width).toBe(557); // and the stored size is untouched
  });

  test('dragging and resizing are off, and say so', async ({ page }) => {
    await openFresh(page);
    await clickNav(page, { tooltip: 'New Note' });
    const el = page.locator('#windows > .window').first();
    const id = await el.getAttribute('id');
    // The grip is the only resize handle in the app, and it is gone here.
    await expect(page.locator(`#${id} .resize-grip`)).toBeHidden();

    // A drag on the title bar leaves the window exactly where it was.
    const before = await page.evaluate(
      (id) => document.getElementById(id!)!.dataset.x,
      id
    );
    const header = page.locator(`#${id} .window-header`);
    const box = (await header.boundingBox())!;
    await page.mouse.move(box.x + 20, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 140, box.y + 200, { steps: 8 });
    await page.mouse.up();
    expect(
      await page.evaluate((id) => document.getElementById(id!)!.dataset.x, id)
    ).toBe(before);
  });

  test('two fingers zoom the canvas', async ({ page }) => {
    await openFresh(page);
    await clickNavId(page, '#canvas-toggle');
    await expect(page.locator('body')).toHaveClass(/canvas-on/);
    await expect(page.locator('#zoom-level')).toHaveText('100%');

    /* Playwright has no pinch gesture, and a phone has no Ctrl+wheel — the two
       fingers arrive as two pointers and nothing else, which is exactly what
       wireCanvasInput() tracks. Dispatched here at that level. */
    await page.evaluate(() => {
      const layer = document.getElementById('windows') as HTMLElement;
      const send = (type: string, id: number, x: number, y: number) =>
        layer.dispatchEvent(
          new PointerEvent(type, {
            pointerId: id,
            pointerType: 'touch',
            clientX: x,
            clientY: y,
            bubbles: true,
            cancelable: true,
          })
        );
      send('pointerdown', 1, 150, 300);
      send('pointerdown', 2, 250, 300); // 100px apart
      send('pointermove', 1, 100, 300);
      send('pointermove', 2, 300, 300); // 200px apart — a 2x spread
      send('pointerup', 1, 100, 300);
      send('pointerup', 2, 300, 300);
    });
    // ZOOM_MAX is 2, so a doubling lands exactly on the ceiling.
    await expect(page.locator('#zoom-level')).toHaveText('200%');
  });

  /* ---------------------------------------------------------------------
     The on-screen keyboard.

     Playwright cannot raise a real keyboard on any project here, so these
     reproduce iOS's SHAPE instead: the keyboard is an overlay, so the layout
     viewport (window.innerHeight) stays put while the visual viewport
     shrinks under it. Redefining innerHeight taller and firing the
     visualViewport resize the app already listens for puts exactly that gap
     in front of syncKeyboardInset().

     This tests the handler, not the platform — it cannot prove iOS reports
     what we think it does. It can prove that when iOS reports it, the
     windows and the chrome get out of the way, and that nothing moves on a
     browser that resizes its layout viewport instead (Android, and every
     project in this file).
     --------------------------------------------------------------------- */
  const fakeKeyboard = (page: Page, height: number) =>
    page.evaluate((h) => {
      Object.defineProperty(window, 'innerHeight', {
        value: window.visualViewport!.height + h,
        configurable: true,
      });
      window.visualViewport!.dispatchEvent(new Event('resize'));
    }, height);

  /* A real keyboard is a FRACTION of the screen, not a constant. An early
     draft used a flat 300px and failed only on mobile-landscape, whose
     viewport is 293px tall — a keyboard taller than the entire phone, which
     collapsed the window to nothing and was measuring the clamp rather than
     the fix. 40% is roughly what iOS and Android both take, and it clears
     KEYBOARD_MIN_INSET (100) on the shortest project here at 117px. */
  const keyboardHeight = (page: Page) =>
    page.evaluate(() => Math.round(window.visualViewport!.height * 0.4));

  test('the keyboard does not cover a note it is being typed into', async ({
    page,
  }) => {
    await openFresh(page);
    await clickNav(page, { tooltip: 'New Note' });
    const win = page.locator('#windows > .window').first();
    await expect(win).toBeVisible();

    const before = (await win.boundingBox())!;
    const kb = await keyboardHeight(page);
    await fakeKeyboard(page, kb);

    await expect
      .poll(async () =>
        page.evaluate(() =>
          getComputedStyle(document.body).getPropertyValue('--keyboard-inset').trim()
        )
      )
      .toBe(`${kb}px`);

    const after = (await win.boundingBox())!;
    // The window gave up the keyboard's height and not some other number.
    expect(Math.round(before.height - after.height)).toBe(kb);

    /* The point of all of it: the controls along the bottom edge — the format
       row and the word count — are the things the keyboard was covering, and
       they have to still be on screen. */
    const keyboardTop = await page.evaluate(
      () => window.visualViewport!.height
    );
    for (const sel of ['.format-buttons', '.counts']) {
      const box = (await win.locator(sel).first().boundingBox())!;
      expect(box.y + box.height).toBeLessThanOrEqual(keyboardTop + 1);
    }
  });

  test('the toolbar rides above the keyboard rather than behind it', async ({
    page,
  }) => {
    await openFresh(page);
    await clickNav(page, { tooltip: 'New Note' });
    await fakeKeyboard(page, await keyboardHeight(page));

    const keyboardTop = await page.evaluate(() => window.visualViewport!.height);
    const pill = (await page.locator('nav.nav-menu').boundingBox())!;
    expect(pill.y + pill.height).toBeLessThanOrEqual(keyboardTop + 1);
  });

  test('a gap too small to be a keyboard is ignored', async ({ page }) => {
    await openFresh(page);
    await clickNav(page, { tooltip: 'New Note' });
    /* iOS reports its own bottom browser toolbar in the same gap. At 60px
       this is that bar, not a keyboard, and reserving for it would shrink
       every window permanently. KEYBOARD_MIN_INSET is 100. */
    await fakeKeyboard(page, 60);
    await expect
      .poll(async () =>
        page.evaluate(() =>
          getComputedStyle(document.body).getPropertyValue('--keyboard-inset').trim()
        )
      )
      .toBe('0px');
  });
});

test.describe('CB App — the phone layout does not reach the desktop', () => {
  /* The mirror image, and it must use the SAME predicate or the two blocks
     both skip a shape and nothing covers it. An iPad belongs here: it is a
     touch device that gets the desktop layout, which is exactly the claim
     this block exists to check. */
  test.skip(
    ({ isMobile, viewport }) => phoneShaped(isMobile, viewport),
    'the point of this block is that a non-phone project sees none of it'
  );

  test('the toolbar is a bar and windows still float', async ({ page }) => {
    await openFresh(page);
    /* The breakpoint is `(max-width: 720px) and (pointer: coarse), (max-width:
       560px)` precisely so a desktop with devtools docked — narrow, but with a
       mouse — keeps the app it had. Width alone would have taken dragging and
       resizing away from someone who lost nothing but width. */
    await expect(page.locator('body')).not.toHaveClass(/mobile-ui/);
    await expect(page.locator('nav.nav-menu')).not.toHaveClass(/collapsed/);
    await expect(page.locator('#protect-toggle')).toBeVisible();
    await expect(page.locator('#stack-tabs')).toBeHidden();
    await expect(page.locator('#nav-scrim')).toBeHidden();

    /* The minimap is fitted to a BOX now so a phone can have one; a desktop's
       box has no height limit, so the width stays the binding constraint and
       the map is still exactly MAP_WIDTH across, in the same corner. */
    await clickNavId(page, '#canvas-toggle');
    const map = (await page.locator('#canvas-map').boundingBox())!;
    expect(map.width).toBe(168);
    expect(map.y).toBe(52);
    await clickNavId(page, '#canvas-toggle');

    await clickNav(page, { tooltip: 'New Note' });
    await expect(page.locator('#windows > .window .resize-grip')).toBeAttached();
    const box = (await page.locator('#windows > .window').first().boundingBox())!;
    expect(box.width).toBeCloseTo(557, -1);
    expect(box.x).toBeGreaterThan(0); // still cascaded, not pinned to the edge
  });

  test('a narrow window with a mouse is still the desktop app', async ({
    page,
    isMobile,
  }) => {
    /* The one test in this block that needs a MOUSE rather than merely a
       desktop layout: it narrows the window to 700px and asserts the app
       stays desktop, which is only true for a fine pointer. A tablet at
       700px matches `(max-width: 720px) and (pointer: coarse)` and becomes
       a phone, correctly. */
    test.skip(Boolean(isMobile), 'the premise is a mouse, not a layout');
    await openFresh(page);
    await page.setViewportSize({ width: 700, height: 600 });
    await expect(page.locator('body')).not.toHaveClass(/mobile-ui/);
    await expect(page.locator('#protect-toggle')).toBeVisible();

    // Below 560px even a mouse gets the sheet: the toolbar cannot be laid out
    // as a bar at that width by any arrangement.
    await page.setViewportSize({ width: 480, height: 600 });
    await expect(page.locator('body')).toHaveClass(/mobile-ui/);
    await expect(page.locator('nav.nav-menu')).toHaveClass(/collapsed/);

    // And it goes away again on the way back out.
    await page.setViewportSize({ width: 1000, height: 700 });
    await expect(page.locator('body')).not.toHaveClass(/mobile-ui/);
    await expect(page.locator('nav.nav-menu')).not.toHaveClass(/collapsed/);
  });
});

/* ===========================================================================
   Layout — what is on screen, on every project
   ---------------------------------------------------------------------------
   These run everywhere: desktop, both phone orientations, both engines. They
   assert geometry rather than pixels, which is what actually catches layout
   breakage without a baseline image that only matches the machine it was
   recorded on. tests/cbapp-visual.spec.ts holds the pixel baselines.
   =========================================================================== */
test.describe('CB App — layout', () => {
  /* Every window type is overflow:hidden, so anything past its box is not
     merely ugly — it is invisible and unreachable, with no scrollbar to say
     so. scrollHeight > clientHeight on the window element is exactly that
     condition.

     Regression: updateWindowSize() summed a note's height as header + 22 +
     buttons + counts + logInput and omitted the three 10px flex gaps
     .window-content puts between its four children. Every note in the app was
     30px shorter than its own contents and clipped the word-count line off
     the bottom — on desktop too, for as long as that gap has existed. It was
     only *noticed* on a phone, where the same 30px is a much bigger share of
     the window. */
  test('no window hides its own contents', async ({ page }) => {
    await openFresh(page);
    await clickNav(page, { tooltip: 'New Note' });
    await clickNav(page, { tooltip: 'New Task List' });
    await clickNav(page, { tooltip: 'New Sticky Note' });
    await clickNavId(page, '#calculator-toggle');
    await clickNavId(page, '#clock-toggle');
    await clickNavId(page, '#log-toggle');

    const clipped = await page.evaluate(() => {
      const sel =
        '#windows > .window, #windows > .task-window, #windows > .sticky-note-window,' +
        ' #windows > .calculator, #windows > .clock-window, #windows > .log-window';
      return [...document.querySelectorAll(sel)]
        .filter((el) => (el as HTMLElement).offsetHeight > 0)
        .map((el) => {
          const e = el as HTMLElement;
          return {
            id: e.id || e.className,
            overflowY: e.scrollHeight - e.clientHeight,
            overflowX: e.scrollWidth - e.clientWidth,
          };
        })
        .filter((r) => r.overflowY > 1 || r.overflowX > 1);
    });
    expect(clipped, JSON.stringify(clipped)).toEqual([]);
  });

  /* The same check on the canvas, where it first showed up. Windows keep
     world coordinates there and are trimmed to the screen on creation, so the
     trim has to leave a box that still fits its contents. */
  test('no window hides its own contents on the canvas either', async ({
    page,
  }) => {
    await openFresh(page);
    await clickNavId(page, '#canvas-toggle');
    await clickNav(page, { tooltip: 'New Note' });
    await clickNavId(page, '#log-toggle');

    const clipped = await page.evaluate(() =>
      [...document.querySelectorAll('#windows > .window, #windows > .log-window')]
        .filter((el) => (el as HTMLElement).offsetHeight > 0)
        .map((el) => {
          const e = el as HTMLElement;
          return { id: e.id, overflowY: e.scrollHeight - e.clientHeight };
        })
        .filter((r) => r.overflowY > 1)
    );
    expect(clipped, JSON.stringify(clipped)).toEqual([]);
  });

  /* A window opened from the toolbar has to be somewhere you can see, on
     every screen this app runs on.

     Regression: canvasBounds() treats the toolbar as a region to place
     windows AROUND, and on a phone the sheet is still open while the button's
     own handler runs — the auto-collapse is a bubbled listener, so it fires
     after. A 400px-tall sheet measured at that moment reads as an obstacle
     covering most of the screen, and every window opened from the toolbar was
     placed in the strip below it, off the bottom of the viewport. */
  test('a new window opens where it can be seen', async ({ page }) => {
    await openFresh(page);
    for (const tooltip of ['New Note', 'New Task List']) {
      await clickNav(page, { tooltip });
    }
    await clickNavId(page, '#canvas-toggle');
    await clickNav(page, { tooltip: 'New Note' });
    await clickNavId(page, '#log-toggle');

    const offscreen = await page.evaluate(() =>
      [...document.querySelectorAll('#windows > *')]
        .filter((el) => (el as HTMLElement).offsetHeight > 0)
        .map((el) => ({ id: el.id, r: el.getBoundingClientRect() }))
        // The title bar is the part that must be reachable: it carries close,
        // minimise, freeze and rename, and on the canvas it is also the only
        // way to drag the window back.
        .filter(
          ({ r }) =>
            r.top > window.innerHeight - 40 ||
            r.bottom < 40 ||
            r.left > window.innerWidth - 40 ||
            r.right < 40
        )
        .map(({ id }) => id)
    );
    expect(offscreen, JSON.stringify(offscreen)).toEqual([]);
  });

  /* Fixed chrome must be sized by its contents, not stretched between two
     offsets.

     Regression: `#status` is top-anchored by default (`top: 18px`) and the
     rule that flips it to bottom-anchored lives in a `max-width: 720px`
     block — which a phone in LANDSCAPE (802px) does not match. The mobile
     rule set only `bottom`, leaving BOTH offsets non-auto, and an absolutely
     positioned box with both set and `height: auto` is stretched to fill the
     gap between them. The toast became 422x302 with two lines of text
     stranded at the top of it, and since it carries `border-radius: 999px`
     for its pill shape it painted as an enormous dark blob across the middle
     of the screen.

     The box-minus-text measurement is the point: a stretched element is one
     whose height has nothing to do with what is inside it. Asserting a
     maximum height would pass a 200px-tall box full of 200px of text. */
  test('fixed chrome is sized by its contents, not stretched', async ({ page }) => {
    await openFresh(page);
    /* Raised directly rather than as a side effect of some action: the toast
       clears itself after ~3s, and a message long enough to WRAP is the case
       that produced the blob — one line would fit inside the stretched box
       and hide the bug. This is the app's real "canvas on" wording. */
    await page.evaluate(() =>
      (window as unknown as { showStatus: (s: string) => void }).showStatus(
        'Big canvas on — a separate workspace, so it starts empty. Your windows are safe in the plain view.'
      )
    );

    const toast = await page.evaluate(() => {
      const el = document.getElementById('status') as HTMLElement;
      const range = document.createRange();
      range.selectNodeContents(el);
      return {
        box: el.getBoundingClientRect().height,
        text: range.getBoundingClientRect().height,
        shown: getComputedStyle(el).display !== 'none',
      };
    });
    expect(toast.shown).toBe(true);
    expect(toast.text).toBeGreaterThan(0);
    // 40 = the toast's 9px vertical padding either side, plus slack.
    expect(toast.box - toast.text, `toast is ${toast.box}px around ${toast.text}px of text`)
      .toBeLessThanOrEqual(40);

    // The search panel shares the same slot and the same pair of rules.
    await clickNavId(page, '#search-btn');
    const search = await page.evaluate(() => {
      const el = document.getElementById('search-replace') as HTMLElement;
      return { h: el.getBoundingClientRect().height, vh: window.innerHeight };
    });
    expect(search.h).toBeLessThan(search.vh * 0.5);
  });

  /* The minimap has TWO update paths, and only one of them is driven by the
     view. applyView() repaints the viewport frame and re-sizes the map box;
     the window blocks inside are rebuilt on a separate debounce fired by add /
     close / minimise / restore / drag / resize-of-a-window.

     Regression: a viewport resize is none of those. The blocks kept the pixel
     positions they were given under the OLD world while the map around them
     was rescaled to the new one, so rotating a phone put every block in the
     wrong place at the wrong size until you happened to touch a window. Latent
     on a desktop, where resizing the browser with the canvas open is rare;
     unmissable on a phone, where rotating it is not. */
  test('the minimap follows the world through a viewport change', async ({
    page,
    viewport,
  }) => {
    await openFresh(page);
    await clickNavId(page, '#canvas-toggle');
    await clickNav(page, { tooltip: 'New Note' });

    // How far each block is from where the CURRENT world says it belongs.
    const drift = () =>
      page.evaluate(() => {
        const w = window as unknown as { computeWorldSize: () => { w: number; h: number } };
        const map = document.getElementById('canvas-map') as HTMLElement;
        const m = map.getBoundingClientRect();
        const world = w.computeWorldSize();
        const scale = m.width / world.w;
        const el = Array.from(document.querySelectorAll('#windows > .window')).find(
          (n) => (n as HTMLElement).offsetHeight > 0
        ) as HTMLElement;
        const block = map.querySelector('.map-window') as HTMLElement | null;
        if (!el || !block) return Infinity;
        const b = block.getBoundingClientRect();
        return Math.max(
          Math.abs(b.x - m.x - parseFloat(el.dataset.x!) * scale),
          Math.abs(b.y - m.y - parseFloat(el.dataset.y!) * scale),
          Math.abs(b.width - el.offsetWidth * scale),
          Math.abs(b.height - el.offsetHeight * scale)
        );
      });

    // 2px covers the map's own 1px border and sub-pixel rounding.
    await expect.poll(drift).toBeLessThanOrEqual(2);

    /* Wider and shorter. The width has to change or nothing does: the world
       only ever grows, and with an unlimited-height box on a desktop the width
       is the binding constraint on the map's scale — so a height-only change
       would leave the block coordinates correct by accident and prove nothing.

       TRAP: this must not cross the mobile breakpoint. The first version of
       this test clamped the width to >=721px, which on a phone project turns
       body.mobile-ui OFF — and syncMobileUI() calls refreshChrome(), which
       rebuilds the blocks. The test passed against the unfixed code because it
       had accidentally triggered the very thing it was meant to prove absent.
       1.4x/0.6x keeps every project in the shape it started in, which the
       assertion below states outright rather than leaving to trust. */
    const shapeBefore = await page.evaluate(() =>
      document.body.classList.contains('mobile-ui')
    );
    await page.setViewportSize({
      width: Math.round(viewport!.width * 1.4),
      height: Math.round(viewport!.height * 0.6),
    });
    await expect
      .poll(() => page.evaluate(() => document.body.classList.contains('mobile-ui')))
      .toBe(shapeBefore);
    await expect.poll(drift).toBeLessThanOrEqual(2);
  });

  /* The word count sits at the bottom edge of a note, so it is the first
     thing to look wrong when the space under it goes. The short-screen rule
     that tightens a note for a landscape phone originally took 4px off all
     four sides of .window-content, and the bottom one shows: the count all but
     touches the border, which reads as the padding having been dropped rather
     than reduced. The savings come from the gaps and the top now. */
  test('the word count keeps its breathing room at the bottom', async ({ page }) => {
    await openFresh(page);
    await clickNav(page, { tooltip: 'New Note' });
    const gap = await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll('#windows > .window')).find(
        (n) => (n as HTMLElement).offsetHeight > 0
      ) as HTMLElement;
      const content = el.querySelector('.window-content') as HTMLElement;
      const counts = el.querySelector('.counts') as HTMLElement;
      return (
        content.getBoundingClientRect().bottom - counts.getBoundingClientRect().bottom
      );
    });
    expect(gap).toBeGreaterThanOrEqual(8);
  });

  /* A restored note must be the right size at first paint, without help.

     THE BUG THIS PINS DOWN. `view.on` is restored AFTER the loop that rebuilds
     the windows, so for the whole of that loop `sizingBasis()` answered with
     the VIEWPORT rather than the world — and setMaxDimensions(), which runs
     inside every add*(), wrote each note an inline `max-height` sized for a
     phone screen instead of for a three-viewport canvas. On a landscape phone
     that capped a 400px note at 322px and hid 78px of it behind
     overflow:hidden, with no scrollbar to say so. What you saw was the word
     count jammed against the bottom border.

     WHY IT LOOKED INTERMITTENT. Each container's ResizeObserver fires its
     first callback after the restore returns, by which time view.on is true,
     and that recomputes everything correctly. So the bug was a race against
     the observer's schedule: both emulated engines win it every time, which is
     why this reproduced on a real phone and nowhere else, and why resizing the
     window always "fixed" it.

     TRAP: do not delete the ResizeObserver stub below to "simplify" this test.
     It IS the test. With the observer in place every engine here rescues the
     layout before the assertion runs and this passes against broken code —
     which is exactly what it did, for six attempts, before the stub. */
  test('a restored note is the right size before any observer runs', async ({
    page,
  }) => {
    await openFresh(page);
    await clickNavId(page, '#canvas-toggle');
    await clickNav(page, { tooltip: 'New Note' });
    await forceSave(page);

    await page.addInitScript(() => {
      (window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
      };
    });
    await page.reload();
    await expectBooted(page);

    const note = await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll('#windows > .window')).find(
        (n) => (n as HTMLElement).offsetHeight > 0
      ) as HTMLElement;
      const container = el.querySelector('.textarea-container') as HTMLElement;
      return {
        // The window is overflow:hidden, so anything past its box is gone.
        clipped: el.scrollHeight - el.clientHeight,
        // The caps have to be the world's, not the screen's. A note on a
        // three-viewport canvas is allowed to be taller than the viewport.
        windowMax: parseFloat(el.style.maxHeight) || Infinity,
        containerMax: parseFloat(container.style.maxHeight) || Infinity,
        height: el.offsetHeight,
        vh: window.innerHeight,
      };
    });
    expect(note.clipped, `${note.clipped}px of the note is cut off`).toBe(0);
    expect(note.windowMax).toBeGreaterThanOrEqual(note.height);
    expect(note.containerMax).toBeGreaterThan(note.vh);
  });

  /* No text field may be small enough to make iOS zoom the page.

     Safari on iOS zooms the WHOLE PAGE whenever a focused text field's
     computed font-size is under 16px, and the zoom persists after the field is
     dismissed. Every field in this app was 12-14px, so the first tap into the
     passphrase box left the entire app rendered wider than the screen with its
     right-hand edge — including that modal's own Unlock button — off it.

     TRAP: this is invisible on every other project in this suite. Chromium
     does not do it, so Pixel 5 portrait and landscape both pass while a real
     iPhone is unusable. It is also invisible to a layout assertion: the DOM is
     laid out correctly at 428px and reports no overflow at all. The only thing
     that catches it is the number below.

     16px exactly is fine; the rule is "under 16". */
  test('no text field is small enough to make iOS zoom the page', async ({
    page,
    isMobile,
    viewport,
  }) => {
    /* Phone shape only, and phoneShaped() rather than isMobile: an iPad is
       a touch device on the DESKTOP layout, where 12-14px fields are
       correct as they are. iPadOS does not zoom a field on a layout that
       was never scaled down to begin with. */
    test.skip(
      !phoneShaped(isMobile, viewport),
      'iOS zoom applies to the phone shape'
    );
    await openFresh(page);
    // Every kind of field the app has, on screen at once.
    await clickNav(page, { tooltip: 'New Note' });
    await clickNav(page, { tooltip: 'New Task List' });
    await clickNavId(page, '#log-toggle');
    await clickNavId(page, '#calendar-toggle');
    await clickNavId(page, '#search-btn');
    // ...plus the passphrase modal, which is where this was first seen.
    await clickNavId(page, '#protect-toggle');
    await expect(page.locator('#pass-modal-input')).toBeVisible();

    const tooSmall = await page.evaluate(() =>
      Array.from(document.querySelectorAll('input, textarea, select'))
        .filter((el) => {
          // Only fields that take a caret: focusing a checkbox or a colour
          // swatch does not trigger the zoom.
          const type = (el as HTMLInputElement).type || el.tagName.toLowerCase();
          return !['checkbox', 'radio', 'color', 'button', 'file'].includes(type);
        })
        .map((el) => ({
          el: `${el.tagName.toLowerCase()}#${el.id || '(no id)'}`,
          size: parseFloat(getComputedStyle(el as HTMLElement).fontSize),
        }))
        .filter((f) => f.size < 16)
    );
    expect(tooSmall, JSON.stringify(tooSmall)).toEqual([]);
  });

  /* The gutter has to move with the text it numbers. Bumping the textarea to
     16px for the rule above and leaving .line-numbers at 14px would drift them
     a little further apart with every line down the note. */
  test('the line-number gutter matches its textarea', async ({ page }) => {
    await openFresh(page);
    await clickNav(page, { tooltip: 'New Note' });
    const m = await page.evaluate(() => {
      const win = Array.from(document.querySelectorAll('#windows > .window')).find(
        (n) => (n as HTMLElement).offsetHeight > 0
      ) as HTMLElement;
      const gutter = win.querySelector('.line-numbers') as HTMLElement;
      const textarea = win.querySelector('textarea') as HTMLElement;
      const g = getComputedStyle(gutter);
      const t = getComputedStyle(textarea);
      return {
        gutterFont: g.fontSize,
        textFont: t.fontSize,
        gutterLine: g.lineHeight,
        textLine: t.lineHeight,
        // A number wider than its column is a gutter that cannot count past 9.
        clipped: gutter.scrollWidth - gutter.clientWidth,
      };
    });
    expect(m.gutterFont).toBe(m.textFont);
    expect(m.gutterLine).toBe(m.textLine);
    expect(m.clipped).toBeLessThanOrEqual(0);
  });

  /* The Download chip is one element that lives in two places: a fixed corner
     chip on a desktop, a full-width row inside the toolbar sheet on a phone.
     Moved rather than duplicated, because it carries #download-app-version and
     two nodes cannot share an id. */
  test('the Download chip follows the shape, and takes the version with it', async ({
    page,
    isMobile,
    viewport,
  }) => {
    /* Which branch this takes is the app's shape, not the fixture's — the
       chip only moves into the sheet when the sheet exists, and a tablet
       keeps the corner chip. */
    const phone = phoneShaped(isMobile, viewport);
    await openFresh(page);
    const chip = page.locator('a.download-app-link');
    const version = page.locator('#download-app-version');
    await expect(version).toHaveText(/^v\d+\.\d+\.\d+$/);

    if (!phone) {
      // Desktop: the corner chip, outside the toolbar, always on screen.
      expect(await chip.evaluate((el) => !!el.closest('.nav-menu'))).toBe(false);
      await expect(chip).toBeVisible();
      return;
    }

    // Phone: inside the sheet, and therefore hidden while the sheet is shut.
    expect(await chip.evaluate((el) => !!el.closest('.nav-menu'))).toBe(true);
    await expect(chip).toBeHidden();

    await page.locator('nav.nav-menu .nav-toggle').click();
    await expect(chip).toBeVisible();
    // The version is the reason it is worth having in there — a corner chip
    // renders it at 10px, a sheet row does not.
    await expect(chip).toContainText(/v\d+\.\d+\.\d+/);
    // Full width: "Download CB App v4.2.2" does not fit a grid cell.
    const box = (await chip.boundingBox())!;
    const sheet = (await page.locator('nav.nav-menu').boundingBox())!;
    expect(box.width).toBeGreaterThan(sheet.width * 0.8);
  });

  /* Crossing the breakpoint has to move it back, and it has to land in the
     right place rather than wherever it happened to start. */
  test('the Download chip goes home when the shape changes', async ({
    page,
    viewport,
  }) => {
    await openFresh(page);
    const inNav = () =>
      page.evaluate(
        () => !!document.querySelector('a.download-app-link')?.closest('.nav-menu')
      );
    const startedInNav = await inNav();

    // Across the breakpoint in whichever direction this project starts on.
    await page.setViewportSize(
      startedInNav ? { width: 1100, height: 800 } : { width: 380, height: 800 }
    );
    await expect.poll(inNav).toBe(!startedInNav);

    // ...and back.
    await page.setViewportSize(viewport!);
    await expect.poll(inNav).toBe(startedInNav);

    /* Home is a placeholder, not a remembered parent. A copy downloaded from a
       phone has the chip inside the nav in its saved markup, and a remembered
       parent would faithfully put it back there on a desktop. */
    if (!startedInNav) {
      const ok = await page.evaluate(() => {
        const chip = document.querySelector('a.download-app-link') as HTMLElement;
        const home = document.getElementById('download-app-home');
        return chip.previousElementSibling === home;
      });
      expect(ok).toBe(true);
    }
  });

  /* Window controls are characters, so they exist only where a font covers
     them — and a missing glyph does not fail loudly, it renders as empty
     space over a button that still works.

     Regression: minimise used U+1F5D5, a bare astral symbol with TEXT
     presentation. iOS ships no glyph for it, so the button was invisible on
     every iPhone, in every window and every mode, while its touch target went
     on working perfectly. Nothing in the suite noticed, and nothing could
     have: this machine's WebKit resolves it out of a Windows font, so it
     renders here and vanishes there.

     Hence an allowlist rather than a measurement. Every glyph must be either
     a BMP symbol, or a character with emoji presentation — by default, or
     forced with U+FE0F. Adding to this list is a decision to be made with an
     iPhone in hand, which is exactly the friction it is here to create. */
  test('window control glyphs are ones every platform can draw', async ({
    page,
  }) => {
    await openFresh(page);
    await clickNav(page, { tooltip: 'New Note' });
    await clickNav(page, { tooltip: 'New Task List' });
    await clickNav(page, { tooltip: 'New Sticky Note' });
    await clickNavId(page, '#calculator-toggle');
    await clickNavId(page, '#clock-toggle');
    await clickNavId(page, '#log-toggle');
    await clickNavId(page, '#calendar-toggle');

    const ALLOWED = [
      '×', // × close — BMP
      '−', // − minimise — BMP
      '✏️', // ✏️ rename — U+FE0F forces emoji presentation
      '\u{1f513}', // 🔓 unfrozen — emoji presentation by default
      '\u{1f512}', // 🔒 frozen — emoji presentation by default
    ];

    const found = await page.evaluate(() => {
      const sel =
        '.window-controls > [role="button"], .sticky-note-controls > [role="button"]';
      return [...new Set(
        Array.from(document.querySelectorAll(sel)).map((el) =>
          (el.textContent || '').trim()
        )
      )].filter(Boolean);
    });

    expect(found.length).toBeGreaterThan(0);
    const unknown = found.filter((g) => !ALLOWED.includes(g));
    expect(
      unknown,
      `unlisted control glyph(s): ${unknown
        .map((g) => [...g].map((c) => 'U+' + c.codePointAt(0)!.toString(16).toUpperCase()).join(' '))
        .join(', ')} — check the glyph renders on iOS before adding it`
    ).toEqual([]);
  });

  // The one thing no window may do, in any shape: force the page itself to
  // scroll sideways. <body> is overflow:hidden, so it would simply cut.
  test('nothing pushes the page sideways', async ({ page }) => {
    await openFresh(page);
    await clickNav(page, { tooltip: 'New Note' });
    await clickNav(page, { tooltip: 'New Sticky Note' });
    const over = await page.evaluate(() => ({
      body: document.body.scrollWidth - document.body.clientWidth,
      html: document.documentElement.scrollWidth - window.innerWidth,
    }));
    expect(over.body).toBeLessThanOrEqual(1);
    expect(over.html).toBeLessThanOrEqual(1);
  });
});

/* ===========================================================================
   The minimap on a phone
   ---------------------------------------------------------------------------
   The overview matters MOST here and was hidden outright until v4.2.0: the
   canvas is three viewports wide, one finger pans a fraction of it at a time,
   and there is no wheel, no space-drag and no scrollbar. A window panned
   off-screen was findable only by dragging until it came back.
   =========================================================================== */
test.describe('CB App — the minimap on a phone', () => {
  test.skip(
    ({ isMobile, viewport }) => !phoneShaped(isMobile, viewport),
    'phone shapes only'
  );

  /** Every fixed thing that paints over the canvas, with its box. */
  async function canvasChrome(page: Page) {
    return page.evaluate(() => {
      const box = (id: string) => {
        const el = document.getElementById(id) as HTMLElement | null;
        if (!el || !el.offsetHeight) return null;
        return el.getBoundingClientRect().toJSON();
      };
      return {
        map: box('canvas-map'),
        zoom: box('canvas-controls'),
        vw: window.innerWidth,
        vh: window.innerHeight,
      };
    });
  }

  test('the canvas has a minimap, in the top-right, on screen', async ({ page }) => {
    await openFresh(page);
    await expect(page.locator('#canvas-map')).toBeHidden(); // off-canvas: nothing to overview
    await clickNavId(page, '#canvas-toggle');
    await expect(page.locator('#canvas-map')).toBeVisible();

    const c = await canvasChrome(page);
    expect(c.map).not.toBeNull();
    // Top-right, fully on screen, and small enough to still be a glance.
    expect(c.map!.top).toBeGreaterThanOrEqual(0);
    expect(c.map!.right).toBeLessThanOrEqual(c.vw);
    expect(c.map!.bottom).toBeLessThanOrEqual(c.vh);
    expect(c.map!.right).toBeGreaterThan(c.vw / 2);
    expect(c.map!.top).toBeLessThan(c.vh / 2);
    // Fitted to a box, not just to a width: on a portrait phone the world
    // inherits the viewport's aspect, and a width-fitted map came out 43% of
    // the screen tall.
    expect(c.map!.height).toBeLessThan(c.vh * 0.22);
    expect(c.map!.width).toBeLessThan(c.vw * 0.4);
  });

  /* Regression: the zoom widget's narrow-screen position lives in a
     `max-width: 720px` block, which a phone in LANDSCAPE (802px) does not
     match — so it stayed at the desktop's top-right and landed directly on
     top of the map the moment the map appeared there. */
  test('the map and the zoom widget do not sit on each other', async ({ page }) => {
    await openFresh(page);
    await clickNavId(page, '#canvas-toggle');
    const c = await canvasChrome(page);
    expect(c.map).not.toBeNull();
    expect(c.zoom).not.toBeNull();
    const overlaps =
      c.map!.left < c.zoom!.right &&
      c.map!.right > c.zoom!.left &&
      c.map!.top < c.zoom!.bottom &&
      c.map!.bottom > c.zoom!.top;
    expect(overlaps, JSON.stringify(c)).toBe(false);
  });

  /* Regression: a new window on the canvas was placed at the very top of the
     visible slice, putting its own freeze and close buttons underneath the
     map — the one control that cannot be moved out of the way, because it is
     how you find the window again. canvasBounds() reserves the measured
     chrome band on a phone now. */
  test('a new window is placed clear of the chrome, not under it', async ({
    page,
  }) => {
    await openFresh(page);
    await clickNavId(page, '#canvas-toggle');
    await clickNav(page, { tooltip: 'New Task List' });

    const c = await canvasChrome(page);
    const header = (await page
      .locator('#windows > .task-window .task-header')
      .first()
      .boundingBox())!;
    // The title bar carries close, minimise, freeze and rename, and on the
    // canvas it is also the only way to drag the window. Nothing fixed may
    // cover any of it.
    for (const [name, r] of Object.entries({ map: c.map, zoom: c.zoom })) {
      if (!r) continue;
      const overlaps =
        header.x < r.right &&
        header.x + header.width > r.left &&
        header.y < r.bottom &&
        header.y + header.height > r.top;
      expect(overlaps, `${name} covers the title bar`).toBe(false);
    }
    // And the whole window clears the bottom chrome it was sized against.
    const win = (await page.locator('#windows > .task-window').first().boundingBox())!;
    expect(win.y + win.height).toBeLessThanOrEqual(c.vh);
  });

  test('tapping the map jumps the view', async ({ page }) => {
    await openFresh(page);
    await clickNavId(page, '#canvas-toggle');

    const transform = () =>
      page.evaluate(
        () => (document.getElementById('windows') as HTMLElement).style.transform
      );
    const before = await transform();

    /* The map's top-left, which is the far corner of a world the canvas
       opened centred on — so the jump is unambiguous. Deliberately no window
       is opened first: adding one grows the world, which resizes the map on a
       120ms debounce, and a click measured before that and delivered after it
       lands outside the element. The map is the fastest way back from a corner
       and that is what this is checking; a window on the canvas is not part of
       the claim. */
    await page.locator('#canvas-map').click({ position: { x: 5, y: 5 } });
    await expect.poll(transform).not.toBe(before);
  });
});

/* ===========================================================================
   The phone on its side
   ---------------------------------------------------------------------------
   ~844x390: wider than a desktop breakpoint would call narrow and shorter
   than anything else this app runs on. It gets its own block because the
   failure mode is not "cramped", it is "reverted to the desktop shape".
   =========================================================================== */
test.describe('CB App — the phone on its side', () => {
  test.skip(
    ({ isMobile, viewport }) => !isMobile || (viewport?.height ?? 0) > 520,
    'landscape phone only'
  );

  test('a phone is still a phone when it is turned', async ({ page, viewport }) => {
    await openFresh(page);
    // The premise: this viewport is WIDER than the 720px a width-only
    // breakpoint keys on, which is exactly why it used to fall through.
    expect(viewport!.width).toBeGreaterThan(720);
    expect(page.locator('body')).toBeTruthy();
    await expect(page.locator('body')).toHaveClass(/mobile-ui/);
    await expect(page.locator('nav.nav-menu')).toHaveClass(/collapsed/);
    // And specifically NOT the twenty-button bar over the top of everything.
    await expect(page.locator('#protect-toggle')).toBeHidden();
  });

  test('the sheet fits the short screen, or scrolls', async ({ page }) => {
    await openFresh(page);
    await page.locator('nav.nav-menu .nav-toggle').click();
    const sheet = await page.evaluate(() => {
      const el = document.querySelector('.nav-menu') as HTMLElement;
      const r = el.getBoundingClientRect();
      return {
        top: r.top,
        bottom: r.bottom,
        vh: window.innerHeight,
        scrolls: el.scrollHeight > el.clientHeight,
        overflowY: getComputedStyle(el).overflowY,
      };
    });
    // On screen at both ends...
    expect(sheet.top).toBeGreaterThanOrEqual(0);
    expect(sheet.bottom).toBeLessThanOrEqual(sheet.vh + 1);
    // ...and if twenty buttons do not fit in 390px, they scroll rather than
    // spilling off the end where nothing can reach them.
    if (sheet.scrolls) expect(sheet.overflowY).toBe('auto');

    // Every group is reachable, which is the thing scrolling buys.
    await page.locator('nav.nav-menu #canvas-toggle').scrollIntoViewIfNeeded();
    await expect(page.locator('nav.nav-menu #canvas-toggle')).toBeInViewport();
  });

  test('a full-bleed note still shows every one of its controls', async ({
    page,
  }) => {
    await openFresh(page);
    await clickNav(page, { tooltip: 'New Note' });
    // 390px tall, minus the bottom chrome, has to hold a title bar, a
    // textarea, a log row, four format buttons and a word count. The
    // textarea gives up the difference; nothing else may.
    for (const sel of ['.close-window', '.note-log-button', '.clear-note-button', '.counts']) {
      await expect(page.locator(`#windows > .window ${sel}`)).toBeInViewport();
    }
  });
});

/**
 * v4.3.0. The calendar was resurfaced to match the rest of the app, and two of
 * those changes are the kind that only a test notices going wrong again: the
 * row actions are glyphs (the app has shipped an invisible one before), and the
 * window has to open inside the band the toolbar leaves free.
 */
test.describe('CB App — calendar surface (v4.3.0)', () => {
  test('row action glyphs are ones every platform can draw', async ({ page }) => {
    await openFresh(page);
    await clickNavId(page, '#calendar-toggle');
    await page.locator('#cal-add-calendar').click();
    await page.locator('#cal-f-title-calendar').fill('Dentist');
    await page.locator('#cal-f-save-calendar').click();
    await expect(page.locator('#cal-lower-calendar .cal-event')).toHaveCount(1);

    // The same allowlist the window controls answer to, for the same reason:
    // 🗑 (U+1F5D1) is an astral symbol with TEXT presentation by default, the
    // class of character that shipped as an invisible minimise button on iOS
    // in v4.2.3. It was the delete button in this row until v4.3.0.
    const ALLOWED = ['×', '✏️'];
    const found = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.cal-event .cal-row-btn')).map((el) =>
        (el.textContent || '').trim()
      )
    );
    expect(found.length).toBe(2);
    expect(found.filter((g) => !ALLOWED.includes(g))).toEqual([]);
  });

  test('the calendar opens clear of the toolbar, controls and all', async ({
    page,
  }) => {
    await openFresh(page);
    await clickNavId(page, '#calendar-toggle');
    // A phone is a different layout entirely: the window is full-bleed — it IS
    // the screen — and the toolbar is a pill floating over it by design.
    test.skip(
      await page.evaluate(() => document.body.classList.contains('mobile-ui')),
      'desktop placement only; the phone layout is full-bleed'
    );
    // placeWindow routes around the toolbar but cannot shrink a window that is
    // taller than the space it is routing into — a flat 640px default hung the
    // form's Save and Cancel underneath it on a 720px-tall screen, where the
    // toolbar ate the clicks.
    const clear = await page.evaluate(() => {
      const win = document.getElementById('calendar')!.getBoundingClientRect();
      const nav = document.querySelector('.nav-menu')!.getBoundingClientRect();
      return { winBottom: win.bottom, navTop: nav.top, vh: window.innerHeight };
    });
    expect(clear.winBottom).toBeLessThanOrEqual(clear.navTop);

    // And the form's buttons are inside it, not under anything.
    await page.locator('#cal-add-calendar').click();
    await expect(page.locator('#cal-f-save-calendar')).toBeInViewport();
    await page.locator('#cal-f-title-calendar').fill('Dentist');
    await page.locator('#cal-f-save-calendar').click();
    await expect(page.locator('#cal-lower-calendar .cal-event')).toHaveCount(1);
  });

  test('the search row is not the section heading wearing a different hat', async ({
    page,
  }) => {
    await openFresh(page);
    await clickNavId(page, '#calendar-toggle');
    // One class, one job. They shared .cal-section-head until v4.3.0, so the
    // toolbar inherited 11px uppercase dim heading type and neither could be
    // restyled without moving the other.
    await expect(page.locator('#calendar .cal-toolbar .cal-filter')).toBeVisible();
    await expect(page.locator('#calendar .cal-toolbar .cal-section-head')).toHaveCount(0);

    const head = page.locator('#cal-lower-calendar .cal-section-head').first();
    await expect(head).toBeVisible();
    expect(
      await head.evaluate((el) => getComputedStyle(el).textTransform)
    ).toBe('uppercase');
  });
});

/**
 * v4.3.0. Home-screen icons and the runtime manifest. They travel as base64
 * inside the file because it is opened from file:// with nothing serving
 * alongside it — a regression here is silent (iOS just goes back to using a
 * screenshot of the page) so it needs asserting rather than eyeballing.
 */
test.describe('CB App — home-screen icons (v4.3.0)', () => {
  test('every icon is embedded, and the manifest is built at runtime', async ({
    page,
  }) => {
    await openFresh(page);

    const icons = await page.evaluate(() =>
      Array.from(document.querySelectorAll("link[rel='apple-touch-icon']")).map(
        (el) => ({
          sizes: el.getAttribute('sizes'),
          embedded: (el.getAttribute('href') || '').startsWith('data:image/png;base64,'),
        })
      )
    );
    expect(icons.length).toBeGreaterThanOrEqual(3);
    expect(icons.every((i) => i.embedded)).toBe(true);
    expect(icons.map((i) => i.sizes)).toContain('180x180');

    // The favicon swaps (countdown, theme) both find their link with
    // link[rel~='icon'], which must never resolve to one of the PNGs above.
    const iconLinks = await page.evaluate(() =>
      Array.from(document.querySelectorAll("link[rel~='icon']")).map(
        (el) => (el.getAttribute('href') || '').slice(0, 24)
      )
    );
    expect(iconLinks).toEqual(['data:image/svg+xml;base6']);

    const manifest = await page.evaluate(() => {
      const link = document.querySelector("link[rel='manifest']") as HTMLLinkElement;
      return link ? link.href : null;
    });
    expect(manifest).toMatch(/^blob:/);
  });

  test('theme-color follows the theme the user picked', async ({ page }) => {
    await openFresh(page);
    const color = () =>
      page.evaluate(
        () => document.querySelector('meta[name="theme-color"]')!.getAttribute('content')
      );
    expect(await color()).toBe('#0c0f16');
    await clickNavId(page, '#theme-toggle');
    expect(await color()).toBe('#f4f6fb');
    await clickNavId(page, '#theme-toggle');
    expect(await color()).toBe('#0c0f16');
  });
});

/* ============================================================
   v4.4.0 — the calculator does time
   ------------------------------------------------------------
   evaluateExpression() and formatResult() are top-level function
   declarations, so they are reachable from page.evaluate() by name. Driving
   them directly keeps the table below a table: one round trip for twenty
   cases instead of twenty fills and twenty clicks. The two UI tests after it
   cover the wiring the table cannot.
   ============================================================ */
test.describe('CB App — the calculator does hh:mm (v4.4.0)', () => {
  test('the operator table', async ({ page }) => {
    await openFresh(page);

    const run = (expr: string) =>
      page.evaluate((e) => {
        try {
          return formatResult(evaluateExpression(e));
        } catch (err) {
          return `ERR:${(err as { calcMessage?: string }).calcMessage || 'Error'}`;
        }
      }, expr);

    // Plain arithmetic is untouched, to the digit. This is the back-compat
    // half of the release, which is why it is asserted first.
    expect(await run('2+3*4')).toBe('14');
    expect(await run('10/4')).toBe('2.5');
    expect(await run('√9')).toBe('3');

    // One row per line of the operator table in the source.
    expect(await run('7:30 - 6:15')).toBe('1:15 (1.25 h)');
    expect(await run('1:30 + 0:45')).toBe('2:15 (2.25 h)');
    expect(await run('1:30 * 3')).toBe('4:30 (4.5 h)');
    expect(await run('7:30 / 3')).toBe('2:30 (2.5 h)');
    expect(await run('7:30 / 1:30')).toBe('5');
    expect(await run('3 * 0:20')).toBe('1:00 (1 h)');

    // Both entry forms, and h:mm:ss for a stopwatch reading.
    expect(await run('90m + 0.5h')).toBe('2:00 (2 h)');
    expect(await run('2.5h')).toBe('2:30 (2.5 h)');
    expect(await run('1:30:45 + 0:00:20')).toBe('1:31:05 (1.52 h)');

    // A negative variance is the normal reading of "logged minus target", so
    // it has to format as -1:15 and not as the -1:-15 naive modulo gives.
    expect(await run('40:00 - 41:15')).toBe('-1:15 (-1.25 h)');

    // Precedence still holds once the values carry units.
    expect(await run('8:00 - 0:15 * 2')).toBe('7:30 (7.5 h)');

    // The refusals. Each is a unit error whose right answer the calculator
    // cannot guess, so it says so rather than inventing one.
    expect(await run('8:00 + 2')).toMatch(/^ERR:Add times/);
    expect(await run('3 - 1:00')).toMatch(/^ERR:Subtract times/);
    expect(await run('0:30 * 0:30')).toMatch(/^ERR:Can.t multiply two times/);
    expect(await run('3 / 0:30')).toMatch(/^ERR:Can.t divide a plain number/);
    expect(await run('√1:30')).toMatch(/^ERR:Can.t take the square root/);
    expect(await run('8:00 / 0:00')).toMatch(/^ERR:Can.t divide by 0:00/);
    // 1:75 is a typo for either 1:15 or 2:15 and there is no way to know which.
    expect(await run('1:75')).toMatch(/minutes and seconds go up to 59/);
  });

  test('a shift is worked out end to end, and lands in the history', async ({
    page,
  }) => {
    await openFresh(page);
    await clickNavId(page, '#calculator-toggle');
    const calc = page.locator('#calculator');
    await expect(calc).toBeVisible();

    await calc.locator('.calculator-input').fill('7:30 - 6:15');
    await calc.locator('.calculator-buttons button.operation', { hasText: '=' }).click();
    await expect(calc.locator('.calculator-display')).toHaveValue('1:15 (1.25 h)');
    await expect(calc.locator('.calculator-history')).toContainText('1:15 (1.25 h)');

    // The message reaches the display instead of a bare "Error" — the whole
    // point of calcMessage is that a unit mistake is correctable.
    await calc.locator('.calculator-input').fill('8:00 + 2');
    await calc.locator('.calculator-buttons button.operation', { hasText: '=' }).click();
    await expect(calc.locator('.calculator-display')).toHaveValue(/Add times/);
  });

  test('the : key is on the pad, and seeds a leading zero', async ({ page }) => {
    await openFresh(page);
    await clickNavId(page, '#calculator-toggle');
    const calc = page.locator('#calculator');
    const colon = calc.locator('.calculator-buttons button', { hasText: /^:$/ });
    await expect(colon).toHaveCount(1);

    // ":30" is not a time literal; "0:30" is. Tapping : into an empty field is
    // how half an hour gets typed on a phone, so it has to produce the second.
    await colon.click();
    await expect(calc.locator('.calculator-input')).toHaveValue('0:');
    await calc.locator('.calculator-buttons button.number', { hasText: /^3$/ }).click();
    await calc.locator('.calculator-buttons button.number', { hasText: /^0$/ }).click();
    await calc.locator('.calculator-buttons button.operation', { hasText: '=' }).click();
    await expect(calc.locator('.calculator-display')).toHaveValue('0:30 (0.5 h)');
  });
});

/* ============================================================
   v4.4.0 — a narrow viewport no longer eats the layout
   ------------------------------------------------------------
   Chromium-only, and only where the viewport is resizable and is not a phone.
   The bug is specific to a mouse-driven window being narrowed and widened
   again — a split Chrome tab, a snapped half-screen, devtools docked to the
   side. On a phone the same resize is the keyboard opening, which the resize
   handler already skips.
   ============================================================ */
test.describe('CB App — narrowing the browser does not destroy the layout (v4.4.0)', () => {
  test.skip(
    ({ isMobile }) => Boolean(isMobile),
    'A phone has no resizable viewport, and stack mode does not position windows at all.'
  );

  test('windows come back to where they were when the width comes back', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openFresh(page);
    await clickNav(page, { tooltip: 'New Note' });
    await clickNav(page, { tooltip: 'New Sticky Note' });

    const positions = () =>
      page.evaluate(() =>
        Array.from(document.querySelectorAll('.window, .sticky-note-window')).map((el) => ({
          id: el.id,
          x: Math.round(parseFloat((el as HTMLElement).style.left) || 0),
          y: Math.round(parseFloat((el as HTMLElement).style.top) || 0),
        }))
      );

    // Somewhere unambiguous: far apart, and far enough right that a squeeze
    // has to move them.
    await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('.window, .sticky-note-window'));
      els.forEach((el, i) => moveWindowTo(el as HTMLElement, 600 + i * 120, 60 + i * 90));
    });
    const before = await positions();
    expect(before.length).toBe(2);
    expect(before[0].x).toBe(600);

    /* A split Chrome tab. 700px and not 520: below 560 the app enters stack
       mode, where every window is full-bleed CSS and the resize handler
       deliberately does not clamp at all. The reported bug lives in the band
       ABOVE that floor — narrow enough to squeeze, wide enough to still be a
       desktop with draggable windows — which is exactly where a split tab and
       a snapped half-screen land. */
    await page.setViewportSize({ width: 700, height: 900 });
    await page.waitForTimeout(500);
    const squeezed = await positions();
    // It really did move — otherwise the restore below proves nothing.
    expect(squeezed[0].x).toBeLessThan(before[0].x);

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(500);
    expect(await positions()).toEqual(before);
  });

  test('the squeezed position is never what gets saved', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openFresh(page);
    await clickNav(page, { tooltip: 'New Note' });
    await page.evaluate(() => {
      moveWindowTo(document.querySelector('.window') as HTMLElement, 700, 120);
    });

    await page.setViewportSize({ width: 700, height: 900 });
    await page.waitForTimeout(500);

    // The session written while narrow still holds the wide layout. Without
    // this, one save from a split tab carried the squeeze into the next boot
    // and into Backup.
    const saved = await page.evaluate(() => {
      const snapshot = buildSessionSnapshot() as Record<
        string,
        { position?: { left: string; top: string } }
      >;
      const entry = Object.values(snapshot).find((v) => v && v.position);
      return entry ? entry.position : null;
    });
    expect(saved).toEqual({ left: '700', top: '120' });
  });
});

/* ============================================================
   v4.5.0 — one window, several calculators
   ------------------------------------------------------------
   The dropdown is the extension point, so the first test asserts the
   REGISTRY rather than a hard-coded list of five: a mode added to CALC_MODES
   has to reach the select, the panels and the validator without anyone
   editing this file. The rest drive each calculator through the real DOM,
   because the arithmetic is only half of what could break — a panel that is
   built but never shown is just as wrong an answer.
   ============================================================ */
test.describe('CB App — the calculator type dropdown (v4.5.0)', () => {
  const CALC = '#calculator';

  async function openCalc(page: Page) {
    await openFresh(page);
    await clickNavId(page, '#calculator-toggle');
    await expect(page.locator(CALC)).toBeVisible();
  }

  async function pick(page: Page, mode: string) {
    await page.locator('#calculator-mode-calculator').selectOption(mode);
  }

  test('every registered mode has an option and exactly one panel', async ({
    page,
  }) => {
    await openCalc(page);

    const registry = await page.evaluate(() =>
      CALC_MODES.map((m: { id: string; label: string }) => ({
        id: m.id,
        label: m.label,
      }))
    );
    expect(registry.length).toBeGreaterThanOrEqual(5);
    expect(registry.map((m) => m.id)).toContain('standard');

    const options = await page
      .locator('#calculator-mode-calculator option')
      .evaluateAll((els) =>
        els.map((el) => ({
          id: (el as HTMLOptionElement).value,
          label: (el as HTMLOptionElement).textContent?.trim(),
        }))
      );
    expect(options).toEqual(registry);

    // One panel per mode, and exactly one of them visible at a time.
    for (const { id } of registry) {
      await pick(page, id);
      const shown = await page
        .locator(`${CALC} .calc-panel`)
        .evaluateAll((els) =>
          els
            .filter((el) => !(el as HTMLElement).hidden)
            .map((el) => (el as HTMLElement).dataset.panel)
        );
      expect(shown).toEqual([id]);
    }
  });

  test('Time Card totals a week, overnight shifts included', async ({ page }) => {
    await openCalc(page);
    await pick(page, 'time');

    const out = page.locator('#calc-time-out-calculator');
    await expect(out).toHaveText('No shifts yet.');

    // A normal day with a half-hour break.
    await page.fill('#calc-time-start-calculator', '08:30');
    await page.fill('#calc-time-end-calculator', '17:00');
    await page.fill('#calc-time-break-calculator', '30');
    await page.getByRole('button', { name: 'Add shift' }).click();
    await expect(out).toContainText('8:00');

    // A night shift. 22:00 to 06:15 is 8:15, not the negative number a plain
    // subtraction gives — this is the case the panel exists for.
    await page.fill('#calc-time-start-calculator', '22:00');
    await page.fill('#calc-time-end-calculator', '06:15');
    await page.fill('#calc-time-break-calculator', '0');
    await page.getByRole('button', { name: 'Add shift' }).click();
    await expect(out).toContainText('8:15');
    await expect(out).toContainText('Total  16:15  (16.25 h)');

    // A break longer than the shift is a typo, and a negative row in a total
    // someone gets paid from is the worst possible failure mode.
    await page.fill('#calc-time-start-calculator', '09:00');
    await page.fill('#calc-time-end-calculator', '10:00');
    await page.fill('#calc-time-break-calculator', '90');
    await page.getByRole('button', { name: 'Add shift' }).click();
    await expect(out).toContainText('longer than the shift');

    await page.getByRole('button', { name: 'Clear shifts' }).click();
    await expect(out).toHaveText('No shifts yet.');
  });

  test('Energy Cost gets the kilowatt-hour division the right way round', async ({
    page,
  }) => {
    await openCalc(page);
    await pick(page, 'energy');

    // 1500W for 8h a day for 30 days is 360 kWh; at 0.12 that is 43.20. The
    // /1000 is the step this panel exists to stop people doing by hand.
    await page.fill('#calc-energy-watts-calculator', '1500');
    await page.fill('#calc-energy-hours-calculator', '8');
    await page.getByRole('button', { name: 'Calculate' }).click();
    const out = page.locator('#calc-energy-out-calculator');
    await expect(out).toContainText('360 kWh over 30 days');
    await expect(out).toContainText('Cost 43.20');
    await expect(out).toContainText('1.44 a day');

    await page.fill('#calc-energy-watts-calculator', '');
    await page.getByRole('button', { name: 'Calculate' }).click();
    await expect(out).toContainText('Fill in all four');
  });

  test('Ohm’s Law solves from any pair and writes the answers back', async ({
    page,
  }) => {
    await openCalc(page);
    await pick(page, 'ohms');

    // V and R.
    await page.fill('#calc-ohms-v-calculator', '120');
    await page.fill('#calc-ohms-r-calculator', '60');
    await page.getByRole('button', { name: 'Solve' }).click();
    await expect(page.locator('#calc-ohms-i-calculator')).toHaveValue('2');
    await expect(page.locator('#calc-ohms-p-calculator')).toHaveValue('240');

    // R and P — the square-root pair, which does not fall out of a generic
    // solver and is the one most likely to be quietly wrong.
    // exact: the shared "Clear History" button one panel down also matches a
    // loose "Clear".
    await page.getByRole('button', { name: 'Clear', exact: true }).click();
    await page.fill('#calc-ohms-r-calculator', '10');
    await page.fill('#calc-ohms-p-calculator', '250');
    await page.getByRole('button', { name: 'Solve' }).click();
    await expect(page.locator('#calc-ohms-v-calculator')).toHaveValue('50');
    await expect(page.locator('#calc-ohms-i-calculator')).toHaveValue('5');

    // Three values is not a solve, it is a contradiction waiting to happen.
    await page.fill('#calc-ohms-r-calculator', '10');
    await page.getByRole('button', { name: 'Solve' }).click();
    await expect(page.locator('#calc-ohms-out-calculator')).toContainText(
      'exactly two'
    );
  });

  test('Liquid Volume converts through litres, both gallons included', async ({
    page,
  }) => {
    await openCalc(page);
    await pick(page, 'liquid');

    const out = page.locator('#calc-liquid-out-calculator');
    await page.fill('#calc-liquid-value-calculator', '5');
    await page.getByRole('button', { name: 'Convert' }).click();
    await expect(out).toContainText('18.9271');

    // Swap has to convert as well as swap, or the answer on screen belongs to
    // the previous pair of units.
    await page.getByRole('button', { name: 'Swap' }).click();
    await expect(out).toContainText('1.3209');

    // "Gallon" alone is a 20% error between the two systems, so both are here
    // and both are named.
    await page.locator('#calc-liquid-from-calculator').selectOption('impgal');
    await page.locator('#calc-liquid-to-calculator').selectOption('l');
    await page.fill('#calc-liquid-value-calculator', '1');
    await page.getByRole('button', { name: 'Convert' }).click();
    await expect(out).toContainText('4.5461');
  });

  /* v4.5.1. The list shipped unfiltered in v4.5.0 and was reported the same
     day: `7:15 - 5:30 = 1:45` sitting under the Energy Cost fields, with
     nothing between the panel and the list, reads as Energy Cost's own answer.
     Each calculator keeps its own rows now. */
  test('each type keeps its own history, and switching does not lose any', async ({
    page,
  }) => {
    await openCalc(page);
    const history = page.locator(`${CALC} .calculator-history p`);
    const head = page.locator('#calculator-history-head-calculator');

    // A Standard result — the exact shape of the reported bug.
    await page.fill('#calculator-input-calculator', '7:15 - 5:30');
    await page.getByRole('button', { name: '=' }).click();
    await expect(head).toHaveText('Standard history');
    await expect(history).toHaveCount(1);

    // Switching type must swap the list, not append to it.
    await pick(page, 'energy');
    await expect(head).toHaveText('Energy Cost history');
    await expect(history).toHaveCount(0);
    await page.fill('#calc-energy-watts-calculator', '100');
    await page.fill('#calc-energy-hours-calculator', '24');
    await page.getByRole('button', { name: 'Calculate' }).click();
    await expect(history).toHaveCount(1);
    await expect(history.first()).toContainText('kWh');

    await pick(page, 'liquid');
    await expect(history).toHaveCount(0);
    await page.fill('#calc-liquid-value-calculator', '2');
    await page.getByRole('button', { name: 'Convert' }).click();
    await expect(history).toHaveCount(1);

    // Clear History clears what is ON SCREEN. A button that wipes work you
    // cannot see is worse than one that needs pressing twice.
    await page.getByRole('button', { name: 'Clear History' }).click();
    await expect(history).toHaveCount(0);
    await pick(page, 'energy');
    await expect(history).toHaveCount(1);
    await pick(page, 'standard');
    await expect(history).toHaveCount(1);
    await expect(history.first()).toHaveText('7:15 - 5:30 = 1:45 (1.75 h)');
  });

  test('the mode, the shifts and every list survive a reload', async ({ page }) => {
    await openCalc(page);

    await pick(page, 'energy');
    await page.fill('#calc-energy-watts-calculator', '100');
    await page.fill('#calc-energy-hours-calculator', '24');
    await page.getByRole('button', { name: 'Calculate' }).click();

    await pick(page, 'time');
    await page.fill('#calc-time-start-calculator', '09:00');
    await page.fill('#calc-time-end-calculator', '17:30');
    await page.getByRole('button', { name: 'Add shift' }).click();

    await forceSave(page);
    await page.reload();
    await expectBooted(page);

    await expect(page.locator('#calculator-mode-calculator')).toHaveValue('time');
    await expect(page.locator('#calc-time-out-calculator')).toContainText(
      'Total  8:30'
    );
    // The stamp rides the session, so the rows land back under the calculator
    // that produced them rather than all under whichever one opens.
    await expect(page.locator(`${CALC} .calculator-history p`)).toHaveCount(1);
    await pick(page, 'energy');
    await expect(page.locator(`${CALC} .calculator-history p`)).toHaveCount(1);
    await expect(page.locator(`${CALC} .calculator-history`)).toContainText('kWh');
  });

  test('rows from a session written before the stamp existed are Standard', async ({
    page,
  }) => {
    await openCalc(page);
    await forceSave(page);

    // Exactly what v4.4.0 and earlier wrote: expression + result, no calcMode.
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).saveSession = () => {};
      const raw = JSON.parse(localStorage.getItem('notepadSession') as string);
      raw.calculator.history = [{ expression: '2+2', result: '4' }];
      localStorage.setItem('notepadSession', JSON.stringify(raw));
    });
    await page.reload();
    await expectBooted(page);

    // They can only have come from the expression calculator — it was the only
    // one that existed — so they must not vanish into an unreachable list.
    await expect(page.locator('#calculator-history-head-calculator')).toHaveText(
      'Standard history'
    );
    await expect(page.locator(`${CALC} .calculator-history p`)).toHaveText('2+2 = 4');
  });

  test('a session naming a calculator this build has never heard of opens on Standard', async ({
    page,
  }) => {
    await openCalc(page);
    await pick(page, 'ohms');
    await forceSave(page);

    /* A session written by a later build, or by hand. It must not leave the
       window showing no panel at all.

       saveSession is stubbed out FIRST, the same way the pre-existing
       world-rescue test above does it: the app writes the session on the way
       out of the page, so a reload would otherwise put the in-memory record
       straight back over the edit and the test would assert nothing. */
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).saveSession = () => {};
      const raw = JSON.parse(localStorage.getItem('notepadSession') as string);
      raw.calculator.calcMode = 'tachyon-flux';
      raw.calculator.shifts = [
        { start: '09:00', end: '17:00', brk: 0 },
        { start: 'not a time', end: '17:00', brk: 0 },
      ];
      localStorage.setItem('notepadSession', JSON.stringify(raw));
    });
    await page.reload();
    await expectBooted(page);

    await expect(page.locator('#calculator-mode-calculator')).toHaveValue('standard');
    await expect(page.locator('#calc-panel-standard-calculator')).toBeVisible();

    // The unparseable row was dropped; the good one survived. One bad shift
    // must not cost someone the rest of their week.
    await page.locator('#calculator-mode-calculator').selectOption('time');
    await expect(page.locator('#calc-time-out-calculator')).toContainText(
      'Total  8:00'
    );
  });
});

/* ============================================================
   v4.5.2 — the Time Card's clock, and a quiet console
   ------------------------------------------------------------
   Two reports off one screenshot. Both are things that only show up when the
   app is LOOKED at rather than driven, which is exactly the class of bug a
   suite this size keeps missing, so both get a gate here.
   ============================================================ */
test.describe('CB App — time fields and the manifest (v4.5.2)', () => {
  test('the Time Card renders its clock in the UI font, not the mono one', async ({
    page,
  }) => {
    await openFresh(page);
    await clickNavId(page, '#calculator-toggle');
    await page.locator('#calculator-mode-calculator').selectOption('time');

    /* Chrome draws input[type="time"] as hour / minute / AM-PM segments with a
       literal space before the meridiem. In the mono face every one of those
       advances is the widest the font has and it reads as "09:00  AM" — and
       the native picker popup, which inherits the input's font, spaces its
       columns of numbers the same way.

       Asserted as "not the mono stack" rather than as a named family: the
       point is the swap, and --font is free to change. */
    // WebKit drops the quotes from a computed font-family and Chromium keeps
    // them, so the two are compared with quotes and whitespace normalised
    // away rather than as raw strings.
    const norm = (s: string) => s.replace(/["']/g, '').replace(/\s+/g, ' ').trim();
    const mono = norm(
      await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--mono')
      )
    );
    for (const id of ['#calc-time-start-calculator', '#calc-time-end-calculator']) {
      const face = norm(
        await page.locator(id).evaluate((el) => getComputedStyle(el).fontFamily)
      );
      expect(face).not.toBe(mono);
      expect(face).not.toMatch(/monospace/);
    }

    // The fields either side of them are still mono — the swap is scoped to
    // the one control that renders its own text.
    const brk = norm(
      await page
        .locator('#calc-time-break-calculator')
        .evaluate((el) => getComputedStyle(el).fontFamily)
    );
    expect(brk).toBe(mono);
  });

  test('the manifest names absolute URLs, so Chrome keeps them', async ({ page }) => {
    await openFresh(page);

    /* A relative URL inside a manifest resolves against the MANIFEST's URL,
       and this manifest is a blob: — there is no directory to walk up from, so
       the "." that shipped through v4.5.1 was dropped with a console warning
       on every open. Both are taken from the document now. */
    const manifest = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const m = (window as any).buildWebManifest
        ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (window as any).buildWebManifest()
        : // buildWebManifest is a top-level declaration, not a window property.
          eval('buildWebManifest()');
      return { start_url: m.start_url, scope: m.scope, here: location.href };
    });

    expect(manifest.start_url).toBe(manifest.here);
    expect(manifest.scope).toBe(manifest.here.replace(/[^/]*$/, ''));
  });

  test('opening the app logs nothing to the console', async ({ page }) => {
    /* WebKit complains about `interactive-widget` in the viewport meta, which
       it does not implement. That is a browser telling us what it supports,
       not the app saying anything, and the key is there for the browsers that
       do honour it — so it is the one line allowed through. */
    const EXPECTED = /interactive-widget/;

    const noise: string[] = [];
    page.on('console', (msg) => {
      if (
        (msg.type() === 'warning' || msg.type() === 'error') &&
        !EXPECTED.test(msg.text())
      ) {
        noise.push(`${msg.type()}: ${msg.text()}`);
      }
    });
    page.on('pageerror', (err) => noise.push(`pageerror: ${err.message}`));

    await openFresh(page);
    await clickNavId(page, '#calculator-toggle');
    await expect(page.locator('#calculator')).toBeVisible();

    expect(noise).toEqual([]);
  });
});

/* ============================================================
   v4.6.0 — two layouts, and only two
   ------------------------------------------------------------
   The app has exactly two shapes: DESKTOP (free windows, toolbar bottom-centre)
   and MOBILE (full-bleed windows, toolbar as a bottom sheet). Which one you get
   is `body.mobile-ui`, written by MOBILE_MQ.

   Until v4.6.0 the CSS disagreed with that. `@media (max-width: 720px)`
   top-anchored the toolbar and flipped the status toast, the search panel and
   both banners to the bottom to clear it — but MOBILE_MQ needs a coarse
   pointer under 720px, so a mouse-driven window at 641px got neither shape.
   A third layout, belonging to nobody. A `max-width: 600px` block did the same
   thing 40px further down, which made a fourth.

   These tests are about POSITION, not pixels: the toolbar is at the bottom at
   every width, and nothing in either bottom corner ends up underneath it.
   ============================================================ */
test.describe('CB App — one boundary, two layouts (v4.6.0)', () => {
  /** Where the toolbar sits, and whether the corner chrome is clear of it. */
  async function layout(page: Page) {
    return page.evaluate(() => {
      const rect = (sel: string) => {
        const el = document.querySelector(sel);
        return el ? el.getBoundingClientRect() : null;
      };
      const overlaps = (a: DOMRect | null, b: DOMRect | null) =>
        !!a &&
        !!b &&
        a.left < b.right &&
        b.left < a.right &&
        a.top < b.bottom &&
        b.top < a.bottom;
      const nav = rect('.nav-menu');
      /* Against the BUTTONS, not the toolbar's box. The box carries padding
         and a border radius, and the download chip clipping an empty 14px of
         it is not a defect — a button you cannot press is. */
      const buttons = Array.from(
        document.querySelectorAll('.nav-menu button, .nav-menu a')
      ).map((el) => el.getBoundingClientRect());
      const covers = (chip: DOMRect | null) =>
        !!chip && buttons.some((b) => overlaps(b, chip));
      return {
        mobile: document.body.classList.contains('mobile-ui'),
        vh: window.innerHeight,
        vw: window.innerWidth,
        nav: nav
          ? { top: nav.top, bottom: nav.bottom, left: nav.left, right: nav.right }
          : null,
        hitsLock: covers(rect('#session-lock')),
        hitsChip: covers(rect('.download-app-link')),
      };
    });
  }

  /* The sweep. Desktop projects only — a phone has no resizable viewport, and
     these widths are about a window someone dragged narrower.

     560 is not in the list: below the floor MOBILE_MQ matches on width alone
     and the shape is mobile by design, which the phone projects already cover.
     561, 600 and 601 are: the 600px block is the one that used to add a fourth
     layout, and its two edges are where that showed. */
  test('the toolbar is bottom-anchored at every desktop width', async ({
    page,
    isMobile,
  }) => {
    test.skip(Boolean(isMobile), 'A phone has no resizable viewport.');

    for (const width of [561, 600, 601, 641, 719, 720, 721, 900, 999, 1000, 1001, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await openFresh(page);
      const l = await layout(page);

      // The toolbar's own position: in the bottom half, and within a bar's
      // reach of the bottom edge. A top-anchored bar fails on both counts.
      expect(l.mobile, `${width}px should be the desktop shape`).toBe(false);
      expect(l.nav!.top, `${width}px: toolbar is in the top half`).toBeGreaterThan(l.vh / 2);
      expect(
        l.vh - l.nav!.bottom,
        `${width}px: toolbar is not near the bottom edge`
      ).toBeLessThanOrEqual(60);

      /* On screen at all. `width: max-content` does not shrink, so between the
         old 720px breakpoint and ~960px the centred bar simply overhung both
         edges — at 721px its left edge measured -109px, with the whole Create
         group unreachable. This is the assertion that pins the 1000px wrap
         threshold to the bar's real width rather than to a device size. */
      expect(l.nav!.left, `${width}px: toolbar overhangs the left edge`)
        .toBeGreaterThanOrEqual(0);
      expect(l.nav!.right, `${width}px: toolbar overhangs the right edge`)
        .toBeLessThanOrEqual(l.vw);

      /* And it is not stretched. Both offsets set on a fixed box with height
         auto makes it fill the gap between them — the exact failure the 600px
         block caused once the 720px block stopped setting `top`: a 639px-tall
         toolbar with its buttons centred in the middle of the screen. */
      expect(
        l.nav!.bottom - l.nav!.top,
        `${width}px: toolbar is stretched`
      ).toBeLessThan(l.vh / 2);

      /* The lock button and the download chip are z-index 1001 against the
         toolbar's 1000, so an overlap does not read as crowding — it covers
         toolbar buttons with a chip drawn on top of them. */
      expect(l.hitsLock, `${width}px: toolbar is under the lock button`).toBe(false);
      expect(l.hitsChip, `${width}px: toolbar is under the download chip`).toBe(false);
    }
  });

  /* The other half of removing the third layout: everything that used to be
     shoved to the bottom to clear a top-anchored bar stays where the desktop
     puts it, because the top is empty again. */
  test('the top-centre chrome stays at the top on a narrow desktop', async ({
    page,
    isMobile,
  }) => {
    test.skip(Boolean(isMobile), 'Phones put this chrome at the bottom; see below.');

    await page.setViewportSize({ width: 641, height: 900 });
    await openFresh(page);

    const offsets = await page.evaluate(() => {
      const top = (sel: string) => getComputedStyle(document.querySelector(sel)!).top;
      return {
        status: top('#status'),
        search: top('#search-replace'),
        locked: top('#locked-banner'),
        warning: top('#save-warning'),
      };
    });

    expect(offsets.status).toBe('18px');
    expect(offsets.search).toBe('18px');
    expect(offsets.locked).toBe('12px');
    expect(offsets.warning).toBe('12px');
  });

  /* On a phone they DO move — and the rules that move them are keyed on
     body.mobile-ui rather than on a width, which is the whole point. A phone
     in landscape is 802px wide and never matched the width-keyed versions, so
     the lock banner used to sit on top of #stack-tabs there.

     `top: auto` is the assertion that matters. With both offsets set and
     height auto the box stretches to fill the gap between them, which is how
     the status toast once painted as a 422x302 dark blob. */
  test('a phone puts the banners and the chips at the bottom, both ways up', async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, 'phone and tablet shapes only');

    await openFresh(page);
    const onPhone = await page.evaluate(() =>
      document.body.classList.contains('mobile-ui')
    );
    test.skip(!onPhone, 'This tablet is wide enough for the desktop shape.');

    const offsets = await page.evaluate(() => {
      const cs = (sel: string) => {
        const s = getComputedStyle(document.querySelector(sel)!);
        return { top: s.top, bottom: s.bottom };
      };
      return {
        locked: cs('#locked-banner'),
        warning: cs('#save-warning'),
        status: cs('#status'),
        chips: cs('#minimized-bar'),
      };
    });

    for (const [name, o] of Object.entries(offsets)) {
      expect(o.top, `${name} must be bottom-anchored, not stretched`).toBe('auto');
      expect(
        parseFloat(o.bottom),
        `${name} must sit above the bottom chrome`
      ).toBeGreaterThan(0);
    }
  });

  /* The tablets, and the answer to "is an iPad tested?" — it is now, on both
     sides of the boundary. iPad Pro 11 portrait is 834px and gets the desktop
     shape with a touch pointer; iPad (gen 11) portrait is 656px and gets the
     phone shape, then crosses to desktop the moment it is turned. Asserted so
     that a change to MOBILE_MQ has to be a deliberate one. */
  test('the shape a tablet gets follows its width, not its pointer', async ({ page }) => {
    test.skip(!test.info().project.name.startsWith('ipad'), 'tablet projects only');

    await openFresh(page);
    const l = await layout(page);

    expect(l.mobile).toBe(l.vw <= 720);
    // Whichever shape it landed in, the toolbar is at the bottom of it.
    expect(l.vh - l.nav!.bottom).toBeLessThanOrEqual(60);
  });
});

/* ============================================================
   v4.6.1 — the notch
   ------------------------------------------------------------
   Reported from an installed iPhone 13 Pro Max: the top of the app was cut
   off. `apple-mobile-web-app-status-bar-style` is black-translucent and the
   viewport is `viewport-fit=cover`, so on a home-screen install the page owns
   the pixels behind the status bar — but --stack-top, which is what a
   full-bleed window is offset by, was 0 unless `.has-switcher` was on. That
   class means "more than one window". With one window open, which is how every
   fresh install starts, the window's title bar and its close button were drawn
   underneath the clock and the battery.

   NOTHING EMULATES A SAFE-AREA INSET. Not Playwright, not the Chrome or WebKit
   device profiles, and `env()` is not settable from script — so this bug is
   invisible to every project in this file and reachable only on a physical
   phone. That is why the fix names the inset in a custom property
   (`--safe-top`, `--safe-left`, `--safe-right`, each `env(...)` with a 0px
   fallback) instead of calling env() at each site: overriding those three on
   <body> reproduces a notch anywhere, which is what these tests do.
   ============================================================ */
test.describe('CB App — the notch (v4.6.1)', () => {
  test.skip(
    ({ isMobile, viewport }) => !phoneShaped(isMobile, viewport),
    'stack mode is the phone shape'
  );

  /** Pretend to be a notched device. 47px is the iPhone 13 Pro Max's inset. */
  async function notch(page: Page, { top = 0, left = 0, right = 0 }) {
    await page.evaluate(
      ({ top, left, right }) => {
        document.body.style.setProperty('--safe-top', `${top}px`);
        document.body.style.setProperty('--safe-left', `${left}px`);
        document.body.style.setProperty('--safe-right', `${right}px`);
      },
      { top, left, right }
    );
  }

  const firstWindow = (page: Page) =>
    page.evaluate(() => {
      const el = document.querySelector('#windows > .window') as HTMLElement;
      const r = el.getBoundingClientRect();
      return {
        top: Math.round(r.top),
        left: Math.round(r.left),
        right: Math.round(r.right),
        vw: window.innerWidth,
        stack: document.body.classList.contains('mobile-ui'),
        switcher: document.body.classList.contains('has-switcher'),
      };
    });

  test('one window still clears the status bar', async ({ page }) => {
    await openFresh(page);
    await clickNav(page, { tooltip: 'New Note' });
    test.skip(
      !(await page.evaluate(() => document.body.classList.contains('mobile-ui'))),
      'This profile is wide enough for the desktop shape.'
    );

    // The reported shape: ONE window, so no tab strip, so --stack-top used to
    // fall back to 0 and the title bar sat 22px inside a 47px inset.
    const flat = await firstWindow(page);
    expect(flat.switcher).toBe(false);
    expect(flat.top).toBe(0);

    await notch(page, { top: 47 });
    expect((await firstWindow(page)).top).toBe(47);

    // And it is a floor, not a replacement: with a second window the tab strip
    // is added ON TOP of the inset rather than instead of it.
    await clickNav(page, { tooltip: 'New Note' });
    const stacked = await firstWindow(page);
    expect(stacked.switcher).toBe(true);
    expect(stacked.top).toBeGreaterThan(47);
  });

  test('a landscape notch is on the side, and windows clear that too', async ({
    page,
  }) => {
    await openFresh(page);
    await clickNav(page, { tooltip: 'New Note' });
    test.skip(
      !(await page.evaluate(() => document.body.classList.contains('mobile-ui'))),
      'This profile is wide enough for the desktop shape.'
    );

    /* Turned sideways the inset moves to the left or the right, and a window
       at `left: 0; width: 100%` ran its own edge under it — on a note that is
       the line-number gutter, permanently behind the notch. */
    await notch(page, { left: 47, right: 47 });
    const w = await firstWindow(page);
    expect(w.left).toBe(47);
    expect(w.right).toBe(w.vw - 47);

    // Back to a phone without one: byte-for-byte the old geometry.
    await notch(page, {});
    const flat = await firstWindow(page);
    expect(flat.left).toBe(0);
    expect(flat.right).toBe(flat.vw);
    expect(flat.top).toBe(0);
  });
});

/* ============================================================
   v4.6.2 — pinch on the canvas belongs to the canvas
   ------------------------------------------------------------
   Reported on an iPad (7th gen, iPadOS 18): pinching the canvas zoomed the
   whole page instead of the world.

   The app's pinch handler is wired for any touch pointer and always was. What
   was missing is the half that stops the BROWSER acting on the same two
   fingers first — `touch-action: none` on the canvas layer — which was keyed
   on `body.mobile-ui`, the phone LAYOUT. An iPad is 810px wide in portrait and
   takes the desktop layout by design, so it never matched: both zooms ran.

   `body.mobile-ui` answers "is this laid out as a phone". The question here is
   "can a finger reach this", which is `any-pointer: coarse` and has different
   answers — an iPad, and a touchscreen laptop being driven with a mouse.

   Asserted as computed `touch-action`, which is the actual contract with the
   browser. Playwright cannot synthesise a two-finger pinch, and a test that
   drove the handler directly would have passed throughout the bug.
   ============================================================ */
test.describe('CB App — the canvas owns the pinch (v4.6.2)', () => {
  const touchAction = (page: Page, sel: string) =>
    page.evaluate(
      (s) => getComputedStyle(document.querySelector(s)!).touchAction,
      sel
    );

  test('a touch device hands the canvas its gestures, phone-shaped or not', async ({
    page,
    hasTouch,
  }) => {
    test.skip(!hasTouch, 'the fix is about fingers');

    await openFresh(page);
    // The windowed desk is untouched: pinch-zooming the PAGE is an
    // accessibility right, and there is no user-scalable=no here to take it
    // away. Only the canvas claims the gesture.
    expect(await touchAction(page, '#windows')).toBe('auto');

    await clickNavId(page, '#canvas-toggle');
    await expect(page.locator('body')).toHaveClass(/canvas-on/);

    /* The reported case is an iPad, which is NOT body.mobile-ui — that is the
       whole point, so assert the two independently rather than assuming a
       device gives you both. */
    const phoneShaped = await page.evaluate(() =>
      document.body.classList.contains('mobile-ui')
    );
    expect(await touchAction(page, '#windows')).toBe('none');
    expect(await touchAction(page, '#canvas-map')).toBe('none');
    if (!phoneShaped) {
      // An iPad-shaped profile proves the gate is not the phone layout.
      expect(test.info().project.name.startsWith('ipad')).toBe(true);
    }

    // And it goes back when the canvas does.
    await clickNavId(page, '#canvas-toggle');
    await expect(page.locator('body')).not.toHaveClass(/canvas-on/);
    expect(await touchAction(page, '#windows')).toBe('auto');
  });

  test('a note on the canvas can still be scrolled with a finger', async ({
    page,
    hasTouch,
  }) => {
    test.skip(!hasTouch, 'the fix is about fingers');

    await openFresh(page);
    await clickNavId(page, '#canvas-toggle');
    await clickNav(page, { tooltip: 'New Note' });

    /* The give-back. A layer at touch-action:none with nothing exempted is a
       canvas whose notes cannot be scrolled — the two rules have to move
       together, which is why they now live in the same block. */
    expect(await touchAction(page, '.window textarea')).toBe('pan-y');
  });

  test('a mouse-only desktop keeps its ordinary scrolling over the canvas', async ({
    page,
    hasTouch,
  }) => {
    test.skip(Boolean(hasTouch), 'this is the exclusion, not the fix');

    await openFresh(page);
    await clickNavId(page, '#canvas-toggle');
    await expect(page.locator('body')).toHaveClass(/canvas-on/);

    // No finger, nothing to take away from it.
    expect(await touchAction(page, '#windows')).toBe('auto');
  });
});

/* ============================================================
   THREE THINGS SEEN, NOT DRIVEN (v4.6.3)

   All three arrived from a phone or an iPad, and all three are the same class
   of bug: the app worked perfectly and looked wrong. A suite that only drives
   the app cannot see any of them, so each gets a gate on the property that
   actually broke.

   1. The dot grid does not thin out. Its dot RADIUS is a fixed 1.5px while
      its SPACING is scaled by the zoom, so at 62% the pattern is half as far
      apart and just as dark — dense enough to read as noise behind the
      empty-desk paragraph.

   2. The collapsed toolbar drew two boxes. .nav-menu (14px radius, border,
      card fill, shadow) and its .nav-toggle (8px radius, border, card fill)
      were both exactly 44px on a phone, one inside the other, edge to edge:
      a square drawn on the hamburger.

   3. Safari on iOS/iPadOS renders an EMPTY input[type="time"] as a blank box.
      Chrome draws greyed "--:-- --" segments; Safari draws nothing, so Start
      and End were two empty rectangles until they were tapped. There is no
      ::placeholder for a time input, so the hint is ours.
   ============================================================ */
test.describe('CB App — three things seen, not driven (v4.6.3)', () => {
  const gridOpacity = (page: Page) =>
    page.evaluate(() =>
      parseFloat(getComputedStyle(document.getElementById('canvas-grid')!).opacity)
    );

  test('the dot grid fades as the canvas zooms out', async ({ page }) => {
    await openFresh(page);
    await clickNavId(page, '#canvas-toggle');
    await expect(page.locator('body')).toHaveClass(/canvas-on/);

    // 1:1 is the reference: at 100% the grid is at full strength and the fade
    // must not touch it.
    const controls = page.locator('#canvas-controls');
    await controls.getByLabel(/reset zoom to 100/i).click();
    await expect(page.locator('#zoom-level')).toHaveText('100%');
    const full = await gridOpacity(page);
    expect(full).toBeCloseTo(1, 2);

    // Then the reported case, and the floor below it. Driven through the zoom
    // control rather than by poking state, so the wiring is covered too.
    const minus = controls.getByLabel('Zoom out', { exact: true });
    const steps: number[] = [];
    for (let i = 0; i < 6; i++) {
      await minus.click();
      steps.push(await gridOpacity(page));
    }

    // Monotonic, never rising on the way down.
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i]).toBeLessThanOrEqual(steps[i - 1] + 1e-6);
    }
    // Meaningfully lighter than 1:1 — the complaint was that it was not.
    expect(steps[steps.length - 1]).toBeLessThan(full * 0.75);
    // And never gone: a canvas with no grid at all stops reading as a canvas.
    expect(steps[steps.length - 1]).toBeGreaterThan(0.1);
  });

  test('the collapsed toolbar is one round button, not a box on a box', async ({
    page,
    isMobile,
    viewport,
  }) => {
    test.skip(!phoneShaped(isMobile, viewport), 'the FAB is the phone layout');

    await openFresh(page);
    const nav = page.locator('nav.nav-menu');
    await expect(nav).toHaveClass(/collapsed/);

    // The container keeps its size and its job; it gives up its skin.
    const shell = await nav.evaluate((el) => {
      const s = getComputedStyle(el);
      return {
        border: s.borderTopWidth,
        shadow: s.boxShadow,
        bg: s.backgroundColor,
      };
    });
    expect(parseFloat(shell.border)).toBe(0);
    expect(shell.shadow === 'none' || shell.shadow === '').toBe(true);
    // rgba(…, 0) or `transparent` — either way nothing is painted.
    expect(shell.bg).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);

    // And the button that is left is round, like #session-lock beside it.
    const btn = nav.locator('.nav-toggle');
    const box = await btn.boundingBox();
    const radius = await btn.evaluate((el) =>
      parseFloat(getComputedStyle(el).borderTopLeftRadius)
    );
    expect(box).not.toBeNull();
    expect(radius).toBeGreaterThanOrEqual(box!.height / 2 - 0.5);

    // Opening it puts the panel's skin back — the strip is scoped to collapsed.
    await btn.click();
    await expect(nav).not.toHaveClass(/collapsed/);
    const open = await nav.evaluate(
      (el) => getComputedStyle(el).backgroundColor
    );
    expect(open).not.toMatch(/rgba\(0, 0, 0, 0\)/);
  });

  test('an empty time field says --:-- even where the browser will not', async ({
    page,
  }) => {
    await openFresh(page);
    await clickNavId(page, '#calculator-toggle');
    await page.locator('#calculator-mode-calculator').selectOption('time');

    for (const key of ['start', 'end']) {
      const hint = page.locator(
        `#calc-time-${key}-calculator ~ .time-hint, .time-shell:has(#calc-time-${key}-calculator) .time-hint`
      );
      await expect(hint.first()).toBeVisible();
      await expect(hint.first()).toHaveText('--:--');
    }

    /* The tap has to reach the input UNDERNEATH the hint. This is the one way
       the affordance could make things worse than the blank box it replaces,
       and it is not visible in a screenshot. */
    const hitsInput = await page.evaluate(() => {
      const input = document.getElementById('calc-time-start-calculator')!;
      const r = input.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + 12, r.top + r.height / 2);
      return hit === input || input.contains(hit);
    });
    expect(hitsInput).toBe(true);

    // A value takes the hint away, and clearing it brings the hint back.
    await page.fill('#calc-time-start-calculator', '08:30');
    await expect(
      page.locator('.time-shell:has(#calc-time-start-calculator) .time-hint')
    ).toBeHidden();
    await expect(
      page.locator('.time-shell:has(#calc-time-end-calculator) .time-hint')
    ).toBeVisible();

    /* Clearing it back to empty brings the hint back — but only once focus
       leaves, because a FOCUSED time input draws its own segments in every
       engine and two lots of "--:--" on top of each other is worse than none.
       The blur is the assertion, not a workaround for one. */
    await page.fill('#calc-time-start-calculator', '');
    await page.locator('#calc-time-start-calculator').blur();
    await expect(
      page.locator('.time-shell:has(#calc-time-start-calculator) .time-hint')
    ).toBeVisible();

    // The wrapper must not have cost the panel its layout: label column, then
    // the field, on one row, exactly as the number rows beside it.
    const aligned = await page.evaluate(() => {
      const box = (sel: string) =>
        document.querySelector(sel)!.getBoundingClientRect();
      return Math.abs(
        box('#calc-time-start-calculator').left -
          box('#calc-time-break-calculator').left
      );
    });
    expect(aligned).toBeLessThan(2);
  });
});
