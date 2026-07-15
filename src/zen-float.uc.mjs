// ==UserScript==
// @name           Zen Float
// @description    Persistent floating browser companion for Zen. v1 privileged userChrome script (fx-autoconfig/Sine).
// @include        main
// @version        0.0.1
// @author         Zen Float
// ==/UserScript==
//
// ZF-001 — Bootstrap: manager scaffold + feature flag + ready hook.
// Scope is deliberately minimal: this ticket only proves the script loads, gates on the
// feature flag, initializes exactly once at the correct startup moment, and feature-detects
// the Zen internals later tickets depend on. No overlay, no browser, no UI yet (ZF-002+).
//
// Grounded in live-runtime findings (EXP-001/002, Zen 1.21.6b):
//   - Safe init hook = "browser-delayed-startup-finished" (fires post session-restore,
//     after every Zen manager's init()). Confirmed by ZenStartup source + probes.
//   - Required globals verified reachable in chrome scope:
//     gBrowser, gZenGlanceManager, gZenWorkspaces, gZenViewSplitter, gZenKeyboardShortcutsManager.
//   - gZenWorkspaces exposes addChangeListeners/removeChangeListeners (used by ZF-060+).

"use strict";

class nsZenFloatManager {
  // ---- constants --------------------------------------------------------
  static PREF_ENABLED = "zen.float.enabled";
  static PREF_DEBUG = "zen.float.debug";
  static READY_TOPIC = "browser-delayed-startup-finished";

  // Zen internals ZF depends on. Presence is feature-detected at init so a browser
  // update that renames one degrades gracefully (disable + notice) instead of throwing.
  static REQUIRED_GLOBALS = [
    "gBrowser",
    "gZenGlanceManager",
    "gZenWorkspaces",
    "gZenViewSplitter",
    "gZenKeyboardShortcutsManager",
  ];

  // ---- state ------------------------------------------------------------
  #initialized = false;
  #readyObserver = null;
  capabilities = null; // { globalName: boolean } — populated at init for later tickets

  constructor() {
    // fx-autoconfig runs us at DOMContentLoaded — before delayed-startup. Subscribe now
    // and let the observer fire init() once this window's startup settles.
    this.#armReadyHook();
    // Teardown hygiene: if this window closes before delayed-startup fires, drop the
    // observer so it never references a dead window.
    window.addEventListener("unload", () => this.#disarmReadyHook(), { once: true });
  }

  // ---- logging (dual sink: Browser Console + terminal stdout via dump) ---
  get #debug() {
    try {
      return Services.prefs.getBoolPref(nsZenFloatManager.PREF_DEBUG, false);
    } catch (_) {
      return false;
    }
  }

  #log(...args) {
    const msg = ["[ZenFloat]", ...args];
    try {
      console.log(...msg);
    } catch (_) {}
    try {
      dump(msg.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ") + "\n");
    } catch (_) {}
  }

  #trace(...args) {
    if (this.#debug) {
      this.#log(...args);
    }
  }

  // ---- lifecycle --------------------------------------------------------
  #armReadyHook() {
    this.#readyObserver = {
      observe: (subject, topic) => {
        // delayed-startup fires per-window; only react to OUR window.
        if (topic === nsZenFloatManager.READY_TOPIC && subject === window) {
          this.#disarmReadyHook();
          this.init();
        }
      },
    };
    try {
      Services.obs.addObserver(this.#readyObserver, nsZenFloatManager.READY_TOPIC);
    } catch (e) {
      // If the observer can't be added, fall back to a best-effort late init so the
      // script still functions (worst case: slightly earlier than ideal).
      this.#log("WARN could not subscribe to", nsZenFloatManager.READY_TOPIC, "-", e.message);
      window.addEventListener("load", () => this.init(), { once: true });
    }
  }

  #disarmReadyHook() {
    if (this.#readyObserver) {
      try {
        Services.obs.removeObserver(this.#readyObserver, nsZenFloatManager.READY_TOPIC);
      } catch (_) {}
      this.#readyObserver = null;
    }
  }

  get enabled() {
    try {
      return Services.prefs.getBoolPref(nsZenFloatManager.PREF_ENABLED, false);
    } catch (_) {
      return false;
    }
  }

  /**
   * Idempotent. No-ops when the feature flag is off. Runs once, at delayed-startup.
   * ZF-001 scope: gate + feature-detect only. Real wiring lands in ZF-002+.
   */
  init() {
    if (this.#initialized) {
      return;
    }
    this.#initialized = true;

    if (!this.enabled) {
      this.#trace("disabled (", nsZenFloatManager.PREF_ENABLED, "=false) — no-op");
      return;
    }

    this.capabilities = this.#detectCapabilities();
    const missing = Object.entries(this.capabilities)
      .filter(([, present]) => !present)
      .map(([name]) => name);

    if (missing.length) {
      // Graceful degradation (seed of ZF-114): never throw on a renamed internal.
      this.#log(
        "WARN missing Zen internals:",
        missing.join(", "),
        "— Zen Float will stay dormant on this build."
      );
      return;
    }

    this.#log("init — all internals present; ready for ZF-002 overlay.");
    // ZF-002+ will build the overlay / FloatWindow here.
  }

  #detectCapabilities() {
    const caps = {};
    for (const name of nsZenFloatManager.REQUIRED_GLOBALS) {
      let present = false;
      try {
        present = typeof window[name] !== "undefined" && window[name] !== null;
      } catch (_) {
        present = false;
      }
      caps[name] = present;
    }
    this.#trace("capabilities:", caps);
    return caps;
  }
}

// Per-window singleton (fx-autoconfig loads this script once per browser window; core v2
// will register via ZenPreloadedScripts and may extend nsZenMultiWindowFeature instead).
if (!window.gZenFloatManager) {
  window.gZenFloatManager = new nsZenFloatManager();
}
