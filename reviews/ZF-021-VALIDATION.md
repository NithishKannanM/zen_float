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

## Verdict
The proven render contract is **maintained across tab switching (ordinary + rapid), restored synchronously after external `deck-selected` removal, and correctly suspended/resumed on fullscreen and customize**, with **leak-free teardown** and **all four design invariants holding**. Residual coverage gaps (live workspace switch, live split/glance/fullscreen/customize UI, multi-window, session restore, OOP pixels) are environmental (headless / single-workspace) and, where load-bearing, are covered by their failure mode. See `reviews/ZF-021-CODE-REVIEW.md` for the adversarial review and the one open condition (TabClose/onFatal).
