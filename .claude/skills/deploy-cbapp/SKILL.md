---
name: deploy-cbapp
description: Release CB App from this repository — bump the version in both places, update CHANGELOG.md, lint, run the security check, and run the Playwright suite on every project. Use when the user asks to ship, release, or deploy CB App, or says "/deploy-cbapp", or has just finished a cbapp.html change and wants it ready to publish. Do not configure DNS or hosting.
---

# Release CB App

This repository is the only home for CB App. `cbapp.html` at the repo root is the app. There is no second copy to mirror, no site build, and no homepage version token.

The public host for this repository is the Vercel project `cbapp` (production branch `main`, domain `cbapp.phbeks.com`). DNS for that name is Philip's. This skill does not create DNS records.

`vercel.json` is what that project deploys. `framework` is null, `installCommand` and `buildCommand` are empty strings (empty skips the step; `null` means "detect", which would go looking for a build), and `outputDirectory` is `.`. `/` rewrites to `/cbapp.html`. Do not add a `build` script to `package.json`. `npm run lint` and the Playwright scripts are local only. This file's headers do not apply to phbeks.com's `/cbapp.html`, which is a different project.

## Preconditions

- The edit to `cbapp.html` is finished and you have seen it work in a browser at a real viewport, not only in a test. Layout bugs ship green.
- Working directory is this repo.
- Do not commit `.env` files, private keys, or `node_modules`.

## Step 1 — version and changelog

`cbapp.html` carries the version in **two** places and both must move together:

- the HTML comment near the top: `<!-- CB App vX.Y.Z — YYYY-MM-DD. ... -->`
- `const CB_APP_VERSION = "X.Y.Z";`

Bump with a small Python replace, not `sed`. The file is large and contains base64 icon blobs:

```bash
python -c "
import io
p='cbapp.html'
s=io.open(p,encoding='utf-8',newline='').read()
for a,b in [('<!-- CB App v4.8.0 —','<!-- CB App v4.8.1 —'),
            ('const CB_APP_VERSION = \"4.8.0\";','const CB_APP_VERSION = \"4.8.1\";')]:
    assert s.count(a)==1, a
    s=s.replace(a,b)
io.open(p,'w',encoding='utf-8',newline='').write(s)
"
```

Patch for a fix, minor for anything a user would notice as new or different.

Write the entry at the top of `CHANGELOG.md`, above the previous release and below the `---`. Keep a Changelog format. This file is the only changelog. Do not add a second one.

**Never rewrite an existing entry.** The diff for past releases must be purely additive. The unreleased section you are writing is the one you may still edit before the commit.

Also update the version, date, and "What's new" blurb in `README.md` when the user-facing story changed.

## Step 2 — lint and the security check

```bash
npm run lint
npm run test:cbapp-security
```

`npm run lint` is `eslint cbapp.html --max-warnings=0`. `consistent-return` and `no-await-in-loop` are warnings, so a warning fails the script.

ESLint's report locations are remapped to `cbapp.html` lines. A line number quoted *inside* a rule message is an offset into the extracted script. Add the `<script>` line (5211 in v4.8.0) to get the real one. Re-check that line if markup moves above the script.

`scripts/cbapp-security-check.mjs` syntax-checks the inline script, checks the CSP and backup rules, and round-trips AES-GCM at 600,000 PBKDF2 iterations plus a legacy 210,000 round trip. New passphrases in the app are at least 12 characters. Unlock does not enforce that minimum.

## Step 3 — tests, all projects

```bash
npx playwright test tests/cbapp.spec.ts --reporter=line
```

The config serves the repo with `python` on Windows and `python3` everywhere else. `python -m http.server` is single-threaded and is not what this suite uses.

Nine projects: `desktop`, `mobile`, `mobile-landscape`, `iphone`, `iphone-se`, `ipad`, `ipad-small`, `firefox`, `webkit`. All of them are gates. A green desktop run means very little on its own.

**Read the summary counts, not the tail of the output.** With `--reporter=line`, a failure and a skip can look alike. Use:

```bash
npx playwright test tests/cbapp.spec.ts --reporter=line | grep -E "^  [0-9]+ (passed|failed|skipped|flaky)"
```

Accessibility:

```bash
npm run test:cbapp:a11y
```

Visual baselines are separate and are **not** part of the default gate:

```bash
npm run test:cbapp:visual
```

The PNGs in `tests/cbapp-visual.spec.ts-snapshots/` are Windows (`win32`) baselines. Playwright names snapshots by the runner's platform. A Linux run looks for `*-linux.png` and fails because those files are absent. That is not a pixel comparison against the win32 shots. Do not pass `--update-snapshots` on Linux or macOS. Refresh the win32 files only on Windows, and only when the desk itself changed. The v4.8.0 origin notice is hidden in the visual harness so it does not force that refresh.

### Failures that have looked like app bugs

- `fontFamily` assertions on WebKit include quotes the other engines omit. Compare the family name, not the raw computed string.
- A 1px border on the iPad (gen 11) project (`deviceScaleFactor` 2.5) computes to 0.8px. Assert a hairline, not the string `"1px"`.
- `phoneShaped()` restates the app's breakpoint. Playwright's `isMobile` is true for iPad, and the app's desktop layout is what an iPad Pro 11 gets. Do not gate phone behaviour on `isMobile` alone.
- An installed iPhone draws under the status bar. Tests fake that with `--safe-top: 47px`. Nothing in Playwright emulates the real notch.
- `file://` is a null origin. Pages opened that way share localStorage, `isSecureContext` is true in Chromium, and blob URLs become `blob:null/...`, which is a different origin from the page. The manifest is not installed from `file://`.
- The app is offline. Do not add a network call to make a test pass.
- `window.onload` is async. `waitUntil: 'load'` returns before restore finishes. Wait for the note or the modal.
- Planting a localStorage envelope while a device-key save is in flight lets that save overwrite the plant. Set `sessionLocked = true` before `setItem` when the test is seeding ciphertext.
- On `http://localhost` the origin notice is visible until the tab dismisses it. `openFresh()` clicks "Not now". A test of the notice itself must not use `openFresh()`.

## Step 4 — commit and push

Commit the files this release touched (`cbapp.html`, `CHANGELOG.md`, `README.md`, tests, and tooling when those changed). Push the branch. Do not merge unless the user asked.

Do not configure Cloudflare, Nginx, or DNS for `cbapp.phbeks.com`. Say that the file is ready and that the host is Philip's to point at this build.
