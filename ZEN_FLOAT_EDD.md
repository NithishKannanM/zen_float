# Zen Float — Engineering Design Document (EDD)

**Status:** Implementation blueprint · **Audience:** Zen core engineering + Zen Float implementers
**Companion to:** `ZEN_FLOAT_RFC.md` (approved). This document does **not** restate the PRD; it maps the *approved* design onto the *actual* Zen source tree so an engineer can clone `zen-browser/desktop` and start.
**Source basis:** `zen-browser/desktop`, default branch **`dev`**, read directly (file tree + key module contents). Every claim tagged **[Confirmed] / [Likely] / [Unknown] / [Needs experimentation]**.

---

## 0. ⚠️ Correction to the RFC — read before anything else

The RFC's headline recommendation was *"build v1 as a Zen Mod with a privileged `script.js`."* **Reading the actual source invalidates the premise.**

**The official Zen Mods loader does not execute JavaScript.** `src/zen/mods/ZenMods.mjs` (class `nsZenMods`, `window.gZenMods`) processes **only `chrome.css` and `preferences.json`**. It reads CSS via `IOUtils.readUTF8`, aggregates into the profile `zen-themes.css`, and rebuilds styles via a native backend (`nsZenModsBackend` / `ZenStyleSheetCache.cpp`). There is **no `Services.scriptloader.loadSubScript`, no `import()`, no `<script>` injection** anywhere in the mod pipeline. **[Confirmed — dev branch source].** Marketing copy that says Mods "inject CSS and JS" is describing the ecosystem loosely, not the marketplace loader.

**Therefore, privileged JS in Zen is delivered by a separate mechanism**, not the Mods marketplace:

| Channel | Runs privileged JS? | How | Install friction |
|---|---|---|---|
| **Official Zen Mods** (`gZenMods`) | ❌ No | CSS + prefs only | Lowest (in-app) **[Confirmed]** |
| **fx-autoconfig** (`MrOtherGuy/fx-autoconfig`) | ✅ Yes | `config.js` autoconfig in the *app install dir* + `.uc.mjs` scripts in `profile/chrome/JS/`, loaded into `browser.xhtml` | Medium — touches install dir **[Confirmed]** |
| **Sine** (`CosmoCreeper/Sine`) | ✅ Yes | Community mod manager for Firefox forks; supports userChrome JS + the Zen chrome format; wraps fx-autoconfig | Medium — one-time setup **[Confirmed]** |
| **Zen core** (upstream patch) | ✅ Yes | Add module to `ZenPreloadedScripts.js` import list | N/A (ships in browser) **[Confirmed]** |

**Revised delivery plan (unchanged strategy, corrected mechanism):**

- **v1 prototype / distribution:** ship Zen Float as a **`.uc.mjs` privileged userChrome script loaded via fx-autoconfig (or Sine)**. Everything the RFC assumed a "mod script.js" would do, a `.uc.mjs` under fx-autoconfig does — with *full* chrome privilege, identical to core. **[Confirmed capability]**
- **v2:** upstream into core by registering `ZenFloatManager.mjs` in `ZenPreloadedScripts.js`.
- A CSS-only Zen Mod can ship *alongside* for theming, but cannot carry the logic.

This correction changes **distribution and install UX**, not the architecture. The rest of this EDD assumes the fx-autoconfig `.uc.mjs` path for v1 and the `ZenPreloadedScripts.js` path for core.

---

# 1. Repository Architecture

## 1.1 How Zen is built (context)

Zen = **patch files applied to Firefox at build time**, orchestrated by **Surfer** (`zen-browser/surfer`). Zen code lives in `src/`; you edit `engine/` (created by `npm run init`, this is the vendored Firefox tree) and use `npm run export/import` to move changes in/out. Prefs are YAML in the surfer config; runtime prefs are `zen.*`. **[Confirmed — docs + RFC §3.1].** Chrome URLs: Zen modules resolve under `chrome://browser/content/zen-components/…` and `resource:///modules/zen/…`. **[Confirmed — import paths in `ZenPreloadedScripts.js`].**

## 1.2 Directory map (what matters for Zen Float)

```
zen-browser/desktop
├─ src/
│  ├─ browser/              Firefox browser patches — incl. browser.xhtml (chrome host doc)  ★ integration point
│  ├─ zen/                  ★★ ALL Zen features live here
│  │  ├─ common/            ★ script-load + base classes + UI manager
│  │  │  ├─ ZenPreloadedScripts.js   ← ★ the loader that pulls every Zen module into the window
│  │  │  ├─ Components.manifest       ← chrome:// registration
│  │  │  ├─ modules/                  ← base classes (nsZenDOMOperatedFeature, nsZenPreloadedFeature) [path Needs exp.]
│  │  │  └─ styles/ sys/ zen-sets.js zenThemeModifier.js
│  │  ├─ glance/            ★★ REUSE TARGET — floating live-browser overlay
│  │  │  ├─ ZenGlanceManager.mjs      (class nsZenGlanceManager, window.gZenGlanceManager)
│  │  │  ├─ zen-glance.css  zen-glance.inc.xhtml  actors/  tests/
│  │  ├─ split-view/        ★ dock-into-split precedent
│  │  │  ├─ ZenViewSplitter.mjs       (gZenViewSplitter)
│  │  │  └─ zen-splitview-overlay.inc.xhtml  zen-split-*.css
│  │  ├─ spaces/            ★ workspaces (renamed "spaces")
│  │  │  ├─ ZenSpaceManager.mjs  ZenSpace.mjs  ZenSpaceCreation.mjs  ZenSpaceIcons.mjs  ZenSpacesSwipe.mjs
│  │  ├─ space-routing/     ★ ZenSpaceRoutingManager.sys.mjs (space<->tab routing)
│  │  ├─ sessionstore/      ★ persistence
│  │  │  ├─ ZenSessionManager.sys.mjs  ZenWindowSync.sys.mjs
│  │  ├─ kbs/               ★ ZenKeyboardShortcuts.mjs (gZenKeyboardShortcutsManager, keyset "zenKeyset")
│  │  ├─ mods/              CSS+prefs loader (NOT JS): ZenMods.mjs + nsZenModsBackend.cpp/.h + ZenStyleSheetCache
│  │  ├─ tabs/ folders/ live-folders/   pinned/essentials + folder patterns (persistence reference)
│  │  ├─ compact-mode/      ZenCompactMode.mjs (auto-hide chrome reference for auto-hide/opacity)
│  │  ├─ media/             ZenMediaController.mjs (PiP/media coexistence reference)
│  │  ├─ urlbar/ boosts/ downloads/ drag-and-drop/ share/ sync/ welcome/ toolkit/ urlbar/
│  │  ├─ @types/ vendor/ images/ fonts/ emojis/
│  │  ├─ ZenComponents.manifest  moz.build  zen.globals.mjs
│  └─ …
├─ (Firefox) toolkit/       platform: docshell, session store internals, XULFrameElement <browser>   ← reuse, never fork
├─ (Firefox) browser/       Firefox UI; Zen patches browser.xhtml here
```

**Directories that DO NOT matter for us:** `boosts/`, `downloads/`, `share/`, `sync/`, `welcome/`, `urlbar/`, `emojis/`, `fonts/`, `images/`, `vendor/`, `live-folders/`. **Never touch** Firefox `toolkit/` / `docshell` internals — reuse via existing `<browser>` element APIs. **[Confirmed tree].**

## 1.3 New code footprint

```
NEW (v1, fx-autoconfig):  profile/chrome/JS/zen-float.uc.mjs      (+ optional zen-float.uc.css)
NEW (v2, core):           src/zen/float/ZenFloatManager.mjs
                          src/zen/float/zen-float.css
                          src/zen/float/zen-float.inc.xhtml
                          src/zen/float/moz.build, jar.inc.mn
                          1-line addition to src/zen/common/ZenPreloadedScripts.js
                          new prefs zen.float.* (surfer prefs YAML)
                          optional: new <key> defaults in ZenKeyboardShortcuts loader
```

---

# 2. Source Code Investigation (subsystem by subsystem)

For each: **Purpose · Entry point · Deps · Public API · Private internals · Lifecycle (init/shutdown) · Extension points · Risks.** All identifiers below are quoted from the `dev` source. **[Confirmed]** unless noted.

## 2.1 Glance — `src/zen/glance/ZenGlanceManager.mjs` ★ THE REUSE TARGET

- **Purpose:** render a live nested `<browser>` as a floating overlay on top of the current tab; animate open/close; expand-to-tab; send-to-split.
- **Class / global:** `class nsZenGlanceManager extends nsZenDOMOperatedFeature`; `window.gZenGlanceManager = new nsZenGlanceManager();`.
- **Entry point:** `init()` → `#setupEventListeners()`, `#setupPreferences()` (`XPCOMUtils.defineLazyPreferenceGetter`), `#setupObservers()` (`quit-application-requested`), `#insertIntoContextMenu()` (adds `#context-zenOpenLinkInGlance`).
- **Dependencies:** `gBrowser` (tab creation/lifecycle), `Services.prefs`, `Services.obs`, `Services.io`, security manager (`#isGlanceLoadAllowed`), DOM: `.browserSidebarContainer`, `.browserContainer`, `.browserStack`, `#tabbrowser-tabpanels`, template `#zen-glance-sidebar-template`.
- **Nested-browser creation (the exact pattern to copy):**
  ```js
  const newTab = existingTab ?? gBrowser.addTab(Services.io.newURI(url).spec, {
    userContextId: currentTab.getAttribute("usercontextid") || "",
    skipBackgroundNotify: true, insertTab: true, skipLoad: false,
    skipAnimation: true, ownerTab: currentTab,
    triggeringPrincipal: data.triggeringPrincipal, skipRoute: true,
  });
  // then: newTab attrs "zen-glance-tab", "glance-id"=<uuid>; currentTab attr "glance-id"=<uuid>
  ```
- **Public methods (selected):** `openGlance(data, existingTab, ownerTab)`, `closeGlance({…})`, `quickOpenGlance()`, `quickCloseGlance({…})`, `fullyOpenGlance({forSplit})`, `splitGlance()`, `manageTabClose(tab)`, `getTabOrGlanceParent/Child(tab)`, `handleMainCommandSet(event)` (routes `cmd_zenGlanceClose/Expand/Split`), `onOverlayClick`, `onTabClose`, `onLocationChange`, `onFullscreenEntered`, `observe`, `onUnload`.
- **Private internals (the machine to study, not necessarily reuse):** `#createBrowserElement`, `#createTabOptions`, `#configureNewTab`, `#registerGlance` (writes `#glances` Map), `#animateGlanceOpening/Closing`, `#createGlanceArcSequence` (uses `#ARC_CONFIG {ARC_STEPS:80, MAX_ARC_HEIGHT:20, ARC_HEIGHT_RATIO:0.2}`), `#animateParentBackground` (scales parent to `GLANCE_BACKGROUND_SCALE=0.97`), `#setGlanceStates`/`#resetGlanceStates` (docshell activation), `#cleanupGlanceElements`, `#deleteGlance` (revokes blob URLs).
- **Lifecycle:** created + `init()` via preloaded-scripts on window setup; per-glance state in `#glances` Map keyed by `glance-id`; **explicitly excluded from session persistence** (the property Zen Float must add); torn down in `onUnload` on `quit-application-requested`.
- **Extension points for Zen Float:** (a) reuse `.browserSidebarContainer` + `.zen-glance-overlay` overlay contract and the `gBrowser.addTab({...skipRoute, skipAnimation, ownerTab...})` recipe; (b) reuse the `cmd_zenGlance*` command-routing pattern; (c) `splitGlance()` proves the Glance→SplitView handoff Zen Float wants.
- **Risks:** heavy private surface; the `#glances` Map + parent/child `glance-id` coupling assumes ephemerality — **do not** hang persistent floats off it. Prefs default `zen.glance.activation-method="ctrl"` (RFC said `alt`; **corrected → `ctrl`** per source). **[Confirmed]**

## 2.2 Split View — `src/zen/split-view/ZenViewSplitter.mjs`

- **Purpose:** multi-pane tab layout; binary tree (`nsSplitNode`/`nsSplitLeafNode`), ≤4 tabs, draggable dividers (`_splitNodeToSplitters`), min `zen.splitView.min-resize-width` (7). **Global:** `gZenViewSplitter`.
- **Relevance:** only as the **"Send to Split View" action** (FR10). Zen Float calls into it to hand off its `<browser>`; Glance's `splitGlance()` already demonstrates the call path.
- **Risk:** internal tree API is private; treat as a black box reached only through the same helper Glance uses (`splitLinkFromURL` / split entry). **[Confirmed pattern; exact call Needs experimentation].**

## 2.3 Web Panels — Firefox sidebar + Zen side web panels

- **Purpose:** persistent side web-apps; "close on focus loss" toggle = the persistence precedent.
- **Source note:** this is largely Firefox's `browser/components/sidebar` plus Zen CSS/patches rather than a single `src/zen/` module we found; **[Likely]** the toggle lives in Zen browser patches + prefs. **[Needs experimentation to pin the exact file].**
- **Relevance:** conceptual (persistence UX) only; Zen Float does **not** build on the sidebar element (that path is edge-docked and can't free-float — RFC §3.4). Reuse the *idea*, not the code.

## 2.4 Workspaces ("Spaces") — `src/zen/spaces/` + `src/zen/space-routing/`

- **Purpose:** independent tab sets per space; routing tabs↔spaces.
- **Entry points / globals:** `ZenSpaceManager.mjs` (loaded via `resource:///modules/zen/ZenSpaceManager.mjs`), custom elements `zen-workspace`/`zen-workspace-creation`/`zen-workspace-icons` (`ZenSpace.mjs`, `ZenSpaceCreation.mjs`, `ZenSpaceIcons.mjs`), and `ZenSpaceRoutingManager.sys.mjs` (loaded via `ChromeUtils.defineESModuleGetters`).
- **Relevance:** Zen Float's **Workspace scope** subscribes to space-change to show/hide/rebind. **[Confirmed spaces exist; exact change-event name Needs experimentation — Experiment E4].**
- **Risk:** "workspaces" were renamed to "spaces" in code — do not grep for `ZenWorkspaces`; use `ZenSpaceManager`. **[Confirmed]**

## 2.5 Session Restore — `src/zen/sessionstore/`

- **Modules:** `ZenSessionManager.sys.mjs`, `ZenWindowSync.sys.mjs`; plus `ZenSessionStore.mjs` (loaded via `chrome://browser/content/zen-components/ZenSessionStore.mjs`).
- **Relevance:** v2 core persistence hook for float geometry/target; v1 uses its own JSON (see §4).
- **Risk:** `.sys.mjs` = system module (loaded in a shared/system global, not per-window). Persisting from a per-window `.uc.mjs` must serialize to profile JSON, not assume access to these internals. **[Likely].**

## 2.6 Preferences — surfer YAML + `Services.prefs` + Mods `preferences.json`

- **Runtime:** `Services.prefs.get/​setBoolPref/StringPref/IntPref`, lazy getters via `XPCOMUtils.defineLazyPreferenceGetter`. Namespace `zen.*`. Zen Float uses `zen.float.*`.
- **Settings UI:** core path can surface a pane in `about:preferences#zen`; v1 uses a Mods-style `preferences.json` for the CSS-toggle parts only.
- **Risk:** v1 `.uc.mjs` can read/write `zen.float.*` prefs freely (full privilege). **[Confirmed].**

## 2.7 Window Manager — **does not exist; this is what we build**

There is **no** generic in-window floating-window manager in Zen. Glance is the closest and it's single-purpose + ephemeral. `ZenFloatManager` is genuinely new code (§4). **[Confirmed by absence in tree].**

## 2.8 Browser Chrome / Overlay host — `src/browser/**/browser.xhtml`

- **Purpose:** the privileged XUL/XHTML document hosting all chrome. Zen injects components here via `.inc.xhtml` linksets and `ZenComponents.manifest`.
- **Relevance:** core path adds `zen-float.inc.xhtml` (the overlay skeleton) to the linkset; v1 `.uc.mjs` builds the overlay DOM at runtime instead.
- **Risk:** injecting XHTML at build time (core) is clean; runtime DOM creation (v1) must run after `browser.xhtml` `DOMContentLoaded` and after `gBrowser` exists. **[Confirmed load timing model — see §2.11].**

## 2.9 Context Menus

- Glance shows the pattern: `#insertIntoContextMenu()` creates `#context-zenOpenLinkInGlance` with a `command` handler calling `openGlance({url, triggeringPrincipal})`. Zen Float reuses this to add "Open in Float." **[Confirmed pattern].**

## 2.10 Keyboard Shortcuts — `src/zen/kbs/ZenKeyboardShortcuts.mjs`

- **Global:** `gZenKeyboardShortcutsManager`. **Model:** `KeyShortcut` instances → XUL `<key>` in keyset id `"zenKeyset"`; `key.toXHTMLElement(browser)`; `key.setAttribute("command", action)`. Persisted at `profile/zen-keyboard-shortcuts.json` via `nsZenKeyboardShortcutsLoader`.
- **Runtime registration:** `async setShortcut(action, shortcut, modifiers)` + `triggerShortcutRebuild()` **modifies existing** shortcuts; **new** defaults expect entry in `nsZenKeyboardShortcutsLoader.zenGetDefaultShortcuts()` (a core edit). 
- **Implication:** v1 `.uc.mjs` should **register its own `<key>` element directly** in the chrome `keyset` (standard XUL) rather than fight the loader; core path adds a proper default. **[Confirmed model; v1 self-registration is standard XUL — Likely].**

## 2.11 Script loading & base classes — `src/zen/common/ZenPreloadedScripts.js` ★

- **Mechanism (this is how everything becomes a window global):**
  - `ChromeUtils.importESModule(url, { global: "current" })` in a loop over module URLs — e.g. `"chrome://browser/content/zen-components/ZenGlanceManager.mjs"`, `ZenViewSplitter.mjs`, `ZenSessionStore.mjs`, `ZenMods.mjs`, `ZenKeyboardShortcuts.mjs`, `ZenUIManager.mjs`, `ZenStartup.mjs`, etc.
  - `Services.scriptloader.loadSubScript("chrome://browser/content/zen-components/…js")` for classic scripts (`ZenDragAndDrop.js`, `ZenSpaceBookmarksStorage.js`).
  - `ChromeUtils.defineESModuleGetters` for lazy system modules (`ZenSpaceRoutingManager.sys.mjs`).
  - `customElements.setElementCreationCallback(...)` for lazy custom elements.
- **Base-class contract:** feature modules `export`/assign a `window.gX = new nsX()`; `nsX` extends `nsZenDOMOperatedFeature` (DOM-ready features) or `nsZenPreloadedFeature` (earlier). `init()` is invoked by the preload machinery once `gBrowser`/DOM are ready. **[Confirmed the two base classes exist and are extended; their exact file path (`src/zen/common/modules/…`) and the precise init dispatch are Needs experimentation — Experiment E1].**
- **Core integration recipe for Zen Float:** add `"chrome://browser/content/zen-components/ZenFloatManager.mjs"` to the `importESModule` array; module ends with `window.gZenFloatManager = new nsZenFloatManager();` and defines `init()`. **One line + one module.** **[Confirmed mechanism].**

---

# 3. Dependency Graph

```
                         browser.xhtml  (chrome host document, privileged)
                                │  DOMContentLoaded
                                ▼
                     ZenPreloadedScripts.js
        ┌──────────────┬───────────┴───────────┬──────────────┬─────────────┐
        ▼              ▼                        ▼              ▼             ▼
   ZenStartup    ZenSpaceManager        gZenGlanceManager  gZenView     gZenKeyboard
   (order/UI)    (workspaces)           (nsZenGlanceMgr)   Splitter     ShortcutsMgr
        │              │                        │              │             │
        │              │  space-changed         │ reuse:       │ handoff     │ <key> in
        │              │  events (E4)           │ overlay+addTab│ target      │ zenKeyset
        ▼              ▼                        ▼              ▼             ▼
   ┌───────────────────────────────────────────────────────────────────────────┐
   │                        ★ nsZenFloatManager (NEW)                           │
   │  gBrowser.addTab(...nested <browser>) → .zen-float-overlay (position:fixed)│
   │  DragController · ResizeController · DockController · ScopeBinder ·        │
   │  StateStore(JSON/prefs) · ShortcutBinding · AnimationController · Session  │
   └───────────────────────────────┬───────────────────────────────────────────┘
                                    ▼
                          floating <browser src="claude.ai">
                          (full web engine; container-aware)
   ▲ WebExtensions can never reach this plane (RFC §3.4) — chrome-JS only.
```

**Where Zen Float integrates:** as a **peer of `gZenGlanceManager`** under `ZenPreloadedScripts.js`, *consuming* `gBrowser`, `ZenSpaceManager` events, `gZenViewSplitter` (handoff), and `gZenKeyboardShortcutsManager`/keyset; *reusing* Glance's overlay+addTab recipe; *owning* a new persistent lifecycle. **[Confirmed integration point].**

---

# 4. Implementation Strategy (per feature)

Legend: **Reuse** = call/copy existing; **New** = write; **Mod** = modify existing file (core path only).

| Feature | Existing impl to lean on | Files reused | Files modified (core) | New classes/interfaces | New events | New prefs | LOC | Cplx | Testing |
|---|---|---|---|---|---|---|---|---|---|
| **Floating window (host + nested browser)** | Glance overlay + `gBrowser.addTab({skipRoute,skipAnimation,ownerTab})`; `.browserSidebarContainer` contract | `ZenGlanceManager.mjs` (pattern), `<browser>` platform | `ZenPreloadedScripts.js` (+1 line) | `nsZenFloatManager`, `FloatWindow` | `ZenFloat:Open/Close` | `zen.float.enabled` | ~250 | High | E1–E3 + UI test render/survive-tab-switch |
| **Dragging** | none (Glance animates, doesn't drag) | pointer events, rAF | — | `DragController` | `ZenFloat:Moved` | — | ~120 | Med | UI: drag delta = geometry delta; no page CLS |
| **Resizing** | Split dividers concept only | pointer events | — | `ResizeController` | `ZenFloat:Resized` | `zen.float.min-width/height` | ~120 | Med | clamp min/max; persist |
| **Docking (Smart Dock)** | Glance `splitGlance()` for split handoff | `gZenViewSplitter` | — | `DockController` | `ZenFloat:Docked` | `zen.float.snap-threshold` | ~180 | Med-High | snap within threshold; per-corner slot memory |
| **Opacity** | ZenCompactMode CSS patterns | CSS var on overlay | — | (in FloatWindow) | — | `zen.float.opacity` | ~30 | Low | slider 50–100% applies live |
| **Bubble mode** | — | CSS transform | — | (FloatWindow state) | `ZenFloat:Collapsed` | `zen.float.collapsed` | ~90 | Med | ≤56px, draggable, expand |
| **Workspace scope** | `ZenSpaceManager` events | space-change hook | — | `ScopeBinder` | — | `zen.float.scope` | ~140 | Med | switch space → correct float (E4) |
| **Global scope** | window-level singleton | — | — | (ScopeBinder branch) | — | (scope enum) | ~40 | Low | visible across tabs/spaces |
| **Session restore** | `ZenSessionStore`/`ZenStartup` timing | v1: profile JSON; v2: session store | v2: sessionstore hook | `StateStore`, `SessionBridge` | `ZenFloat:Restored` | (state file) | ~150 | Med | restart → geometry/target/lastUrl restored |
| **Keyboard shortcut** | `gZenKeyboardShortcutsManager`, keyset `zenKeyset` | XUL `<key>` | v2: default in loader | `ShortcutBinding` | — | `zen.float.hotkey` | ~60 | Low | toggle <150ms, no CLS |
| **Settings** | Mods `preferences.json`; `about:preferences#zen` | prefs system | v2: prefs pane | — | — | `zen.float.*` | ~80 | Low | each pref round-trips |
| **Context-menu "Open in Float"** | Glance `#insertIntoContextMenu` | context menu | — | (FloatManager method) | — | — | ~40 | Low | menu item opens float w/ link |

**Total new LOC estimate:** ~1,300–1,700 (v1). **[Likely].** The dominant risk/complexity is concentrated in the *first* feature (host + nested browser), which is exactly what the experiments in §6 de-risk.

### 4.1 State model (v1 persistence, no core dependency)

```jsonc
// profile/zen-float-state.json  (v1)   |   ZenSessionStore entry (v2)
{
  "version": 1,
  "scope": "workspace",                 // "tab" | "workspace" | "global"
  "perScope": {
    "global":      { "target": {"id":"claude","url":"https://claude.ai/"},
                     "geometry": {"x":1180,"y":520,"w":420,"h":640,"snap":"br"},
                     "opacity":0.96, "collapsed":false, "autohideOnPageFocus":false,
                     "lastActiveUrl":"https://claude.ai/chat/…" },
    "ws:<uuid>":   { /* … */ },
    "tab:<id>":    { /* … */ }
  }
}
```
Written with `IOUtils.writeJSON` (same API family Mods uses for `zen-themes.json`); debounced on geometry commit. **[Confirmed IOUtils availability].**

---

# 5. Code Reuse Analysis — what must NOT be rewritten

| Do **not** rewrite | Reuse instead | Why |
|---|---|---|
| Nested-browser creation | Glance's `gBrowser.addTab({ skipRoute:true, skipAnimation:true, skipBackgroundNotify:true, ownerTab, triggeringPrincipal, userContextId })` recipe | This exact options set is what makes a `<browser>` that renders but stays out of the tab strip/routing. Re-deriving it invites subtle session/route bugs. **[Confirmed]** |
| Overlay container plumbing | `.browserSidebarContainer` + a `.zen-float-overlay` class mirroring `.zen-glance-overlay`, `position:fixed` | Proven to host a live docshell over content without breaking chrome layout. **[Confirmed]** |
| Docshell activation on show/hide | Glance's `#setGlanceStates`/`#resetGlanceStates` approach (activate/deactivate docshell) | Correct docshell activation avoids painting/AV bugs and background throttling mistakes. **[Confirmed]** |
| Split handoff | `gZenViewSplitter` via the same path `splitGlance()` uses | Reimplementing split tree insertion is out of scope and fragile. **[Confirmed]** |
| Command routing | `cmd_zenFloat*` commands on the main command set (mirror `cmd_zenGlanceClose/Expand/Split`) | Consistent with chrome command dispatch; free menu/keys wiring. **[Confirmed]** |
| Keyset | Add `<key>` to `zenKeyset` (v1) / loader default (v2) | Native shortcut plumbing incl. conflict handling. **[Confirmed]** |
| Preference plumbing | `Services.prefs` + `defineLazyPreferenceGetter` + Mods `preferences.json` for CSS toggles | Matches every other Zen feature; free settings UI wiring in core. **[Confirmed]** |
| Persistence primitives | `IOUtils.readJSON/writeJSON` (v1); `ZenSessionStore` (v2) | Same APIs Mods/session use; battle-tested. **[Confirmed]** |
| Auto-hide/opacity mechanics | Patterns from `ZenCompactMode.mjs` | Existing solution for hiding/fading chrome; consistent behavior. **[Likely]** |
| Firefox `toolkit/` `<browser>`/docshell | Never fork; use element APIs | Forking platform = RFC path D (rejected). **[Confirmed]** |

**Rule of thumb:** Zen Float is ~80% *composition* of the above and ~20% *new* window-manager logic (drag/resize/dock/scope). If you find yourself writing docshell, tab-routing, or session internals, stop — you're rewriting something that exists.

---

# 6. Experimental Tasks (must complete BEFORE production code)

No production code in this phase — each is a throwaway spike with a pass/fail gate.

### E1 — Privileged-JS load + base-class contract
- **Prototype:** install fx-autoconfig; drop `zen-float.uc.mjs` that logs and reads `gBrowser`, `gZenGlanceManager`, `ZenSpaceManager`. Confirm whether extending `nsZenDOMOperatedFeature` is possible from a `.uc.mjs` or whether we self-manage `init()` after `DOMContentLoaded`.
- **Expected:** globals reachable; script runs privileged in `browser.xhtml`.
- **Possible failure:** load ordering — script runs before `gBrowser` exists.
- **Alternative:** hook `browser-delayed-startup-finished` / `MozAfterPaint` before init.
- **Success:** `gZenGlanceManager` is defined and callable from our script. **[Needs experimentation]**

### E2 — Persistent nested `<browser>` outside Glance's lifecycle
- **Prototype:** create a tab with Glance's addTab options *without* registering it in `#glances`; parent it into a custom `.zen-float-overlay`; keep it alive across a `TabSelect`.
- **Expected:** live page persists over tab switches; no Glance cleanup fires.
- **Possible failure:** Glance's `TabSelect`/`onLocationChange` or session-restore reclaims/closes it; docshell deactivates.
- **Alternative:** mark the tab with a private attribute Glance ignores; manually manage docshell active state (E-copy of `#setGlanceStates`).
- **Success:** claude.ai stays interactive through 20 tab switches, RAM stable. **[Needs experimentation — highest-risk spike].**

### E3 — Third-party AI embedding (CSP / X-Frame-Options)
- **Prototype:** load claude.ai, chatgpt.com, gemini, perplexity, github, notion, slack in the float `<browser>`; verify login/cookies per container.
- **Expected:** real `<browser>` (not iframe) bypasses XFO like Web Panels do.
- **Possible failure:** a site sniffs framing/user-agent and blocks, or breaks OAuth popups.
- **Alternative:** first-class "open in tab" fallback; per-site allowlist.
- **Success:** ≥5/7 targets fully usable incl. auth. **[Likely pass; verify per site].**

### E4 — Space (workspace) change event
- **Prototype:** subscribe to `ZenSpaceManager` change signal; log on space switch.
- **Expected:** a documented event/callback exists.
- **Possible failure:** no public event → must poll or patch.
- **Alternative:** observe active-space attribute mutation via `MutationObserver` on the spaces DOM.
- **Success:** deterministic callback on every space switch. **[Needs experimentation]**

### E5 — Geometry perf during drag
- **Prototype:** drag overlay via `transform: translate3d` on rAF vs. `left/top`; measure jank + page reflow (CLS).
- **Expected:** transform path is 60fps, zero page reflow.
- **Possible failure:** compositing the live docshell during drag stutters.
- **Alternative:** show a lightweight ghost while dragging, reparent on drop.
- **Success:** 60fps drag, no page layout shift. **[Likely]**

### E6 — Shortcut self-registration
- **Prototype:** append a `<key>` to `zenKeyset` from the script; bind to a `cmd_zenFloatToggle`.
- **Success:** hotkey toggles float; no conflict with existing Zen keys. **[Likely]**

**Gate:** do not start §8 commits until E1, E2, E3, E4 pass (E5/E6 are low-risk).

---

# 7. Architecture Decision Records

**ADR-001 — Not WebExtensions.** *Decision:* reject. *Why:* `sidebar_action` is fixed-position, can't overlay chrome, no `onFocus/onBlur`, no workspace/split/geometry APIs (MDN Chrome_incompatibilities / sidebarAction). *Alternatives:* extension + native messaging (still can't float over chrome). **[Confirmed]**

**ADR-002 — Build on Glance's rendering model.** *Decision:* reuse Glance's overlay + `addTab` recipe + docshell activation; own a separate lifecycle. *Why:* Glance is a shipped existence-proof of a chrome-level floating live `<browser>`; re-deriving risks session/route bugs. *Alternatives:* raw `<browser>` from scratch (loses proven options set); `<iframe>` (subject to XFO, no per-container identity). **[Confirmed]**

**ADR-003 — Use a real nested `<browser>`, not an iframe.** *Why:* full web context (extensions, DevTools, media, container cookies) and XFO bypass, matching Web Panels/Glance. *Alternative:* iframe (blocked by AI sites; no container identity). **[Confirmed/Likely]**

**ADR-004 — (REVISED) Deliver v1 as a privileged `.uc.mjs` via fx-autoconfig/Sine, NOT the official Mods marketplace.** *Why:* source review shows `gZenMods` executes **CSS + prefs only**, no JS. fx-autoconfig/Sine run true privileged chrome JS identical to core. *Alternatives:* official Mod (can't run logic — rejected); straight to core (slower iteration, needs maintainer buy-in — chosen for v2). *Cost:* higher install friction (touches app dir / one-time setup) — accept for v1, remove at v2. **[Confirmed — this corrects RFC ADR-004].**

**ADR-005 — Smart Dock default (snap-by-default, free-float allowed).** *Why:* whole competitive field converged on docked/snapped persistent assistants; pure free-float occludes work. *Alternatives:* pure floating (rejected as default), pure edge-dock (= Web Panels, no differentiation). **[Confirmed reasoning, RFC §6].**

**ADR-006 — v1 persistence via profile JSON (`IOUtils`), v2 via `ZenSessionStore`.** *Why:* `.uc.mjs` shouldn't reach `.sys.mjs` session internals; JSON is decoupled and testable; migrate to session store on upstream. *Alternative:* prefs-only (awkward for nested geometry objects). **[Likely]**

**ADR-007 — Single float in v1, multi-float-ready interfaces.** *Why:* one live docshell bounds memory risk and de-risks E2; keep `FloatWindow` instances in a registry so multi-float is additive later (§13). **[Confirmed intent].**

---

# 8. Implementation Order (commit-by-commit; each compiles & leaves browser usable)

> v1 = `.uc.mjs`. "Compiles/usable" = script loads without throwing and browser is fully functional with the feature gated behind `zen.float.enabled`.

1. **Scaffold `ZenFloatManager` + feature flag.** Empty manager, `init()` gated on `zen.float.enabled` (default false), logs. *(Browser unaffected.)*
2. **Build overlay skeleton.** Create `.zen-float-overlay` (hidden) in the content layer after `gBrowser` ready. Toggle via console. No browser yet.
3. **Spawn + attach nested `<browser>`.** Use Glance addTab recipe; load `about:blank`; show/hide overlay. (E2 must have passed.)
4. **Load a target URL + title bar.** TargetRegistry with presets; render Claude; Close button.
5. **Persist across tab switches (Global scope).** ScopeBinder Global branch; survive `TabSelect`. → AC1(global).
6. **Drag.** DragController (transform+rAF); commit geometry. → E5.
7. **Resize.** ResizeController; clamp; persist. 
8. **StateStore + restore.** Write/read `zen-float-state.json`; restore on startup. → AC2.
9. **Smart Dock snapping.** DockController edges/corners + per-slot memory. → AC3.
10. **Bubble mode + opacity.** Collapse ≤56px, expand; opacity var. → AC5.
11. **Keyboard shortcut + context menu.** `<key>` in `zenKeyset`; "Open in Float" menu item. → AC4.
12. **Workspace + Tab scopes.** ScopeBinder full; per-space targets. (E4.) 
13. **Send-to-Split + Promote-to-tab.** Handoff to `gZenViewSplitter`; convert to real tab. (FR10.)
14. **Auto-hide, reduced-motion, fullscreen handling, settings JSON.** Polish + edge cases (§11).
15. **Hardening:** feature-detect every Zen internal; graceful degrade + user notice on missing globals.

**Upstream track (post-v1):** C1 move logic into `src/zen/float/ZenFloatManager.mjs`; C2 add to `ZenPreloadedScripts.js`; C3 add `zen-float.inc.xhtml` linkset + `moz.build`/`jar.inc.mn`; C4 migrate persistence to `ZenSessionStore`; C5 add default `<key>` + `about:preferences#zen` pane.

---

# 9. Testing Strategy

| Layer | Scope | Tooling | Key cases |
|---|---|---|---|
| **Unit** | StateStore serialize/clamp, geometry math, DockController snap math, ScopeBinder decisions | `xpcshell`-style / pure JS harness | clamp to viewport; snap thresholds; scope→visibility truth table |
| **Integration** | Manager ↔ gBrowser/Spaces/Splitter (mocked where possible) | browser-chrome mochitest (`browser/base/content/test`) | open/close, tab-switch persistence, space-switch rebind, split handoff |
| **Browser UI** | Real drag/resize/snap/bubble; hotkey; context menu | mochitest-browser + synthesized pointer/key events | AC1–AC5; no page CLS during drag (E5 assertion) |
| **Regression** | Glance still works; split unaffected; session restore of *tabs* intact | existing `src/zen/glance/tests` + split tests | run Glance suite with Float enabled |
| **Performance** | Idle CPU, drag fps, memory of 1 live docshell | `about:memory`, `Performance` API, Talos-style | §10 budgets |
| **Memory/leak** | Open/close 100×; enable/disable scope; window close | `about:memory` diff, `MOZ_CC_LOG` | zero retained docshells/blob URLs after close (mirror Glance `#deleteGlance` revokes) |
| **Manual QA** | Real AI sites incl. auth/OAuth popups | checklist | E3 target matrix |
| **Stress** | Rapid tab/space switching, resize spam, multi-monitor | scripted | no crash, geometry re-clamps |
| **Update-compat** | Load against next Zen `dev` build | CI matrix on Zen nightly | feature-detect degrades gracefully (§12 flags) |

---

# 10. Performance Analysis (budgets & reasoning)

| Dimension | Estimate | Reasoning | Mitigation |
|---|---|---|---|
| **Memory** | +1 content process / docshell (~40–150MB depending on site) | It hosts a real page (Claude ≈ heavy SPA) | Suspend/throttle docshell when collapsed (reuse Glance `#resetGlanceStates`); single float v1 (ADR-007); `zen.float.suspend-on-collapse` |
| **CPU idle** | ~0 when static; target site drives its own load | Chrome JS idle; docshell painting only when visible | Deactivate docshell in bubble mode |
| **Startup impact** | Negligible (+~1 module import) | Lazy: don't spawn `<browser>` until first open; `init()` only wires listeners | Defer heavy work to first toggle; gate on `zen.float.enabled` |
| **GPU** | One extra composited layer when visible; transform-based drag | `translate3d` promotes to its own layer | reduced-motion path; ghost-drag fallback (E5) |
| **IPC** | Same as any tab (parent↔content actors) | nested `<browser>` = normal content process | none needed |
| **Leaks (risk)** | blob URLs, retained tabs, listeners | Glance revokes blobs in `#deleteGlance`; we must mirror | teardown checklist; leak test in §9 |

**Golden rule:** a collapsed/hidden float must cost near-zero — deactivate its docshell, don't just `display:none` a live, painting page. **[Confirmed pattern exists in Glance].**

---

# 11. Failure Modes & Recovery

| Event | Behavior | Recovery |
|---|---|---|
| **Browser crash** | State last persisted to `zen-float-state.json` (debounced) | Restore float on relaunch from JSON (AC2) |
| **Space/workspace change** | ScopeBinder decides: Global stays; Workspace rebinds/hides; Tab hides | Deterministic on E4 event; fallback `MutationObserver` |
| **Target page crash** (`oop-browser-crashed`) | Detect via `<browser>` crash event; show inline "reload" | Recreate docshell; keep geometry |
| **Claude logs out / session expires** | It's a normal page → shows login | User logs in in-place; container cookies persist |
| **Network offline** | Page shows its own offline UI | Retry button; float chrome unaffected |
| **Browser update (Zen/FF bump)** | Internal selectors/globals may shift | Feature-detect each global at `init`; if missing → disable + one-time notice (never hard-crash) |
| **Theme/Mod change** | Float CSS uses its own namespaced vars | Scope all styles under `.zen-float-*`; avoid theming globals |
| **Monitor config change / DPI** | Geometry may fall off-screen | On `window` `resize`/screen-change, re-clamp into viewport (AC edge case) |
| **Window resize** | Re-clamp + re-evaluate snap slot | DockController recompute |
| **Multiple browser windows** | v1: per-window float (documented non-goal to sync) | Each window instantiates its own manager; state keyed per-window optional |
| **Safe mode** | Mods/autoconfig disabled → float absent | Expected; core path (v2) still ships but respects safe-mode disable like `gZenMods` does |
| **Private browsing window** | Spawn float in a private/ephemeral context; **do not persist** its state | Skip JSON write when `PrivateBrowsingUtils.isWindowPrivate(window)` |
| **Container tabs** | Float inherits scope's `userContextId` (Glance passes `userContextId`) | Preserve isolation; per-container target identity |
| **PiP coexisting** | Both allowed; float never captures PiP surface | No interception of `MozDOMFullscreen`/PiP; media stays in `ZenMediaController` |

---

# 12. Code Standards

- **Folder:** v1 `profile/chrome/JS/zen-float.uc.mjs` (+`zen-float.uc.css`); v2 `src/zen/float/` mirroring `src/zen/glance/` (`ZenFloatManager.mjs`, `zen-float.css`, `zen-float.inc.xhtml`, `moz.build`, `jar.inc.mn`).
- **Naming:** class `nsZenFloatManager` (matches `nsZenGlanceManager`); global `window.gZenFloatManager`; sub-controllers `FloatWindow`, `DragController`, etc. Private members `#foo`. DOM classes namespaced `.zen-float-*` (overlay `.zen-float-overlay`, mirror `.zen-glance-overlay`).
- **Events:** `ZenFloat:Open|Close|Moved|Resized|Docked|Collapsed|Restored` (colon-namespaced custom events, mirroring Glance's `GlanceOpen/GlanceClose`).
- **Commands:** `cmd_zenFloatToggle|Close|Split|Promote` on the main command set (mirror `cmd_zenGlance*`).
- **Preferences:** `zen.float.*` — `enabled`, `scope`, `opacity`, `min-width`, `min-height`, `snap-threshold`, `collapsed`, `hotkey`, `suspend-on-collapse`, `default-target`. Defaults in surfer YAML (core) or set on first run (v1).
- **Docs:** JSDoc on every public method; a top-of-file block linking Glance patterns reused.
- **Logging:** namespaced `console.debug("[ZenFloat]", …)`, gated on `zen.float.debug`.
- **Debugging:** works under Browser Toolbox (chrome context); document `devtools.chrome.enabled`.
- **Telemetry:** v1 none (privacy); v2 optional Glean-style counters (`open`, `session-duration`, `scope-used`) behind existing Zen telemetry opt-in only.
- **Feature flags:** master `zen.float.enabled`; every external-global access wrapped in `typeof globalThis.gX !== "undefined"` guards → graceful degrade.
- **Versioning:** `state.version` field with a migration switch in `StateStore`; script header `@version` for fx-autoconfig/Sine.

---

# 13. Future Extensibility (must not require rewrites)

Design now so these are additive:

- **Multiple floats:** `FloatWindow` instances already live in a registry (`Map<id, FloatWindow>`); ScopeBinder/StateStore key by float id. Single-float v1 is `registry.size === 1`. **[Confirmed intent — ADR-007].**
- **Pinned notes / non-web content:** `TargetRegistry` targets are `{type:"web"|"internal", …}`; an internal target renders a chrome panel instead of `<browser>`. No manager change.
- **DevTools / terminal / console:** same `type:"internal"` extension; or load a privileged `about:` page in the docshell.
- **Sidebar integration:** DockController already models edges; "dock to sidebar" = a snap target that hands the `<browser>` to the sidebar host.
- **Native Zen feature:** the v1→v2 migration (§8 upstream track) is a *move*, not a *rewrite* — same class, new home + `ZenPreloadedScripts.js` registration.
- **Plugin ecosystem:** expose `gZenFloatManager.registerTarget(descriptor)` and the `ZenFloat:*` events so other Mods/scripts can add targets/actions. **[Likely]**

---

# 14. Master Deliverable — consolidated views

## 14.1 Lifecycle (state machine)

```
        zen.float.enabled=false ──► [DISABLED]
                                       │ enable + toggle/hotkey
                                       ▼
 [SPAWNING] ─(addTab recipe, load target)─► [ACTIVE:DOCKED] ◄──drag──► [ACTIVE:FLOATING]
     │  fail(E2/E3)                              │  collapse            │  snap
     ▼                                           ▼                      ▼
 [DEGRADED/notice]                        [BUBBLE] ──expand──► [ACTIVE:*]   [ACTIVE:DOCKED]
                                                 │ close
                                                 ▼
                                            [CLOSED] ─(persist JSON)─► (restore next start)
   scope/space change ─► ScopeBinder ─► show│hide│rebind (no teardown)
```

## 14.2 Sequence — "user hits hotkey to open float"

```
User→Keyset(zenKeyset): cmd_zenFloatToggle
Keyset→gZenFloatManager.toggle()
  gZenFloatManager→StateStore.load(scopeKey)         : geometry/target/opacity
  gZenFloatManager→FloatWindow.ensure()
     FloatWindow→gBrowser.addTab(url, {skipRoute,skipAnimation,ownerTab,userContextId,…})
     FloatWindow→overlay(.zen-float-overlay).attach(browser)   [reuse Glance overlay contract]
     FloatWindow→docshell.activate()                 [reuse #setGlanceStates pattern]
  gZenFloatManager→AnimationController.open()         [respect prefers-reduced-motion]
  gZenFloatManager→ScopeBinder.bind(scope)            [subscribe Spaces/gBrowser]
  gZenFloatManager⇢ dispatch "ZenFloat:Open"
```

## 14.3 Class diagram (textual)

```
nsZenFloatManager (window.gZenFloatManager)
 ├─ registry: Map<floatId, FloatWindow>
 ├─ scopeBinder: ScopeBinder ── subscribes ▶ ZenSpaceManager, gBrowser(TabSelect/Close)
 ├─ stateStore: StateStore ──── IOUtils json (v1) / ZenSessionStore (v2)
 ├─ shortcuts: ShortcutBinding ─ <key> in zenKeyset
 ├─ animation: AnimationController
 └─ targets: TargetRegistry
FloatWindow
 ├─ browser: <browser> (nested, via gBrowser.addTab recipe)
 ├─ overlay: .zen-float-overlay (position:fixed)
 ├─ drag: DragController   resize: ResizeController   dock: DockController
 └─ geometry, opacity, collapsed, target
```

## 14.4 Risk matrix

| Risk | Likelihood | Impact | Mitigation | Owner gate |
|---|---|---|---|---|
| E2 fails (can't persist nested browser outside Glance) | Med | High | manual docshell mgmt; separate overlay; worst case core patch to Glance | Blocks §8 |
| Zen internals refactor (globals move) | High (over time) | Med | feature-detect + degrade; upstream to core ASAP | Ongoing |
| AI site blocks embedding (E3) | Low-Med | Med | open-in-tab fallback; allowlist | §6 gate |
| No public space-change event (E4) | Med | Med | MutationObserver fallback | §8 step 12 |
| Memory of live docshell | Med | Med | suspend-on-collapse; single float | §10 |
| fx-autoconfig install friction (v1) | High | Low | ship Sine-compatible package; push to core for v2 | Distribution |

## 14.5 Migration strategy (v1 `.uc.mjs` → v2 core)

1. Freeze the `.uc.mjs` public surface (`gZenFloatManager`, `ZenFloat:*`, prefs).
2. Move file to `src/zen/float/ZenFloatManager.mjs`; convert self-`init()` to the `nsZenDOMOperatedFeature` contract.
3. Register in `ZenPreloadedScripts.js` (1 line); add `.inc.xhtml`/`moz.build`/`jar.inc.mn`.
4. Swap `StateStore` backend JSON→`ZenSessionStore`; add a one-time importer from `zen-float-state.json`.
5. Add default `<key>` + `about:preferences#zen` pane. Ship behind `zen.float.enabled` for a release, then default-on.

## 14.6 Deployment strategy

- **v1:** GitHub repo with fx-autoconfig instructions **and** a Sine-installable package; `@version` header; changelog tied to Zen `dev` builds; CI smoke-test against Zen nightly.
- **v2:** PR to `zen-browser/desktop` referencing this EDD + RFC; feature-flagged; beta cohort; then default-on.

## 14.7 Open issues

1. **[Needs experimentation]** Exact `nsZenDOMOperatedFeature`/`nsZenPreloadedFeature` init contract & file path (E1).
2. **[Needs experimentation]** Can a nested `<browser>` persist cleanly outside Glance's `#glances` bookkeeping? (E2 — the make-or-break spike).
3. **[Needs experimentation]** Public space-change event vs. MutationObserver fallback (E4).
4. **[Likely, verify]** Per-site embedding/OAuth behavior for each AI target (E3).
5. **[Unknown]** Whether Zen maintainers prefer Zen Float as a distinct feature vs. a "persistent Glance" extension of `nsZenGlanceManager` — this affects §8 upstream shape. *Recommend socializing the RFC/EDD with maintainers before v2.*
6. **[Open decision]** Multi-window state: per-window (v1 default) vs. Firefox-Sync-shared (future).

---

## Appendix A — Assumption challenges (per the brief)

1. **The RFC's "Zen Mod with script.js" was wrong** — Mods are CSS+prefs only; use fx-autoconfig/Sine (`.uc.mjs`) or core. Corrected in ADR-004. **[Confirmed by source].**
2. **Simpler path worth weighing:** the *smallest* shippable version is **"Persistent, dockable Glance"** — extend `nsZenGlanceManager` with a `pinned`/`persistent` flag + snap, reusing ~90% of its machinery, instead of a parallel `nsZenFloatManager`. Pros: minimal new code, most upstream-acceptable. Cons: inherits Glance's ephemeral assumptions and single-instance design; harder to reach multi-float/Smart-Dock later. **Recommendation:** prototype *both* in E2 — if extending Glance survives persistence cleanly, ship that as v1 and grow `ZenFloatManager` only when multi-float/scopes demand it. This defers the biggest new subsystem until proven necessary.
3. **Glance activation default is `ctrl`, not `alt`** (RFC said `alt`) — minor, but shows the value of reading source over docs. **[Confirmed].**
4. **"Workspaces" don't exist by that name in code** — they're **Spaces** (`ZenSpaceManager`). Any implementer grepping `ZenWorkspaces` will find nothing. **[Confirmed].**
```
