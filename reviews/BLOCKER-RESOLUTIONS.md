# ZF-020 Blocker Resolutions (C1–C3)

One section per blocker. Each was resolved as an independent, self-contained commit.

---

## C1 — No-move host model (commit `C1: no-move host model`)
**Problem:** ZF-002 implied ZF-020 would move a `<browser>` into `.zen-float-overlay`; moving a remote browser destroys/recreates its frameloader (docshell/page-state loss).
**Resolution:** `.zen-float-overlay` is a **chrome frame only**. ZF-020 applies `.zen-float-browser` to the float tab's **own** `.browserSidebarContainer` (Glance's `.zen-glance-overlay` pattern); the inner `.browserContainer` floats via `position: fixed`. Frame + browser share `--zen-float-*` geometry vars → aligned with no imperative sync.
**Invariants:** browser never reparented; one geometry source; frame hosts chrome only.
**Docs:** EDD ADR-002 amendment, backlog ZF-020.
**Rollback:** `git revert` the C1 commit.

---

## C2 — Initialization race (commit `C2: guaranteed single init`)

**Problem:** `init()` is triggered only by the `browser-delayed-startup-finished` observer. If that notification already fired before the observer was added (late script injection, or timing on a window created after startup), the observer never fires again and **`init()` never runs** — the feature silently stays dead. The prior `load` fallback only covered the `addObserver`-throws case, not a missed notification.

### Startup-path coverage

| Path | Signal | Handling |
|---|---|---|
| Normal cold startup | observer fires (`subject === window`) | observer |
| Late injection / notification already fired | flag `gBrowserInit.delayedStartupFinished === true` | **already-fired guard (C2)** |
| Secondary window opened later | delayed-startup fires for that window | observer (per-window) |
| Restored session | delayed-startup fires post `SessionStore.promiseAllWindowsRestored` | observer |
| `addObserver` throws | — | `load` event fallback |

### Lifecycle diagram

```
 fx-autoconfig loads script (per window, ~DOMContentLoaded)
        │
        ▼
 constructor → #armReadyHook()
        │  1. addObserver(browser-delayed-startup-finished)   [subscribe FIRST]
        │  2. if gBrowserInit.delayedStartupFinished === true ─► disarm + init()   (missed-notification)
        │  3. else if !subscribed ─► window 'load' ─► init()   (last resort)
        │  4. else ─► wait ─► observer(subject===window) ─► disarm + init()
        ▼
 init()  ── #initialized guard (idempotent) ──►
        ├─ enabled? no ─► no-op
        └─ yes ─► detectCapabilities ─► (missing? dormant+warn) ─► build frame
        ▲
 window 'unload' ─► disarm observer + destroy frame
```

### Race analysis
- **Check-then-subscribe gap:** eliminated by subscribing **before** reading the flag. If the notification fires in between, the observer catches it; if it already fired, the flag catches it.
- **Double-fire (flag true *and* observer later):** harmless — `#armReadyHook` disarms the observer before calling `init()`, and `init()` is idempotent via `#initialized`.
- **Per-window isolation:** observer filters `subject === window`; each window's manager is independent (fx-autoconfig loads once per window).
- **Feature-detect:** `gBrowserInit?.delayedStartupFinished` is optional-chained and try-wrapped; absence degrades to observer-only (prior behavior), never throws.

**Regression:** no behavior change on the normal path (observer still primary). Only adds a path for the previously-dead missed-notification case. Flag-gated; `init()` unchanged.
**Rollback:** `git revert` the C2 commit → reverts `#armReadyHook` to observer-plus-throw-fallback. No schema/state involved.
**DoD:** all five startup paths reach exactly one `init()`; idempotent; `node --check` passes; Zen functional flag on/off.

---

## C3 — Overlay attachment
(see the C3 commit / section appended below when implemented)
