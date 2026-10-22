import js from "@eslint/js";
import html from "eslint-plugin-html";
import globals from "globals";

/**
 * ESLint for CB App.
 *
 * CB App is one HTML file with a single inline <script> block
 * (cbapp.html:5211 in v4.8.0). eslint-plugin-html lints that block in place
 * and maps reported line numbers back to the HTML file, so nothing has to be
 * extracted to a temp file first and the line numbers you get are the ones
 * you edit. Re-check the script line if markup is added above it.
 *
 * Two things about this file shape drive the rule choices below:
 *
 *   1. The script is `type="text/javascript"`, not a module, so its top level
 *      is GLOBAL scope, not module scope.
 *   2. ~98 functions are wired up through inline `onclick="..."` attributes,
 *      many of them inside `innerHTML` template literals. ESLint cannot see
 *      those references, so every one of those functions looks unused to it.
 *
 * Hence `no-unused-vars: { vars: "local" }` — unused *locals* inside functions
 * are real signal; unused top-level declarations are almost always an inline
 * handler and would be 98 false positives.
 *
 * TRAP — two kinds of line number come out of a run, and only one is remapped.
 * The location at the head of each report ("7903:13") IS remapped to real
 * cbapp.html lines. A line number quoted *inside a rule's message text* is NOT;
 * it is an offset into the extracted script. Add 5211 (the `<script>` line in
 * v4.8.0) to get the real one. An older copy of this comment said 3605; that
 * was the script line before the file grew. Do not look up the un-added
 * offset in the HTML — that lands in CSS, and the tool looks broken.
 */
export default [
  {
    ignores: [
      "node_modules/**",
      "test-results/**",
      "playwright-report/**",
      "vendor/**",
      "junk/**",
      "matter.min.js",
    ],
  },

  {
    files: ["cbapp.html"],
    plugins: { html },
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "script",
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      ...js.configs.recommended.rules,

      // Top-level declarations are reachable from inline HTML handlers that
      // ESLint cannot see. Locals are fair game.
      "no-unused-vars": [
        "error",
        {
          vars: "local",
          args: "after-used",
          caughtErrors: "none",
          ignoreRestSiblings: true,
        },
      ],

      // --- Bug-shaped rules, the reason this was wired up at all ---
      eqeqeq: ["error", "always", { null: "ignore" }],
      // NOT no-implicit-globals: this app's ~98 inline `onclick=` handlers can
      // only resolve against global function declarations, so that rule fires
      // 242 times against the architecture rather than against any defect.
      "no-shadow": "error",
      "no-var": "error",
      "prefer-const": ["error", { destructuring: "all" }],
      "no-throw-literal": "error",
      "no-return-assign": ["error", "always"],
      "no-unmodified-loop-condition": "error",
      "no-constructor-return": "error",
      "no-self-compare": "error",
      "no-template-curly-in-string": "error",
      "array-callback-return": "error",
      // Warn, not error: the add*() window builders return the new element on
      // the happy path and bare-return on their guard paths. Callers almost
      // all ignore the return value, so this is an inconsistency worth seeing
      // rather than a defect worth blocking on.
      "consistent-return": "warn",
      // Warn: several of these are deliberate sequential crypto/IO steps that
      // must not be parallelised.
      "no-await-in-loop": "warn",

      // --- Security invariants this app actually claims to hold ---
      // The app is offline-only under a CSP with connect-src 'none'; eval and
      // friends would be both a CSP violation and a policy break.
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "no-script-url": "error",
    },
  },
];
