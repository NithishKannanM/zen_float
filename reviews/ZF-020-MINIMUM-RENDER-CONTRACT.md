# EXP-002E — Minimum Render Enrollment Contract

**Method:** source read from the shipped archives of the portable build (`~/zen-float-test/zen/browser/omni.ja` + toolkit `omni.ja`) **and** isolated-variable runtime matrix on Zen 1.21.7b via Marionette chrome context (one variable per experiment, fresh tab each). No fixes designed or implemented.

**Signal caveat (stated honestly):** headless cannot capture composited OOP pixels (proven earlier: chrome-screenshot omits remote content; content-screenshot degenerate). The primary render signal is `document.elementFromPoint()` — the actual stacked/hit-testable render tree — cross-checked against the **source of the compositing switch itself**. Literal on-screen pixels remain a headful residual (see §Remaining Unknowns).

---

## Executive answer (success criterion met)

> **A non-selected BrowserHost becomes renderable in Zen's deck when and only when both hold:**
> **(1) RENDER ENROLLMENT — its `.browserSidebarContainer` carries `deck-selected` (or `zen-split="true"`);**
> **(2) CONTENT COMPOSITING — `browser.docShellIsActive = true`.**
> **`zenModeActive` and `gBrowser.selectedTab` are NOT part of the minimum contract** — `zenModeActive` keeps compositing alive across deselection (persistence/keep-alive), and `selectedTab` is a convenience that auto-applies (1)+(2) at the cost of stealing selection/focus.

This is proven from the shipped setter/tabbox source **and** the runtime matrix, not inferred.

---

## 1. Source-backed rendering pipeline

Three independent layers, each with its own control:

**Layer A — Panel enrollment (which panel the deck shows / stacks on top).**
- Toolkit tabbox, Zen-patched — `chrome/toolkit/content/global/elements/tabbox.js:245-246`:
  ```js
  if (!(window.gZenGlanceManager && gZenGlanceManager.shouldShowDeckSelected(this._selectedPanel, oldPanel)))
      oldPanel?.classList.remove("deck-selected");
  this._selectedPanel?.classList.add("deck-selected");
  ```
  → On selection, the tabbox **adds `deck-selected` to the selected panel, removes it from the old** (unless Glance vetoes via `shouldShowDeckSelected`). `deck-selected` is the deck's "this panel is shown" marker.
- CSS gate — `zen-styles/zen-browser-container.css:47`: `.browserSidebarContainer:is(.deck-selected, [zen-split="true"]) .browserContainer { … }`; `tabbrowser/content-area.css:311`: `&.deck-selected > .browserContainer { z-index: 1 }`.
  → Only `deck-selected` **or** `zen-split="true"` panels get their `.browserContainer` rendered/stacked on top. **Two equivalent enrollment markers** (Glance uses `deck-selected`; Split View uses `zen-split`).

**Layer B — Content compositing (does the remote content paint its layers).**
- Toolkit browser custom element — `chrome/toolkit/content/global/elements/browser-custom-element.mjs:503-514`:
  ```js
  set docShellIsActive(val) {
    if (!this.browsingContext) return;
    this.browsingContext.isActive = val || this.zenModeActive;
    if (this.isRemoteBrowser) {
      let remoteTab = this.frameLoader?.remoteTab;
      if (remoteTab) remoteTab.renderLayers = val || this.zenModeActive;
    }
  }
  ```
  → `docShellIsActive = true` sets **`browsingContext.isActive`** + **`remoteTab.renderLayers`** — *this is the actual compositing switch* for OOP content. `renderLayers=true` is what makes the content process build & submit layers.

**Layer C — Persistence / keep-alive (stay composited when not selected).**
- Same setter: `val || this.zenModeActive` → when the core sets `docShellIsActive=false` on deselect, `zenModeActive=true` keeps `isActive`/`renderLayers` **true**.
- `moz-src/browser/components/tabbrowser/AsyncTabSwitcher.sys.mjs:938-943` `shouldDeactivateDocShell()` returns false (don't deactivate) if `browser.zenModeActive` (alongside split-view/PiP/print-preview).
- `moz-src/browser/components/tabbrowser/TabUnloader.sys.mjs:54` won't discard a tab if `tab.zenModeActive`.
  → `zenModeActive` = "keep this non-selected browser alive & composited, and don't unload it." A persistence flag, **not** an initial-render requirement.

---

## 2. Experiment matrix (isolated variables, fresh tab each)

Constant across all: `addTab` (background, unselected) + a fixed geometry stylesheet (`position:fixed` 420×640). Then exactly the listed variable(s) set. Key signal **`efpIsFloat`** = `elementFromPoint(float-center)` returns the FLOAT browser.

| # | deck-selected | zen-split | docShellIsActive | zenModeActive | selectedTab | **efpIsFloat** | container display/vis | browser WxH | dsa readback |
|---|:--:|:--:|:--:|:--:|:--:|:--:|---|---|:--:|
| M0 baseline | – | – | – | – | – | **false** | flex/visible | 420×640 | false |
| M1 docShell only | – | – | ✓ | – | – | **false** | flex/visible | 420×640 | true |
| M2 deck-selected only | ✓ | – | – | – | – | **TRUE** | flex/visible | 420×640 | false |
| M3 zen-split only | – | ✓ | – | – | – | **TRUE** | flex/visible | 420×640 | false |
| M4 zenModeActive only | – | – | – | ✓ | – | **false** | flex/visible | 420×640 | false |
| M5 selectedTab only | (auto ✓) | – | (auto ✓) | – | ✓ | **TRUE** | flex/visible | 420×640 | true |
| M6 deck + docShell | ✓ | – | ✓ | – | – | **TRUE** | flex/visible | 420×640 | true |
| M7 zen-split + docShell | – | ✓ | ✓ | – | – | **TRUE** | flex/visible | 420×640 | true |
| M8 full Glance set | ✓ | – | ✓ | ✓ | ✓ | **TRUE** | flex/visible | 420×640 | true |

All cases: `browsingContext:true`, `remoteType:web`, geometry 420×640 identical.

---

## 3. Runtime observations

1. **`efpIsFloat` flips TRUE iff `deck-selected` OR `zen-split` OR selected** (M2, M3, M5–M8). It is **false** for baseline, docShell-only, and zenMode-only (M0, M1, M4). → **Enrollment is governed solely by `deck-selected`/`zen-split`.**
2. **`docShellIsActive` alone (M1) does NOT enroll** — confirms ZF-020's current single action leaves the float behind the selected browser (the observed blank-box render path).
3. **`zenModeActive` alone (M4) does NOTHING for enrollment** (`efpIsFloat:false`, dsa stays false) — it is not a render marker.
4. **`deck-selected` alone (M2) enrolls even with `docShellIsActive:false`** — enrollment (stacking/panel-shown) is independent of content-compositing. Such a float would be *on top but not repainting* (stale/blank content) until `docShellIsActive=true`.
5. **`selectedTab` (M5) auto-applied BOTH** `deck-selected` (container class observed) **and** `docShellIsActive:true` — i.e. selection is the core bundle of A+B, via `tabbox.js:246` + the tabbrowser selection path.
6. **M6 (deck + docShell, `isSel:false`) reproduces the full rendered state of M8 (full Glance) without selecting or `zenModeActive`.** → selection and zenModeActive are not required for the initial rendered state.
7. Container `display:flex`/`visibility:visible`/size were identical in every case — so enrollment is **stacking/panel-show (z-index + deck marker)**, not a display/visibility toggle.

---

## 4. Variable dependency graph

```
                        ┌─ deck-selected ─┐            (Glance marker)
 RENDER ENROLLMENT  ────┤                 ├──►  panel shown / stacked on top   [Layer A]
 (efpIsFloat = true)    └─ zen-split ─────┘            (Split View marker)
                              ▲
                              │ auto-applied by
        gBrowser.selectedTab ─┘  (tabbox.js:246)  ── also auto-applies ──► docShellIsActive
                                                                                  │
 CONTENT COMPOSITING ── docShellIsActive=true ──► browsingContext.isActive=true   │  [Layer B]
                                              └─► remoteTab.renderLayers=true  ◄───┘
                              ▲
                              │ OR-kept-true-by
 PERSISTENCE ─────────── zenModeActive=true ──► keeps isActive/renderLayers across deselect  [Layer C]
                                              └─► AsyncTabSwitcher won't deactivate; TabUnloader won't discard
```

## 5. Call graph — Glance vs ZF-020

```
openGlance()                                   openFloat()  (ZF-020 current)
  #createBrowserElement                          FloatWindow.attachTarget
    gBrowser.addTab(...)                            gBrowser.addTab(...)
    gBrowser.selectedTab = newTab   ◄── A+B          (—) not selected
  #setGlanceStates                                 linkedBrowser.docShellIsActive = true   ◄── B only
    docShellIsActive = true         ◄── B          container.classList.add("zen-float-browser")  ◄── (own CSS; NOT a deck marker)
    zenModeActive = true            ◄── C          (—) no deck-selected / zen-split         ◄── A MISSING
  #configureGlanceElements                         ⇒ Layer A unmet ⇒ efpIsFloat=false ⇒ main browser renders the region
    overlay.classList.add("deck-selected")  ◄── A
  ⇒ A + B + C satisfied ⇒ rendered + persistent
```

## 6. Proven minimum rendering contract

**Necessary and sufficient for a non-selected BrowserHost to be rendered (on-top + repainting):**
- **A:** `container.classList.add("deck-selected")` — or `container.setAttribute("zen-split","true")`.
- **B:** `browser.docShellIsActive = true`.

Evidence: M6 (`deck-selected` + `docShellIsActive`, not selected) yields `efpIsFloat:true` + `dsa:true` — the same rendered state as the full Glance set (M8). Source confirms A (tabbox/CSS) and B (custom-element setter → `renderLayers`).

## 7. Variables proven unnecessary (for initial render)

| Variable | Role (source) | Matrix proof it's not required |
|---|---|---|
| `gBrowser.selectedTab = tab` | Bundles A+B via `tabbox.js:246`; steals selection/focus | M6 renders without it |
| `zenModeActive = true` | Persistence: OR'd into `isActive`/`renderLayers`; blocks async-deactivate + unload | M4 alone does nothing; M6 renders without it. (Required for *persistence across tab-switch*, not initial render.) |

## 8. Confidence level

**HIGH for the enrollment + compositing contract.** It is grounded in *both* the shipped control code (tabbox.js:246; browser-custom-element.mjs:507/511) *and* single-variable runtime isolation (M0–M8). The `efpIsFloat` signal reflects the real render/hit-test tree, and the compositing switch (`renderLayers`) is read directly from source, not inferred.

## 9. Remaining unknowns

1. **Literal composited OOP pixels — HEADFUL RESIDUAL.** `efpIsFloat` proves the float browser is the topmost element in the render tree and `renderLayers=true` proves the content is told to composite; a real-display screenshot is still owed for final visual confirmation (headless compositor cannot produce it here).
2. **Persistence across tab-switch — NOT tested (static matrix).** On selecting another tab, `tabbox.js:245` removes `deck-selected` from the float panel and the core sets `docShellIsActive=false`; `zenModeActive` keeps compositing (Layer C) but `deck-selected` (Layer A) would need re-adding. The steady-state contract (A+B) is proven; the *maintained-across-selection* contract is a distinct follow-up (propose EXP-002F).
3. **Focus / input routing** into a rendered-but-unselected browser is a separate concern from paint and was not measured.
4. **`shouldShowDeckSelected` interaction:** the tabbox consults `gZenGlanceManager.shouldShowDeckSelected` before removing `deck-selected`; an independent float has no equivalent hook, relevant to unknown #2.

## 10. Success-criteria verdict

**Met — first form, with a bounded residual.** We can state with source+runtime evidence:

> "A BrowserHost becomes renderable in Zen when and only when its `.browserSidebarContainer` is render-enrolled via `deck-selected` (or `zen-split`) **and** `docShellIsActive=true` sets `browsingContext.isActive`/`remoteTab.renderLayers`. `zenModeActive` and `selectedTab` are not part of the minimum render contract."

Residual (does not weaken the contract, bounds its scope): literal on-screen pixel confirmation and cross-tab-switch persistence require a headful run / a follow-up experiment. **No fix designed or proposed.**
