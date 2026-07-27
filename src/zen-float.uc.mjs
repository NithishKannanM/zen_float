// ==UserScript==
// @name           Zen Float
// @description    Persistent floating browser companion for Zen. v1 privileged userChrome script (fx-autoconfig/Sine).
// @include        main
// @version        0.0.3
// @author         Zen Float
// ==/UserScript==
//
// ZF-001 — Bootstrap: manager scaffold + feature flag + ready hook.
// ZF-002 — Overlay skeleton: FloatWindow shell (hidden .zen-float-overlay chrome frame).
// ZF-022 — Ownership matrix, enforced structurally (one class per concern):
//          BrowserHost → the tab + <browser> (the ONLY strong browser reference)
//          EnrollmentManager → the three render attributes (ZF-021)
//          TargetRegistry → page metadata (url/title/favicon/loading), event-driven
//          FloatChrome → presentation (title bar), holds no browser/tab reference
//          FloatWindow → composition, geometry and lifecycle; wires the four together.
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
      --zen-float-chrome-height: 32px; /* ZF-022 title bar; reserved out of the browser box */
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
      /* ZF-022: transparent + inert. The frame sits ON TOP of the (never-moved) browser, so
         an opaque background hid the page (defect F-1) and any pointer surface would have
         eaten its clicks. Only FloatChrome re-enables pointer events, for its own bar. */
      background: transparent;
      pointer-events: none;
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
      /* Bottom-anchored, so shrinking by the bar height frees exactly the top strip the
         ZF-022 title bar occupies — the two stay aligned with no imperative syncing. */
      height: calc(var(--zen-float-height) - var(--zen-float-chrome-height));
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
  #registry = null; // ZF-022 metadata layer (borrows the host)
  #chrome = null; // ZF-022 title bar (presentation only; no browser reference)
  #geometryTarget = null; // the node WE classed with .zen-float-browser (geometry is ours)

  get hasBrowser() {
    return this.#host.alive;
  }

  /** Read-only access for the manager's debug/logging paths. Never handed to Chrome. */
  get host() {
    return this.#host;
  }

  /** ZF-022 — read-only metadata surface (manager debug + validation). */
  get registry() {
    return this.#registry;
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
      // ZF-022 — metadata then presentation. The registry borrows the host; the chrome only
      // ever sees the registry + two owner callbacks, so it can never reach the browser.
      this.#registry = new TargetRegistry();
      this.#registry.attach(this.#host);
      this.#chrome = new FloatChrome({
        onClose: () => this.close(),
        onReload: () => this.#host.reload(),
      });
      this.#chrome.attach(this.#frame, this.#registry);
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
    // ZF-022 teardown order is deliberate: presentation, then metadata, then rendering, then
    // the host. The registry must unhook while the browser is still alive — on the fatal path
    // TabClose fires BEFORE any teardown (tabbrowser.js), so this still holds there.
    if (this.#chrome) {
      this.#chrome.detach();
      this.#chrome = null;
    }
    if (this.#registry) {
      this.#registry.detach();
      this.#registry = null;
    }
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

/**
 * ZF-022 — TargetRegistry. Metadata layer for the float's page: URL, title, favicon and
 * loading state, each with a `lastUpdated` stamp. It BORROWS the browser from BrowserHost at
 * attach time; it never creates or removes tabs, never touches the render contract (ZF-021's
 * three attributes), and nulls its browser reference on detach. Event-driven only — no
 * polling, no timers, no retries. Extends EventTarget and emits CustomEvents:
 *   "target-location" {url, previous, sameDocument} · "target-title"   {title, previous}
 *   "target-favicon"  {favicon, previous}           · "target-loading" {loading}
 *
 * Source-verified behaviour (shipped 1.21.7b archives; cited because none of it is obvious):
 * - **Load state:** tabbrowser's own TabProgressListener treats `STATE_START|STATE_IS_NETWORK`
 *   and `STATE_STOP|STATE_IS_NETWORK` on an `isTopLevel` webProgress as page-load begin/end
 *   (`tabbrowser.js:9647` / `:9724`). We apply the same test rather than inventing one.
 * - **Title:** content fires `pagetitlechanged` on the browser; tabbrowser turns that into
 *   `setTabTitle()` → `_setTabLabel()` → `_tabAttrModified(tab, ["label"])`
 *   (`tabbrowser.js:9009`, `:2472`), dispatched as a bubbling `TabAttrModified` CustomEvent
 *   on the TAB (`:2243`).
 * - **Favicon:** `gBrowser.setIcon()` → `_tabAttrModified(tab, ["image"])` (`:1483`); the
 *   resolved icon is `gBrowser.getIcon(tab)` === `browser.mIconURL` (`:1535`). We piggyback on
 *   that pipeline and never fetch or parse an icon ourselves.
 * - `_tabAttrModified` early-returns when `tab.closing` (`:2239`), so no metadata events can
 *   arrive during teardown — the ZF-021d fatal path stays quiet by construction.
 * - **REMOTENESS (investigated per ZF-022): a progress listener does NOT survive a process
 *   switch.** `browser.webProgress` is `browsingContext?.webProgress`
 *   (`browser-custom-element.mjs:644`), and tabbrowser removes its filter *before* the switch
 *   and re-adds it *after* on BOTH paths: the frontend `updateBrowserRemoteness`
 *   (`tabbrowser.js:2679` → `:2741`) and Gecko's Fission switch, hooked via
 *   `WillChangeBrowserRemoteness`/`DidChangeBrowserRemoteness` (`:9288` → `:9371`;
 *   the browser element fires those in `beforeChangeRemoteness`/`finishChangeRemoteness`,
 *   `browser-custom-element.mjs:1989`/`:2000`). Both paths end by dispatching
 *   `TabRemotenessChange` on the tab, which is where we re-register.
 */
class TargetRegistry extends EventTarget {
  #host = null;
  #tab = null;
  #browser = null; // borrowed; nulled on detach
  #progress = null; // nsIWebProgressListener
  #listeners = []; // [{ target, type, fn }]
  #inflight = 0; // outstanding top-level network loads (see #onStateChange)
  #state = { url: null, title: null, favicon: null, loading: false };
  #lastUpdated = { url: 0, title: 0, favicon: 0, loading: 0 };

  get attached() {
    return !!this.#host;
  }

  /** Snapshot of current metadata (copy — callers cannot mutate registry state). */
  get state() {
    return { ...this.#state, lastUpdated: { ...this.#lastUpdated } };
  }

  // ---- lifecycle (idempotent, symmetric with EnrollmentManager) ----------
  attach(host) {
    if (!host || !host.alive) {
      return false;
    }
    if (this.#host === host) {
      return true; // double attach → no-op
    }
    if (this.#host) {
      this.detach(); // re-attach to a different host: never stack listeners
    }
    this.#host = host;
    this.#tab = host.tab;
    this.#browser = host.browser;
    this.#armProgress();
    this.#armTabListeners();
    this.#refresh(); // seed from the live browser/tab (about:blank, initial icon, busy state)
    return true;
  }

  detach() {
    if (!this.#host) {
      return; // double detach → no-op
    }
    this.#disarmProgress();
    this.#disarmTabListeners();
    this.#host = null;
    this.#tab = null;
    this.#browser = null;
    this.#inflight = 0;
    this.#state.loading = false; // silent: the surface is going away with us
  }

  // ---- state plumbing ---------------------------------------------------
  // One funnel, conditional emit: a field that did not change emits nothing, so a duplicate
  // or late notification is inert.
  #set(field, value, extra = null) {
    if (this.#state[field] === value) {
      return false;
    }
    const previous = this.#state[field];
    this.#state[field] = value;
    this.#lastUpdated[field] = Date.now();
    const type =
      field === "url"
        ? "target-location"
        : field === "title"
          ? "target-title"
          : field === "favicon"
            ? "target-favicon"
            : "target-loading";
    const detail = field === "loading" ? { loading: value } : { [field]: value, previous };
    try {
      this.dispatchEvent(new CustomEvent(type, { detail: extra ? { ...detail, ...extra } : detail }));
    } catch (_) {}
    return true;
  }

  /**
   * Re-read every field from the LIVE source of truth. This is the anti-staleness rule of
   * this component: notifications are treated as *triggers only* and never as carriers of
   * values, so a late or out-of-order event can never apply an old URL/title/icon — the
   * worst it can do is re-read the current one and emit nothing.
   */
  #refresh({ sameDocument = false } = {}) {
    if (!this.#browser) {
      return;
    }
    let url = null;
    try {
      url = this.#browser.currentURI?.spec ?? null;
    } catch (_) {}
    this.#set("url", url, { sameDocument });

    let title = null;
    try {
      title = this.#browser.contentTitle || this.#tab?.label || null;
    } catch (_) {
      title = this.#tab?.label ?? null;
    }
    this.#set("title", title);

    let favicon = null;
    try {
      favicon = window.gBrowser?.getIcon?.(this.#tab) ?? null; // resolved icon, not fetched
    } catch (_) {}
    this.#set("favicon", favicon);
  }

  // ---- nsIWebProgressListener ------------------------------------------
  #armProgress() {
    this.#disarmProgress();
    const browser = this.#browser;
    if (!browser) {
      return;
    }
    const self = this;
    this.#progress = {
      QueryInterface: ChromeUtils.generateQI([
        "nsIWebProgressListener",
        "nsISupportsWeakReference",
      ]),
      onStateChange(wp, request, flags, status) {
        self.#onStateChange(wp, request, flags, status);
      },
      onLocationChange(wp, request, location, flags) {
        self.#onLocationChange(wp, request, location, flags);
      },
      onProgressChange() {},
      onSecurityChange() {},
      onStatusChange() {},
      onContentBlockingEvent() {},
    };
    try {
      browser.addProgressListener(
        this.#progress,
        Ci.nsIWebProgress.NOTIFY_STATE_ALL | Ci.nsIWebProgress.NOTIFY_LOCATION
      );
    } catch (_) {
      this.#progress = null; // browser not built yet / already torn down — stay inert
    }
  }

  #disarmProgress() {
    if (!this.#progress) {
      return;
    }
    try {
      // May throw if the browser is mid-teardown (webProgress is browsingContext-bound and
      // is already gone) — the listener dies with the browsing context either way.
      this.#browser?.removeProgressListener(this.#progress);
    } catch (_) {}
    this.#progress = null;
  }

  /**
   * Loading state. Counting in-flight top-level network loads (rather than latching a
   * boolean) is what makes rapid navigation correct: a STOP belonging to a superseded
   * navigation decrements the count instead of clearing a flag the newer load just set.
   */
  #onStateChange(wp, _request, flags, _status) {
    if (!this.#browser || !wp?.isTopLevel) {
      return;
    }
    const { STATE_START, STATE_STOP, STATE_IS_NETWORK } = Ci.nsIWebProgressListener;
    if (flags & STATE_START && flags & STATE_IS_NETWORK) {
      this.#inflight++;
      this.#set("loading", true);
    } else if (flags & STATE_STOP && flags & STATE_IS_NETWORK) {
      this.#inflight = Math.max(0, this.#inflight - 1);
      this.#set("loading", this.#inflight > 0);
      this.#refresh(); // title/icon usually land around STOP
    }
  }

  #onLocationChange(wp, _request, _location, flags) {
    if (!this.#browser || !wp?.isTopLevel) {
      return; // iframe/subframe navigations are not the float's target
    }
    const sameDocument = !!(
      flags & Ci.nsIWebProgressListener.LOCATION_CHANGE_SAME_DOCUMENT
    );
    this.#refresh({ sameDocument });
  }

  // ---- tab-scoped DOM listeners ----------------------------------------
  // Scoped to the float's OWN tab: no cross-tab filtering needed, and nothing can fire for
  // another tab's metadata. All are removed in #disarmTabListeners (incl. the fatal path).
  #armTabListeners() {
    this.#disarmTabListeners();
    const tab = this.#tab;
    if (!tab) {
      return;
    }
    const add = (target, type, fn) => {
      target.addEventListener(type, fn);
      this.#listeners.push({ target, type, fn });
    };
    add(tab, "TabAttrModified", (e) => {
      const changed = e?.detail?.changed;
      if (!Array.isArray(changed)) {
        return;
      }
      if (changed.includes("label") || changed.includes("image")) {
        this.#refresh();
      }
    });
    // Remoteness: our listener is bound to the OLD browsing context's webProgress, so it is
    // dropped by the process switch exactly like tabbrowser's own filter. Unhook early,
    // re-hook on the new one — same two-phase dance tabbrowser does (see class comment).
    add(tab, "BeforeTabRemotenessChange", () => this.#disarmProgress());
    add(tab, "TabRemotenessChange", () => {
      this.#browser = this.#host?.browser ?? this.#browser; // same element, new frameLoader
      this.#armProgress();
      this.#refresh();
    });
  }

  #disarmTabListeners() {
    for (const { target, type, fn } of this.#listeners) {
      try {
        target.removeEventListener(type, fn);
      } catch (_) {}
    }
    this.#listeners = [];
  }
}

/**
 * ZF-022 — FloatChrome. Read-only native title bar rendered inside the FloatWindow shell:
 * favicon, title, throbber, reload, close. Presentation ONLY — it holds no browser and no
 * tab reference, ever: it reads metadata from TargetRegistry events and routes both of its
 * actions back through owner callbacks (`onClose` → FloatWindow.close(), `onReload` →
 * BrowserHost.reload()). It never calls gBrowser, never touches the tab, and never writes a
 * render attribute. Plain DOM, no frameworks; styling matches the existing float shell.
 */
class FloatChrome {
  static BAR_CLASS = "zen-float-chrome";
  static STYLE_ID = "zen-float-chrome-styles";
  static STYLES = `
    .zen-float-chrome {
      pointer-events: auto;            /* the frame itself is inert (see .zen-float-overlay) */
      box-sizing: border-box;
      height: var(--zen-float-chrome-height);
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 6px 0 10px;
      background: Field;
      color: FieldText;
      border-bottom: 1px solid color-mix(in srgb, FieldText 12%, transparent);
      border-radius: var(--zen-float-radius) var(--zen-float-radius) 0 0;
      font: message-box;
      font-size: 12px;
      user-select: none;
    }
    .zen-float-chrome-icon {
      width: 16px; height: 16px; flex: none;
      border-radius: 3px;
      background: color-mix(in srgb, FieldText 10%, transparent); /* placeholder until real */
      object-fit: contain;
    }
    .zen-float-chrome-icon[data-has-icon="true"] { background: transparent; }
    /* Throbber replaces the icon while loading. CSS animation only — no JS timer/polling. */
    .zen-float-chrome[loading] .zen-float-chrome-icon { visibility: hidden; }
    .zen-float-chrome-throbber {
      display: none;
      position: absolute;
      width: 14px; height: 14px; flex: none;
      border: 2px solid color-mix(in srgb, FieldText 25%, transparent);
      border-top-color: AccentColor;
      border-radius: 50%;
      animation: zen-float-spin 0.7s linear infinite;
    }
    .zen-float-chrome[loading] .zen-float-chrome-throbber { display: block; }
    @keyframes zen-float-spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) {
      .zen-float-chrome-throbber { animation-duration: 2.4s; }
    }
    .zen-float-chrome-title {
      flex: 1 1 auto;
      min-width: 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;          /* truncation is CSS's job, not JS's */
    }
    .zen-float-chrome-button {
      flex: none;
      width: 24px; height: 24px;
      display: flex; align-items: center; justify-content: center;
      padding: 0; border: none; border-radius: 4px;
      background: transparent; color: inherit;
      font-size: 13px; line-height: 1;
      cursor: default;
    }
    .zen-float-chrome-button:hover { background: color-mix(in srgb, FieldText 12%, transparent); }
    .zen-float-chrome-button:active { background: color-mix(in srgb, FieldText 20%, transparent); }
  `;

  #bar = null;
  #icon = null;
  #label = null;
  #registry = null;
  #registryListeners = []; // [{ type, fn }]
  #domListeners = []; // [{ target, type, fn }]
  #onClose = null;
  #onReload = null;

  constructor({ onClose = null, onReload = null } = {}) {
    this.#onClose = onClose;
    this.#onReload = onReload;
  }

  get element() {
    return this.#bar;
  }

  // ---- lifecycle (idempotent, symmetric with TargetRegistry) ------------
  attach(frame, registry) {
    if (!frame || !registry) {
      return null;
    }
    if (this.#bar && this.#registry === registry) {
      return this.#bar; // double attach → no-op
    }
    if (this.#bar) {
      this.detach();
    }
    this.#injectStyles();
    this.#build(frame);
    this.#registry = registry;
    const on = (type, fn) => {
      registry.addEventListener(type, fn);
      this.#registryListeners.push({ type, fn });
    };
    on("target-title", (e) => this.#renderTitle(e.detail?.title, null));
    on("target-location", (e) => this.#renderTitle(null, e.detail?.url));
    on("target-favicon", (e) => this.#renderFavicon(e.detail?.favicon));
    on("target-loading", (e) => this.#renderLoading(!!e.detail?.loading));
    this.#render(registry.state); // seed from whatever the registry already knows
    return this.#bar;
  }

  detach() {
    for (const { type, fn } of this.#registryListeners) {
      try {
        this.#registry?.removeEventListener(type, fn);
      } catch (_) {}
    }
    this.#registryListeners = [];
    for (const { target, type, fn } of this.#domListeners) {
      try {
        target.removeEventListener(type, fn);
      } catch (_) {}
    }
    this.#domListeners = [];
    this.#registry = null;
    if (this.#bar) {
      this.#bar.remove();
      this.#bar = null;
    }
    this.#icon = null;
    this.#label = null;
  }

  // ---- DOM --------------------------------------------------------------
  #injectStyles() {
    if (document.getElementById(FloatChrome.STYLE_ID)) {
      return;
    }
    const style = document.createElementNS(XHTML_NS, "style");
    style.id = FloatChrome.STYLE_ID;
    style.textContent = FloatChrome.STYLES;
    document.documentElement.appendChild(style);
  }

  #build(frame) {
    const el = (tag, cls) => {
      const node = document.createElementNS(XHTML_NS, tag);
      if (cls) {
        node.className = cls;
      }
      return node;
    };
    const bar = el("div", FloatChrome.BAR_CLASS);

    const iconSlot = el("div", "zen-float-chrome-iconslot");
    iconSlot.style.position = "relative";
    iconSlot.style.display = "flex";
    iconSlot.style.alignItems = "center";
    const icon = el("img", "zen-float-chrome-icon");
    icon.setAttribute("data-has-icon", "false");
    const throbber = el("div", "zen-float-chrome-throbber");
    iconSlot.append(icon, throbber);

    const label = el("span", "zen-float-chrome-title");

    const reload = el("button", "zen-float-chrome-button");
    reload.textContent = "⟳"; // ⟳
    reload.setAttribute("title", "Reload");
    const close = el("button", "zen-float-chrome-button");
    close.textContent = "✕"; // ✕
    close.setAttribute("title", "Close");

    const click = (target, fn) => {
      const handler = (e) => {
        e.preventDefault();
        try {
          fn();
        } catch (_) {}
      };
      target.addEventListener("click", handler);
      this.#domListeners.push({ target, type: "click", fn: handler });
    };
    // Chrome never touches the browser or the tab: both actions go through the owner.
    click(reload, () => this.#onReload?.());
    click(close, () => this.#onClose?.());

    bar.append(iconSlot, label, reload, close);
    frame.prepend(bar);
    this.#bar = bar;
    this.#icon = icon;
    this.#label = label;
  }

  // ---- rendering --------------------------------------------------------
  #render(state) {
    if (!state) {
      return;
    }
    this.#renderTitle(state.title, state.url);
    this.#renderFavicon(state.favicon);
    this.#renderLoading(!!state.loading);
  }

  // Title falls back to the URL when the page has none yet (mirrors tab-strip behaviour).
  #renderTitle(title, url) {
    if (!this.#label) {
      return;
    }
    const next = title || url || this.#label.textContent || "";
    if (title || !this.#label.textContent) {
      this.#label.textContent = next;
      this.#label.setAttribute("title", next);
    }
  }

  #renderFavicon(favicon) {
    if (!this.#icon) {
      return;
    }
    if (favicon) {
      // The already-resolved icon from tabbrowser's pipeline (gBrowser.getIcon) — the same
      // value the tab strip renders. We never fetch one ourselves.
      if (this.#icon.getAttribute("src") !== favicon) {
        this.#icon.setAttribute("src", favicon);
      }
      this.#icon.setAttribute("data-has-icon", "true");
    } else {
      this.#icon.removeAttribute("src");
      this.#icon.setAttribute("data-has-icon", "false"); // placeholder square
    }
  }

  #renderLoading(loading) {
    if (!this.#bar) {
      return;
    }
    if (loading) {
      if (!this.#bar.hasAttribute("loading")) {
        this.#bar.setAttribute("loading", "true");
      }
    } else if (this.#bar.hasAttribute("loading")) {
      this.#bar.removeAttribute("loading");
    }
  }
}

class nsZenFloatManager {
  // ---- constants --------------------------------------------------------
  static PREF_ENABLED = "zen.float.enabled";
  static PREF_DEBUG = "zen.float.debug";
  static READY_TOPIC = "browser-delayed-startup-finished";
  // Single default target. Target PRESETS (Claude/ChatGPT/… picker) are still unbuilt — see
  // the ADR: ZF-022's TargetRegistry is the metadata layer, not the backlog's preset list.
  static DEFAULT_TARGET = "https://claude.ai/";

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

  /** ZF-022 debug: current target metadata (url/title/favicon/loading + lastUpdated). */
  _debugTargetState() {
    return this.floatWindow?.registry?.state ?? null;
  }

  /** ZF-022 — reload the float's page (same path the title bar's button takes). */
  reloadFloat() {
    return !!this.floatWindow?.host?.reload();
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
