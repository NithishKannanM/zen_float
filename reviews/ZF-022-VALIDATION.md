# ZF-022 — Float Surface Validation (TargetRegistry + FloatChrome)

**Build:** Zen 1.21.7b portable, `zen-float.uc.mjs` @ ZF-022, **loaded via fx-autoconfig** (real ship path).
**Driver:** Marionette chrome context; three `ExecuteAsyncScript` matrices + one chrome screenshot.
**Ground truth per row:** read from live objects, never from our own event payloads — `registry.state` vs `host.browser.currentURI.spec`; bar state read out of the DOM (`.zen-float-chrome` title text, `data-has-icon`, `[loading]`); listener counts via `nsIEventListenerService.getListenerInfoFor()` on **both** `window` (ZF-021d standard) and the float **tab** (new, for the tab-scoped metadata listeners).

## Result matrix

| # | Scenario | Method | Expected | Observed | Verdict |
|---|---|---|---|---|---|
| V1 | Open float, seed metadata | driven | registry seeded; bar shows title; not loading | `title="Alpha"`, `barTitle="Alpha"`, `loading=false` | **PASS** |
| V2 | **Rapid nav across 6 URLs** (60ms apart) | driven | `registry.url === live currentURI`; title = last page; loading false | registry url == live url == `…<title>Six</title>…`; `title="Six"`; `loading=false` | **PASS** |
| V3 | **Close mid-load** (STATE_START, no STATE_STOP — blackholed host) | driven | no errors; bar removed; registry detached; listeners at baseline | bar gone, `registryAttached=false`, tab listeners `0/0/0`, window `13/10`, **0 errors** | **PASS** |
| V4a | **Double `attach()`** | driven | no-op; no stacked listeners; one bar | both return `true`; tab census unchanged `1/1/1`; `.zen-float-chrome` count `1` | **PASS** |
| V4b | **Double `detach()`** | driven | no throw; stays detached | `threw=false`, `attached=false` | **PASS** |
| V5 | **External TabClose** on the float tab | driven | registry + chrome torn down via `onFatal`; no throw | before `bar=true, attached=true`; after `bar=false, attached=false, floatTabs=0`; window census `13/10` | **PASS** |
| V6a | `about:` page (`about:license`) | driven | url + title tracked | `url="about:license"`, `title="Licenses"` | **PASS** |
| V6b | Page with **no favicon** | driven | title tracked; icon falls back to placeholder | `title="NoFavicon"`, `favicon=null`, `hasIcon=false` | **PASS** |
| V6c | Normal network page (`example.com`) | driven | title from pipeline | `title="Example Domain"` (site genuinely has no favicon) | **PASS** |
| V6c-2 | Normal network page **with a favicon** (`mozilla.org`) | driven | favicon from `gBrowser.getIcon`; bar renders it | registry favicon == `gBrowser.getIcon(tab)` (`data:image/x-icon;base64,AAABAAMA…`); `barHasIcon=true` | **PASS** |
| V6d | **Slow-loading page** (blackholed host) | driven | `loading=true`, throbber on | `loading=true`, `barLoading=true` | **PASS** |
| V7 | **Remoteness change** (process switch) | driven | remoteType changes; metadata keeps tracking | `webIsolated=https://mozilla.org` → `null` (parent, about:) → `webIsolated=https://example.com`; url/title tracked across it **and** through a further navigation (`example.org`) | **PASS** |
| V8 | **Reload button** → `BrowserHost.reload()` | driven (event-subscribed) | loading true→false; same URL | `target-loading{true}` → `target-loading{false}` 84ms apart; url unchanged; `lastUpdated.loading` advanced | **PASS** |
| V9 | **Close button** → `FloatWindow.close()` | driven (real `.click()`) | float torn down | `bar=false`, `hasBrowser=false`, `floatTabs=0` | **PASS** |

**Listener-leak check (the ZF-021d standard):** window `TabSelect/TabClose` = **13/10 baseline → 13/10 after every teardown path** (owner close, close-mid-load, external TabClose). Tab-scoped metadata listeners = `TabAttrModified/TabRemotenessChange/BeforeTabRemotenessChange` **1/1/1 while attached → 0/0/0 after detach**, and unchanged by a second `attach()`.

## Visual evidence

`reviews/evidence/zf022-title-bar.png` — chrome screenshot, float open on mozilla.org: title bar with **real favicon**, full page title, reload (⟳) and close (✕) buttons, and **the live page compositing directly below the bar**.

Two prior project assumptions are corrected by this run:
- **Headless *can* composite OOP page pixels** here (`WebDriver:TakeScreenshot {full:true}` in chrome context). ZF-021's "no literal screenshot of the page inside the float" limitation does not hold on this rig — the page is visible in the capture. The earlier hit-test proxy (`efpIsFloat`) was sound but is no longer the only available signal.
- **The rig has network.** `mozilla.org`, `example.com` and `example.org` all loaded. The EXP-001-era note that "example.com didn't load headless" is stale.

## Coverage honesty

- **Driven (real build, real APIs):** every row above. Navigation used `fixupAndLoadURIString` with the system principal; the reload/close rows dispatched **real clicks on the real buttons**; the external-close row used `gBrowser.removeTab` (the same entry point "Close Other Tabs" and session ops take).
- **Genuinely exercised, not simulated:** the process switch (V7) — `remoteType` changed across a real about:↔https boundary, which is the exact condition that drops a progress listener.
- **Not exercised:** multi-window (headless second window hangs — unchanged from ZF-021); session restore; a *content-initiated* process switch (ours was chrome-initiated navigation, though the switch mechanism is identical); user-facing UI affordances for closing a tab ("Close Other Tabs" menu item) as opposed to the `removeTab` API beneath them.
- **Cosmetic finding (not a defect against this ticket's AC):** the title bar's top corners are rounded (frame radius) but the float browser's bottom corners are square — the browser is never reparented, so the frame's `overflow:hidden` cannot clip it. Fixing it means adding a matching `border-radius` to `.zen-float-browser .browserContainer`; deferred rather than folded in silently, since it is pure styling and geometry work belongs to ZF-030/031/032.
- **Console errors:** 1 unique message across all runs — `TypeError: Property 'handleEvent' is not callable.` It fires ~1 per `TabClose` in a **no-float baseline** too (measured in ZF-021d), so it is pre-existing Zen/headless noise, not ZF. No ZF-originated error was emitted in any row.

## Verdict

All six required scenarios pass, plus four rows added during the run (favicon-bearing page, real process switch, reload button, close button). Metadata is correct under rapid navigation, teardown is clean from all three paths (owner close, close-mid-load, external `TabClose` → `onFatal`), both components are idempotent on double attach/detach, and the listener census returns exactly to baseline at both window and tab scope. Deviations from the ticket are recorded in `design/ADR-022-FLOAT-SURFACE.md`.
