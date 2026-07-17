# ZF-020 vs Glance — Rendering Root-Cause Analysis (source + runtime)

**Method:** read Glance source from `omni.ja` of the running build + local `dev` source; measured runtime state on portable Zen 1.21.7b via Marionette chrome context. No fixes proposed — root-cause only.

## Premise correction
The observed "blank white box" has **two independent causes**, both now proven — and *"the browser cannot paint"* is **not** one of them (the float browser has correct geometry 420×640, `visibility:visible`, `docShellIsActive:true`, `renderLayers:true`):

- **F-1 (occlusion):** the opaque `.zen-float-overlay` frame (`background: rgb(255,255,255)`) stacks above everything — `elementFromPoint(float-center)` → `zen-float-overlay`.
- **F-2 (render enrollment — the real rendering-model divergence):** even with the frame hidden, the float browser is **not rendered as a live panel** because its `.browserSidebarContainer` lacks the **`deck-selected`** class. Zen's `#tabbrowser-tabpanels` composites only `deck-selected` panels; the main (deck-selected) tab's browser paints the float region instead.

## Ownership / rendering path of the `<browser>`
```
gBrowser.addTab(url, opts)
  → <tab> (owned by gBrowser)  +  linkedBrowser
  → panel in #tabbrowser-tabpanels:
        .browserSidebarContainer            ← deck panel; RENDERED ONLY IF .deck-selected
          └ .browserContainer               ← Glance/Float set position:fixed here
              └ .browserStack
                  └ <browser remote>        ← OOP content; composited only when its panel is deck-rendered + docShellIsActive
```
Zen's deck mechanism: `#tabbrowser-tabpanels` renders the `.browserSidebarContainer` element(s) carrying `.deck-selected`. Normal selection marks exactly one (the selected tab). **Glance and Split View add `deck-selected` to additional panels** to render more than one at once.

## Line-by-line divergence (Glance `ZenGlanceManager.mjs` vs ZF-020 `FloatWindow.attachTarget`)

| Step | Glance | ZF-020 | Diverges? |
|---|---|---|---|
| create browser | `#createBrowserElement`: `gBrowser.addTab(url, {ownerTab, skipBackgroundNotify, insertTab, skipAnimation, skipRoute, triggeringPrincipal})` (L189-195) | `gBrowser.addTab(url, {ownerTab, skipBackgroundNotify, insertTab, skipAnimation, triggeringPrincipal})` | ~same (ZF omits `skipRoute`, `skipLoad`) |
| **select** | **`gBrowser.selectedTab = newTab` (L200)** | *(never selects the tab)* | **YES — first divergence** |
| nest/own | `currentTab.querySelector('.tab-content').appendChild(newTab)` (L236); parent/child `glance-id` | standalone top-level tab; `[zen-float-tab]` hidden from strip | YES |
| **deck enroll** | **`overlay.classList.add('deck-selected')` (L1277)**; parent → `zen-glance-background` + `deck-selected` (L1273-1275) | **adds only `.zen-float-browser`** (no `deck-selected`) | **YES — the rendering gate** |
| activate | `docShellIsActive=true` **and `zenModeActive=true`** on glance + parent (L1285-1288) | `docShellIsActive=true` only | YES (`zenModeActive` unset) |
| float geometry | `.zen-glance-overlay .browserContainer { position:fixed }` | `.zen-float-browser .browserContainer { position:fixed }` | ~same technique |

## First point of divergence from Glance's rendering model
**In the render-enrollment step.** Glance's first two rendering actions after creating the browser are **(1) make it the selected tab** (`gBrowser.selectedTab = newTab`, L200) and **(2) mark its container `deck-selected`** (L1277) — enrolling the browser's panel in Zen's deck-rendered set. ZF-020's `attachTarget` performs **neither**; it substitutes `.zen-float-browser` CSS, which Zen's deck does **not** recognize as "render this panel." Everything downstream (occlusion aside) follows from the float panel never being deck-enrolled.

## Runtime proof (Marionette, portable 1.21.7b)
- `A_zf020_noDeckSelected`: container `display:flex visibility:visible`, browser `420×640`, `docShellIsActive:true`, `renderLayers:true` — *laid out and active, but…*
- `elementFromPoint(float-center)` with frame hidden, **no** deck-selected → **main** browser (`…deck-selected`).
- add `deck-selected` to the float container → `elementFromPoint` → **float** browser (`…zen-float-browser deck-selected`), `topIsFloatBrowserNow:true`.
- `zenModeActive` consumers: only `ZenGlanceManager.mjs` + `ZenViewSplitter.mjs` ("avoid setting docShellIsActive to false later on") — a Zen bookkeeping flag to keep a non-selected browser active; ZF-020 never sets it.

## Conclusion (no fix proposed)
**Glance's remote browser paints because Glance enrolls its `.browserSidebarContainer` in Zen's deck-rendered set (`deck-selected` + tab selection) and keeps it active (`docShellIsActive` + `zenModeActive`). ZF-020's browser is laid out, sized, visible and active, but its container is never `deck-selected`, so Zen's `#tabbrowser-tabpanels` never composites it as a live panel — the deck-selected main browser renders the region instead. Separately, the opaque `.zen-float-overlay` frame occludes on top (F-1).** Root cause = missing deck-render enrollment (`deck-selected`/selection), not a paint incapability. Remedy to be designed separately.
