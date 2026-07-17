// ==UserScript==
// @name           Zen Float
// @description    Persistent floating browser companion for Zen. v1 privileged userChrome script (fx-autoconfig/Sine).
// @include        main
// @version        0.0.2
// @author         Zen Float
// ==/UserScript==
//
// ZF-001 — Bootstrap: manager scaffold + feature flag + ready hook.
// ZF-002 — Overlay skeleton: FloatWindow shell (hidden .zen-float-overlay chrome frame).
// C1     — No-move host model (Glance-faithful). The nested <browser> is NEVER reparented.
//          .zen-float-overlay is a CHROME FRAME only. ZF-020 will style the float tab's OWN
//          .browserSidebarContainer as the float (class .zen-float-browser), exactly like
//          Glance's .zen-glance-overlay: the inner .browserContainer is positioned fixed
//          using the SAME --zen-float-* geometry vars the frame reads, so frame and browser
//          align with no imperative syncing. Still no <browser>/UI yet — that is ZF-020.
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
 * FloatWindow — the float's CHROME FRAME (C1 no-move model).
 *
 * Owns a single `.zen-float-overlay` element: a position:fixed chrome frame (border,
 * shadow, and later the title bar / resize handles), hidden by default. It NEVER hosts
 * the nested <browser>. Per the C1 contract, ZF-020 will style the float tab's OWN
 * `.browserSidebarContainer` (class `.zen-float-browser`) so its inner `.browserContainer`
 * is positioned fixed via the same `--zen-float-*` geometry vars — the browser aligns with
 * this frame automatically and is never moved in the DOM (mirrors Glance's overlay).
 *
 * Frozen public API (ZF-020 review): ensureShell / show / hide / toggle / visible / destroy.
 */
class FloatWindow {
  static OVERLAY_CLASS = "zen-float-overlay"; // the chrome frame element
  static BROWSER_CLASS = "zen-float-browser"; // C1 contract: applied by ZF-020 to the float
  //                                             tab's .browserSidebarContainer. Inert here.
  static STYLE_ID = "zen-float-styles";
  static STYLES = `
    :root {
      /* Single source of truth for float geometry. DockController (ZF-040) updates these.
         Both the chrome frame and the (never-moved) browser container read them, so they
         stay aligned with no imperative syncing. */
      --zen-float-width: 420px;
      --zen-float-height: 640px;
      --zen-float-inset-block-end: 24px;
      --zen-float-inset-inline-end: 24px;
      --zen-float-radius: 12px;
      --zen-float-z: 2147483646;
    }

    /* Chrome frame ONLY — never a <browser> parent. */
    .zen-float-overlay {
      position: fixed;
      inset: auto var(--zen-float-inset-inline-end) var(--zen-float-inset-block-end) auto;
      width: var(--zen-float-width);
      height: var(--zen-float-height);
      min-width: 280px; min-height: 360px;
      z-index: var(--zen-float-z);
      border-radius: var(--zen-float-radius);
      overflow: hidden;
      background: Field;
      box-shadow: 0 12px 48px rgba(0, 0, 0, 0.35);
      contain: layout style;           /* isolate from page layout */
    }
    .zen-float-overlay[hidden] { display: none; }

    /* C1 no-move contract (applied by ZF-020, inert until then). Mirrors Glance:
       the float tab's own .browserSidebarContainer becomes the float; the inner
       .browserContainer is positioned fixed with the SAME geometry vars as the frame. */
    .browserSidebarContainer.zen-float-browser {
      visibility: visible !important;
      z-index: var(--zen-float-z);
      overflow: visible !important;
    }
    .browserSidebarContainer.zen-float-browser .browserContainer {
      position: fixed;
      inset: auto var(--zen-float-inset-inline-end) var(--zen-float-inset-block-end) auto;
      width: var(--zen-float-width);
      height: var(--zen-float-height);
      flex: unset !important;
    }
  `;

  #frame = null;

  #injectStyles() {
    if (document.getElementById(FloatWindow.STYLE_ID)) {
      return;
    }
    const style = document.createElementNS(XHTML_NS, "style");
    style.id = FloatWindow.STYLE_ID;
    style.textContent = FloatWindow.STYLES;
    document.documentElement.appendChild(style);
  }

  /** Create the hidden chrome frame if absent. Idempotent. */
  ensureShell() {
    if (this.#frame && this.#frame.isConnected) {
      return this.#frame;
    }
    this.#injectStyles();
    const el = document.createElementNS(XHTML_NS, "div");
    el.className = FloatWindow.OVERLAY_CLASS;
    el.setAttribute("hidden", "true");
    this.#attachHost().appendChild(el);
    this.#frame = el;
    return el;
  }

  // C3 — attach point for the chrome frame. `document.documentElement` is the only node
  // where position:fixed is *guaranteed* viewport-relative: as the DOM root it can never
  // have a transformed/filtered/contained ancestor, so the frame is immune to Zen's
  // compact-mode / workspace / glance transforms. It is tab-independent, outside Glance's
  // subtree, and a platform invariant (not a Zen-private id) — maximally update-proof.
  // Rejected: #tabbrowser-tabpanels (deck hides non-selected panels; animated),
  // #navigator-toolbox (compact-mode animated), #browser/#appcontent (descendant
  // transforms possible), #mainPopupSet (popup semantics). See reviews/BLOCKER-RESOLUTIONS.md.
  #attachHost() {
    return document.documentElement;
  }

  get visible() {
    return !!this.#frame && !this.#frame.hasAttribute("hidden");
  }

  show() {
    this.ensureShell();
    this.#frame.removeAttribute("hidden");
    return this.visible;
  }

  hide() {
    if (this.#frame) {
      this.#frame.setAttribute("hidden", "true");
    }
    return this.visible;
  }

  toggle() {
    return this.visible ? this.hide() : this.show();
  }

  /** Full teardown — remove the frame (shared styles left in place; cheap). */
  destroy() {
    if (this.#frame) {
      this.#frame.remove();
      this.#frame = null;
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
  // C2 — guarantee init() runs exactly once regardless of when this script loads relative
  // to window startup: normal startup, late injection (notification already fired),
  // secondary windows, and restored sessions.
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

    // Subscribe FIRST so there is no gap between the already-fired check and subscription.
    let subscribed = false;
    try {
      Services.obs.addObserver(this.#readyObserver, nsZenFloatManager.READY_TOPIC);
      subscribed = true;
    } catch (e) {
      this.#log("WARN could not subscribe to", nsZenFloatManager.READY_TOPIC, "-", e.message);
    }

    // Already-fired guard: if this window's delayed startup is already complete, the
    // notification is gone and the observer would never fire — init now. init() is
    // idempotent, so a redundant observer callback afterwards is harmless.
    let alreadyFinished = false;
    try {
      alreadyFinished = window.gBrowserInit?.delayedStartupFinished === true;
    } catch (_) {
      alreadyFinished = false;
    }
    if (alreadyFinished) {
      this.#disarmReadyHook();
      this.init();
      return;
    }

    // Neither the observer nor the readiness flag was usable — last-resort late init.
    if (!subscribed) {
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
