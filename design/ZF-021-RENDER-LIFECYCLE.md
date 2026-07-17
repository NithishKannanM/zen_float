# ZF-021 — Persistent Render Enrollment: Rendering Lifecycle Design

**Type:** Architecture/design only — no implementation code, no production edits.
**Basis:** EXP-002E proven contract (`deck-selected` | `zen-split` **AND** `docShellIsActive`), + shipped-source behavior (`tabbox.js`, `browser-custom-element.mjs`, `AsyncTabSwitcher.sys.mjs`, `TabUnloader.sys.mjs`, `ZenGlanceManager.mjs`, `ZenViewSplitter.mjs`).
**Scope:** the *render lifecycle* of one persistent, never-selected, hidden float BrowserHost. The chrome frame (F-1 occlusion) and geometry/drag are out of scope.

## Foundational decisions (from source)

- **Marker = `deck-selected`, NOT `zen-split`.** Both satisfy the CSS gate (`:is(.deck-selected, [zen-split="true"])`), but `zen-split` is semantically owned by Split View (`ZenViewSplitter` enumerates `zen-split` panels); adopting it would make Split View mis-claim the float. `deck-selected` is the generic deck marker, and multiple simultaneous `deck-selected` panels are already a supported pattern (Glance parent+overlay; Split columns).
- **`tabbox.js:245-246` only touches the *selected transition* panels** (`oldPanel`, `_selectedPanel`). A float that is **never selected** is neither → its `deck-selected` is **not stripped on ordinary tab switches**. Enrollment is therefore mostly *self-persisting*; maintenance is needed only for (a) content deactivation on deselect and (b) deck-rebuilding operations.
- **`zenModeActive = true` is REQUIRED for persistence** (this is the EXP-002F residual, now resolved by source): `AsyncTabSwitcher.shouldDeactivateDocShell()` returns *don't-deactivate* iff `browser.zenModeActive` (`:941`), and the `docShellIsActive` setter keeps `renderLayers = val || zenModeActive` (`browser-custom-element.mjs:511`). Without it, the float's compositing dies on the first tab switch. `TabUnloader:54` also spares `zenModeActive` browsers from discard.
- **Selection is never used to render** (forbidden requirement). The contract is applied directly.

**Persistent render contract (steady state):** `container.classList.contains("deck-selected") === true` **AND** `browser.docShellIsActive === true` **AND** `browser.zenModeActive === true`.

---

## 1. Rendering State Machine

```
 DETACHED ──attach()──► ATTACHED ──enroll()──► ENROLLED ──composite()──► RENDERED
    ▲                      │                       │                        │  ▲
    │                      │                       │                   hide()│  │show()
    │                      └───────────────────────┴──────────► (any) ───────▼  │
    │                                                              HIDDEN ───────┘
    └──────────────────────────── destroy() ◄─────────────────── (any) ── DESTROYED
```

| State | Entry condition | Invariants | Exit condition |
|---|---|---|---|
| **DETACHED** | no float tab/browser | no float tab exists; no listeners armed | `attach()` creates BrowserHost |
| **ATTACHED** | float tab+browser exist (hidden `[zen-float-tab]`, unselected) | tab hidden from strip; **not** selected; not yet enrolled | `enroll()` |
| **ENROLLED** | `deck-selected` added to container | container has `deck-selected`; panel is shown/stacked; content may be inactive | `composite()` (→RENDERED) or `hide()` |
| **RENDERED** | `docShellIsActive=true` + `zenModeActive=true` | **contract holds**; `renderLayers=true`; browser never selected; exactly this container carries our `deck-selected` | event breaks contract → self-heal (stay RENDERED); `hide()`; `destroy()` |
| **HIDDEN** | deliberate suppression (bubble collapse, fullscreen policy, out-of-scope workspace) | `deck-selected` removed **and/or** `docShellIsActive=false`; `zenModeActive` may stay true to keep warm, or false to suspend; tab still alive | `show()` → re-`enroll()`+`composite()` → RENDERED |
| **DESTROYED** | float closed / tab gone | all listeners+observer removed; `deck-selected` removed; tab removed; refs nulled | `attach()` → back to ATTACHED |

**Global invariants (all states except DESTROYED):**
- I1 — the float browser is **never** `gBrowser.selectedTab`.
- I2 — exactly one container (the float's own) carries the float's `deck-selected`; the manager never adds/removes `deck-selected` on any other panel.
- I3 — the float tab is always `[zen-float-tab]` (hidden from strip).
- I4 — RENDERED ⇒ contract holds; any observed violation triggers self-heal, not a state change.

---

## 2. Enrollment Manager

A component that **maintains render state only**. It does **not** own the BrowserHost (create/spawn/removeTab), does **not** own geometry/frame, does **not** decide policy (scope/auto-hide). It receives a handle and keeps the contract satisfied.

**Handle (borrowed, not owned):** `{ tab, browser, container }` (container = `browser.closest(".browserSidebarContainer")`).

**Responsibilities**
- Apply and maintain: `deck-selected` (container), `docShellIsActive=true`, `zenModeActive=true`.
- Detect external contract violations and restore them before paint (no flicker).
- Suspend/resume on policy request (`hide()`/`show()`), without destroying the tab.
- Surface fatal conditions (tab externally closed) to the owner via callback.

**Public API (contracts, not code)**
| Method | Contract |
|---|---|
| `enroll(handle)` | idempotent; applies the full contract; arms the MutationObserver + event listeners; → RENDERED. Safe to call repeatedly. |
| `unenroll(handle)` | removes `deck-selected`, clears `zenModeActive`, sets `docShellIsActive=false`; disarms observer+listeners; → DETACHED-ready. Does **not** remove the tab (owner's job). |
| `reassert(handle)` | idempotent self-heal; writes **only** the sub-properties that currently differ from the contract; returns what it corrected. No-op when already satisfied. |
| `suspend(handle)` / `resume(handle)` | HIDDEN ↔ RENDERED; suspend drops `deck-selected` (+ optionally `docShellIsActive`), resume re-applies. |
| `isRendered(handle)` | true iff contract holds right now. |
| `onFatal(cb)` | owner callback for "float tab closed/gone externally". |

**Lifecycle:** created per-window by the float owner (mirrors ZF-001 per-window manager). `enroll` at ATTACHED→RENDERED; `reassert` on matrix events + observer; `unenroll` at teardown.

**Failure handling / recovery:** all writes wrapped and idempotent; a missing `browsingContext` (browser not built yet) defers to the next event/observer tick rather than throwing; if `container` is stale (re-created by a deck rebuild) it is re-resolved from `browser.closest(...)` before writing.

---

## 3. Event Matrix

"Required rendering state" is RENDERED unless policy (scope/fullscreen) dictates HIDDEN. "Transition" = what the manager does. Default action = **`reassert` (idempotent)**; only listed exceptions differ.

| Event | Current | Required | Manager action | Invariant checked |
|---|---|---|---|---|
| **TabSelect** (switch away/in) | RENDERED | RENDERED | `reassert` (tabbox leaves float's `deck-selected`; `zenModeActive` blocks deactivation — reassert is a cheap backstop) | I1 (float still not selected), contract |
| **TabOpen** (other tab) | RENDERED | RENDERED | none (float unaffected) | I2 (didn't touch others) |
| **TabClose** (other tab) | RENDERED | RENDERED | none | contract |
| **TabClose (float tab)** | RENDERED | DESTROYED | `unenroll` + `onFatal` → owner recreates or dismisses | no leaked tab |
| **Workspace change** | RENDERED | RENDERED (global) / HIDDEN (scoped) | global: `reassert`; scoped: `suspend`/`resume` per active-space match | I1, scope policy |
| **Split View enter/exit** | RENDERED | RENDERED | `reassert` after split DOM settles; verify float not in a split group | I2, float excluded from split |
| **Glance open/close** | RENDERED | RENDERED | `reassert` (Glance mutates only glance-id panels; float coexists) | I2 |
| **Fullscreen enter** | RENDERED | HIDDEN (policy) | `suspend` (float must not cover FS content) | no FS occlusion |
| **Fullscreen exit** | HIDDEN | RENDERED | `resume` | contract restored |
| **Window focus** | any | unchanged | none (compositing independent of focus) | — |
| **Window blur** | any | unchanged | none | — |
| **Browser startup** | DETACHED | per owner | owner opens float post-delayed-startup → `enroll` | ordering (§5) |
| **Browser shutdown** | any | DESTROYED | `unenroll`; owner removes tab | no leaked host/tab |
| **Customize Mode start** | RENDERED | HIDDEN | `suspend` (customize rebuilds chrome/tabpanels) | survives rebuild |
| **Customize Mode end** | HIDDEN | RENDERED | re-resolve container, `enroll`/`resume` | contract restored |
| **Session restore** | DETACHED | per owner | float not restored as live tab (v1 JSON); owner re-opens post-restore → `enroll`; stray restored float tab → detect+clean | no leaked hidden tab |
| **deck-selected removed (observer)** | RENDERED | RENDERED | `reassert` synchronously (backstop) | flicker-free restore |

---

## 4. Source-backed Integration Points

Each hook justified from shipped source; wrong hooks rejected.

**Accepted hooks**
| Hook | Source justification | Why correct |
|---|---|---|
| `window` `"TabSelect"` | Glance registers exactly this (`ZenGlanceManager` setup) | fires on every selection change; the moment `AsyncTabSwitcher` may deactivate — reassert here |
| `window` `"TabClose"` | tabbrowser standard | distinguish float-tab close (fatal) from others |
| `gZenWorkspaces.addChangeListeners(...)` | EXP-001B confirmed public API (`addChangeListeners`/`removeChangeListeners`) | official Zen workspace-change signal; no polling |
| `window` `"MozDOMFullscreen:Entered"` / `":Exited"` | Glance listens to `MozDOMFullscreen:Entered` | canonical fullscreen signal |
| `window` `"customizationstarting"` / `"aftercustomization"` | Firefox CustomizeMode standard events | tabpanels/chrome is rebuilt during customize |
| **MutationObserver** on the float `container` `class` attribute | `tabbox.js:245`/`ZenViewSplitter`/`ZenGlanceManager` all mutate `deck-selected` via `classList` | deterministic, synchronous backstop for *any* external `deck-selected` removal — the only reliable way to catch third-party deck rebuilds without polling |
| Split View: observe `#tabbrowser-tabpanels` `zen-split-view` attribute (MutationObserver) **or** a `gZenViewSplitter` event if exposed | `ZenViewSplitter` toggles `zen-split-view` on tabpanels | reassert after split reshapes the deck |

**Rejected hooks**
| Rejected | Why |
|---|---|
| Patching `set selectedTab` / `tabbox.js` | core patch — fragile, unnecessary (tabbox doesn't touch a never-selected float), and out of a Mod's reach |
| Reusing `gZenGlanceManager.shouldShowDeckSelected` | Glance-specific; keyed to `glance-id`; the float has none |
| `gBrowser.selectedTab = floatTab` to force render | violates I1 (selection stealing) — explicitly forbidden |
| Polling `docShellIsActive` / rAF loop | violates "no polling"; `zenModeActive` + events + observer already cover it |
| Listening on `gBrowser.tabContainer` per-tab | float has no strip presence; window-level `TabSelect` is the correct scope |

---

## 5. Race Analysis (deterministic ordering)

| Scenario | Race | Deterministic rule |
|---|---|---|
| **Startup** | enroll before `gBrowser`/browser exists | enroll only after ZF-001's `browser-delayed-startup-finished` init **and** the float browser's `browsingContext` exists; `SessionStore.promiseAllWindowsRestored` is already awaited by `gZenStartup` before that fires |
| **Rapid tab switching** | many TabSelect in quick succession | `reassert` is idempotent + O(1); coalesce multiple sync events into one microtask (dirty-flag) so at most one write burst per frame |
| **Workspace switching** | reassert before the workspace's own DOM settles | drive `reassert` **from** the `addChangeListeners` callback (fires after the switch), never before; re-resolve container first |
| **Multiple windows** | cross-window contention on one float | per-window manager owns only its window's float tab; no shared mutable state; a float tab belongs to exactly one `gBrowser` |
| **Split View enter/exit** | reassert during split's own deck mutation | reassert on the **trailing** edge (after `zen-split-view` attribute settles via observer), and assert float is not in any split group before writing |
| **Glance open** | Glance selects its tab → TabSelect fires mid-Glance-setup | reassert is safe/idempotent; it only re-adds the float's own `deck-selected` and never touches glance panels (I2) |
| **Glance close** | Glance removes deck-selected on its panels | float's container is a different node; unaffected; observer would catch an errant removal anyway |
| **Session restore** | a persisted float tab races re-open | v1 does not persist the float as a live tab; on restore, detect any stray `[zen-float-tab]` and clean before the owner re-opens |
| **MutationObserver vs event reassert** | double restore | both call the same idempotent `reassert`; second is a no-op |

**Ordering primitive:** every reassert path funnels through one idempotent `reassert(handle)` guarded by a per-frame dirty flag; the MutationObserver is a synchronous pre-paint backstop. No two paths write conflicting state because writes are conditional on *current* value.

---

## 6. Failure Recovery

**`deck-selected` removed unexpectedly (e.g., a deck rebuild, split op, future core change):**
- **Detect:** MutationObserver on the container's `class` attribute → fires synchronously in the same task as the removal, **before** the next paint.
- **Restore:** `reassert` re-adds `deck-selected` immediately in the observer callback.
- **Flicker prevention:** because the observer callback runs before the compositor paints the frame, the removal never reaches the screen → no visible flash. (If the container element itself was replaced, re-resolve via `browser.closest(".browserSidebarContainer")` first.)

**`docShellIsActive` became false (deselect, suspend, external):**
- With `zenModeActive=true`, `renderLayers` stays true (`browser-custom-element.mjs:511`) so compositing does not actually drop on deselect — this is the primary guard.
- Backstop: `reassert` on `TabSelect`/matrix events re-sets `docShellIsActive=true`. No polling.

**Hidden float tab closed externally (e.g., "close other tabs", session op):**
- **Detect:** `TabClose` whose target is the float tab.
- **Recover:** `unenroll` (drop observer/listeners cleanly), fire `onFatal` → the owner decides recreate-vs-dismiss per policy. Guarantees no leaked observer referencing a dead tab and no orphaned `deck-selected`.

---

## 7. Interaction Matrix

| Feature | Verdict | Evidence / coordination |
|---|---|---|
| **Glance** | Compatible | tabbox touches only selected/old panels; Glance mutates only `glance-id` panels; float has no `glance-id`. Coordination: `reassert` on open/close (cheap). |
| **Split View** | Needs coordination | `ZenViewSplitter` uses `zen-split` + enumerates split groups; float uses `deck-selected` and is not in any group. Must reassert after `zen-split-view` toggles and confirm float excluded. |
| **Pinned Tabs / Essentials** | Compatible | float is its own hidden tab; pinned/essentials are independent tab states. |
| **Collapsed Sidebar** | Compatible | sidebar collapse is chrome layout; render enrollment is content-area/deck state — orthogonal. |
| **Compact Mode** | Needs coordination (frame only) | enrollment/compositing unaffected; the *frame geometry* (C3 residual) may need reposition — out of this component's scope. |
| **Workspaces** | Needs coordination | `gZenWorkspaces.addChangeListeners` drives `reassert`/`suspend` per scope policy (global vs workspace-scoped). |
| **Picture-in-Picture** | Compatible | `AsyncTabSwitcher.shouldDeactivateDocShell` and `TabUnloader` already special-case PiP separately from `zenModeActive`; no conflict. |
| **Find Bar** | Compatible | findbar is per-browser UI; the float browser can host its own. |
| **DevTools** | Compatible | DevTools attaches to a browser/tab; the float browser is a normal remote browser. |
| **Multi-window** | Compatible | per-window manager; float tab bound to one `gBrowser`; no cross-window state. |
| **Customize Mode** | Needs coordination | rebuilds chrome/tabpanels → `suspend` on start, re-`enroll` (re-resolve container) on end. |

No verdict is **Impossible**; the two **Unknown-until-tested** edges are Split-View-with-float-open and Customize-Mode round-trip (flagged for the ZF-021 test plan, not this design).

---

## 8. Performance

- **Reevaluations/sec:** bounded by *event frequency*, not time. Human tab/workspace switching ≈ ≤5–10/s worst case; MutationObserver fires only on actual `class` changes. **No polling → ~0 idle cost.**
- **Per reassert:** read 3 booleans (`classList.contains`, `docShellIsActive`, `zenModeActive`), write only those that differ → **≤3 conditional writes**, O(1). `classList.contains`/property reads do not force layout/reflow.
- **DOM mutations:** at most one `classList` toggle per genuine violation (idempotent guard prevents redundant writes → **no layout thrash**). `docShellIsActive`/`zenModeActive` are property setters (no DOM mutation).
- **Observer cost:** one `MutationObserver` on one element, one attribute (`class`) → negligible.
- **Batching:** coalesce synchronous event bursts via a per-frame dirty flag; the observer path stays synchronous (must beat paint).
- **Complexity:** O(1) per event; O(1) memory (one handle + one observer + a fixed listener set per window).

---

## 9. Reviewer Checklist (Mozilla-style)

- [ ] **No render races:** every mutation path funnels through one idempotent `reassert`; MutationObserver is a synchronous pre-paint backstop; per-frame dirty-flag coalescing.
- [ ] **No selection stealing:** `gBrowser.selectedTab` is never written (I1); grep the change for `selectedTab =` → none.
- [ ] **No layout thrashing:** writes are conditional on current value; no unconditional `classList` toggles; no forced reflow reads interleaved with writes.
- [ ] **No leaked BrowserHosts:** `unenroll` disarms observer+listeners; `onFatal` handed to owner; teardown verified on window close.
- [ ] **No leaked hidden tabs:** float `TabClose` handled; stray `[zen-float-tab]` cleaned on session restore; owner removes tab on destroy.
- [ ] **No broken deck invariants:** manager only ever adds/removes `deck-selected` on the **float's own** container (I2); never touches other panels; never uses `zen-split` (Split View's marker).
- [ ] **No compatibility regressions:** interaction matrix (§7) exercised; Glance/Split/Workspace/Fullscreen/Customize round-trips leave both the float and the feature intact.
- [ ] **Contract preservation:** after each matrix event, `isRendered(handle)` is true (or intentionally HIDDEN per policy).
- [ ] **Determinism:** enroll gated on delayed-startup + `browsingContext`; no polling anywhere.

---

## Success-criteria check
Satisfies the proven contract (deck-selected + docShellIsActive), adds only the source-justified persistence flag (`zenModeActive`), **never** abuses `selectedTab`, maintains rendering across tab/workspace/split/glance/fullscreen/customize via idempotent reassert + a synchronous observer backstop, is deterministic (single reassert funnel, gated ordering, no polling), and is review-ready (§9). **Design only — no implementation, no production changes.**

## Open follow-ups (not part of this design)
- **EXP-002F** (empirical): confirm the persistence path on a **headful** run — deck-selected survival + `zenModeActive` compositing across real tab/workspace/split switches, and the two Unknown interaction edges.
- **F-1** (separate defect): the chrome frame occlusion — orthogonal to this render lifecycle.
