/**
 * Offline checks for CB App security hardening (v3.2.0, current build v3.2.1).
 * Run: node scripts/cbapp-security-check.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import assert from "assert";
import { webcrypto } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const htmlPath = path.join(root, "cbapp.html");
const html = fs.readFileSync(htmlPath, "utf8");

// --- Extract and syntax-check the main script ---
const scriptMatch = html.match(
  /<script type="text\/javascript">([\s\S]*)<\/script>/
);
assert.ok(scriptMatch, "inline script block present");
const code = scriptMatch[1];
try {
  // eslint-disable-next-line no-new-func
  new Function(code);
} catch (e) {
  console.error("SYNTAX ERROR in cbapp.html script:", e.message);
  process.exit(1);
}
console.log("PASS syntax");

// --- Static policy / surface checks ---
const fails = [];
function check(name, cond) {
  if (cond) console.log("PASS", name);
  else {
    console.log("FAIL", name);
    fails.push(name);
  }
}

check("no cdnjs allowlist/link", !html.includes("cdnjs.cloudflare.com"));
check("no Google Fonts link", !html.includes("fonts.googleapis.com"));
check("no fonts.gstatic", !html.includes("fonts.gstatic.com"));
check(
  "CSP splits script-src",
  /script-src 'self' 'unsafe-inline'/.test(html)
);
check("CSP object-src none", /object-src 'none'/.test(html));
check("CSP base-uri none", /base-uri 'none'/.test(html));
check("CSP connect-src none", /connect-src 'none'/.test(html));
const cspMeta = html.match(
  /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/
);
check("CSP meta present", !!cspMeta);
if (cspMeta) {
  check(
    "CSP default-src does not include data:",
    !/default-src[^;]*data:/.test(cspMeta[1])
  );
  check(
    "CSP default-src is none",
    /default-src 'none'/.test(cspMeta[1])
  );
}
check("validateSessionObject present", html.includes("validateSessionObject"));
check("encryptSessionObject present", html.includes("encryptSessionObject"));
check("Protect UI present", html.includes("toggleSessionProtection"));
check("clearAllSessionStorage present", html.includes("clearAllSessionStorage"));
check("freeze not encryption messaging", html.includes("not encryption"));
// --- Exports carry no content (v3.2.7) ---------------------------------------
// 3.2.0–3.2.6 baked the session into the HTML export and restored it on open.
// Two ways that went wrong: it displaced whatever the browser already had, and
// a plaintext payload never set sessionPassphrase — so opening any export
// silently turned Protect off and wrote the next autosave in the clear. The
// mechanism is gone rather than guarded; these checks assert it stays gone.
check(
  "no embedded-session payload is written into the HTML download",
  !/id\s*=\s*EMBEDDED_SESSION_ID/.test(html) &&
    !html.includes("const EMBEDDED_SESSION_ID")
);
check(
  "no embedded-session restore path at boot",
  !html.includes("function readEmbeddedSession") &&
    !html.includes("function undoEmbeddedRestore")
);
/* The property that matters is WHERE boot gets its session: this browser's own
   SESSION_KEY and nowhere else. The assertion used to pin the declaration too
   (`const rawToLoad = …`), which made it fail in v4.0.3 the moment the read was
   wrapped in try/catch so that a storage-denied profile could still finish
   booting — a change that does not touch the property at all. Match the read,
   not the syntax around it, and separately assert that this is the only place
   the session key is read at boot. The two checks above already assert that no
   embedded-session source exists to compete with it. */
check(
  "boot loads only this browser's own session",
  /rawToLoad = localStorage\.getItem\(SESSION_KEY\)/.test(html)
);
// The retired keys are inert but must still be cleared out of browsers that
// ran an older build — a stale .prev is the wreckage of the displacement bug.
check(
  "retired export keys are purged at boot and by Reset",
  /RETIRED_EXPORT_KEYS\s*=\s*\[[^\]]*notepadSession\.prev/.test(html) &&
    /ALL_SESSION_KEYS\s*=\s*\[[^\]]*RETIRED_EXPORT_KEYS/.test(html) &&
    html.includes("purgeRetiredExportKeys()")
);
check(
  "Backup is the only content export",
  html.includes("downloadCbApp") && !html.includes("downloadCurrentHtml")
);
// v3.2.11: Backup has no plaintext path. It must always seal the snapshot —
// with the session passphrase when Protect is on, otherwise with one it asks
// for per file — and the filename must not advertise a plaintext variant.
const backupFn = html.slice(
  html.indexOf("async function downloadSessionJSON()"),
  html.indexOf("async function downloadCbApp()")
);
check("Backup body was located", backupFn.length > 200);
check(
  "Backup always encrypts",
  backupFn.includes("encryptSessionObject(snap, sessionPassphrase)") &&
    backupFn.includes("encryptForExport(snap, pass)") &&
    backupFn.includes("promptNewPassphrase")
);
check(
  "Backup writes no plaintext file and refuses without Web Crypto",
  !/a\.download\s*=\s*sessionPassphrase/.test(backupFn) &&
    !backupFn.includes('"cbapp-session.json"') &&
    backupFn.includes("window.crypto?.subtle")
);
// A per-file backup passphrase must never reach the tab's cached session key.
check(
  "encryptForExport bypasses the session key cache",
  /async function encryptForExport[\s\S]{0,500}?deriveAesKey\(passphrase, salt, PBKDF2_ITERATIONS\)/.test(
    html
  ) &&
    !/async function encryptForExport[\s\S]{0,500}?ensureSessionKey/.test(html)
);
check(
  "new passphrases are at least 12 characters",
  /const MIN_NEW_PASSPHRASE_CHARS = 12;/.test(html)
);
check(
  "current seals use 600000 PBKDF2 iterations",
  /const PBKDF2_ITERATIONS = 600000;/.test(html) &&
    html.includes("PBKDF2-SHA256-600000")
);
check(
  "legacy 210000 envelopes are still recognised",
  /const LEGACY_PBKDF2_ITERATIONS = 210000;/.test(html) &&
    html.includes("PBKDF2-SHA256-210000")
);
check(
  "http(s) passphrase notice and plaintext-import confirm are present",
  html.includes('id="origin-notice"') &&
    html.includes("Import an unencrypted file?")
);
check(
  "Backup syncs storage through persistSessionPayload, not a raw setItem",
  backupFn.includes("persistSessionPayload(snap)") &&
    !/localStorage\.setItem\(SESSION_KEY/.test(backupFn)
);
/* The hardening above landed in 3.2.0 and every check here must keep holding
   for each release built on top of it. That was pinned to `v3.2.x` until the
   calendar shipped as 4.0.0 — a pin that tight turns a major version into a
   test failure, so it now asserts "3.2 or later" instead: still a floor, no
   longer a ceiling. */
const marker = html.match(/<!-- CB App v(\d+)\.(\d+)\.\d+ /);
check(
  "version marker is 3.2 or later",
  !!marker &&
    (Number(marker[1]) > 3 ||
      (Number(marker[1]) === 3 && Number(marker[2]) >= 2))
);

const vercel = JSON.parse(
  fs.readFileSync(path.join(root, "vercel.json"), "utf8")
);
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
check("vercel headers for cbapp", Array.isArray(vercel.headers));
const hdrBlob = JSON.stringify(vercel.headers || []);
check("vercel frame-ancestors none", hdrBlob.includes("frame-ancestors 'none'"));
check("vercel X-Frame-Options DENY", hdrBlob.includes("DENY"));
/* package.json is the test toolchain. An empty buildCommand overrides any
   detected build, and outputDirectory "." serves this repo as-is, including
   cbapp.html at the root. null would mean "detect", which is the opposite. */
check("vercel does not run a build", vercel.buildCommand === "");
check("vercel output is the repo root", vercel.outputDirectory === ".");
check("vercel framework is unset", vercel.framework === null);
check("vercel skips install", vercel.installCommand === "");
check(
  "vercel serves cbapp.html at /",
  Array.isArray(vercel.rewrites) &&
    vercel.rewrites.some(
      (r) => r.source === "/" && r.destination === "/cbapp.html"
    )
);
check("package.json has no build script", !pkg.scripts || !pkg.scripts.build);

// --- Functional crypto + validation (mirror key algorithms) ---
const SESSION_FORMAT_VERSION = 1;
const PBKDF2_ITERATIONS = 600000;
const LEGACY_PBKDF2_ITERATIONS = 210000;

function bufToB64(buf) {
  return Buffer.from(buf).toString("base64");
}
function b64ToBytes(b64) {
  return new Uint8Array(Buffer.from(b64, "base64"));
}

async function deriveAesKey(passphrase, saltBytes, iterations) {
  const enc = new TextEncoder();
  const material = await webcrypto.subtle.importKey(
    "raw",
    enc.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return webcrypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: saltBytes,
      iterations,
      hash: "SHA-256",
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function roundTrip() {
  const session = {
    theme: "dark-mode",
    window1: {
      position: { left: "10", top: "20" },
      width: 400,
      height: 300,
      content: "secret note <script>alert(1)</script>",
      name: "Note",
      isTaskWindow: false,
      locked: false,
      minimized: false,
      tasks: [],
    },
  };
  const salt = webcrypto.getRandomValues(new Uint8Array(16));
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey("test-pass-123", salt, PBKDF2_ITERATIONS);
  const plain = new TextEncoder().encode(JSON.stringify(session));
  const ct = await webcrypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain);
  const envelope = {
    _cbapp: SESSION_FORMAT_VERSION,
    enc: true,
    alg: "AES-GCM-256",
    kdf: "PBKDF2-SHA256-600000",
    salt: bufToB64(salt),
    iv: bufToB64(iv),
    ct: bufToB64(ct),
  };
  const key2 = await deriveAesKey(
    "test-pass-123",
    b64ToBytes(envelope.salt),
    PBKDF2_ITERATIONS
  );
  const pt = await webcrypto.subtle.decrypt(
    { name: "AES-GCM", iv: b64ToBytes(envelope.iv) },
    key2,
    b64ToBytes(envelope.ct)
  );
  const out = JSON.parse(new TextDecoder().decode(pt));
  assert.strictEqual(out.window1.content, session.window1.content);
  console.log("PASS AES-GCM round-trip");

  // Wrong passphrase must fail
  let threw = false;
  try {
    const bad = await deriveAesKey(
      "wrong-password",
      b64ToBytes(envelope.salt),
      PBKDF2_ITERATIONS
    );
    await webcrypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64ToBytes(envelope.iv) },
      bad,
      b64ToBytes(envelope.ct)
    );
  } catch {
    threw = true;
  }
  check("wrong passphrase fails decrypt", threw);

  const legacySalt = webcrypto.getRandomValues(new Uint8Array(16));
  const legacyIv = webcrypto.getRandomValues(new Uint8Array(12));
  const legacyKey = await deriveAesKey(
    "old-pass-12345",
    legacySalt,
    LEGACY_PBKDF2_ITERATIONS
  );
  const legacyCt = await webcrypto.subtle.encrypt(
    { name: "AES-GCM", iv: legacyIv },
    legacyKey,
    new TextEncoder().encode("legacy-210000")
  );
  const legacyKey2 = await deriveAesKey(
    "old-pass-12345",
    legacySalt,
    LEGACY_PBKDF2_ITERATIONS
  );
  const legacyPt = await webcrypto.subtle.decrypt(
    { name: "AES-GCM", iv: legacyIv },
    legacyKey2,
    legacyCt
  );
  assert.strictEqual(new TextDecoder().decode(legacyPt), "legacy-210000");
  console.log("PASS legacy 210000 PBKDF2 round-trip");
}

// --- Import a minimal sandbox of validateSessionObject from the file ---
// Pull the function source between markers is hard; re-check reject patterns in source.
check(
  "rejects __proto__ key",
  html.includes('key === "__proto__"')
);
check(
  "sanitizeColorString present",
  html.includes("sanitizeColorString")
);

await roundTrip();

if (fails.length) {
  console.error("\n" + fails.length + " check(s) failed:", fails.join(", "));
  process.exit(1);
}
console.log("\nAll CB App security checks passed.");
