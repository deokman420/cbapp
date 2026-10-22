/**
 * CB App icon generator.
 *
 * CB App is one self-contained file opened from file:// on a locked-down
 * machine, so it cannot reference /icons/*.png — every icon has to travel
 * inside the HTML as a data: URI. This script draws the art once as SVG,
 * rasterises it with the Playwright Chromium that the test suite already
 * installs, and prints the base64 PNGs so they can be pasted into cbapp.html.
 *
 *   node scripts/make-cbapp-icons.mjs            # writes icons.json next to it
 *   node scripts/make-cbapp-icons.mjs --out DIR  # also drops the raw PNGs
 *
 * Two art variants:
 *   any       — glyph at full size, for apple-touch-icon and the plain
 *               manifest entries. iOS masks the corners itself, so the
 *               background is full-bleed and opaque (a transparent
 *               apple-touch-icon comes out black on the home screen).
 *   maskable  — same art shrunk into the middle 60%, which is the only
 *               region Android guarantees survives its mask shapes.
 */
import { chromium } from "@playwright/test";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

// Straight from cbapp.html's :root, so the home-screen icon and the app agree.
const BG = "#0c0f16";
const BG_TOP = "#161c27";
const ACCENT = "#00d4aa";
const PAPER = "#e2e8f0";
const RULE = "#8492a6";
// The nib sits ON the paper, so it cannot be paper-coloured — at 120px a
// near-white wedge on a near-white page disappears and the pencil looks
// snapped off. --orange from the same token block, which the calendar already
// uses for "today".
const WOOD = "#f59e0b";

/** @param {number} scale 1 = full bleed art, 0.6 = Android maskable safe zone */
function svg(scale) {
  // The art is authored in a 512 box and then scaled about its centre.
  const t = `translate(256 256) scale(${scale}) translate(-256 -256)`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${BG_TOP}"/>
      <stop offset="1" stop-color="${BG}"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" fill="url(#bg)"/>
  <g transform="${t}">
    <!-- the note -->
    <rect x="104" y="96" width="250" height="320" rx="28" fill="${PAPER}"/>
    <g fill="${RULE}">
      <rect x="140" y="156" width="178" height="18" rx="9"/>
      <rect x="140" y="212" width="178" height="18" rx="9"/>
      <rect x="140" y="268" width="120" height="18" rx="9"/>
    </g>
    <!-- accent rule: the one line you just wrote -->
    <rect x="140" y="324" width="86" height="18" rx="9" fill="${ACCENT}"/>
    <!-- the pencil, nib down, crossing the note's bottom-right corner -->
    <g transform="rotate(45 330 300)">
      <rect x="300" y="120" width="60" height="232" rx="14" fill="${ACCENT}"/>
      <rect x="300" y="300" width="60" height="52" fill="${BG}" opacity="0.18"/>
      <path d="M300 352 h60 l-30 62 Z" fill="${WOOD}"/>
      <path d="M317 388 h26 l-13 26 Z" fill="${BG}"/>
    </g>
  </g>
</svg>`;
}

const VARIANTS = [
  // apple-touch-icon sizes: 180 is the one modern iPhones read; the rest are
  // the iPad/legacy rungs, and they are cheap.
  { name: "apple-180", size: 180, scale: 1 },
  { name: "apple-167", size: 167, scale: 1 },
  { name: "apple-152", size: 152, scale: 1 },
  { name: "apple-120", size: 120, scale: 1 },
  // Android / PWA.
  { name: "any-192", size: 192, scale: 1 },
  { name: "any-512", size: 512, scale: 1 },
  { name: "maskable-192", size: 192, scale: 0.6 },
  { name: "maskable-512", size: 512, scale: 0.6 },
];

const outDir = process.argv.includes("--out")
  ? process.argv[process.argv.indexOf("--out") + 1]
  : null;
if (outDir) mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const out = {};
for (const v of VARIANTS) {
  const page = await browser.newPage({
    viewport: { width: v.size, height: v.size },
    deviceScaleFactor: 1,
  });
  await page.setContent(
    `<style>html,body{margin:0;padding:0}svg{display:block;width:${v.size}px;height:${v.size}px}</style>${svg(v.scale)}`
  );
  const buf = await page.screenshot({ omitBackground: false });
  await page.close();
  out[v.name] = `data:image/png;base64,${buf.toString("base64")}`;
  if (outDir) writeFileSync(join(outDir, `${v.name}.png`), buf);
  console.log(`${v.name}: ${v.size}px, ${buf.length} bytes raw`);
}
await browser.close();

writeFileSync(join(HERE, "cbapp-icons.json"), JSON.stringify(out, null, 2));
console.log(`\nwrote ${join(HERE, "cbapp-icons.json")}`);
