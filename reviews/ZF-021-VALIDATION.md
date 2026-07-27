# ZF-021 — Enrollment Manager Validation Report

**Build:** Zen 1.21.7b portable, `zen-float.uc.mjs` @ ZF-021c, **loaded via fx-autoconfig** (real ship path; A1 confirmed: `[ZenFloat] init — internals present; overlay shell ready`).
**Driver:** Marionette chrome context, single `ExecuteAsyncScript` matrix + a double-open smoke test.
**Ground truth per snapshot:** read directly from DOM — `deckSelected` = float container has `deck-selected`; `dsa`/`zma` = the float `<browser>`'s `docShellIsActive`/`zenModeActive`; `efpIsFloat` = `elementFromPoint(float-center)` (frame hidden) resolves to the float browser; `contractHolds` = all three; `floatTabSelected` = is the float tab the selected tab (must be false, I1).

**Signal note (carried, honest):** headless cannot composite OOP pixels, so no literal screenshot of the page inside the float. `efpIsFloat` is the render-tree/hit-test proxy (the float browser is the topmost element at its coords); `reviews/evidence/zf020-overlay-positioning.png` shows the overlay geometry from a prior chrome-screenshot.

## Result matrix

| # | Scenario | Method | Expected | Observed | Verdict |
|---|---|---|---|---|---|
| S1 | Baseline (open float) | driven | contract holds, efpIsFloat, not selected | `deck=t, dsa=t, zma=t, efp=t, holds=t, selected=f` | **PASS** |
| S2 | Ordinary tab switching (×3) | driven (real `selectedTab`) | contract holds after each, never selects float | all 3: `holds=t, efp=t, selected=f` | **PASS** |
| S3 | Rapid switching (×20) | driven | contract holds | `holds=t, efp=t, selected=f` | **PASS** |
| S4 | Observer backstop (strip `deck-selected`) | driven | immediate=removed, then restored before paint | `immediate=false → restored=true` | **PASS** |
| S5 | Fullscreen enter/exit | synthetic `MozDOMFullscreen:*` | enter→suspended, exit→restored | enter `holds=f, deck=f, zma=f`; exit `holds=t` | **PASS (handler)** |
| S6 | Customize mode start/end | synthetic events on `gNavToolbox` | start→suspended, end→restored | start `holds=f`; end `holds=t` | **PASS (handler)** |
| S7 | Workspace change | hook wired; live switch not exercised | change API present, hook registered | `hasChangeApi=true, active=true` | **PARTIAL** |
| S8 | Multi-window | structural (headless can't open 2nd window) | per-window manager | `managerIsPerWindow=true`, distinct per window by construction | **STRUCTURAL** |
| S9 | Teardown / leak | driven (`closeFloat`) | container gone, 0 float tabs, no post-error | `containerGone=t, hasBrowser=f, floatTabsLeft=0, postSwitchOk=t` | **PASS** |
| — | Idempotency (double `openFloat`) | driven smoke | contract holds, clean teardown | `deck=t,dsa=t,zma=t` → `gone=t, left=0` | **PASS** |

## Invariant checks (design §1)

| Invariant | Check | Result |
|---|---|---|
| **I1** — float never `gBrowser.selectedTab` | `floatTabSelected` in every snapshot (S1–S6, S8) | **false everywhere → HOLDS** |
| **I2** — only the float's own container carries our `deck-selected` | only `.zen-float-browser` container observed with `deck-selected`; teardown removed it; no stray | **HOLDS** |
| **I3** — float tab hidden from strip | `[zen-float-tab]` → `display:none` (validated ZF-020c) | **HOLDS (carried)** |
| **I4** — RENDERED ⇒ contract holds | `contractHolds=true` in every RENDERED snapshot; `false` only in intended HIDDEN (S5/S6 suspend) | **HOLDS** |

## Coverage honesty (what was DRIVEN vs SIMULATED vs STRUCTURAL)

- **Driven (real API):** tab switching (ordinary + rapid), observer backstop, teardown/leak, idempotency. These are the load-bearing proofs.
- **Simulated (synthetic events):** fullscreen and customize — the *handlers* (`suspend`/`resume`) are validated by dispatching the real event names on the real targets; the OS/UI fullscreen and the full CustomizeMode DOM rebuild were **not** exercised.
- **Indirectly covered:** **Split View** and **Glance** were not driven as live features. Their relevant failure mode against the float is *external `deck-selected` stripping / deck rebuild*, which is exactly what **S4** exercises (and the design routes both through the MutationObserver backstop + `TabSelect` reassert). This is coverage-by-failure-mode, not feature-drive.
- **Structural:** multi-window (per-window manager + window-scoped listeners) asserted by construction; a live 2nd window hangs in headless.
- **Not exercised:** **session restore** (the float is not session-persisted in v1; re-open after a fresh launch works and init loads); live **workspace switch** (single-workspace profile); literal **OOP paint** (headless).

## Console evidence
`[ZenFloat] init — internals present; overlay shell ready (hidden).` on every launch (fx-autoconfig load). `zen.float.debug=true` in the test profile; no errors emitted during the matrix.

---

# ZF-021d — External float-tab close (C-1) validation

**Build:** same rig, `zen-float.uc.mjs` @ ZF-021d, fx-autoconfig load path. **Driver:** Marionette chrome context, one `ExecuteAsyncScript` matrix.
**New ground truth:** `listeners` = window listener census via `nsIEventListenerService.getListenerInfoFor(window)` for `TabSelect`/`TabClose` — a *direct* measurement of the C-1 leak claim, not an inference. `hasBrowser` = `FloatWindow.hasBrowser`; `floatTabs` = tabs with `[zen-float-tab]`; `floatClassContainers` = `.zen-float-browser` elements.

| # | Scenario | Method | Expected | Observed | Verdict |
|---|---|---|---|---|---|
| S0 | Noise baseline (3 tab open/close, **no float**) | driven | attribute console errors | 3× `handleEvent is not callable` (1 per TabClose) → **pre-existing noise, not ZF** | **BASELINE** |
| S10 | Float open | driven | contract holds, listeners 13/10→14/11 | `deck=t, dsa=t, zma=t, holds=t, selected=f`, `14/11` | **PASS** |
| S11 | **Unrelated** tab closes | driven | float untouched (design §3) | `holds=t, hasBrowser=t, floatTabs=1`, listeners `14/11` | **PASS** |
| S12 | **External close of the float tab** (`gBrowser.removeTab`, bypasses `detach`) | driven | `unenroll`+`onFatal`; no throw; no leak | `removeThrew=f`, `tabGone=t`, `hasBrowser=f`, `floatTabs=0`, `floatClassContainers=0`, overlay hidden, listeners **13/10** | **PASS** |
| S13 | Post-fatal tab churn (×3) | driven | inert; no dead-handle writes/errors | no float artifacts; error rate identical to S0 baseline (3 for 3 closes) | **PASS** |
| S14 | Re-open after fatal | driven | state clean, not wedged | `reopenOk=t`, `holds=t`, listeners back to `14/11` | **PASS** |
| S15 | Owner close path + double close | driven | unchanged from S9 | `teardownClean=t`, `floatTabs=0`, listeners `13/10`, second `closeFloat()` no-op | **PASS** |

**Defect found by driving this path (F-5, fixed):** the first ZF-021d build wired `onFatal → detach()`, whose `removeTab` re-entered `tabbrowser.removeTab` on an already-closing tab and ran `_endRemoveTab` inside the outer `_beginRemoveTab` → `removeThrew=true`, `TypeError: can't access property "removeProgressListener", browser.webProgress is undefined @ tabbrowser.js:6180`. Fixed via `detach({ removeTab:false })` on the fatal path; re-run is clean. Full analysis in `reviews/ZF-021-CODE-REVIEW.md` (addendum).

**Coverage honesty (ZF-021d):** all rows above are **driven on a real build** (real `gBrowser.removeTab`, real `TabClose` dispatch, real listener census). The float tab was closed *by script* — equivalent to the "close other tabs"/session-op path at the tabbrowser level (same `removeTab` entry point), but the **UI** affordances ("Close Other Tabs" menu, session restore closing it) were **not** exercised. Tab **adoption into another window** (`TabClose` with `detail.adoptedBy`) is treated as fatal by construction and was **not** driven (headless second window).

## Verdict
The proven render contract is **maintained across tab switching (ordinary + rapid), restored synchronously after external `deck-selected` removal, and correctly suspended/resumed on fullscreen and customize**, with **leak-free teardown** and **all four design invariants holding**. Residual coverage gaps (live workspace switch, live split/glance/fullscreen/customize UI, multi-window, session restore, OOP pixels) are environmental (headless / single-workspace) and, where load-bearing, are covered by their failure mode. See `reviews/ZF-021-CODE-REVIEW.md` for the adversarial review. **The open condition (TabClose/onFatal) is closed as of ZF-021d — see the section above.**
