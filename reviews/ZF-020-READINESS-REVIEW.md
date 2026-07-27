# Zen Float — Pre-ZF-020 Implementation Review

**Reviewer:** Lead Reviewer (platform-feature acceptance gate)
**Under review:** `src/zen-float.uc.mjs` @ `2704fac` (ZF-001 + ZF-002), branch `zen-float-v1`
**Against:** `ZEN_FLOAT_RFC.md`, `ZEN_FLOAT_EDD.md`, `ZEN_FLOAT_BACKLOG.md`, EXP-001/002 report
**Constraint:** No code. No redesign. No scope growth. Freeze quality before BrowserHost rendering.
**Verdict:** **YES, WITH CONDITIONS** (3 blocking, see §10). ZF-001/002 are sound; the untested seam is the overlay↔browser integration, and one Glance-conformance decision must be made explicit before ZF-020, not during it.

---

## 1. Architecture Conformance Review

Overall: implementation tracks the EDD closely. Drift is minor and mostly documentation, **except one substantive divergence (D-1) that ZF-020 will collide with.**

| # | Item | RFC/EDD/Backlog says | Implementation does | Assessment |
|---|---|---|---|---|
| **D-1** | Overlay/host model | EDD §5, §7.3 + EXP-002: reuse **Glance's** model — Glance styles the tab's **existing** `.browserSidebarContainer` as the fixed overlay; the `<browser>` **never moves** | ZF-002 creates a **standalone empty** `.zen-float-overlay` div, implying ZF-020 will **place/reparent a browser into it** | **Substantive.** Physically moving a remote `<browser>` destroys/recreates its frameloader (docshell loss). Glance deliberately avoids this. Must reconcile before ZF-020 (see §7, C1). |
| D-2 | Stylesheet delivery | Backlog ZF-002: ship `zen-float.uc.css` | Self-injected `<style>` (single-file install) | Acceptable deviation; **update backlog** to record it. Not blocking. |
| D-3 | Base class | EDD §2.11: v1 self-init; v2 `nsZenDOMOperatedFeature` | Self-init via `browser-delayed-startup-finished` | Conformant. Note EXP-001B found `nsZenMultiWindowFeature` — record as the v2 target. |
| D-4 | Spaces global name | Early EDD said `ZenWorkspaces`/`ZenSpaceManager` | Code correctly uses `gZenWorkspaces` | Conformant (correction already absorbed). |
| D-5 | activation-method | EDD "corrected" to `ctrl` | N/A in code yet; live value is `alt` | Doc bug in EDD only; fix EDD text. |

**Missing (expected, not drift):** all controllers (`DragController`, `StateStore`, `ScopeBinder`, `AnimationController`, `TargetRegistry`), event dispatch (`ZenFloat:*`), and prefs seeding (ZF-003) are absent — correct for this stage.

**Unnecessary complexity:** none material. `contain: layout style` (line 45) and `z-index: 2147483646` (line 40) are slightly speculative for an empty shell but harmless; keep.

---

## 2. BrowserHost Readiness Review

`FloatWindow` today is an **overlay shell**, not yet a browser host. Assessed for readiness to *become* one:

| Dimension | State | Finding |
|---|---|---|
| **Ownership** | `nsZenFloatManager.floatWindow` owns one `FloatWindow`; `FloatWindow.#overlay` owns the div | Clean, single-owner. Registry-for-multi-float (ADR-007) deferred — fine. |
| **Lifetime** | Created in `init()`; destroyed on window `unload` (lines 135–142) | Correct. But `init()` reliability is conditional — see B-1. |
| **Cleanup** | `destroy()` removes overlay; unload handler calls it | OK for shell. **Gap:** ZF-020 adds a `<browser>`/tab whose teardown (removeTab, docshell deactivate, blob revoke) is NOT yet modeled. Must land with ZF-020, not after. |
| **Initialization** | Single-shot via delayed-startup observer | **B-1 (blocking):** no "already-fired" fallback — if the notification predates the observer (late injection, or per-window timing on new windows), `init()` never runs. The `load` fallback only triggers on `addObserver` throw, not on a missed notification. |
| **Error recovery** | Missing-internals path degrades (lines 228–236) | Good. But there is no recovery if `init()` simply never fires (B-1). |
| **Event ordering** | Init at delayed-startup = post `SessionStore.promiseAllWindowsRestored` (ZenStartup, EXP-verified) | Correct; ZF-051 restore can safely read state at init. |
| **Browser shutdown** | Not handled | Glance flushes on `quit-application-requested`; ZF has no state yet so N/A now, but **StateStore (ZF-050) must hook it.** Note only. |
| **Window shutdown** | `unload` disarms observer + destroys overlay | Correct. |
| **Session restore** | Ordering safe (above) | OK. |
| **Memory ownership** | Only a detached-until-shown div | OK. ZF-020 introduces the real risk (live docshell) — enforce EXP-006 teardown then. |
| **State management** | None yet | OK; `capabilities` is the only state, read-only after init. |

**Readiness:** the shell is a sound foundation; **B-1 (init reliability)** and the **not-yet-modeled browser teardown** are the two host-level gaps ZF-020 must close.

---

## 3. Overlay Readiness

| Dimension | Finding |
|---|---|
| **DOM hierarchy / attach point** | **B-2 (blocking).** Overlay is appended to `#tabbrowser-tabpanels` (line 68). That element is a **deck that renders only the selected tab panel** — a non-panel child may be hidden by deck semantics, and its descendants are per-tab. A *global* float attached here is at risk of being hidden on tab switch and of being clipped. Likely needs to attach **higher** (e.g. `#browser`/`#appcontent` or a dedicated chrome layer) so it is tab-independent. Must be decided before ZF-020 renders. |
| **Overlay container** | Single div, class-scoped styles — clean. |
| **CSS** | `position:fixed` + `inset` + `contain:layout style`. **B-3 (blocking, visual):** `position:fixed` resolves against the nearest ancestor with `transform`/`filter`/`will-change`/`contain:paint`. Zen animates compact mode, workspaces, and Glance with transforms — at the current attach point the float may anchor to a transformed ancestor instead of the viewport. Must validate the containing block at the chosen attach point. |
| **BrowserStack integration** | EXP-002 confirmed the float browser lives in `.browserSidebarContainer`/`.browserStack`. The **relationship** between that container and `.zen-float-overlay` is undefined (D-1). This is the core ZF-020 decision. |
| **Pointer events** | Shown overlay captures pointer events over its rect (intended for a float). No pass-through needed. OK. When hidden, `display:none` → no capture. OK. |
| **Reparenting** | **Unproven and dangerous.** EXP-002 only tested `closest('.browserSidebarContainer')` — it did **not** move a browser element. Moving a remote `<browser>` in the DOM triggers frameloader swap/loss unless the documented swap API is used. Prefer Glance's no-move model. |
| **Fullscreen** | Not handled; fixed + max z-index would cover fullscreen video. Deferred to ZF-083 — acceptable before ZF-020, but list in regression. |
| **Compact mode** | Interacts via transformed ancestors (B-3) and auto-hide (ZF-083). Validate positioning; behavior deferred. |
| **Accessibility** | Overlay has no `role`, label, focus order, or keyboard-trap policy. Acceptable for a shell; **must be addressed before release** (not before ZF-020). |
| **Future docking** | `inset` model is dock-friendly (DockController will own it). No obstacle. |

---

## 4. Code Review (ZF-001 / ZF-002)

Line references are to `src/zen-float.uc.mjs` @ `2704fac`.

**Race conditions**
- **B-1** (init may never fire — missed delayed-startup notification). Highest-value fix.
- Observer filters `subject === window` (line 175) — correct per-window isolation. No cross-window race.

**Leaks**
- Ready observer removed on fire and on unload — good. `load` fallback listener (line 187) is `{once:true}` but is only added in the throw path; not a leak.
- **Latent:** ZF-020's tab/docshell/blob lifecycle is unmodeled; must arrive with ZF-020 (flagged §2).

**Observer issues**
- Uses `Services.obs` global topic with per-window filtering — idiomatic. `#disarmReadyHook` is null-safe and idempotent. OK.

**Initialization bugs**
- **B-1** as above. Also: `#initialized` guards re-entry (line 213) — good.

**Hidden dependencies**
- Relies on `window`, `document`, `Services`, `dump`, `console` being present in the `.uc.mjs` scope — **A1 still unproven at runtime** (loader not installed). This is the known gap; not introduced by ZF-001/002 but it gates real execution.
- Depends on `#tabbrowser-tabpanels` id and Glance/Zen globals — feature-detected for globals, **not** for the DOM id (line 68 falls back to `documentElement`, which would misplace the overlay silently). Minor robustness gap; tie to B-2 resolution.

**Future maintenance**
- Feature flag read only at `init()` (lines 218, 200–206): **runtime toggle of `zen.float.enabled` has no effect until restart.** EDD/Mods ethos is "instant enable." Acceptable for v1 if documented; otherwise a pref observer is a small add (defer, see §5 TD-2).

**Performance**
- Shell is inert; `#log` always `console.log`s (line 157) even in release. One line at init is fine; ensure ZF-020+ routes verbose logs through `#trace` (debug-gated). No other concerns. Main-thread only.

**Feature-flag correctness**
- Off ⇒ no overlay, no observers-after-init, no UI. On ⇒ single init. Correct. Missing-internals ⇒ dormant. Correct.

**Thread safety**
- All chrome JS on main thread; no shared-memory concerns. Assumption valid; document it once.

**Graceful degradation**
- Missing-internals path is correct and is the seed of ZF-114. Good. Extend the same discipline to the DOM attach id (B-2).

**Net:** ZF-001/002 are well-formed. The only in-code blocker is **B-1**; the other blockers are integration decisions (B-2, B-3, D-1) that must be settled *before* ZF-020 writes rendering code.

---

## 5. Technical Debt Register (introduced so far)

| ID | Debt | Class | Rationale / removal |
|---|---|---|---|
| **TD-A** | Overlay attach point unvalidated (`#tabbrowser-tabpanels`) | **Must fix before ZF-020** | Wrong parent → hidden/clipped/mispositioned float (B-2). |
| **TD-B** | No "already-fired" delayed-startup guard | **Must fix before ZF-020** | Init reliability (B-1). |
| **TD-C** | Reparent-vs-overlay model undecided (D-1) | **Must fix before ZF-020** | Avoids docshell-loss; picks Glance's proven path. |
| TD-D | `zen.float.enabled` not observed at runtime | Can wait | Add pref observer (small) once settings land; document "restart to toggle" meanwhile. |
| TD-E | Backlog says `zen-float.uc.css`; code self-injects | Can wait | Update backlog text. |
| TD-F | No a11y on overlay | Defer (pre-release, not pre-ZF-020) | role/label/focus/keyboard-trap with UI tickets. |
| TD-G | Fullscreen/compact auto-hide absent | Defer (ZF-083) | Not needed to render; list in regression. |
| TD-H | `#log` always console.logs in release | Defer (v2 polish) | Route through Glean/debug gating later. |

---

## 6. Implementation Contracts (freeze)

**Frozen — do not change signatures without a ticket:**

*`nsZenFloatManager`*
- `init()` — idempotent, flag-gated, single-shot at delayed-startup.
- `get enabled` — reads `zen.float.enabled` (default false).
- `capabilities` — read-only `{globalName: boolean}` after init.
- `floatWindow` — the single `FloatWindow` (nullable until init).
- `_debugToggleOverlay()` — debug-only; returns visibility.
- Constants: `PREF_ENABLED`, `PREF_DEBUG`, `READY_TOPIC`, `REQUIRED_GLOBALS`.

*`FloatWindow` (overlay contract)*
- `ensureShell()` idempotent → overlay element.
- `show()/hide()/toggle()` → boolean visibility.
- `get visible`.
- `destroy()` — full overlay teardown.
- DOM: single `.zen-float-overlay`, hidden via `hidden` attr; styles under `#zen-float-styles`.

**Internal events:** none yet. Reserve the `ZenFloat:Open|Close|Moved|Resized|Docked|Collapsed|Restored` names (EDD §12) for when dispatch is added.

**State ownership:** manager owns lifecycle + capabilities; `FloatWindow` owns overlay DOM. **No other responsibilities** may be added to `FloatWindow` except **browser hosting** (justified: that is ZF-020's charter).

**ZF-020 is permitted to add, and only:** browser attach/detach + target load + on-`TabSelect` `docShellIsActive` reassertion. Anything else (drag, dock, persistence, scope) belongs to its own ticket.

---

## 7. ZF-020 Preparation (no code)

**Charter:** put ONE live nested `<browser>` into the float region using the EXP-002-locked recipe, keep it rendering while unselected, and tear it down leak-free. Single float. No drag/dock/persistence.

**Precondition (resolve first):** decide **C1** — the host model. Recommended, because it is Glance-proven and avoids frameloader loss: **do not physically move the `<browser>`.** Instead, take the float tab's own `.browserSidebarContainer` and position *it* as the float (Glance's `.zen-glance-overlay` pattern), using `.zen-float-overlay` as the **chrome/frame wrapper** (title bar, future handles) rather than as the browser's new parent. If a true reparent is ever required, use the documented browser-swap API — never a raw `appendChild` of a remote browser.

**Files modified:** `src/zen-float.uc.mjs` only (v1). No Zen core files.

**Classes modified:** `FloatWindow` (gains browser hosting); `nsZenFloatManager` (gains an `openFloat`/`closeFloat` entry the debug toggle can call).

**Methods added (behavioral description, not signatures to expand):**
- `FloatWindow.attachTarget(url)` — spawn tab via Glance recipe; retain `floatTab` + `linkedBrowser`; set `docShellIsActive = true`; place its container in the float region per C1; mark shown.
- `FloatWindow.detach()` — deactivate docshell, `gBrowser.removeTab(floatTab)`, revoke any blob URLs, null refs.
- `nsZenFloatManager.onTabSelect` handler — reassert `docShellIsActive = true` on the float browser (ScopeBinder will later own this; ZF-020 uses a minimal local listener).

**Methods reused (do NOT reimplement):**
- `gBrowser.addTab(url, { triggeringPrincipal, skipBackgroundNotify:true, insertTab:true, skipAnimation:true, ownerTab })` — the EXP-002 recipe.
- `FloatWindow.ensureShell/show/hide/destroy`.
- The `docShellIsActive` lifecycle (EXP-002C).

**Expected call flow:**
`_debugToggleOverlay()/hotkey → manager.openFloat(url) → FloatWindow.ensureShell() → addTab(Glance opts) → linkedBrowser.docShellIsActive=true → place container (C1) → show() → dispatch ZenFloat:Open`
On tab switch: `TabSelect → reassert docShellIsActive=true`.
On close: `manager.closeFloat() → FloatWindow.detach() → dispatch ZenFloat:Close`.

**Required assertions:**
- After spawn: `linkedBrowser.browsingContext` truthy; float tab has **no** `glance-id`/`zen-glance-tab`.
- After activate: `linkedBrowser.docShellIsActive === true`.
- Across ≥10 tab switches: `browsingContext` truthy every time, `docShellIsActive` true every time, tab not `closing`.
- After close: no retained tab, docshell deactivated, refs null (EXP-006 harness green).

**Expected logs:** `[ZenFloat] openFloat <url>`, `spawned browserId=<n>`, `active=true`, `closeFloat`, `detached`.

**Failure handling:** `addTab` throws → log, abort, `hide()`, leave shell intact. Load failure/embedding block → **out of scope** (ZF-023). Content-process crash → out of scope (ZF-101) but must not crash the manager.

**Rollback strategy:** any failure in `attachTarget` calls `detach()` + `hide()`; `openFloat` is transactional (no half-attached state). Feature remains flag-gated; disabling the flag + restart fully removes it.

**Definition of Done:**
- One live browser renders in the float region (**visual confirmation requires a headful run — see Conditions**).
- Persists + stays active across tab switches (Marionette-verifiable).
- Teardown leak-free (EXP-006).
- No regression in §8 list.
- Contracts (§6) unchanged except the sanctioned browser-hosting additions.

**Review checklist (ZF-020 PR):** reuses Glance recipe (no host reimpl); no raw reparent of a remote browser; `docShellIsActive` reasserted on TabSelect; float tab unregistered from Glance; teardown revokes/deactivates/nulls; feature-flag + degrade intact; naming per §12.

**Unit tests:** state transitions (attached/shown/hidden/detached), idempotent `attachTarget`, `detach` clears refs.

**Manual/Marionette validation:** extend `exp002c.js` to also verify the browser is inside the float container and active across switches; **headful** pass to confirm actual paint (the one thing headless cannot show).

---

## 8. Regression Checklist (must still pass after ZF-020)

With `zen.float.enabled=false` (default) **and** `true`:

- [ ] Browser startup completes; no new console errors.
- [ ] Tab switching (`TabSelect`) unaffected; float reasserts without disturbing normal tabs.
- [ ] **Glance** opens/closes/expands/splits normally (float tab is unregistered → Glance ignores it — EXP-002 confirmed).
- [ ] **Spaces** switch works; float does not leak across spaces (scope is ZF-060+, but must not break spaces now).
- [ ] **Split View** unaffected; float browser not pulled into split trees.
- [ ] Window close: overlay + browser torn down; no leaked docshell/observer.
- [ ] Browser close/quit: clean shutdown.
- [ ] Private browsing window: no persistence (no state yet; verify no errors).
- [ ] Container tabs: float inherits `userContextId`; isolation preserved.
- [ ] Theme switching: overlay styles scoped; no bleed.
- [ ] Session restore: init after restore; exactly one (or zero) float; no double-spawn.
- [ ] PiP/media: not captured or disturbed by the float.

---

## 9. Future Compatibility

| Integration point | Fragility | Abstraction boundary to add |
|---|---|---|
| Glance `addTab` recipe (private option set) | **High** — options could change across Zen releases | Wrap the spawn in one internal helper (`FloatWindow.attachTarget`) so a recipe change is a one-line fix. |
| `gZenGlanceManager` presence / `#glances` semantics | Medium | Never touch `#glances`; rely only on "unregistered tabs are ignored" (validated). Feature-detect already covers presence. |
| `#tabbrowser-tabpanels` / chosen attach node | Medium — Firefox ESR could restructure the browser deck | Centralize the attach node in one accessor; feature-detect the id and log if absent (fixes silent fallback). |
| `browser-delayed-startup-finished` topic | Low — stable Firefox contract | Keep + add the already-fired guard (B-1). |
| `docShellIsActive` on remote browser | Low — stable platform API | Keep; document the OOP gotcha (docShell null in parent). |
| `gZenWorkspaces.addChangeListeners` | Medium (Zen-private) | Isolate in ScopeBinder (ZF-060); one integration site. |
| Firefox ESR uplift of Glance base | Medium | The single-helper wrappers above localize all breakage; ZF-114 nightly-compat CI catches it. |

**Principle:** every Zen-private touchpoint should have exactly **one** call site behind a named helper, so a browser-update break is a localized fix + a graceful-degrade path — not a scattered hunt.

---

## 10. Final Verdict

### YES, WITH CONDITIONS.

**Evidence for YES:** ZF-001/002 are correctly scoped, flag-gated, leak-conscious, feature-detected, and syntactically valid; the delayed-startup hook, global reachability, and the persistent-browser lifecycle are validated by EXP-001/002; contracts are small and freezable.

**Conditions — resolve in this priority order before ZF-020 writes rendering code:**

1. **C1 — Decide the host model (D-1/TD-C).** Adopt Glance's no-move approach: position the float tab's existing `.browserSidebarContainer` as the float; use `.zen-float-overlay` as the frame wrapper. **Never** raw-reparent a remote `<browser>`. *Rationale: prevents frameloader/docshell loss; uses the only proven path.*

2. **C2 — Fix init reliability (B-1/TD-B).** Add an "already-fired" guard (e.g. check the window's delayed-startup-finished state) so `init()` runs even if the notification predates the observer, especially for windows opened after startup. *Rationale: ZF-020 depends on `init()` having run; a missed notification silently disables everything.*

3. **C3 — Validate the attach point & containing block (B-2/B-3/TD-A).** Choose an attach node that is tab-independent and not under a transformed ancestor; feature-detect it and log on fallback. Confirm `position:fixed` anchors to the viewport there. *Rationale: wrong parent ⇒ hidden/clipped/mispositioned float; this is the difference between "renders" and "renders correctly."*

**Non-blocking (may proceed in parallel or later):** TD-D (runtime pref toggle), TD-E (backlog doc), TD-F (a11y), TD-G (fullscreen/compact), TD-H (release logging), and the standing unknowns (A1 loader install, headful visual confirmation) — none require redesign; all are tracked.

**One honest caveat carried forward:** ZF-020's Definition of Done includes *visual* rendering, which **cannot** be confirmed headless. Either install the loader (needs sudo) for a headful pass, or accept that ZF-020 lands "API-verified, visually-pending" until a display run — and say so in its commit.
