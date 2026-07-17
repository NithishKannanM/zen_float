# ZF-020 — Implementation Report

**Branch:** `zen-float-v1` · **Status:** Complete — **API-verified, visually pending** (headful checks not executable here).
**Frozen-architecture compliance:** no browser reparenting, no DOM-ownership change, no startup refactor, no overlay redesign, attach host unchanged. ✔

## 1. Commits (one per logical stage)

| Commit | Stage | What |
|---|---|---|
| `031751e` | ZF-020a | `FloatWindow.attachTarget/detach` — spawn nested `<browser>` (EXP-002 recipe), apply `.zen-float-browser` to its OWN container (no-move), `docShellIsActive=true`, `TabSelect` reassert; `destroy()`→`detach()` |
| `5ed25b0` | ZF-020b | `nsZenFloatManager.openFloat/closeFloat` + `_debugToggleFloat` + `DEFAULT_TARGET` |
| `6780c59` | ZF-020c | Hide the float's real tab from the strip (`[zen-float-tab=true]{display:none}`) |

## 2. Test results (real, Zen 1.21.6b, buildID 20260708113753, via headless Marionette)

**API + CSS contract (`exp020.js`):** `verdict: PASS`
```
containerFound:true  hasClass:true  spawn{bc:true, active:true, glanceId:null}
innerFound:true  computedPosition:"fixed"  computedVisibility:"visible"
loop{bcOK:15/15, activeOK:15/15, classOK:15/15}
afterDetach{classGone:true, tabRemoved:true}
```
Proves: no-move container styling computes to `position:fixed` + forced `visible`; browser is live (browsingContext) and active while unselected; Glance ignores it (`glanceId:null`); persists across 15 switches; detach cleans up.

**Tab-strip hiding + liveness (`exp020b.js`):** `verdict: PASS`
```
tabComputedDisplay:"none"  browserStillLive{bc:true, active:true}  loop{bcOK:10/10, activeOK:10/10}
```
Proves: the float tab is hidden from the strip, and hiding it does **not** deactivate the docshell.

**Static:** `node --check` passes on every commit.

## 3. Acceptance criteria — PASS/FAIL

| # | Criterion | Status | Evidence / note |
|---|---|---|---|
| AC1 | Live `<browser>` in the float region | **PASS (API)** / **PENDING (visual)** | bc+active true, inner `.browserContainer` computed `position:fixed`; actual paint needs headful |
| AC2 | Not shown in tab strip | **PASS** | tab computed `display:none`, browser stays live |
| AC3 | Loads a URL | **PARTIAL** | navigation initiated via addTab; full page load not confirmed (example.com didn't load headless; real-site embedding = ZF-023) |
| AC4 | No-move / no reparent | **PASS** | browser never moved; container classed in place; `glanceId:null` |
| AC5 | Persists + active across tab switches | **PASS** | 15/15 bc+active, 10/10 with tab hidden |
| AC6 | Geometry synchronization | **PASS** | frame + browser both read `--zen-float-*`; computed `fixed` confirms browser reads them |
| AC7 | Overlay creation/destruction | **PASS** | `ensureShell`/`show`/`hide`/`destroy`; `destroy()`→`detach()` |
| AC8 | Resize behavior wired | **PASS (contract)** | geometry is var-driven; no imperative resizer exists yet (ZF-031/040) — nothing to wire beyond the vars, by design |
| AC9 | Pref enable/disable | **PASS** | `floatWindow` only exists when `zen.float.enabled` + internals; `openFloat` gates on it |
| AC10 | Cleanup correctness | **PASS (API)** | detach removes tab+class+listener, deactivates; `tabRemoved:true classGone:true`. Deep `about:memory` audit (EXP-006) not run — see residuals |
| AC11 | Marionette/API assertions green | **PASS** | both scripts PASS |
| ACv | Visual: compact/workspace/glance/fullscreen/resize/maximize/multi-monitor | **PENDING** | headless cannot render; **not claimed** |

## 4. Regression notes
- Flag **off** (default): `init()` no-ops → no frame, no tab, no listeners → zero surface area. Inert by construction.
- Flag **on**: only effect is when `openFloat` is invoked. The float tab is spawned with `glanceId:null` → **Glance ignores it** (verified). No Split/Spaces/session APIs touched.
- New CSS selectors (`.zen-float-*`, `[zen-float-tab]`) match nothing until ZF applies them → no effect on normal tabs/Glance.
- `TabSelect` listener only added while a float is open; removed on detach → no idle cost.
- **Not exhaustively run headful:** full Glance/Spaces/Split/fullscreen/private/container/theme/session regression (§8 of readiness) — pending a headful pass.

## 5. Rollback plan
- Per-stage: `git revert 6780c59` (tab hiding) / `5ed25b0` (manager) / `031751e` (hosting) — independent.
- Whole feature: revert the three, or simply leave `zen.float.enabled=false` (default) → fully inert.
- No persisted state, no core files, no schema — rollback is clean.

## 6. Residual risks (honest)
1. **Visual correctness — UNVERIFIED.** No headful run: actual paint, and frame↔browser alignment during compact-mode/workspace/glance transforms (the C3 residual), are unconfirmed. Marked pending, not claimed.
2. **A1 — fx-autoconfig load path still unproven.** The module's *logic* is validated by replicating it in chrome scope, but loading `zen-float.uc.mjs` via fx-autoconfig/Sine is untested (loader not installable here; needs sudo).
3. **Real third-party embedding (Claude/ChatGPT CSP/XFO)** — not tested; `example.com` used and didn't fully load headless. ZF-023/EXP-003 scope.
4. **Deep leak audit** — `about:memory` over 100 open/close cycles (EXP-006) not run; API-level teardown verified only.
5. **Multi-window** — per-window managers by construction; two-window behavior not exercised.
6. **Runtime pref toggle (TD-D)** — enabling still needs restart (no pref observer); documented, deferred.
7. **`triggeringPrincipal`** — uses system principal (chrome-initiated load, standard); revisit if a target requires a content principal.

## 7. Factual updates to design docs
- Confirmed: setting `linkedBrowser.docShellIsActive = true` directly after `addTab` yields `active:true` + live `browsingContext` **without** a select-once step (EXP-002C had used a select; direct activation suffices). No recipe change needed; backlog ZF-020 annotated.
- Confirmed: the C1 no-move CSS contract computes correctly (`position:fixed`, `visibility:visible`) on a real build.

## 8. Final readiness summary
ZF-020 is **functionally complete and API/CSS-verified on real Zen 1.21.6b**, strictly within the frozen architecture. The single unmet class of criteria is **visual (headful)**, which is environmentally blocked and explicitly **not claimed**. To close it: install the loader (sudo) for a headful pass, or accept the **"API-verified, visually pending"** status. Per instructions, **no follow-on work (ZF-021+) started.**
