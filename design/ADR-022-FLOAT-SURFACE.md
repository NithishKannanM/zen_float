# ADR-022 — Float Surface (BrowserHost / TargetRegistry / FloatChrome)

**Status:** Accepted · **Scope:** ZF-022 · **Code:** `src/zen-float.uc.mjs` · **Validation:** `reviews/ZF-022-VALIDATION.md`

Decisions taken while implementing ZF-022 that deviate from, or resolve ambiguity in, the ticket as written. Everything else followed the ticket exactly.

---

## D-1 — `BrowserHost` did not exist; it was extracted first (approved before coding)

The ticket's "established architecture" states BrowserHost owns the tab and browser and is the only component allowed to hold a strong browser reference. **No such class existed** — `FloatWindow` itself held `#floatTab`/`#browser`/`#container` (ZF-020). Two ticket items presupposed it: the `BrowserHost.reload()` deliverable, and "enforce the ownership matrix in code structure, not just convention".

**Decision:** extract `BrowserHost` as a separate, behaviour-preserving commit (`b386e12`) *before* any ZF-022 feature code, then build on it. The extraction touched the ZF-020/ZF-021d-validated spawn/teardown paths, so the full ZF-021d matrix was re-run against it and returned **identical** results (contract holds, external close throw-free, listener census 13/10).

**Consequence:** `FloatWindow` no longer holds a browser reference; it caches only `#geometryTarget` (the node it applied `.zen-float-browser` to), because the host drops its container reference during teardown and the class must be removed from the node we actually classed.

## D-2 — `FloatWindow.close()` added as the public entry point

The ticket says the Close button "calls `FloatWindow.close()`"; the class only had `detach()` / `destroy()`. Added `close()` as a thin public alias that routes to the single `detach()` teardown path (which still carries the ZF-021d `{removeTab:false}` fatal variant). `nsZenFloatManager.closeFloat()` now goes through it too, so there is exactly one teardown funnel.

## D-3 — The chrome frame is now transparent and inert; the browser box reserves the bar's height

Adding a title bar exposed defect **F-1** (`reviews/ZF-020-HEADFUL-VALIDATION.md`): `.zen-float-overlay` was an opaque `background: Field` box sitting *on top* of the never-moved browser, hiding the page entirely, and any pointer surface there would have eaten the page's clicks.

**Decision:** `.zen-float-overlay` becomes `background: transparent; pointer-events: none`, and `FloatChrome` re-enables `pointer-events: auto` for its own bar only. The float's browser box is shrunk by a new `--zen-float-chrome-height` (32px): since `.browserContainer` is bottom-anchored, `height: calc(var(--zen-float-height) - var(--zen-float-chrome-height))` frees exactly the top strip the bar occupies — the two stay aligned with no imperative syncing, preserving the C1 no-move contract.

**Why this is in scope even though geometry is not:** a title bar that is invisible (covered) or that covers page content is not a deliverable. This resolves F-1 as a side effect; drag/resize/docking remain out of scope and untouched. Verified visually: `reviews/evidence/zf022-title-bar.png`.

## D-4 — This `TargetRegistry` is **not** the backlog's `TargetRegistry` · **CLOSED by ZF-023**

> **Resolved.** ZF-023 shipped `TargetPresets` (the PRD's eight presets + custom-URL validation) and target switching via `BrowserHost.navigate()` / `FloatWindow.switchTarget()`. The two original ZF-022 ACs are now met. See `reviews/ZF-023-VALIDATION.md`. The naming split stands: `TargetRegistry` = page metadata, `TargetPresets` = the target list.


`ZEN_FLOAT_BACKLOG.md` ZF-022 defines `TargetRegistry` as *target presets* (Claude/ChatGPT/Gemini/… + custom URL). The implementation ticket redefines the same name as the *page-metadata* layer. Both cannot be the same class.

**Decision:** implement the ticket's meaning (metadata). **Target presets are NOT built** and remain outstanding; `nsZenFloatManager.DEFAULT_TARGET` is still a single hard-coded URL. Flagged in the backlog status so the preset work is not silently lost. If presets land later, they need a different name (e.g. `TargetPresets`).

## D-5 — Notifications are treated as triggers, never as carriers of values

Required behaviour: "registry state must match final currentURI with no stale intermediate events applied late."

**Decision:** every handler re-reads the authoritative value live (`browser.currentURI.spec`, `browser.contentTitle`/`tab.label`, `gBrowser.getIcon(tab)`) and emits only on change, instead of applying the value carried by the event. A late, duplicated or out-of-order notification therefore cannot apply an old value — at worst it re-reads the current one and emits nothing. Validated by V2 (6 navigations at 60ms intervals).

## D-6 — `loading` counts in-flight top-level loads instead of latching a boolean

A `STATE_STOP` belonging to a superseded navigation would clear a latched flag that a newer `STATE_START` had just set. **Decision:** maintain an in-flight counter (`STATE_START|STATE_IS_NETWORK` increments, `STATE_STOP|STATE_IS_NETWORK` decrements, both gated on `isTopLevel`); `loading = inflight > 0`. Same flag test tabbrowser's own `TabProgressListener` uses (`tabbrowser.js:9647`/`:9724`).

## D-7 — Metadata listeners are tab-scoped, not window-scoped

`TabAttrModified` / `TabRemotenessChange` bubble from the tab. Listening on the **float's own tab** removes the need for cross-tab filtering, guarantees we can never react to another tab's metadata, and keeps the window-level listener census (the ZF-021d leak standard) untouched — confirmed: window counts stay at baseline while a float is open, and the tab-level counts return to 0 on teardown.

## D-8 — Remoteness: re-register, don't assume survival

Investigated as required. A progress listener does **not** survive a process switch: `browser.webProgress` is `browsingContext?.webProgress` (`browser-custom-element.mjs:644`), and tabbrowser removes its own filter before the switch and re-adds it after on both the frontend path (`tabbrowser.js:2679`→`:2741`) and Gecko's Fission path (`:9288`→`:9371`), each ending with a `TabRemotenessChange` dispatch on the tab. **Decision:** unhook on `BeforeTabRemotenessChange`, re-hook on `TabRemotenessChange`. Confirmed empirically, not just from source — V7 drove a real switch (`webIsolated=https://mozilla.org` → parent → `webIsolated=https://example.com`) and metadata kept tracking across it and through a further navigation.
