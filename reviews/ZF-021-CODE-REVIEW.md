# ZF-021 — EnrollmentManager Code Review (adversarial)

**Reviewer stance:** attempt to reject. Approve only if every design invariant (design/ZF-021-RENDER-LIFECYCLE.md §1) holds.
**Under review:** `src/zen-float.uc.mjs` @ ZF-021c (`EnrollmentManager` + FloatWindow wiring). Commits `9123b45` (a), `a11e564` (b), `<idempotency>` (c).

> **UPDATE (ZF-021d):** condition **C-1 is RESOLVED** by restoring the design's `TabClose` hook (option (a), the recommended one). Driving that path on the real build then exposed a **new defect (F-5)**, now fixed. Verdict upgraded to **APPROVED** — see the addendum at the end.

## Verdict: **APPROVE WITH ONE CONDITION** *(superseded — see addendum)*

Every rendering invariant (I1–I4) holds and is validated (ZF-021-VALIDATION.md). One self-review defect was found and fixed. One **design-vs-ticket conflict** remains open (C-1) and must be reconciled — it is not an invariant violation but an unimplemented design-mandated recovery path, forced by this ticket's hook constraint.

---

## Findings

### F-1 — enroll() not idempotent → observer/listener leak. **[FIXED — ZF-021c]**
A second `enroll()` armed a second `MutationObserver` (orphaning the first) and pushed duplicate listeners. Design requires idempotent methods. **Fixed:** `#armObserver`/`#armListeners` now disarm-before-arm. Verified by double-`openFloat` smoke (contract intact, clean teardown).

### C-1 — External float-tab close is undetected (design mandates it; ticket forbids the hook). **[OPEN CONDITION]**
- **Design** (§3 event matrix, §6 failure recovery) mandates: `TabClose(float)` → `unenroll` + `onFatal`; "hidden float tab closes → recover."
- **This ticket's** *Required Integration* lists only {TabSelect, Workspace, MozDOMFullscreen, Customize, MutationObserver, Browser shutdown} and says "Do NOT hook anything else." **TabClose is excluded.**
- **Consequence:** if the hidden float tab is closed by external means (e.g. "close other tabs", a script, session op) *without* going through `FloatWindow.detach`, the `EnrollmentManager` retains a dead handle and **armed window-level listeners until `unload`** (a bounded, per-window leak). `onFatal` is wired (`() => this.detach()`) but **never triggered** → currently dead.
- **Severity:** Low-Med. Bounded (one stale handle + a fixed listener set per window; cleared on window close). Not an I1–I4 violation. But it is a **deviation from the design's failure-recovery contract**, caused by obeying the ticket's hook constraint.
- **Required action:** reconcile before "design-complete." Either (a) restore the `TabClose` hook the *design* specifies (recommended — it is in the approved design), or (b) formally re-scope the design to move float-tab-close detection to the owner (`FloatWindow`) and document the bounded-leak-until-unload. **Do not silently leave both.**

### F-2 — Overlapping fullscreen + customize suspend/resume. **[NOTE, theoretical]**
`suspend` is guarded by `state==="hidden"` (second suspend no-ops) and `resume` by `state==="rendered"`. If fullscreen-exit `resume` fires while a customize DOM rebuild is mid-flight, the re-resolved container could be transiently stale. **Unreachable in practice** (CustomizeMode is not available in DOM-fullscreen). Left as a documented edge; the MutationObserver + next `reassert` would self-heal regardless.

### F-3 — `#container()` stale fallback. **[ACCEPTED]**
If `browser.closest(".browserSidebarContainer")` returns null (browser detached), `#container()` falls back to the cached `handle.container`. Writing `deck-selected` to a detached node is a harmless no-op (not in the render tree). Acceptable; documented.

### F-4 — Microtask coalescing — "is this a hidden scheduler?" **[DEFENDED]**
`#scheduleReassert` uses `Promise.resolve().then()`. A microtask is **not** a timer (`setTimeout`) or polling; it drains deterministically at the end of the current task. No `setInterval`/`setTimeout`/retry anywhere. After `destroy()`, a pending microtask's `reassert` no-ops (`state==="detached"`). Complies with "event-driven only, no timers/polling/retries."

---

## Compliance checklist (design §9)

| Check | Result | Evidence |
|---|---|---|
| **No render races** | PASS | single idempotent `reassert` funnel; MutationObserver synchronous pre-paint backstop (S4: strip→restore); microtask coalescing for bursts (S3 ×20 holds) |
| **No selection stealing (I1)** | PASS | grep: no `selectedTab =` in EnrollmentManager; `floatTabSelected=false` in every snapshot |
| **No layout thrashing** | PASS | all contract writes conditional on current value (`if (!contains)…`, `if (x !== true)…`) → no redundant DOM/property writes |
| **No leaked BrowserHosts** | PASS | `EnrollmentManager` borrows, never owns; `destroy()`→`unenroll` disarms observer+listeners+workspace cb; FloatWindow nulls `#enrollment` |
| **No leaked hidden tabs** | PASS (with C-1 caveat) | S9: `floatTabsLeft=0` after `closeFloat`; **but** external-close path (C-1) leaves a stale handle until unload |
| **No broken deck invariants (I2)** | PASS | only the float's own container is ever classed; other panels never touched; `deck-selected`, not `zen-split` (Split View's) |
| **No compatibility regressions** | PASS (bounded coverage) | Glance/Split failure mode covered by S4 observer; fullscreen/customize handlers PASS; live UI not driven (headless) |
| **Idempotency** | PASS | F-1 fixed; double-`openFloat` smoke clean |
| **Event ordering / determinism** | PASS | enroll applies contract *then* arms observer (no self-trigger); observer guards `state!=="rendered"` (won't fight suspend) |
| **Memory ownership** | PASS | one handle + one observer + fixed listener set per window; `onFatal` nulled on destroy |
| **Browser lifecycle** | PASS | `unload`→`destroy`; no cross-window state; per-window manager (S8 structural) |

## Adversarial summary
I tried to reject on: idempotency (found → **fixed**), timer/polling (**defended**, microtask), selection stealing (**clean**), leaks (**clean** except C-1), render races (**backstopped**). The only surviving issue is **C-1**, a design-mandated recovery path deliberately unimplemented because this ticket forbade the `TabClose` hook — a **spec conflict**, not a coding error.

## Approval
**APPROVED WITH CONDITION C-1.** All rendering invariants I1–I4 hold and are validated. Merge-eligible for the render-lifecycle scope; **C-1 (TabClose/onFatal) must be reconciled** (restore the design's hook, or formally re-scope) before ZF-021 is declared design-complete. No other blocking findings. **Stop here — do not proceed to ZF-022.**

---

# Addendum — ZF-021d: C-1 reconciled, F-5 found and fixed

**Under review:** `src/zen-float.uc.mjs` @ ZF-021d. **Evidence:** driven matrix on the portable 1.21.7b rig via fx-autoconfig + Marionette (`reviews/ZF-021-VALIDATION.md` §ZF-021d).

### C-1 — RESOLVED (option (a): restore the design's hook)
`EnrollmentManager` now hooks `window` `"TabClose"` and, when `event.target` is the float tab, runs the design's §6 recovery: **`unenroll` first** (drop observer/listeners/contract — never leave a live hook on a dead tab), **then** fire `onFatal` **once** (`#onFatal` is nulled before the call, so the owner's re-entrant `destroy()` cannot re-fire it). Any other tab closing is ignored (design §3: "TabClose (other tab) → none"). The `TabClose` hook is one of the design's *accepted* hooks (§4) — the ticket's narrower hook list was the deviation, and it is now reconciled toward the approved design.

**Leak claim measured directly, not asserted:** window listener census via `nsIEventListenerService.getListenerInfoFor(window)` — `TabSelect`/`TabClose` counts go 13/10 (baseline) → 14/11 (float open) → **13/10 after an external close** and 13/10 after the owner path. The bounded per-window leak C-1 described is gone, by measurement.

### F-5 — Re-entrant `removeTab` during `TabClose` corrupted tabbrowser's close sequence. **[FOUND BY DRIVING THE PATH — FIXED]**
Wiring `onFatal` to `FloatWindow.detach()` (which removes the tab) was **wrong**, and only showed up once the path was actually driven:
- `_beginRemoveTab` sets `aTab.closing = true`, then dispatches `TabClose` **before any teardown**.
- Our handler → `onFatal` → `detach()` → `gBrowser.removeTab(floatTab)` → `removeTab`'s fastpath `if (!animate && aTab.closing) { this._endRemoveTab(aTab); return; }` (`animate` has **no default** → `undefined`) ran `_endRemoveTab` **synchronously inside the outer `_beginRemoveTab`**, destroying the browser mid-close.
- The outer frame then threw: `TypeError: can't access property "removeProgressListener", browser.webProgress is undefined @ tabbrowser.js:6180`.
- **Observed:** `removeThrew=true` on the first ZF-021d build. **Fix:** `detach({ removeTab })`; `onFatal = () => this.detach({ removeTab: false })` — the owner drops references, tabbrowser finishes its own close. **Re-run: `removeThrew=false`**, tab gone, state clean. Design §6 updated with the constraint.

Note this defect was *latent in the C-1 recommendation itself* ("`onFatal` is wired (`() => this.detach()`)"): had the hook been added without driving it, the fatal path would have shipped throwing inside tabbrowser.

### Console-error attribution (honesty check)
A recurring `TypeError: Property 'handleEvent' is not callable.` appears in the headless log. Attributed by measurement, not assumption: a **no-float baseline** of 3 tab open/close cycles emits **3** of them — the same 1-per-`TabClose` rate observed with the float open and after the fatal path. **Pre-existing Zen/headless noise, not ZF.**

### Re-checked findings
- **F-1** (idempotency), **F-2/F-3/F-4** — unchanged; the new listener is armed/disarmed through the same idempotent `#armListeners`/`#disarmListeners` pair (census confirms no double-registration across open→close→re-open).
- **I1–I4** — re-verified in the ZF-021d matrix (`floatTabSelected=false` throughout; contract holds at S1/T1/T4; cleanly absent after teardown).

### Approval (updated)
**APPROVED.** C-1 reconciled per the approved design; F-5 found by driving the previously-undriven path and fixed with a source-grounded change. ZF-021 is **design-complete** for the render-lifecycle scope. Remaining gaps are unchanged and documented (live workspace switch, live split/glance/fullscreen/customize UI, multi-window, session restore, OOP pixels).
