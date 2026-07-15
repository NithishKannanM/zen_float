// ==UserScript==
// @name           Zen Float
// @description    Persistent floating browser companion for Zen. v1 privileged userChrome script (fx-autoconfig/Sine).
// @include        main
// @version        0.0.2
// @author         Zen Float
// ==/UserScript==
//
// ZF-001 — Bootstrap: manager scaffold + feature flag + ready hook.
// ZF-002 — Overlay skeleton: FloatWindow shell (hidden .zen-float-overlay host).
// Still no nested <browser> / UI — that is ZF-020 (uses the EXP-002 host recipe).
//
// Grounded in live-runtime findings (EXP-001/002, Zen 1.21.6b):
//   - Safe init hook = "browser-delayed-startup-finished" (fires post session-restore,
//     after every Zen manager's init()). Confirmed by ZenStartup source + probes.
//   - Required globals verified reachable in chrome scope:
//     gBrowser, gZenGlanceManager, gZenWorkspaces, gZenViewSplitter, gZenKeyboardShortcutsManager.
//   - gZenWorkspaces exposes addChangeListeners/removeChangeListeners (used by ZF-060+).

"use strict";

const XHTML_NS = "http://www.w3.org/1999/xhtml";

/**
 * ZF-002 — FloatWindow (shell only).
 * Owns the `.zen-float-overlay` host element (position:fixed, hidden by default),
 * mirroring Glance's overlay contract. No nested <browser> yet — that lands in ZF-020,
 * which will attach a browser built with the recipe validated in EXP-002.
 */
class FloatWindow {
  static OVERLAY_CLASS = "zen-float-overlay";
  static STYLE_ID = "zen-float-styles";
  static STYLES = `
    .zen-float-overlay {
      position: fixed;
      inset: auto 24px 24px auto;      /* bottom-right default; DockController owns this later */
      width: 420px; height: 640px;
      min-width: 280px; min-height: 360px;
      z-index: 2147483646;
      border-radius: 12px;
      overflow: hidden;
      background: Field;
      box-shadow: 0 12px 48px rgba(0, 0, 0, 0.35);
      contain: layout style;           /* isolate from page layout */
    }
    .zen-float-overlay[hidden] { display: none; }
  `;

  #overlay = null;

  #injectStyles() {
    if (document.getElementById(FloatWindow.STYLE_ID)) {
      return;
    }
    const style = document.createElementNS(XHTML_NS, "style");
    style.id = FloatWindow.STYLE_ID;
    style.textContent = FloatWindow.STYLES;
    document.documentElement.appendChild(style);
  }

  /** Create the hidden overlay host if absent. Idempotent. */
  ensureShell() {
    if (this.#overlay && this.#overlay.isConnected) {
      return this.#overlay;
    }
    this.#injectStyles();
    const host = document.getElementById("tabbrowser-tabpanels") || document.documentElement;
    const el = document.createElementNS(XHTML_NS, "div");
    el.className = FloatWindow.OVERLAY_CLASS;
    el.setAttribute("hidden", "true");
    host.appendChild(el);
    this.#overlay = el;
    return el;
  }

  get visible() {
    return !!this.#overlay && !this.#overlay.hasAttribute("hidden");
  }

  show() {
    this.ensureShell();
    this.#overlay.removeAttribute("hidden");
    return this.visible;
  }

  hide() {
    if (this.#overlay) {
      this.#overlay.setAttribute("hidden", "true");
    }
    return this.visible;
  }

  toggle() {
    return this.visible ? this.hide() : this.show();
  }

  /** Full teardown — remove the overlay (styles left; cheap and shared). */
  destroy() {
    if (this.#overlay) {
      this.#overlay.remove();
      this.#overlay = null;
    }
  }
}

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
  floatWindow = null; // ZF-002 FloatWindow shell (created at init when enabled)

  constructor() {
    // fx-autoconfig runs us at DOMContentLoaded — before delayed-startup. Subscribe now
    // and let the observer fire init() once this window's startup settles.
    this.#armReadyHook();
    // Teardown hygiene: drop the observer if the window closes before delayed-startup
    // fires, and tear down the overlay so nothing references a dead window.
    window.addEventListener(
      "unload",
      () => {
        this.#disarmReadyHook();
        this.floatWindow?.destroy();
      },
      { once: true }
    );
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
   * Gates on the flag, feature-detects internals, then (ZF-002) builds the overlay shell.
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

    // ZF-002: create the hidden overlay shell. ZF-020 will attach the nested <browser>.
    this.floatWindow = new FloatWindow();
    this.floatWindow.ensureShell();
    this.#log("init — internals present; overlay shell ready (hidden).");
  }

  /**
   * ZF-002 debug affordance: toggle the (empty) overlay shell from the Browser Console.
   * Returns the resulting visibility. Real toggling/UI lands in ZF-070/ZF-080.
   */
  _debugToggleOverlay() {
    if (!this.floatWindow) {
      this.#log("_debugToggleOverlay: no overlay (is zen.float.enabled true and init done?)");
      return false;
    }
    const visible = this.floatWindow.toggle();
    this.#log("_debugToggleOverlay:", visible ? "shown" : "hidden");
    return visible;
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
