# Zen Float — Master Engineering Backlog

**Status:** Executable tracker · **Source of truth:** `ZEN_FLOAT_EDD.md` (every ticket cites an EDD section) · **Companion:** `ZEN_FLOAT_RFC.md`
**Architecture:** FINALIZED. Do not revisit unless a ticket surfaces an implementation blocker (→ file a `BLOCK-xxx`, see §Blockers).

**Locked assumptions (from EDD §0):** Zen Mods run no JS → v1 ships as a privileged `.uc.mjs` via fx-autoconfig/Sine; v2 upstreams into core (`src/zen/float/`). Glance (`nsZenGlanceManager`, `window.gZenGlanceManager`) is the reuse blueprint. Workspaces = **Spaces** (`ZenSpaceManager`). Reuse existing infra; never fork `toolkit/`.

**Confidence tags** carried from EDD: **[C]** Confirmed · **[L]** Likely · **[U]** Unknown · **[NX]** Needs experimentation.

---

## Legend & conventions

- **Ticket IDs:** `EXP-xxx` (spikes, throwaway), `ZF-xxx` (production), `BLOCK-xxx` (blockers), `DOC-xxx` (docs).
- **Complexity:** XS / S / M / L / XL. **Time** assumes 1 engineer, excludes review.
- **DoD (global, applies to every ZF ticket):** code merged behind `zen.float.enabled` (default false); browser fully usable with flag on AND off; no new console errors; all external Zen globals accessed through feature-detect guards (EDD §12); JSDoc on public methods; unit/UI tests per ticket pass; PR review checklist (§11) green.
- **Namespaces (EDD §12):** class `nsZenFloatManager`, global `window.gZenFloatManager`, sub-controllers `FloatWindow/DragController/ResizeController/DockController/ScopeBinder/StateStore/ShortcutBinding/AnimationController/TargetRegistry`; DOM `.zen-float-*`; events `ZenFloat:*`; commands `cmd_zenFloat*`; prefs `zen.float.*`.

---

# 1. Epic Breakdown

| Epic | Name | Purpose | Depends on | Risk | Deliverables |
|---|---|---|---|---|---|
| **E0** | Experiments / De-risking | Prove the four make-or-break unknowns before any production code | — | **Critical** | EXP-001…006 signed off; go/no-go on §8 path |
| **E1** | Infrastructure & Bootstrap | Loadable privileged script, manager scaffold, feature flag, overlay skeleton | E0 (E1/E2 spikes) | Med | `zen-float.uc.mjs` loads; `gZenFloatManager` inits; hidden overlay in DOM |
| **E2** | Persistent Browser Host | Spawn + own a nested `<browser>` that survives tab switches (the core) | E1, EXP-002 | **High** | Live Claude pane persists across `TabSelect` |
| **E3** | Window Manager | Drag, resize, geometry model | E2, EXP-005 | Med | Draggable/resizable float, no page CLS |
| **E4** | Docking (Smart Dock) | Edge/corner magnetism + per-slot memory; split handoff | E3 | Med-High | Snap-on-release; corner slots; Send-to-Split |
| **E5** | Persistence & Session Restore | StateStore (JSON v1), restore on startup | E2, EXP-003 | Med | Geometry/target/lastUrl restored after restart |
| **E6** | Spaces & Scope | Tab / Workspace / Global scope binding | E2, EXP-004 | Med | Scope switching shows/hides/rebinds correctly |
| **E7** | Input | Keyboard shortcut + context menu entry | E2 | Low | Hotkey toggles; "Open in Float" menu item |
| **E8** | UX Polish | Bubble mode, opacity, animations, auto-hide, fullscreen/reduced-motion | E3 | Med | Collapse-to-bubble, opacity slider, motion-safe |
| **E9** | Settings | Prefs surface (v1 JSON/`preferences.json`; v2 `about:preferences#zen`) | E5 | Low | All `zen.float.*` round-trip via UI |
| **E10** | Handoff & Interop | Promote-to-tab, Send-to-Split-View, PiP/media coexistence | E2, E4 | Med | Glance-parity actions work |
| **E11** | Testing & Hardening | Unit/integration/UI/perf/memory/leak/update-compat; graceful degrade | all | Med | Green CI matrix; degrade-not-crash on missing globals |
| **E12** | Upstream / Core Migration (v2) | Move logic to `src/zen/float/`, register in `ZenPreloadedScripts.js`, session-store backend, prefs pane | E1–E11 stable | Med | Core PR behind `zen.float.enabled` |

---

# 2. Experimental Tickets (E0 — do first, throwaway code)

> Gate: **EXP-001/002/003/004 must PASS before ZF-020+ (E2 onward).** EXP-005/006 inform budgets but don't block.

### EXP-001 — Verify privileged globals & load timing
- **Goal:** fx-autoconfig loads a `.uc.mjs` into `browser.xhtml`; confirm `gBrowser`, `gZenGlanceManager`, `ZenSpaceManager`, `gZenKeyboardShortcutsManager`, `gZenViewSplitter` are reachable, and determine correct init hook. (EDD §2.11, E1)
- **Success:** all listed globals defined and callable from our script after a deterministic ready event.
- **Failure:** script runs before `gBrowser` exists / globals undefined.
- **Fallback:** init on `browser-delayed-startup-finished` or first `MozAfterPaint`; last resort poll with timeout.
- **Output:** documented ready-hook + guard snippet reused by ZF-001. **[NX]**

### EXP-002 — Persistent nested `<browser>` outside Glance lifecycle ★ make-or-break
- **Goal:** create a tab with Glance's addTab options **without** registering in `#glances`; parent into a custom `.zen-float-overlay`; keep alive + interactive across ≥20 `TabSelect` events. Also prototype the *alternative*: extend Glance with a `persistent` flag (EDD §14 App.A.2). (EDD §6 E2)
- **Success:** page stays interactive through 20 switches; no Glance cleanup fires; RAM stable.
- **Failure:** Glance `onLocationChange`/session restore reclaims/closes it; docshell deactivates.
- **Fallback:** manual docshell activation (mirror `#setGlanceStates`); private attribute Glance ignores; if both fail → recommend "persistent Glance" fork of `nsZenGlanceManager` as v1.
- **Output:** go/no-go on `nsZenFloatManager` vs "persistent Glance"; the chosen host recipe for ZF-020/021. **[NX — highest risk]**

### EXP-003 — Session-restore / persistence experiment
- **Goal:** write/read `zen-float-state.json` via `IOUtils.writeJSON/readJSON`; confirm timing to restore after `ZenStartup`/session settle without racing tab restore. (EDD §2.5, §4.1)
- **Success:** state survives restart; restore fires after `gBrowser` tabs exist; no duplicate float.
- **Failure:** restore races tab restore / double-spawn / private-window writes leak.
- **Fallback:** debounce writes; idempotent restore keyed by scope; skip write when `PrivateBrowsingUtils.isWindowPrivate`.
- **Output:** restore hook + debounce constants for ZF-050. **[NX]**

### EXP-004 — Space (workspace) lifecycle observation
- **Goal:** find a public `ZenSpaceManager` change event; else validate a `MutationObserver` on the active-space DOM attribute. (EDD §2.4, E4)
- **Success:** deterministic callback on every space switch.
- **Failure:** no event and DOM signal unreliable.
- **Fallback:** MutationObserver on spaces container; last resort poll active-space id.
- **Output:** the subscribe primitive for ZF-060. **[NX]**

### EXP-005 — Drag performance baseline
- **Goal:** compare `transform: translate3d` + rAF vs `left/top`; measure fps and page reflow/CLS while a live docshell is composited. (EDD §6 E5, §10)
- **Success:** 60fps drag, zero page layout shift.
- **Failure:** compositing live docshell stutters <45fps.
- **Fallback:** ghost-drag (lightweight placeholder), reparent live browser on drop.
- **Output:** drag technique decision for ZF-030. **[L]**

### EXP-006 — Memory-leak validation harness
- **Goal:** establish open/close×100 and enable/disable teardown measured via `about:memory` diff + `MOZ_CC_LOG`; confirm blob-URL/docshell/listener release (mirror Glance `#deleteGlance`). (EDD §9, §10)
- **Success:** zero retained docshells/blob URLs/listeners after close; flat memory across 100 cycles.
- **Failure:** monotonic growth / retained docshell.
- **Fallback:** explicit teardown checklist; weak refs; blob revocation.
- **Output:** teardown contract enforced by ZF-021 + reused in ZF-11x tests. **[NX]**

---

# 3. Production Tickets (E1–E12)

> Each ticket: **ID · Title · Desc · Motivation · Deps · AC · DoD · Complexity · LOC · Time · Risk · Files · Classes(affected/new) · Testing · Review focus.** Global DoD (top of doc) applies to all; ticket DoD lists *additional* gates.

## Epic E1 — Infrastructure & Bootstrap

### ZF-001 — Bootstrap loadable script + manager scaffold + feature flag
- **Desc:** Create `zen-float.uc.mjs`; define `nsZenFloatManager` with `init()` gated on `zen.float.enabled` (default false); wire ready-hook from EXP-001; expose `window.gZenFloatManager`.
- **Motivation:** entry point every other ticket builds on (EDD §8.1, §2.11).
- **Deps:** EXP-001.
- **AC:** with flag on, `init()` runs once post-ready, logs `[ZenFloat] init`; with flag off, no-op; no errors either way.
- **DoD (add):** feature-detect guards for all external globals; `zen.float.debug` gates logging.
- **Complexity:** S · **LOC:** ~120 · **Time:** 0.5d · **Risk:** Low.
- **Files:** `zen-float.uc.mjs` (new). **New class:** `nsZenFloatManager`.
- **Testing:** unit (init idempotency, flag gating). **Review:** flag gating; guard pattern; no global leakage.

### ZF-002 — Overlay skeleton (hidden host container)
- **Desc:** Build `.zen-float-overlay` (`position:fixed`, hidden) attached in the content layer, mirroring Glance's `.zen-glance-overlay` contract on `.browserSidebarContainer`. Console-toggle visibility.
- **Motivation:** DOM host for the nested browser (EDD §2.1, §8.2, §5).
- **Deps:** ZF-001.
- **AC:** overlay exists in DOM, toggled hidden/shown via `gZenFloatManager._debugToggleOverlay()`; zero impact on page layout when hidden.
- **Complexity:** S · **LOC:** ~90 · **Time:** 0.5d · **Risk:** Low.
- **Files:** `zen-float.uc.mjs`, `zen-float.uc.css` (new). **New class:** `FloatWindow` (shell only).
- **Testing:** UI (overlay present, no CLS). **Review:** reuses Glance overlay contract; namespaced CSS only.

### ZF-003 — Pref registration & defaults
- **Desc:** Define/seed `zen.float.*` defaults on first run (`enabled, scope, opacity, min-width, min-height, snap-threshold, collapsed, hotkey, suspend-on-collapse, default-target, debug`). (EDD §2.6, §12)
- **Deps:** ZF-001.
- **AC:** all prefs readable via `Services.prefs`; missing prefs seeded once; no overwrite of user-set values.
- **Complexity:** XS · **LOC:** ~50 · **Time:** 0.25d · **Risk:** Low.
- **Files:** `zen-float.uc.mjs`. **Testing:** unit (seed-once). **Review:** naming matches `zen.float.*`.

## Epic E2 — Persistent Browser Host

### ZF-020 — Spawn nested `<browser>` via Glance recipe
- **C1 no-move model (REQUIRED):** do **not** attach/move the `<browser>` into `.zen-float-overlay`. Spawn the float tab, then apply class `.zen-float-browser` to its **own** `.browserSidebarContainer` (Glance's `.zen-glance-overlay` pattern) so its inner `.browserContainer` floats via the shared `--zen-float-*` geometry vars. `.zen-float-overlay` stays a chrome frame only.
- **Desc:** Implement `FloatWindow.attachTarget(url)` using the exact addTab options `{skipRoute:true, skipAnimation:true, skipBackgroundNotify:true, insertTab:true, ownerTab, triggeringPrincipal, userContextId}`; set `linkedBrowser.docShellIsActive=true`; apply the no-move float class to the tab's container; load `about:blank` then target.
- **Motivation:** the core capability; reuse not re-derive (EDD §2.1, §5, ADR-002).
- **Deps:** ZF-002, EXP-002.
- **AC:** a live `<browser>` renders inside the overlay; not shown in tab strip; loads a URL.
- **Status (implemented `031751e`/`5ed25b0`/`6780c59`):** API + CSS **verified** on Zen 1.21.6b (browsingContext+active, container computes `position:fixed`/`visibility:visible`, tab `display:none`, 15-switch persistence, clean detach; Glance ignores it via `glanceId:null`). Direct `docShellIsActive=true` after `addTab` suffices (no select-once). **Visual paint = pending headful.** See `reviews/ZF-020-REPORT.md`.
- **DoD (add):** uses EXP-002's chosen host recipe; docshell activated on show.
- **Complexity:** L · **LOC:** ~200 · **Time:** 2d · **Risk:** **High**.
- **Files:** `zen-float.uc.mjs`. **Classes:** `FloatWindow` (spawn/attach/show/hide). **Affected:** none in Zen core (v1).
- **Testing:** UI (renders, interactive), integration (no tab-strip entry). **Review:** exact option set; docshell activation; no `#glances` coupling.

### ZF-021 — Lifecycle & teardown (leak-safe)
- **Desc:** `FloatWindow.close()`/`destroy()` — remove browser, revoke any blob URLs, detach listeners, deactivate docshell; manager registry `Map<floatId, FloatWindow>` add/remove.
- **Motivation:** prevent leaks (EDD §10, EXP-006); multi-float-ready registry (ADR-007).
- **Deps:** ZF-020, EXP-006.
- **AC:** after close, no retained docshell/blob/listener (EXP-006 harness passes); registry empties.
- **Complexity:** M · **LOC:** ~120 · **Time:** 1d · **Risk:** Med.
- **Files:** `zen-float.uc.mjs`. **Classes:** `FloatWindow`, `nsZenFloatManager` (registry). **Testing:** memory/leak (§9). **Review:** teardown completeness; registry keyed by id.
- **Status (implemented `9123b45`/`a11e564`/`12eb683`/ZF-021d):** `EnrollmentManager` maintains the render contract across tab switching, workspace change, fullscreen/customize suspend-resume, and an external `deck-selected` strip (MutationObserver backstop); teardown is leak-free. **ZF-021d** closed review condition C-1 by restoring the design's `TabClose` hook (external float-tab close → `unenroll` + `onFatal`) and fixed **F-5** (re-entrant `removeTab` during `TabClose` corrupted tabbrowser's close sequence → `onFatal` now tears down without removing the tab). Listener census proves no per-window listener leak. **Design-complete for the render-lifecycle scope.** See `reviews/ZF-021-VALIDATION.md` + `reviews/ZF-021-CODE-REVIEW.md`. Multi-float registry (`Map<floatId, FloatWindow>`) is still deferred — cap is 1 float.

### ZF-022 — Target registry + title bar + Close
- **Desc:** `TargetRegistry` with presets (Claude/ChatGPT/Gemini/Perplexity/DeepWiki/GitHub/Notion/Slack + custom URL); render title bar (target label, close). 
- **Deps:** ZF-020.
- **AC:** switching target reloads browser; close destroys float; custom URL accepted/validated (http/https).
- **Complexity:** M · **LOC:** ~140 · **Time:** 1d · **Risk:** Low.
- **Files:** `zen-float.uc.mjs`, `zen-float.uc.css`. **New class:** `TargetRegistry`. **Testing:** UI + E3 site matrix (via EXP-003? no—via manual E3). **Review:** URL validation; extensible descriptor `{type:"web"|"internal"}` (EDD §13).

### ZF-023 — Embedding fallback (open-in-tab)
- **Desc:** Detect load failure / blocked embedding on the float `<browser>`; surface inline "Open in tab" that promotes to a real tab. (EDD §6 E3, §11)
- **Deps:** ZF-020, ZF-022.
- **AC:** a target that refuses embedding shows fallback; click opens it as a normal tab with same container.
- **Complexity:** S · **LOC:** ~70 · **Time:** 0.5d · **Risk:** Med.
- **Files:** `zen-float.uc.mjs`. **Testing:** manual (force a blocking site). **Review:** no infinite reload loop; container preserved.

## Epic E3 — Window Manager

### ZF-030 — Drag controller
- **Desc:** `DragController` — pointer capture on title bar; move via technique chosen in EXP-005; commit geometry on pointerup; dispatch `ZenFloat:Moved`.
- **Deps:** ZF-022, EXP-005.
- **AC:** float follows pointer at 60fps; no page CLS; geometry persisted to in-memory model.
- **Complexity:** M · **LOC:** ~120 · **Time:** 1d · **Risk:** Med.
- **Files:** `zen-float.uc.mjs`. **New class:** `DragController`. **Testing:** UI (drag delta==geometry delta), perf (fps, CLS). **Review:** transform not layout; rAF throttle; pointer capture released.

### ZF-031 — Resize controller
- **Desc:** `ResizeController` — 8 handles; clamp to `zen.float.min-width/height` and viewport; dispatch `ZenFloat:Resized`.
- **Deps:** ZF-030.
- **AC:** resize from any handle; clamps at min/max; persists.
- **Complexity:** M · **LOC:** ~120 · **Time:** 1d · **Risk:** Med.
- **Files:** `zen-float.uc.mjs`. **New class:** `ResizeController`. **Testing:** unit (clamp math), UI. **Review:** min-size enforcement; no NaN geometry.

### ZF-032 — Geometry model + viewport re-clamp
- **Desc:** Central geometry object `{x,y,w,h,snap}`; on `window` resize / screen change, re-clamp float into viewport. (EDD §11 monitor/resize)
- **Deps:** ZF-030, ZF-031.
- **AC:** float never off-screen after window/monitor resize; snap slot re-evaluated.
- **Complexity:** S · **LOC:** ~80 · **Time:** 0.5d · **Risk:** Med.
- **Files:** `zen-float.uc.mjs`. **Classes:** `FloatWindow`. **Testing:** unit (clamp), UI (multi-monitor manual). **Review:** DPI safety.

## Epic E4 — Docking (Smart Dock)

### ZF-040 — Edge/corner snap (Smart Dock)
- **Desc:** `DockController` — compute distance to 4 edges + 4 corners; show snap ghost within `zen.float.snap-threshold`; snap on release; dispatch `ZenFloat:Docked`.
- **Motivation:** ADR-005 snap-by-default.
- **Deps:** ZF-030.
- **AC:** dragging within threshold of a corner/edge snaps and aligns; ghost preview shown.
- **Complexity:** L · **LOC:** ~180 · **Time:** 1.5d · **Risk:** Med-High.
- **Files:** `zen-float.uc.mjs`, `zen-float.uc.css`. **New class:** `DockController`. **Testing:** unit (snap math truth table), UI. **Review:** threshold from pref; ghost cleaned up.

### ZF-041 — Per-corner slot memory
- **Desc:** Persist independent geometry per snap slot; restoring to a corner recalls its remembered size.
- **Deps:** ZF-040, ZF-050 (StateStore).
- **AC:** dock to BR then TL then back to BR restores BR's size. (AC3)
- **Complexity:** S · **LOC:** ~60 · **Time:** 0.5d · **Risk:** Low.
- **Files:** `zen-float.uc.mjs`. **Testing:** UI. **Review:** slot keys stable.

### ZF-042 — Send-to-Split-View handoff
- **Desc:** Hand the float `<browser>` to `gZenViewSplitter` via the same path Glance `splitGlance()` uses; `cmd_zenFloatSplit`.
- **Deps:** ZF-020; EXP verifying split entry (fold into EXP-002 output).
- **AC:** action converts float into a split pane; float closes cleanly.
- **Complexity:** M · **LOC:** ~90 · **Time:** 1d · **Risk:** Med.
- **Files:** `zen-float.uc.mjs`. **Affected:** `gZenViewSplitter` (call only). **Testing:** integration. **Review:** no split-tree reimplementation (EDD §5).

## Epic E5 — Persistence & Session Restore

### ZF-050 — StateStore (JSON) read/write/debounce
- **Desc:** `StateStore` over `IOUtils.readJSON/writeJSON` at `profile/zen-float-state.json`; schema per EDD §4.1 with `version`; debounced writes on geometry commit; skip writes in private windows.
- **Deps:** ZF-021, EXP-003.
- **AC:** state persists; private-window state never written; debounce coalesces rapid writes.
- **Complexity:** M · **LOC:** ~150 · **Time:** 1d · **Risk:** Med.
- **Files:** `zen-float.uc.mjs`. **New classes:** `StateStore`. **Testing:** unit (serialize/migrate/debounce), integration. **Review:** private-mode guard; atomic write.

### ZF-051 — Session restore on startup
- **Desc:** `SessionBridge` restores float (target/geometry/opacity/collapsed/lastUrl) for active scope after startup settle (hook from EXP-003); idempotent (no double-spawn).
- **Deps:** ZF-050.
- **AC:** restart restores per active scope (AC2); exactly one float; no race with tab restore.
- **Complexity:** M · **LOC:** ~100 · **Time:** 1d · **Risk:** Med.
- **Files:** `zen-float.uc.mjs`. **New class:** `SessionBridge`. **Testing:** integration (restart matrix). **Review:** idempotency; ordering.

## Epic E6 — Spaces & Scope

### ZF-060 — ScopeBinder core (Global scope)
- **Desc:** `ScopeBinder` with scope enum {tab,workspace,global}; implement Global (always visible across tabs/spaces) subscribing `gBrowser` TabSelect/TabClose.
- **Deps:** ZF-020.
- **AC:** Global float stays visible + same geometry across tab switches. (AC1 global)
- **Complexity:** M · **LOC:** ~140 · **Time:** 1d · **Risk:** Med.
- **Files:** `zen-float.uc.mjs`. **New class:** `ScopeBinder`. **Testing:** integration (scope→visibility truth table). **Review:** listener teardown.

### ZF-061 — Workspace (Space) scope
- **Desc:** Subscribe to space-change (EXP-004 primitive); show/hide/rebind per active space; per-space target memory.
- **Deps:** ZF-060, EXP-004, ZF-050.
- **AC:** switching space shows the space's bound float/target; unbound spaces hide it. 
- **Complexity:** M · **LOC:** ~120 · **Time:** 1d · **Risk:** Med.
- **Files:** `zen-float.uc.mjs`. **Classes:** `ScopeBinder`. **Testing:** integration (space switch). **Review:** uses ZenSpaceManager not `ZenWorkspaces`; observer fallback wired.

### ZF-062 — Tab scope
- **Desc:** Bind float to a specific tab; show only when active; hide on switch; dismiss on tab close.
- **Deps:** ZF-060.
- **AC:** tab-scoped float visible only on its tab; cleaned up on close.
- **Complexity:** S · **LOC:** ~70 · **Time:** 0.5d · **Risk:** Low.
- **Files:** `zen-float.uc.mjs`. **Testing:** integration. **Review:** tab-id lifecycle.

## Epic E7 — Input

### ZF-070 — Keyboard shortcut (toggle)
- **Desc:** Register a `<key>` in `zenKeyset` bound to `cmd_zenFloatToggle`; hotkey from `zen.float.hotkey` (EXP-006? no — EDD §2.10, E6). Self-register in v1.
- **Deps:** ZF-020.
- **AC:** hotkey toggles float in <150ms, no page CLS (AC4); no conflict with existing Zen keys.
- **Complexity:** S · **LOC:** ~60 · **Time:** 0.5d · **Risk:** Low.
- **Files:** `zen-float.uc.mjs`. **New class:** `ShortcutBinding`. **Affected:** `zenKeyset` (append). **Testing:** UI (timing), conflict check. **Review:** no clobber of loader defaults.

### ZF-071 — Context-menu "Open in Float"
- **Desc:** Mirror Glance `#insertIntoContextMenu`; add `#context-zenOpenLinkInFloat` calling `gZenFloatManager.openFor({url,triggeringPrincipal})`.
- **Deps:** ZF-020, ZF-022.
- **AC:** right-click link → "Open in Float" loads it in the float.
- **Complexity:** S · **LOC:** ~50 · **Time:** 0.5d · **Risk:** Low.
- **Files:** `zen-float.uc.mjs`. **Testing:** UI. **Review:** principal passed correctly.

## Epic E8 — UX Polish

### ZF-080 — Bubble (collapse/expand)
- **Desc:** Collapse to ≤56×56 draggable bubble; expand on click (hover-expand configurable); deactivate docshell while collapsed (suspend-on-collapse). Dispatch `ZenFloat:Collapsed`.
- **Deps:** ZF-030, ZF-021.
- **AC:** bubble ≤56px, draggable, expands to prior geometry; collapsed docshell suspended (AC5).
- **Complexity:** M · **LOC:** ~90 · **Time:** 1d · **Risk:** Med.
- **Files:** `zen-float.uc.mjs`, `zen-float.uc.css`. **Classes:** `FloatWindow`. **Testing:** UI, memory (suspend). **Review:** docshell deactivate not just `display:none` (EDD §10 golden rule).

### ZF-081 — Opacity control
- **Desc:** Opacity 50–100% via CSS var on overlay; slider in title bar; pref `zen.float.opacity`.
- **Deps:** ZF-022.
- **AC:** live opacity change; persists.
- **Complexity:** XS · **LOC:** ~30 · **Time:** 0.25d · **Risk:** Low.
- **Files:** `zen-float.uc.mjs`, `zen-float.uc.css`. **Testing:** UI. **Review:** doesn't fade content docshell to unusable.

### ZF-082 — Animations + reduced-motion
- **Desc:** `AnimationController` for open/close/snap/collapse; respect `prefers-reduced-motion`.
- **Deps:** ZF-040, ZF-080.
- **AC:** animations smooth at 60fps; reduced-motion disables them (FR9).
- **Complexity:** M · **LOC:** ~100 · **Time:** 1d · **Risk:** Low.
- **Files:** `zen-float.uc.mjs`, `zen-float.uc.css`. **New class:** `AnimationController`. **Testing:** UI, perf. **Review:** motion query honored.

### ZF-083 — Auto-hide on page focus + fullscreen handling
- **Desc:** Optional auto-hide when page gains focus (`zen.float.autohideOnPageFocus`); auto-hide in fullscreen, restore after (mirror ZenCompactMode patterns). (EDD §11)
- **Deps:** ZF-060.
- **AC:** auto-hide toggle works; fullscreen hides float and restores on exit; PiP unaffected.
- **Complexity:** M · **LOC:** ~90 · **Time:** 1d · **Risk:** Med.
- **Files:** `zen-float.uc.mjs`. **Testing:** UI (fullscreen, PiP coexist). **Review:** no interception of PiP/media (EDD §11).

## Epic E9 — Settings

### ZF-090 — Settings surface (v1)
- **Desc:** Ship a Mods-style `preferences.json` for CSS-toggle prefs + an in-float settings popover for the rest; all `zen.float.*` round-trip.
- **Deps:** ZF-003, ZF-050.
- **AC:** every pref settable from UI and persisted; reset-to-default works.
- **Complexity:** M · **LOC:** ~80 · **Time:** 1d · **Risk:** Low.
- **Files:** `zen-float.uc.mjs`, `preferences.json` (new). **Testing:** UI round-trip. **Review:** pref names canonical.

## Epic E10 — Handoff & Interop

### ZF-100 — Promote-to-tab
- **Desc:** Convert float `<browser>` into a real tab (Glance `fullyOpenGlance` analog); `cmd_zenFloatPromote`.
- **Deps:** ZF-020.
- **AC:** action opens current float page as a normal tab; float closes; history/session intact.
- **Complexity:** M · **LOC:** ~80 · **Time:** 1d · **Risk:** Med.
- **Files:** `zen-float.uc.mjs`. **Testing:** integration. **Review:** reuse promote path, don't reimplement.

### ZF-101 — Crash & network resilience
- **Desc:** Handle `oop-browser-crashed` on the float browser (inline reload); page offline shows its own UI; float chrome unaffected. (EDD §11)
- **Deps:** ZF-020.
- **AC:** killing the content process shows reload affordance; recreate keeps geometry.
- **Complexity:** S · **LOC:** ~60 · **Time:** 0.5d · **Risk:** Med.
- **Files:** `zen-float.uc.mjs`. **Testing:** integration (force crash). **Review:** no manager crash on child crash.

## Epic E11 — Testing & Hardening

### ZF-110 — Unit test suite
- **Desc:** Cover StateStore (serialize/clamp/migrate/debounce), geometry/clamp math, DockController snap math, ScopeBinder truth table.
- **Deps:** ZF-032, ZF-040, ZF-050, ZF-060.
- **AC:** ≥90% coverage on pure-logic modules; CI green.
- **Complexity:** M · **LOC:** ~300 (test) · **Time:** 1.5d · **Risk:** Low.
- **Files:** `tests/unit/*`. **Testing:** self. **Review:** deterministic, no chrome deps.

### ZF-111 — Integration/UI test suite (mochitest-browser)
- **Desc:** open/close, tab-switch persistence, space-switch rebind, drag/resize/snap, hotkey, split handoff, restore. Synthesized pointer/key events.
- **Deps:** most E2–E7.
- **AC:** AC1–AC5 automated; CI green.
- **Complexity:** L · **LOC:** ~400 (test) · **Time:** 2d · **Risk:** Med.
- **Files:** `tests/browser/*`. **Review:** no flakiness; teardown between tests.

### ZF-112 — Regression: Glance/Split/Session unaffected
- **Desc:** Run existing `src/zen/glance/tests` + split/session suites with `zen.float.enabled=true`.
- **Deps:** E2–E10.
- **AC:** all existing suites still pass with Float on.
- **Complexity:** S · **Time:** 0.5d · **Risk:** Med.
- **Review:** no shared-state contamination.

### ZF-113 — Performance & memory gates
- **Desc:** Automate §10 budgets: idle CPU ~0, drag 60fps, single-docshell memory bound, suspend-on-collapse verified; EXP-006 harness in CI.
- **Deps:** ZF-080, ZF-030.
- **AC:** budgets enforced as CI thresholds; leak test flat across 100 cycles.
- **Complexity:** M · **Time:** 1.5d · **Risk:** Med.
- **Review:** thresholds justified.

### ZF-114 — Graceful degradation & update-compat
- **Desc:** Feature-detect every external Zen global at init; if any missing → disable Float + one-time user notice (never crash). CI job builds against latest Zen `dev` nightly.
- **Deps:** all.
- **AC:** removing/renaming a mocked global disables Float cleanly with notice; nightly job runs.
- **Complexity:** M · **LOC:** ~80 · **Time:** 1d · **Risk:** High (ongoing).
- **Files:** `zen-float.uc.mjs`, CI config. **Review:** every global guarded; notice non-nagging.

## Epic E12 — Upstream / Core Migration (v2)

### ZF-120 — Freeze public surface
- **Desc:** Lock `gZenFloatManager` API, `ZenFloat:*` events, `zen.float.*` prefs, `StateStore` schema before the move.
- **Deps:** E11 stable. **AC:** documented frozen surface + `state.version` migration path. **Complexity:** S · **Time:** 0.5d.

### ZF-121 — Relocate to `src/zen/float/` + base-class contract
- **Desc:** Move logic to `ZenFloatManager.mjs`; convert self-`init()` to `nsZenDOMOperatedFeature` contract (EXP-001 findings); add `zen-float.css`, `zen-float.inc.xhtml`, `moz.build`, `jar.inc.mn`.
- **Deps:** ZF-120. **AC:** builds via Surfer; parity with v1. **Complexity:** L · **Time:** 2d · **Risk:** Med.
- **Files (new):** `src/zen/float/*`. **Affected:** none yet.

### ZF-122 — Register in ZenPreloadedScripts.js
- **Desc:** Add `"chrome://browser/content/zen-components/ZenFloatManager.mjs"` to the `importESModule` array. (EDD §2.11)
- **Deps:** ZF-121. **AC:** `gZenFloatManager` present in core build. **Complexity:** XS · **Time:** 0.25d.
- **Files:** `src/zen/common/ZenPreloadedScripts.js` (1 line).

### ZF-123 — Migrate persistence to ZenSessionStore + importer
- **Desc:** Swap StateStore backend JSON→`ZenSessionStore`; one-time importer from `zen-float-state.json`.
- **Deps:** ZF-122. **AC:** state survives via session store; v1 users migrated once. **Complexity:** M · **Time:** 1.5d · **Risk:** Med.
- **Files:** `src/zen/float/*`, session hook.

### ZF-124 — Default `<key>` + `about:preferences#zen` pane
- **Desc:** Add default shortcut to `nsZenKeyboardShortcutsLoader.zenGetDefaultShortcuts()`; add Float settings pane to Zen preferences.
- **Deps:** ZF-122. **AC:** default hotkey ships; settings pane functional. **Complexity:** M · **Time:** 1.5d.
- **Files:** `src/zen/kbs/*`, prefs pane.

### ZF-125 — Upstream PR (behind flag → default-on)
- **Desc:** PR to `zen-browser/desktop` referencing RFC+EDD; feature-flagged; beta cohort; then default-on.
- **Deps:** ZF-121…124. **AC:** PR merged behind `zen.float.enabled`. **Complexity:** M · **Time:** ongoing · **Risk:** Med (maintainer buy-in — open issue EDD §14.7.5).

---

# 4. Dependency Graph & Critical Path

```
EXP-001 ─┬─► ZF-001 ─► ZF-002 ─┬─► ZF-020 ─► ZF-021 ─► ZF-022 ─► ZF-023
EXP-002 ─┘        ZF-003 ┘         │  │          │
                                   │  │          ├─► ZF-030 ─► ZF-031 ─► ZF-032
EXP-005 ───────────────────────────┘  │          │        └─► ZF-040 ─► ZF-041(+ZF-050)
EXP-006 ──────────────────────────────┘          │                 └─► ZF-042
                                                  │
EXP-003 ─────────────────► ZF-050 ─► ZF-051       ├─► ZF-060 ─┬─► ZF-061 (needs EXP-004, ZF-050)
                                                  │           └─► ZF-062
EXP-004 ──────────────────────────────────────────┘
                                                  ├─► ZF-070   ZF-071
                                                  ├─► ZF-080 ─► ZF-082
                                                  │   ZF-081   ZF-083(needs ZF-060)
                                                  ├─► ZF-090(needs ZF-050)
                                                  ├─► ZF-100   ZF-101
                                                  └─► ZF-110/111/112/113/114 (need respective features)
                                                            │
                                                            ▼
                                                    ZF-120►121►122►{123,124}►125
```

**Critical path (longest chain to a shippable persistent float):**
`EXP-002 → ZF-001 → ZF-002 → ZF-020 → ZF-021 → ZF-022 → ZF-030 → ZF-040 → ZF-050 → ZF-051 → ZF-111 → ZF-114`.
Everything hinges on **EXP-002** and **ZF-020** (the host). Slippage there slips the project.

**Parallelizable once ZF-022 lands:**
- Track A (Window Mgr): ZF-030→031→032→040→041→042
- Track B (Persistence): ZF-050→051 (unblocked by EXP-003, independent of drag)
- Track C (Scope): ZF-060→061/062 (needs EXP-004)
- Track D (Input/Polish): ZF-070, ZF-071, ZF-080/081/082/083
- Track E (Interop): ZF-100, ZF-101
Tracks A–E converge into E11 testing.

---

# 5. Git Strategy

- **Repo (v1):** standalone `zen-float` repo — `src/zen-float.uc.mjs`, `src/zen-float.uc.css`, `preferences.json`, `tests/`, `docs/`, `install/` (fx-autoconfig + Sine packaging), `.github/workflows/` (nightly-compat + tests). Mirror `src/zen/glance/` layout to ease the v2 move.
- **Branching:** trunk-based with short-lived feature branches `feat/ZF-0xx-slug`, `exp/EXP-00x-slug`, `fix/…`, `test/…`. Protected `main`; all merges via PR + green CI + 1 review.
- **Merge order:** follow the dependency graph; never merge a ZF ticket whose deps aren't on `main`. EXP branches merge as **docs/decision records only** (throwaway code deleted or quarantined under `spikes/`).
- **Commit size:** one logical unit per commit; each commit compiles and leaves the browser usable (EDD §8). Squash-merge feature branches to one commit referencing the ticket ID.
- **Tagging / releases:** SemVer `v0.x` during v1. `v0.1.0`=Milestone 2 (Persistent Float), `v0.2.0`=Docking, `v0.3.0`=Persistence, `v0.4.0`=Spaces, `v0.5.0`=UX polish, `v0.9.0-rc`=RC, `v1.0.0`=stable v1. Tag `@version` in the `.uc.mjs` header to match (Sine/fx-autoconfig update detection).
- **Review strategy:** every PR runs the §11 checklist; host/persistence/scope PRs require the owning maintainer (§7); perf/memory-touching PRs require a ZF-113 run attached.

---

# 6. Milestone Plan (every milestone = a usable build)

| Milestone | Name | Tickets | Usable build means | Gate |
|---|---|---|---|---|
| **M0** | Prototype / De-risk | EXP-001…006 | Spikes answered; go/no-go recorded | EXP-002/003/004 pass |
| **M1** | Bootstrap | ZF-001,002,003 | Script loads; hidden overlay; prefs seeded | flag on/off clean |
| **M2** | Persistent Float (`v0.1`) | ZF-020,021,022,023,060,070 | Claude floats, persists across tabs (Global), hotkey toggle, close | AC1(global), leak-free |
| **M3** | Docking (`v0.2`) | ZF-030,031,032,040,041,042 | Drag/resize/snap; corner memory; send-to-split | AC3, 60fps |
| **M4** | Persistence (`v0.3`) | ZF-050,051,090,041 | Restart restores; settings UI | AC2 |
| **M5** | Spaces (`v0.4`) | ZF-061,062,083 | Per-space targets; tab scope; auto-hide | space-switch correct |
| **M6** | UX Polish (`v0.5`) | ZF-080,081,082,071,100,101 | Bubble, opacity, animations, promote, resilience | reduced-motion, crash-safe |
| **M7** | Release Candidate (`v0.9-rc`→`v1.0`) | ZF-110,111,112,113,114 + DOC-* | Full test matrix green; degrade-not-crash; docs | CI matrix green |
| **M8** | Upstream (v2) | ZF-120…125 | Core build with Float behind flag | maintainer review |

---

# 7. Code Ownership & Module Communication

| Boundary | Modules | Owns | Talks to (how) |
|---|---|---|---|
| **Browser Host** | `FloatWindow`, `TargetRegistry` | nested `<browser>`, overlay, lifecycle/teardown | ← `nsZenFloatManager` (commands); → `gBrowser`, `gZenViewSplitter` (calls) |
| **Window Manager / Input** | `DragController`, `ResizeController`, `DockController`, `ShortcutBinding` | geometry, snapping, gestures | → emits `ZenFloat:Moved/Resized/Docked`; ← keyset commands |
| **State / Persistence** | `StateStore`, `SessionBridge` | JSON schema, debounce, restore | ← geometry/target events; → `IOUtils` (v1) / `ZenSessionStore` (v2) |
| **Scope** | `ScopeBinder` | visibility decisions per scope | ← `gBrowser`, `ZenSpaceManager` events; → `FloatWindow.show/hide` |
| **Animation** | `AnimationController` | transitions, reduced-motion | ← manager lifecycle calls |
| **Settings** | `preferences.json`, settings popover | pref surface | ↔ `Services.prefs` |
| **Testing** | `tests/unit`, `tests/browser` | coverage/gates | drives all above |

**Communication rules (avoid cycles):**
- One-way: **Manager → controllers/host**; controllers/host **→ events only** (never call the manager directly).
- `ScopeBinder` and `StateStore` **never** import each other — they meet at the manager.
- No controller imports `FloatWindow`'s internals; they operate on a passed geometry handle.
- All cross-module signals are `ZenFloat:*` DOM events (EDD §12), keeping modules decoupled and testable.

---

# 8. Technical Debt Register (v1 acceptable shortcuts)

| ID | Shortcut (v1) | Why acceptable | Removal plan | Migration cost |
|---|---|---|---|---|
| TD-1 | Persistence via profile JSON, not `ZenSessionStore` | `.uc.mjs` shouldn't touch `.sys.mjs` internals; decoupled+testable | ZF-123 swaps backend + importer | Low-Med |
| TD-2 | Self-registered `<key>` instead of loader default | Loader adds *new* defaults only via core edit | ZF-124 adds proper default | Low |
| TD-3 | Rides private Zen internals (Glance recipe, spaces) via feature-detect | No public API exists yet | Upstream stable hooks (ZF-121/125) | Med |
| TD-4 | Single float only (registry ready but capped at 1) | Bounds memory; de-risks EXP-002 | Lift cap (EDD §13) post-v1 | Low |
| TD-5 | Space-change via MutationObserver if no public event (EXP-004 fallback) | Unblocks Spaces without a core patch | Replace with public event when available | Low |
| TD-6 | Settings split (JSON + popover), not `about:preferences#zen` | v1 has no core pref-pane access | ZF-124 adds native pane | Low |
| TD-7 | fx-autoconfig/Sine install friction | Only privileged-JS channel in v1 | Core ship removes it (ZF-125) | N/A (removed) |
| TD-8 | If EXP-002 forces "persistent Glance" over `nsZenFloatManager` | Ship fastest viable host | Grow dedicated manager when multi-float needed | Med |

Every TD must appear as a `// TODO(TD-x)` in code and link back here.

---

# 9. Risk Register (per-ticket cross-cut)

| Risk vector | Tickets most exposed | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| **Breaking browser updates** (globals move/rename) | ZF-020, ZF-042, ZF-061, all reuse | High (over time) | High | ZF-114 feature-detect+degrade; nightly-compat CI; upstream ASAP |
| **API instability** (Glance/spaces private) | ZF-020, ZF-042, ZF-061 | High | High | thin coupling; EXP-002/004 fallbacks; TD-3 |
| **Performance regression** | ZF-030, ZF-040, ZF-080 | Med | Med | EXP-005 technique; ZF-113 gates; transform-based drag |
| **Memory leaks** | ZF-020, ZF-021, ZF-080, ZF-101 | Med | High | EXP-006 harness; ZF-021 teardown; suspend-on-collapse |
| **Race conditions** (startup/restore) | ZF-001, ZF-051 | Med | Med | EXP-001/003 ready-hooks; idempotent restore |
| **Session restoration** | ZF-050, ZF-051, ZF-123 | Med | Med | debounce; version+importer; restore after tab restore |
| **Browser shutdown** | ZF-021, ZF-050 | Low | Med | flush state on `quit-application-requested` (mirror Glance `observe`) |
| **Multiple windows** | ZF-001, ZF-060 | Med | Med | per-window manager instance (v1 non-goal to sync); document |
| **Container tabs** | ZF-020, ZF-023, ZF-100 | Low | Med | pass `userContextId`; preserve isolation |
| **Private browsing** | ZF-050, ZF-051 | Low | Med | `PrivateBrowsingUtils.isWindowPrivate` guard; never persist |
| **Safe mode** | ZF-001 | Low | Low | Mods/autoconfig disabled → Float absent (expected); core respects safe-mode |
| **Maintainer rejection of shape** | ZF-125 | Med | High | socialize RFC/EDD early (EDD §14.7.5); "persistent Glance" fallback |

---

# 10. Documentation Plan (write alongside code)

| ID | Doc | Written with | Owner |
|---|---|---|---|
| DOC-01 | Architecture overview (links RFC/EDD, module map, dep graph) | M1 | Tech Lead |
| DOC-02 | Module docs (per-class JSDoc + README per controller) | each ticket | ticket author |
| DOC-03 | Developer guide (clone Zen, fx-autoconfig setup, run/debug) | M1–M2 | Infra owner |
| DOC-04 | Contribution guide (branch/commit/PR/review, ticket workflow) | M1 | Tech Lead |
| DOC-05 | Debugging guide (Browser Toolbox, `devtools.chrome.enabled`, `zen.float.debug`) | M2 | Host owner |
| DOC-06 | Testing guide (unit + mochitest-browser, perf/leak harness) | M7 | Testing owner |
| DOC-07 | Release guide (versioning, Sine/fx-autoconfig packaging, tagging) | M7 | Infra owner |
| DOC-08 | Upstream proposal (v2 migration, EDD §14.5) | M8 | Tech Lead |

---

# 11. Pull-Request Review Checklist (every PR)

**Correctness & scope**
- [ ] Behind `zen.float.enabled`; browser fully usable with flag on AND off.
- [ ] Traces to a ticket ID; scope matches (no drive-by changes).

**Reuse & architecture (EDD §5)**
- [ ] Uses Glance's `<browser>` host recipe — **no duplicated browser-host logic**.
- [ ] No reimplementation of split-tree/session/docshell internals.
- [ ] No unnecessary modification of Zen/Firefox core files (v1).
- [ ] Cross-module signaling via `ZenFloat:*` events; no new import cycles (§7).

**Robustness**
- [ ] Every external Zen global accessed through a feature-detect guard; degrades, never crashes.
- [ ] Listeners/observers removed on teardown; blob URLs revoked; docshell deactivated when hidden.
- [ ] Private-window path never persists; container `userContextId` preserved.

**Performance & memory**
- [ ] No page CLS from float operations; drag uses transform+rAF.
- [ ] Memory checked (ZF-113 harness) for host/lifecycle PRs; collapsed float suspends docshell.

**State & session**
- [ ] StateStore writes debounced; schema `version` bumped + migration if changed.
- [ ] Session restore idempotent (no double-spawn), fires after tab restore.

**Quality gates**
- [ ] Unit/UI tests added/updated and green; regression suite (ZF-112) unaffected.
- [ ] JSDoc on public methods; `// TODO(TD-x)` links any accepted debt.
- [ ] Naming matches EDD §12 (`nsZenFloatManager`, `gZenFloatManager`, `.zen-float-*`, `zen.float.*`).

---

# 12. Blockers process

If a ticket hits an architecture-invalidating wall, open **`BLOCK-xxx`** citing: ticket, EDD section assumed, observed reality, and options. Only a `BLOCK` may reopen a finalized architecture decision. Known candidate: **BLOCK-candidate-1** = EXP-002 fails both persistent-host approaches → escalate to "persistent Glance" pivot (TD-8) or a core patch to Glance.

---

## Appendix — Ticket index (quick reference)

**EXP:** 001 globals · 002 persistent host★ · 003 session · 004 spaces · 005 drag-perf · 006 leaks
**E1:** ZF-001 bootstrap · 002 overlay · 003 prefs
**E2:** ZF-020 spawn★ · 021 teardown · 022 targets/titlebar · 023 embed-fallback
**E3:** ZF-030 drag · 031 resize · 032 geometry/reclamp
**E4:** ZF-040 snap · 041 slot-memory · 042 send-to-split
**E5:** ZF-050 StateStore · 051 restore
**E6:** ZF-060 scope-core/global · 061 space-scope · 062 tab-scope
**E7:** ZF-070 hotkey · 071 context-menu
**E8:** ZF-080 bubble · 081 opacity · 082 animations · 083 auto-hide/fullscreen
**E9:** ZF-090 settings
**E10:** ZF-100 promote-to-tab · 101 crash/network
**E11:** ZF-110 unit · 111 integration/UI · 112 regression · 113 perf/memory · 114 degrade/update-compat
**E12:** ZF-120 freeze · 121 relocate · 122 register · 123 session-store · 124 key+prefs-pane · 125 upstream PR
**Docs:** DOC-01…08

**Estimated v1 (E0–E11):** ~28 production tickets + 6 spikes ≈ **~30–36 engineer-days** (1 eng), compressible to **~3–4 calendar weeks** with the 5 parallel tracks (§4) across 2–3 engineers. **[L]**
