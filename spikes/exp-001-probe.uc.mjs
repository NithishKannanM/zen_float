// ==UserScript==
// @name           EXP-001 Zen Float Global/Timing Probe
// @description    DISPOSABLE SPIKE. Validates fx-autoconfig privileged load + Zen global reachability + safe init hook. NOT production.
// @include        main
// @onlyonce
// ==/UserScript==
//
// EXP-001 — Verify privileged globals & determine the safe init hook.
// Install fx-autoconfig (or Sine), drop this in <profile>/chrome/JS/, restart Zen.
// Read output either in Browser Console (Ctrl+Shift+J) OR on terminal stdout if launched
// with browser.dom.window.dumps.enabled=true (see spikes/EXP-001-RUNBOOK.md).
// Delete after reading. No abstractions, no cleanup, maximum logging.

(() => {
  const TAG = "[EXP-001]";
  const t0 = (globalThis.performance?.now?.() ?? Date.now());
  const now = () => ((globalThis.performance?.now?.() ?? Date.now()) - t0).toFixed(1) + "ms";

  // Dual-sink logging so the run is either capturable to a file (dump->stdout) or readable live.
  const _consoleLog = (globalThis.console && globalThis.console.log) || function () {};
  const P = (...a) => {
    const s = a.map((x) => (typeof x === "string" ? x : (() => { try { return JSON.stringify(x); } catch { return String(x); } })())).join(" ");
    try { dump(s + "\n"); } catch {}
    try { _consoleLog.apply(globalThis.console, a); } catch {}
  };

  // Globals every downstream ticket depends on: name + a liveness accessor + human label.
  const GLOBALS = [
    ["gBrowser",                    (g) => g?.tabs?.length,        "tabs.length"],
    ["gZenGlanceManager",           (g) => typeof g?.openGlance,   "typeof openGlance"],
    ["gZenWorkspaces",              (g) => typeof g?.init,         "typeof init (Spaces global)"],
    ["gZenViewSplitter",            (g) => typeof g,               "typeof splitter"],
    ["gZenKeyboardShortcutsManager",(g) => typeof g?.setShortcut,  "typeof setShortcut"],
    ["gZenMods",                    (g) => typeof g?.getMods,      "typeof getMods"],
    ["gZenStartup",                 (g) => typeof g,               "typeof startup"],
  ];

  function probe(label) {
    let ctx;
    try {
      ctx = {
        windowtype: document?.documentElement?.getAttribute?.("windowtype"),
        href: window?.location?.href,
        privileged: (typeof Components !== "undefined") && (typeof ChromeUtils !== "undefined"),
      };
    } catch (e) { ctx = { error: String(e) }; }
    P(`${TAG} ── checkpoint: ${label} @ ${now()}`, ctx);

    for (const [name, live, desc] of GLOBALS) {
      let defined = false, val;
      try {
        const g = globalThis[name] ?? window[name];
        defined = typeof g !== "undefined" && g !== null;
        val = defined ? (() => { try { return live(g); } catch (e) { return "THREW:" + e.message; } })() : undefined;
      } catch (e) { val = "ACCESS_THREW:" + e.message; }
      P(`${TAG}   ${defined ? "OK " : "NO "} ${name.padEnd(30)} ${defined ? `(${desc} = ${String(val)})` : "= undefined"}`);
    }
  }

  // Can we reach Zen's base-class module? (validates v2 base-class-extension path)
  function probeBaseClasses() {
    const paths = [
      "chrome://browser/content/ZenCommonUtils.mjs",
      "resource:///modules/zen/ZenCommonUtils.mjs",
      "chrome://browser/content/zen-components/ZenCommonUtils.mjs",
    ];
    for (const p of paths) {
      try {
        const mod = ChromeUtils.importESModule(p, { global: "current" });
        const feat = Object.keys(mod).filter((k) => /Feature/.test(k));
        P(`${TAG}   OK base-class module importable: ${p} -> ${feat.join(", ") || Object.keys(mod).join(",")}`);
        return;
      } catch (e) { P(`${TAG}   .. base-class import failed: ${p} (${e.message})`); }
    }
    P(`${TAG}   NO base classes not reachable from any known path -> v2 must self-init.`);
  }

  P(`${TAG} ================ SPIKE LOADED (privileged=${typeof ChromeUtils !== "undefined"}) ================`);

  // CP1: import/execution time.
  probe("IMPORT_TIME");
  try { probeBaseClasses(); } catch (e) { P(`${TAG} probeBaseClasses threw: ${e.message}`); }

  // CP2: DOMContentLoaded (nsZenDOMOperatedFeature / Glance init tick).
  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", () => probe("DOMContentLoaded"), { once: true });
  } else {
    P(`${TAG} (DOMContentLoaded already passed at import; readyState=${document.readyState})`);
    probe("DOMContentLoaded_ALREADY_PASSED");
  }

  // CP3: first paint.
  window.addEventListener("MozAfterPaint", () => probe("MozAfterPaint(first)"), { once: true });

  // CP4: predicted SAFE hook — delayed startup finished (post session-restore).
  try {
    const obs = {
      observe(subject) {
        if (subject === window) {
          Services.obs.removeObserver(obs, "browser-delayed-startup-finished");
          probe("browser-delayed-startup-finished  *PREDICTED_SAFE_HOOK*");
        }
      },
    };
    Services.obs.addObserver(obs, "browser-delayed-startup-finished");
    P(`${TAG} subscribed to browser-delayed-startup-finished`);
  } catch (e) { P(`${TAG} could not subscribe to delayed-startup: ${e.message}`); }

  // Cross-check: when does session restore actually resolve, relative to the above?
  try {
    if (window.SessionStore?.promiseAllWindowsRestored) {
      SessionStore.promiseAllWindowsRestored.then(() => probe("SessionStore.promiseAllWindowsRestored RESOLVED"));
    }
  } catch (e) { P(`${TAG} SessionStore promise unavailable: ${e.message}`); }

  P(`${TAG} listeners armed; watch stdout/console during startup.`);
})();
