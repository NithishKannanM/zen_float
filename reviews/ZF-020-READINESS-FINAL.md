# ZF-020 Readiness — Final Verdict & Implementation Checklist

**After:** C1 (`0e7c004`), C2 (`431f80f`), C3 (`b2a6c93`) on branch `zen-float-v1`.
**Question:** Can ZF-020 (attach the live nested `<browser>`) now be implemented safely?

## Verdict: **YES** — with one non-code caveat.

All three blocking conditions from the ZF-020 readiness review are closed:

| Blocker | Was | Now | Evidence |
|---|---|---|---|
| **C1** host model | risked moving a remote `<browser>` (frameloader/docshell loss) | no-move: `.zen-float-overlay` = chrome frame; browser stays in its tab container, styled `.zen-float-browser` via shared geometry vars | Glance source (`zen-glance.css`) + inert contract CSS in place |
| **C2** init race | `init()` could silently never run (missed notification) | all 5 startup paths reach exactly one idempotent `init()` | lifecycle + race analysis, `BLOCKER-RESOLUTIONS.md` |
| **C3** attach point | `#tabbrowser-tabpanels` (tab-dependent, transform-prone) | `document.documentElement` — `fixed` guaranteed viewport-relative | DOM-root invariant |

**Caveat (not a code blocker):** ZF-020's DoD includes *visual* rendering, which cannot be confirmed headless. Either install the loader (needs sudo) for a headful pass, or ZF-020 lands **"API-verified, visually-pending"** and says so in its commit. Also standing-open but non-blocking: **A1** (fx-autoconfig `.uc.mjs` load path unproven), TD-D (runtime pref toggle), a11y, fullscreen auto-hide.

---

## ZF-020 Implementation Checklist (do NOT implement yet)

**Scope:** ONE live nested `<browser>`, rendered in the float region via the no-move model, kept active while unselected, torn down leak-free. No drag/dock/persistence/scope.

### Build
- [ ] Add `FloatWindow.attachTarget(url)`:
  - [ ] `gBrowser.addTab(url, { triggeringPrincipal, skipBackgroundNotify:true, insertTab:true, skipAnimation:true, ownerTab })` — the EXP-002 recipe. Do **not** set `glance-id`/`zen-glance-tab`; do **not** register in Glance.
  - [ ] Retain `floatTab` + `linkedBrowser`.
  - [ ] `linkedBrowser.docShellIsActive = true` (render while unselected — EXP-002C).
  - [ ] Apply `FloatWindow.BROWSER_CLASS` (`zen-float-browser`) to the float tab's **own** `.browserSidebarContainer` (C1 no-move). **Never** `appendChild` the browser into the frame.
  - [ ] `show()` the chrome frame.
- [ ] Add `FloatWindow.detach()`: deactivate docshell, remove `zen-float-browser` class, `gBrowser.removeTab(floatTab)`, revoke any blob URLs, null refs.
- [ ] Add a minimal `TabSelect` listener that reasserts `linkedBrowser.docShellIsActive = true` (temporary; ScopeBinder/ZF-060 takes ownership later).
- [ ] `nsZenFloatManager.openFloat(url)` / `closeFloat()` entry points; wire `_debugToggleOverlay` → `openFloat`/`closeFloat`.

### Invariants (must hold)
- [ ] Browser element is never moved in the DOM (C1).
- [ ] Frame + browser geometry both derive from `--zen-float-*` vars (no imperative sync).
- [ ] Feature-detect guards on every Zen global; degrade, never throw.
- [ ] Single float only (registry cap = 1).

### Assertions (Marionette-verifiable, extend `exp002c.js`)
- [ ] After spawn: `linkedBrowser.browsingContext` truthy; tab has no `glance-id`.
- [ ] After activate: `linkedBrowser.docShellIsActive === true`.
- [ ] Float tab's `.browserSidebarContainer` carries `zen-float-browser`.
- [ ] Across ≥15 tab switches: `browsingContext` truthy, `docShellIsActive` true, tab not `closing` — every iteration.
- [ ] After `detach()`: no retained tab, docshell inactive, refs null (EXP-006 harness green).

### Expected logs
`[ZenFloat] openFloat <url>` · `spawned browsingContext=<id>` · `active=true` · `closeFloat` · `detached`.

### Failure handling / rollback
- [ ] `addTab` throws → log, abort, `hide()`, leave shell intact (transactional; no half-attached state).
- [ ] Embedding block / load failure → out of scope (ZF-023); crash → out of scope (ZF-101) but must not crash the manager.
- [ ] Rollback = `git revert` the ZF-020 commit; feature stays flag-gated.

### Definition of Done
- [ ] One live browser renders in the float region (**headful visual confirmation** OR commit tagged "visually-pending").
- [ ] Persists + stays active across tab switches (Marionette).
- [ ] Teardown leak-free (EXP-006).
- [ ] Regression list (below) green.
- [ ] Contracts (readiness review §6) unchanged except the sanctioned browser-hosting additions.
- [ ] `node --check` passes.

### Regression (flag on AND off)
- [ ] Startup clean; tab switching; **Glance** open/close/expand/split; **Spaces** switch; **Split View**; window close teardown; browser quit; private browsing (no persist); container `userContextId` preserved; theme switch; session restore (one/zero float, no double-spawn); PiP/media not captured.

### Tests
- [ ] Unit: attach/detach state transitions; idempotent `attachTarget`; `detach` clears refs.
- [ ] Marionette: extend `exp002c.js` with the assertions above.
- [ ] Manual/headful: confirm actual paint + frame/browser alignment, incl. compact-mode/workspace transient states (the C3 residual).
