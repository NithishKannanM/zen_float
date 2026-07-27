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
 * ZF-022a — BrowserHost. Owns the float's hidden tab and its `<browser>`, and is the ONLY
 * component that holds a strong browser reference or calls browser APIs.
 *
 * Extracted from FloatWindow (ZF-020) with NO behavioural change: same EXP-002 spawn recipe,
 * same C1 no-move model (the `<browser>` is never reparented), same teardown semantics
 * including the ZF-021d fatal path (`removeTab:false`).
 *
 * Deliberately does NOT: write rendering attributes (EnrollmentManager owns deck-selected /
 * docShellIsActive / zenModeActive), style anything (FloatWindow owns the geometry class), or
 * read page metadata (TargetRegistry owns that — it borrows the browser through this host).
 */
class BrowserHost {
  static TAB_ATTR = "zen-float-tab"; // hides the tab from the strip (CSS, ZF-020c)

  #tab = null;
  #browser = null;
  #container = null; // the tab's OWN .browserSidebarContainer (never reparented)

  get alive() {
    return !!this.#browser;
  }
  get tab() {
    return this.#tab;
  }
  get browser() {
    return this.#browser;
  }
  get container() {
    return this.#container;
  }

  /**
   * Spawn the hidden tab + browser via the EXP-002 recipe. Idempotent: a second call while
   * one is alive returns the existing browser (single float, cap = 1). Returns null on
   * failure, leaving nothing behind (transactional).
   */
  spawn(url) {
    if (this.#browser) {
      return this.#browser;
    }
    const gBrowser = window.gBrowser;
    if (!gBrowser) {
      return null;
    }
    let tab;
    try {
      tab = gBrowser.addTab(url, {
        triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
        skipBackgroundNotify: true,
        insertTab: true,
        skipAnimation: true,
        ownerTab: gBrowser.selectedTab,
      });
    } catch (_) {
      return null; // caller logs
    }
    this.#tab = tab;
    this.#tab.setAttribute(BrowserHost.TAB_ATTR, "true");
    this.#browser = tab.linkedBrowser;
    this.#container = this.#browser.closest(".browserSidebarContainer");
    return this.#browser;
  }

  /** Borrowed handle for EnrollmentManager (ZF-021). The host stays the owner. */
  handle() {
    return { tab: this.#tab, browser: this.#browser, container: this.#container };
  }

  /**
   * ZF-022 — reload the hosted page. The only navigation API the float exposes in this
   * milestone; FloatChrome reaches it through FloatWindow and never holds a browser.
   */
  reload() {
    try {
      this.#browser?.reload();
      return true;
    } catch (_) {
      return false;
    }
  }

  /**
   * Drop the tab + browser. `removeTab:false` is the ZF-021d fatal path (tabbrowser is
   * already closing our tab — see FloatWindow.detach for why re-entering removeTab there
   * corrupts tabbrowser's close sequence). References are nulled before the removal so a
   * re-entrant teardown finds nothing to do.
   */
  teardown({ removeTab = true } = {}) {
    const tab = this.#tab;
    this.#browser = null;
    this.#container = null;
    this.#tab = null;
    if (tab && removeTab) {
      try {
        window.gBrowser?.removeTab(tab);
      } catch (_) {}
    }
  }
}

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

    /* The float's tab is a real tab (no-move) but must not clutter the tab strip. */
    [zen-float-tab="true"] { display: none !important; }
  `;

  // Composition + lifecycle only (ZF-022 ownership matrix):
  //   BrowserHost → browser instance | EnrollmentManager → rendering attributes
  //   TargetRegistry → metadata      | FloatChrome → presentation | FloatWindow → this
  #frame = null;
  #host = new BrowserHost(); // ZF-022a: owns the tab + <browser> (no-move)
  #enrollment = null; // ZF-021 render-contract maintainer (borrows the host handle)
  #geometryTarget = null; // the node WE classed with .zen-float-browser (geometry is ours)

  get hasBrowser() {
    return this.#host.alive;
  }

  /** Read-only access for the manager's debug/logging paths. Never handed to Chrome. */
  get host() {
    return this.#host;
  }

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

  /**
   * ZF-020 — spawn ONE nested <browser> for `url` using the EXP-002 recipe and render it
   * via the C1 no-move model: the browser stays in its own tab container; we add
   * `.zen-float-browser` to that container so its inner `.browserContainer` floats via the
   * shared geometry vars. The browser is NEVER moved. Returns the browser, or null on failure.
   * Single float (cap = 1): a second call while one is open is a no-op.
   */
  attachTarget(url) {
    if (this.#host.alive) {
      return this.#host.browser;
    }
    this.ensureShell();

    const browser = this.#host.spawn(url);
    if (!browser) {
      return null; // caller logs; leave the frame shell intact (transactional).
    }

    try {
      // No-move: style the tab's OWN container for float GEOMETRY (positioning only).
      // We cache the node we classed — the host may drop its reference before we unclass.
      this.#geometryTarget = this.#host.container;
      if (this.#geometryTarget) {
        this.#geometryTarget.classList.add(FloatWindow.BROWSER_CLASS);
      }
      // Render enrollment + compositing + persistence are owned by EnrollmentManager (ZF-021).
      // onFatal = "our tab is being closed by someone else": tear down without touching the tab.
      this.#enrollment = new EnrollmentManager(() => this.detach({ removeTab: false }));
      this.#enrollment.enroll(this.#host.handle());
      this.show();
      return browser;
    } catch (_) {
      this.detach(); // roll back any partial attach
      return null;
    }
  }

  /**
   * Tear down the hosted browser (no-move reverse): unenroll, unclass, remove tab, hide.
   * `removeTab:false` is the fatal path (EnrollmentManager `onFatal`): tabbrowser is already
   * closing our tab, so we only drop references. Calling `removeTab` there would re-enter
   * `tabbrowser.removeTab`, hit its "synchronously remove an already asynchronously closing
   * tab" fastpath (`if (!animate && aTab.closing) { this._endRemoveTab(aTab); return; }` —
   * `animate` has no default, so it is undefined here) and destroy the browser *inside* the
   * outer `_beginRemoveTab`, which then throws on `browser.webProgress` (verified on 1.21.7b).
   */
  detach({ removeTab = true } = {}) {
    // EnrollmentManager clears deck-selected + docShellIsActive + zenModeActive and disarms hooks.
    if (this.#enrollment) {
      this.#enrollment.destroy();
      this.#enrollment = null;
    }
    if (this.#geometryTarget) {
      this.#geometryTarget.classList.remove(FloatWindow.BROWSER_CLASS); // geometry class (ours)
      this.#geometryTarget = null;
    }
    this.#host.teardown({ removeTab });
    this.hide();
  }

  /** Public close entry point (ZF-022). Routes through the one teardown path. */
  close() {
    this.detach();
  }

  /** Full teardown — detach the browser, then remove the frame (shared styles left in place). */
  destroy() {
    this.detach();
    if (this.#frame) {
      this.#frame.remove();
      this.#frame = null;
    }
  }
}

/**
 * ZF-021 — EnrollmentManager.
 * Maintains ONLY the proven render contract for one borrowed BrowserHost handle:
 *   render enrollment  = `deck-selected` on the .browserSidebarContainer
 *   content compositing = docShellIsActive === true
 *   persistence         = zenModeActive === true   (survives AsyncTabSwitcher deselection)
 * It does NOT own the BrowserHost: it never creates/removes tabs and never writes
 * gBrowser.selectedTab. Design: design/ZF-021-RENDER-LIFECYCLE.md. All methods idempotent;
 * event-driven only (no timers, no polling, no retries).
 */
class EnrollmentManager {
  static ENROLL_CLASS = "deck-selected"; // NOT zen-split (owned by Split View)

  #handle = null; // borrowed { tab, browser, container }
  #state = "detached"; // detached | rendered | hidden
  #classObserver = null;
  #listeners = []; // [{ target, type, fn, opts }]
  #wsFn = null;
  #dirty = false;
  #onFatal = null;

  constructor(onFatal = null) {
    this.#onFatal = onFatal;
  }

  get state() {
    return this.#state;
  }

  // Re-resolve the container each time: a deck rebuild (split/customize/restore) can
  // replace the .browserSidebarContainer element under a stable <browser>.
  #container() {
    const b = this.#handle && this.#handle.browser;
    let c = null;
    try {
      c = b && b.closest && b.closest(".browserSidebarContainer");
    } catch (_) {}
    return c || (this.#handle && this.#handle.container) || null;
  }

  // Idempotent, conditional writes only (no write when already satisfied → no layout thrash).
  #applyContract() {
    const h = this.#handle;
    if (!h || !h.browser) {
      return;
    }
    const c = this.#container();
    if (c) {
      h.container = c;
      if (!c.classList.contains(EnrollmentManager.ENROLL_CLASS)) {
        c.classList.add(EnrollmentManager.ENROLL_CLASS);
      }
    }
    try {
      if (h.browser.zenModeActive !== true) {
        h.browser.zenModeActive = true;
      }
    } catch (_) {}
    try {
      if (h.browser.docShellIsActive !== true) {
        h.browser.docShellIsActive = true;
      }
    } catch (_) {}
  }

  #clearContract({ compositing = true } = {}) {
    const h = this.#handle;
    if (!h) {
      return;
    }
    const c = this.#container();
    if (c && c.classList.contains(EnrollmentManager.ENROLL_CLASS)) {
      c.classList.remove(EnrollmentManager.ENROLL_CLASS);
    }
    if (compositing && h.browser) {
      try {
        if (h.browser.docShellIsActive) {
          h.browser.docShellIsActive = false;
        }
      } catch (_) {}
      try {
        if (h.browser.zenModeActive) {
          h.browser.zenModeActive = false;
        }
      } catch (_) {}
    }
  }

  // ---- public API ----
  enroll(handle) {
    if (this.#handle && this.#handle !== handle) {
      this.unenroll();
    }
    this.#handle = handle;
    this.#applyContract();
    this.#state = "rendered";
    this.#armObserver(); // after the initial apply, so our own add doesn't self-trigger
    this.#armListeners();
    return this.#state;
  }

  unenroll() {
    this.#disarmObserver();
    this.#disarmListeners();
    this.#clearContract();
    this.#handle = null;
    this.#state = "detached";
  }

  reassert() {
    if (this.#state !== "rendered") {
      return false;
    }
    this.#applyContract();
    return true;
  }

  suspend() {
    if (!this.#handle || this.#state === "hidden") {
      return;
    }
    this.#clearContract({ compositing: true });
    this.#state = "hidden";
  }

  resume() {
    if (!this.#handle || this.#state === "rendered") {
      return;
    }
    this.#applyContract();
    this.#state = "rendered";
  }

  destroy() {
    this.unenroll();
    this.#onFatal = null;
  }

  isRendered() {
    const h = this.#handle;
    if (!h || !h.browser) {
      return false;
    }
    const c = this.#container();
    let dsa = false;
    let zma = false;
    try {
      dsa = h.browser.docShellIsActive === true;
    } catch (_) {}
    try {
      zma = h.browser.zenModeActive === true;
    } catch (_) {}
    return !!(c && c.classList.contains(EnrollmentManager.ENROLL_CLASS) && dsa && zma);
  }

  // Coalesce synchronous event bursts (e.g. rapid TabSelect) into one reassert via the
  // microtask queue. A microtask is not a timer/poll; it drains after the current task.
  #scheduleReassert() {
    if (this.#dirty) {
      return;
    }
    this.#dirty = true;
    Promise.resolve().then(() => {
      this.#dirty = false;
      this.reassert();
    });
  }

  // Fatal path (design §3 event matrix, §6 failure recovery): the float tab was closed by
  // something other than the owner ("close other tabs", a session op, adoption into another
  // window). tabbrowser dispatches TabClose from `_beginRemoveTab` *before any teardown* and
  // *after* setting `tab.closing = true` (tabbrowser.js: `aTab.closing = true` → dispatch),
  // so (a) the handle is still readable here and (b) the owner's `removeTab` in its teardown
  // path is short-circuited by the `aTab.closing` guard — no recursion, no double-remove.
  // Any other tab closing leaves the float untouched (design §3: "TabClose (other tab) → none").
  #onTabClose(event) {
    const h = this.#handle;
    if (!h || !event || event.target !== h.tab) {
      return;
    }
    const fatal = this.#onFatal;
    this.#onFatal = null; // fire at most once; the owner's teardown re-enters via destroy()
    this.unenroll(); // drop observer/listeners/contract first: never leave a live hook on a dead tab
    if (typeof fatal === "function") {
      try {
        fatal();
      } catch (_) {}
    }
  }

  // Synchronous, pre-paint backstop: if any third party (split/customize/restore/deck)
  // strips deck-selected, restore it before the frame paints → no flicker.
  #armObserver() {
    this.#disarmObserver(); // idempotent: never orphan a prior observer
    const c = this.#container();
    if (!c || typeof MutationObserver === "undefined") {
      return;
    }
    this.#classObserver = new MutationObserver(() => {
      if (this.#state !== "rendered") {
        return;
      }
      const cc = this.#container();
      if (cc && !cc.classList.contains(EnrollmentManager.ENROLL_CLASS)) {
        this.#applyContract();
      }
    });
    this.#classObserver.observe(c, { attributes: true, attributeFilter: ["class"] });
  }

  #disarmObserver() {
    if (this.#classObserver) {
      this.#classObserver.disconnect();
      this.#classObserver = null;
    }
  }

  // Approved hooks ONLY: TabSelect, TabClose, Workspace, MozDOMFullscreen, Customize Mode, unload.
  #armListeners() {
    this.#disarmListeners(); // idempotent: never double-register
    const add = (target, type, fn, opts) => {
      target.addEventListener(type, fn, opts);
      this.#listeners.push({ target, type, fn, opts });
    };
    add(window, "TabSelect", () => this.#scheduleReassert());
    add(window, "TabClose", (e) => this.#onTabClose(e));
    add(window, "MozDOMFullscreen:Entered", () => this.suspend());
    add(window, "MozDOMFullscreen:Exited", () => this.resume());
    const toolbox = window.gNavToolbox || document.getElementById("navigator-toolbox");
    if (toolbox) {
      add(toolbox, "customizationstarting", () => this.suspend());
      add(toolbox, "aftercustomization", () => this.resume());
    }
    add(window, "unload", () => this.destroy());
    try {
      const ws = window.gZenWorkspaces;
      if (ws && typeof ws.addChangeListeners === "function") {
        this.#wsFn = () => this.#scheduleReassert();
        ws.addChangeListeners(this.#wsFn, { once: false });
      }
    } catch (_) {}
  }

  #disarmListeners() {
    for (const { target, type, fn, opts } of this.#listeners) {
      try {
        target.removeEventListener(type, fn, opts);
      } catch (_) {}
    }
    this.#listeners = [];
    if (this.#wsFn) {
      try {
        window.gZenWorkspaces?.removeChangeListeners?.(this.#wsFn);
      } catch (_) {}
      this.#wsFn = null;
    }
  }
}

class nsZenFloatManager {
  // ---- constants --------------------------------------------------------
  static PREF_ENABLED = "zen.float.enabled";
  static PREF_DEBUG = "zen.float.debug";
  static READY_TOPIC = "browser-delayed-startup-finished";
  static DEFAULT_TARGET = "https://claude.ai/"; // single default until TargetRegistry (ZF-022)

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

  /**
   * ZF-020 — open the single float on `url` (default target if omitted). Spawns a live
   * nested <browser> via the no-move model. Returns true on success. Idempotent-ish:
   * a second open while one exists is a no-op at the FloatWindow layer (cap = 1).
   */
  openFloat(url) {
    if (!this.floatWindow) {
      this.#log("openFloat: not initialized (need zen.float.enabled + internals present)");
      return false;
    }
    const target = url || nsZenFloatManager.DEFAULT_TARGET;
    const browser = this.floatWindow.attachTarget(target);
    if (!browser) {
      this.#log("openFloat: spawn failed for", target);
      return false;
    }
    this.#log(
      "openFloat",
      target,
      "browsingContext=" + !!browser.browsingContext,
      "active=" + browser.docShellIsActive
    );
    return true;
  }

  /** ZF-020 — close the float and tear down its browser. */
  closeFloat() {
    if (!this.floatWindow) {
      return;
    }
    this.floatWindow.close();
    this.#log("closeFloat: detached");
  }

  /**
   * ZF-020 debug: toggle a REAL float (spawns/closes a live browser) from the Browser
   * Console. Distinct from _debugToggleOverlay (which only toggles the empty chrome frame).
   */
  _debugToggleFloat(url) {
    if (!this.floatWindow) {
      this.#log("_debugToggleFloat: no floatWindow (enabled + init?)");
      return false;
    }
    if (this.floatWindow.hasBrowser) {
      this.closeFloat();
      return false;
    }
    return this.openFloat(url);
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
