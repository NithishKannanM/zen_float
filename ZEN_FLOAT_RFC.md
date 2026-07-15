# Zen Float — Product Requirements & Technical Design RFC

**Status:** Draft for review · **Author:** Platform/Chrome Engineering
**Date:** 2026-07-14 · **Target reviewers:** Zen Browser maintainers, self
**Type:** Internal RFC (research + PRD + TDD)

---

## 0. TL;DR (read this first)

**The question you asked — "Can this actually be built?" — has a confident answer: yes, and most of it already exists inside Zen under a different name.**

Zen already ships a **chrome-level, floating, browser-real pane that renders a live web page on top of the current tab**: it's called **Glance**
(`src/zen/glance/ZenGlanceManager.mjs`). Glance uses a nested `<browser>` inside a `position: fixed` overlay (`.browserSidebarContainer.zen-glance-overlay`), animates it into place, and gives it a small toolbar with Close / Expand / Split. It deliberately does **not** persist. **[Confirmed]**

Zen also ships **Web Panels** — persistent sidebar web-apps that can *float over the page* and optionally *not close on focus loss*. **[Confirmed]**

So "Zen Float" is not a new capability class. It is the **union of Glance's rendering model and Web Panels' persistence model, plus drag/resize/dock/opacity chrome and workspace-scoped state.** That reframing is the single most important finding in this document, because it collapses the risk from "invent a floating browser engine" to "compose two shipped subsystems and add a window manager on top."

**Recommended path:** Build v1 as a **Zen Mod with a privileged `script.js`** (Mods can ship JS that runs in the browser chrome process with full access to `gBrowser`, `ZenGlanceManager`, `gZenWorkspaces`, `gZenViewSplitter`). **[Confirmed that Mods ship script.js; Needs experimentation on exactly which internals are reachable at runtime.]** If it proves valuable and stable, upstream it into Zen core as a first-class feature.

**Do NOT build this as a WebExtension.** The core requirement — draw over browser chrome, always-on-top *inside* the window, access workspaces, control Split View — is architecturally impossible through the WebExtension API surface. **[Confirmed]**

---

## Evidence & confidence legend

Every non-trivial technical claim below is tagged:

- **[Confirmed]** — verified against Zen/Mozilla docs, source, or MDN.
- **[Likely]** — strong inference from architecture; not directly quoted.
- **[Unknown]** — could not verify; open question.
- **[Needs experimentation]** — must be proven in a running build/prototype.

Primary sources are listed in §12.

---

# 1. Product Vision

## 1.1 The problem from first principles

Every mainstream browser models "the thing you're doing" and "the thing that helps you do it" as **peer tabs**. An AI chat, a doc, a dashboard — all get the same rectangle, the same z-order, the same lifecycle as the page you're actually working on. That's a category error. A reference/assistant surface has fundamentally different ergonomics than a primary surface:

| Property | Primary surface (the page) | Assistant surface (AI/docs) |
|---|---|---|
| Attention | Foreground, full focus | Peripheral, glanceable |
| Lifecycle | Comes and goes | Persistent companion |
| Spatial need | Wants the whole viewport | Wants a *corner*, always reachable |
| Z-order | Owns the plane | Wants to float *above* |
| Cross-context | Bound to one task | Should follow you across tasks |

The copy-switch-paste loop you described is the tax users pay for that category error. Split View is the current mitigation, but it **demotes the assistant into a co-equal pane** — it fixes z-order and persistence by *sacrificing* the "wants a corner, not half the screen" property. Glance fixes the spatial + z-order properties but *sacrifices* persistence (by design). **No shipping Zen surface satisfies all four assistant properties at once.** Zen Float's thesis is: satisfy all four.

## 1.2 Who needs this

- **Developers / power users** running an LLM continuously beside code, GitHub, docs. (Primary — you.)
- **Researchers / students** with a paper open and Claude/Perplexity floating.
- **Knowledge workers** keeping Notion/Slack/an internal dashboard peripheral-but-live.
- **Anyone Split-View-ing an AI today** — they've already revealed the intent; they just accepted a bad spatial trade.

## 1.3 Why now

1. **Continuous-AI workflows became the default** for the target user (2024→2026). The assistant is no longer an occasional lookup; it's an always-on peripheral.
2. **Zen already built the hard 80%** (Glance = chrome-level floating live browser; Web Panels = persistence; Mods = a safe distribution channel for privileged UI). The remaining 20% is a window manager. **[Confirmed the primitives exist.]**
3. **Arc's decline** (Browser Company pivoted away from Arc to Dia) left a vacuum for opinionated, power-user browsers — Zen is the credible OSS heir, and "floating assistant" is a marquee differentiator Arc never fully shipped.

## 1.4 What makes this different from Split View

| | Split View | Glance | **Zen Float** |
|---|---|---|---|
| Z-order | In-flow (steals layout) | Above page ✅ | **Above page ✅** |
| Persistence | Per-tab, in layout | None (ephemeral) ❌ | **Tab / Workspace / Global ✅** |
| Spatial footprint | ~50% viewport | Center modal | **Draggable corner, resizable, collapsible ✅** |
| Follows you across tabs | No | No | **Yes (workspace/global modes) ✅** |
| Feels like | A layout mode | A peek | **An ambient companion** |

Split View answers "show me two pages." Zen Float answers "keep one page *available to* everything I do."

---

# 2. Competitor Research

| Browser | Closest feature | What it is | Why it succeeds / fails for *this* problem |
|---|---|---|---|
| **Arc** | Little Arc | A tiny **separate OS window** that pops for quick links | Fails: it's a transient *OS-level* window, not an in-page persistent assistant. Not always-on-top over your work; disappears. Arc itself is now in maintenance (company moved to Dia). **[Confirmed Little Arc is a floating quick window]** |
| **SigmaOS** | Mini Window + AI (Airis) | macOS-only; mini windows for external links; built-in AI sidebar | Closest *intent* (AI-centric). Fails: macOS-only, $20/mo, AI is a *sidebar* not a free-floating dock, mini window is ephemeral. **[Confirmed]** |
| **Sidekick** | Split view + "apps" sidebar | Session/workspace console with pinned web-apps | Sidebar apps are docked, not floating/draggable over content. Chromium base. |
| **Vivaldi** | Web Panels | Docked side panel of web-apps | Docked to an edge only; not free-floating, not always-on-top over page, no opacity/collapse-to-bubble. |
| **Opera** | Sidebar + Aria AI | Pinned messengers + native AI in a fixed sidebar | Fixed left dock; Aria is proprietary. Not a movable pane. |
| **Edge** | Copilot pane / split screen | Docked AI pane | Docked right; not draggable; Copilot-locked. |
| **Floorp** | Multiple web panels (BSM) | Firefox fork; richer side panels than Zen | Still edge-docked panels, not a floating window manager. |
| **Zen (today)** | **Glance + Web Panels** | Glance = ephemeral float; Web Panels = persistent dock | **The two halves of Zen Float already exist but aren't unified.** |

**Pattern across the field:** everyone converged on *either* an edge-docked persistent panel *or* an ephemeral floating quick-window. **Nobody ships a persistent, free-floating, draggable, workspace-following assistant pane over the page.** That's the open lane. Zen is uniquely positioned because Glance already proves the rendering model works in a Firefox fork.

---

# 3. Zen Architecture Research

## 3.1 What Zen actually is

Zen is **not a from-scratch browser** and **not a maintained hard-fork**. It's a set of **patch files applied to Firefox source at build time**, orchestrated by the **Surfer** CLI (`zen-browser/surfer`). Zen-specific code lives in `src/zen/`; Firefox integration points are patched via `src/browser/` (notably `browser.xhtml` patches). Prefs are YAML in `prefs/`, namespaced `zen.*`. **[Confirmed — docs.zen-browser.app/contribute/desktop/code-structure-and-prefs]**

Implication for us: **the UI layer is privileged chrome JS + XHTML + CSS**, i.e. the same technology as Firefox's own browser UI. Anything Firefox's chrome can do, Zen features can do. This is why Glance can exist and a WebExtension can't replicate it.

## 3.2 The subsystems that matter for Zen Float

```
src/zen/
├─ glance/        ZenGlanceManager.mjs      ← ★ floating live-browser overlay (the model)
├─ workspaces/    ZenWorkspaces.mjs, ZenWorkspace.mjs   ← per-workspace tab sets & scoping
├─ split-view/    ZenViewSplitter.mjs (gZenViewSplitter) ← tree-based multi-pane
├─ common/        ZenUIManager.mjs, ZenStartup.mjs, ZenSessionStore  ← lifecycle + persistence
├─ compact-mode/  ZenCompactMode.mjs        ← auto-hiding chrome (relevant to auto-hide/opacity)
├─ tabs/ folders/ ZenPinnedTabManager, ZenFolders  ← Essentials/pinned persistence patterns
└─ mods/          ZenMods.mjs (gZenMods)     ← ★ distribution channel for privileged UI code
```
**[Confirmed file locations from Zen docs + DeepWiki; exact runtime globals need verification in a build — Needs experimentation]**

### 3.2.1 Glance (the rendering blueprint) — **[Confirmed]**

- Creates a real tab via `gBrowser.addTab(...)` kept **nested + backgrounded**, tagged `zen-glance-tab` with a `glance-id` UUID linking parent↔child.
- Renders in `.browserSidebarContainer.zen-glance-overlay`, `position: fixed`, over the content area.
- Scales the parent content to `0.97` (`GLANCE_BACKGROUND_SCALE`) for depth; "arc animation" from click point to center (`ARC_STEPS = 80`).
- Toolbar `.zen-glance-sidebar-container` with Close / Expand / Split actions.
- Managed by `ZenGlanceManager`, internal `#glances` Map, tab-lifecycle aware.
- **Deliberately excluded from session persistence** — the one property Zen Float must *add*.
- Prefs: `zen.glance.enabled`, `zen.glance.activation-method` (default `alt`), `zen.glance.animation-duration` (350).

**This is the proof of feasibility.** A floating pane backed by a genuine `<browser>` (full web engine, extensions, DevTools, media) already runs in Zen chrome. Zen Float reuses this pattern rather than inventing it.

### 3.2.2 Web Panels (the persistence blueprint) — **[Confirmed]**

Sidebar web-apps with a "**Close the panel when it loses focus**" toggle; when off, the panel **floats over the page and stays open** while you interact with the page. This proves the *persistent-floating* interaction is already accepted UX in Zen. Zen Float generalizes it from "edge-docked, one at a time" to "free-floating, positioned, workspace-scoped."

### 3.2.3 Workspaces — **[Confirmed concept; API surface Needs experimentation]**

`ZenWorkspaces` manages independent tab sets and exposes workspace-change events. Zen Float's "Workspace-wide" persistence mode hooks these to show/hide/rebind the float per active workspace.

### 3.2.4 Split View — **[Confirmed]**

`gZenViewSplitter` / `ZenViewSplitter.mjs`: binary tree of `nsSplitNode`/`nsSplitLeafNode`, ≤4 tabs, draggable dividers in `_splitNodeToSplitters`, min resize `zen.splitView.min-resize-width` (7px). Relevant because "dock into Split View" is a natural Zen Float action (Glance already has a "Split" button — precedent that these subsystems interoperate).

### 3.2.5 Mods (the distribution channel) — **[Confirmed]**

A Mod = folder with `chrome.css` + optional `script.js` (behavior) + `theme.json` / `preferences.json`. Mods **inject CSS and JS into the Firefox UI chrome**, install without restart, and expose settings via `about:preferences#zen`. `preferences.json` supports checkbox/dropdown/string prefs, readable in CSS via `-moz-pref(...)` / `var(--...)`. **This means a Mod can ship the privileged JS that implements Zen Float** — no fork required for v1. **[Confirmed Mods ship JS; the *degree* of privileged access at runtime is Needs-experimentation.]**

## 3.3 Architecture diagram — where Zen Float sits

```
┌───────────────────────────────────────────────────────────────┐
│  Firefox/Zen CHROME PROCESS (privileged, browser.xhtml)        │
│                                                                │
│  ┌──────────┐  ┌────────────┐  ┌───────────────┐  ┌─────────┐  │
│  │ gBrowser │  │ZenWorkspaces│ │gZenViewSplitter│  │ gZenMods│  │
│  └────┬─────┘  └─────┬──────┘  └───────┬───────┘  └────┬────┘  │
│       │              │                 │               │       │
│  ┌────▼──────────────▼─────────────────▼───────────────▼────┐  │
│  │            ZenGlanceManager (nested <browser> overlay)    │  │
│  └────────────────────────┬─────────────────────────────────┘  │
│                           │ reuse rendering model              │
│  ┌────────────────────────▼─────────────────────────────────┐  │
│  │              ★ ZEN FLOAT MANAGER (new)                    │  │
│  │  window mgr · drag/resize · dock · opacity · persistence │  │
│  │  · shortcut · workspace binding · session restore        │  │
│  └────────────────────────┬─────────────────────────────────┘  │
│                           │ hosts                              │
│                  ┌────────▼─────────┐                          │
│                  │ floating overlay │  position:fixed          │
│                  │  <browser>       │  (real web content:      │
│                  │  = ChatGPT/Claude│   Claude, docs, etc.)    │
│                  └──────────────────┘                          │
└───────────────────────────────────────────────────────────────┘
        ▲                                          ▲
        │ WebExtensions can reach ONLY here ───────┘
        │ (content scripts + fixed sidebar_action)
   ✗ cannot draw over chrome, cannot float, cannot see workspaces
```

## 3.4 Extension limitations (why the boundary matters) — **[Confirmed]**

Firefox WebExtensions:
- `sidebar_action` is a **fixed-position pane** managed by the browser's own layout — cannot be repositioned, made always-on-top over content, or drawn over chrome.
- No `onFocus`/`onBlur` for sidebars; `sidebarAction.open()` requires a user gesture.
- No API for workspaces, Split View, or chrome geometry.
- Cannot inject into `browser.xhtml` or the parent chrome document.

Conclusion: the WebExtension surface is the wrong plane entirely for a floating-over-chrome assistant.

---

# 4. Technical Feasibility (four paths)

| Approach | Pros | Cons | Complexity | Maint. | Perf | Security | Verdict |
|---|---|---|---|---|---|---|---|
| **A. Zen Mod (privileged `script.js`)** | Ships today, no build, instant install, reuses Glance/WebPanel patterns, upstream-able, reversible | Rides private internals (may break on Zen updates); Mod JS API depth unverified; must guard against internal refactors | **Med** | Med (track Zen internals) | Native (chrome JS) | Runs privileged — must be careful, but same trust model as any Mod | **✅ RECOMMENDED for v1** |
| **B. WebExtension** | Cross-browser, sandboxed, AMO distribution | **Cannot float over chrome, no always-on-top-in-window, no workspaces, no Split View** — fails the core requirement | Low | Low | N/A | Safe | **❌ Rejected — can't meet core req** |
| **C. Native Zen feature (upstream patch)** | First-class, stable APIs, session-store integration, no fragility | Requires maintainer buy-in, C++/build, slower iteration, review cycle | High | Low (once merged) | Native | Reviewed | **✅ Target for v2 (promote A→C)** |
| **D. Browser fork** | Total control | Insane maintenance, splits from Zen, throws away the reason to use Zen | Very High | Very High | Native | Yours to own | **❌ Rejected — unjustifiable** |

**Recommendation:** **A now, C later.** Prototype as a Mod against Glance's model; if it earns its keep, propose it upstream as `ZenFloatManager` beside `ZenGlanceManager`. This is the lowest-risk, highest-optionality path, and it mirrors how Zen features tend to mature (community mod → core).

---

# 5. Browser API Research (can each capability be done, and where)

| Capability | WebExtension | Zen Mod (privileged JS) | Zen core |
|---|---|---|---|
| Create floating browser panel over page | ❌ | ✅ (reuse Glance overlay + nested `<browser>`) **[Likely→Needs exp.]** | ✅ **[Confirmed pattern]** |
| Persist overlay across tab switches | ❌ | ✅ (own state, don't tie to tab) **[Likely]** | ✅ (via ZenSessionStore) |
| Draw over browser chrome (toolbar/sidebar) | ❌ **[Confirmed]** | ⚠️ Over *content* easily; over *chrome* possible but invasive — recommend staying within content area | ✅ |
| Access / observe workspaces | ❌ **[Confirmed]** | ✅ (`ZenWorkspaces` events) **[Needs exp.]** | ✅ |
| Control / dock into Split View | ❌ | ✅ (`gZenViewSplitter`) **[Needs exp.]** | ✅ |
| Attach UI to browser frame / geometry | ❌ **[Confirmed]** | ✅ (chrome DOM in `browser.xhtml`) | ✅ |
| Global keyboard shortcut (works over any page) | ⚠️ `commands` API, limited | ✅ (chrome `keyset`/`XULCommandEvent`) **[Likely]** | ✅ |
| Adjustable opacity / collapse-to-bubble | ❌ | ✅ (CSS on chrome overlay) **[Confirmed feasible]** | ✅ |
| Session restore of float | ❌ | ✅ (persist to prefs/JSON) **[Likely]** | ✅ (native session store) |

**Documented hard limits:** WebExtension `sidebar_action` cannot float/reposition/overlay chrome; no workspace/split APIs exist for extensions; sidebar open/close is gesture-gated with no focus events. **[Confirmed via MDN sidebarAction / Chrome_incompatibilities.]**

**Biggest unknowns to burn down early:**
1. Exactly which globals (`ZenGlanceManager`, `gZenWorkspaces`, `gZenViewSplitter`) are reachable and stable from Mod `script.js` at runtime. **[Needs experimentation — Prototype task #1]**
2. Whether a nested `<browser>` can be spawned/owned *outside* the Glance lifecycle without fighting Glance's `#glances` bookkeeping. **[Needs experimentation]**
3. Whether third-party AI sites (Claude/ChatGPT) set `X-Frame-Options`/CSP that break embedding. **A real `<browser>` (not an `<iframe>`) is generally not subject to `X-Frame-Options` the way page iframes are, which is exactly why Web Panels/Glance can load these sites — [Likely], verify per-site.**

---

# 6. UX Research (options + recommendation)

Six candidate models, scored for the *continuous-AI* job:

| Option | Description | Strength | Weakness |
|---|---|---|---|
| **1. Free Floating Window** | Draggable/resizable pane, always-on-top over page | Max flexibility, "app-like" | Can occlude content; user must manage position |
| **2. Docked Assistant** | Snaps to an edge, page reflows or is overlaid | Predictable, never lost | Basically Web Panels; less "floating" magic |
| **3. Collapsible Bubble** | Collapses to a small draggable orb; expand on click/hover | Ambient, low-footprint, "always available" | Hover-expand can misfire; discoverability |
| **4. Smart Dock** | Floats, but *snaps* to edges/corners with magnetism + remembers slots | Best of 1+2; muscle memory | More engineering (snap physics) |
| **5. PiP-inspired** | Mirrors Firefox PiP: small always-on-top, minimal chrome | Familiar mental model | PiP is OS-window; in-window variant needs custom work |
| **6. Command-palette summon** | No persistent pane; hotkey summons AI at cursor, dismiss on answer | Zero footprint, keyboard-native | Not "always available"; breaks the persistent-companion thesis |

### Recommendation: **#4 Smart Dock as the default, composed of #1 + #3.**

Concretely: a **free-floating, resizable pane (#1)** that **snaps magnetically to edges/corners and remembers per-corner slots (#4)**, and **collapses to a draggable bubble (#3)** when you want it out of the way. Opacity + auto-hide-on-page-focus are modifiers, not separate modes.

Rationale: the target job is "peripheral but instantly available." Pure floating (#1) loses the "never in the way" property; pure docking (#2) loses the "corner not half-screen" property; the bubble (#3) is the *idle* state and the smart-dock (#4) is the *active* state. #6 (command palette) is a great **complementary summon mechanism**, not a replacement — ship it as the keyboard entry point.

**ASCII of the two states:**

```
   ACTIVE (Smart Dock, snapped bottom-right)      IDLE (collapsed bubble)
  ┌───────────────────────────────────┐          ┌───────────────────────────┐
  │  your page (github/docs/paper)    │          │  your page                │
  │                                   │          │                           │
  │                ┌───────────────┐  │          │                           │
  │                │ ⣿ Claude    ⌄ │  │          │                        ◉  │
  │                │───────────────│  │          │                       (AI) │
  │                │  chat…        │  │          │                           │
  │                │  ▓▓▓▓▓▓       │  │          │   hover/click ◉ → expands  │
  │                │  ░░░░         │  │          │                           │
  │                │ [type…]     ⇧ │  │          │                           │
  │                └───────────────┘  │          │                           │
  └───────────────────────────────────┘          └───────────────────────────┘
```

---

# 7. Technical Architecture

## 7.1 Module map

```
ZenFloatManager (singleton, chrome process)
├─ FloatWindow          — the overlay element + nested <browser> host (reuses Glance overlay pattern)
├─ DragController       — pointer capture, move, throttle to rAF
├─ ResizeController     — edge/corner handles, min/max, aspect lock optional
├─ DockController       — edge magnetism, corner slots, snap thresholds, Split-View handoff
├─ StateStore           — size/pos/url/opacity/collapsed per scope; serialize to prefs/JSON
├─ ScopeBinder          — Tab | Workspace | Global; subscribes to gBrowser + ZenWorkspaces events
├─ ShortcutManager      — chrome keyset: toggle, summon, cycle-target, collapse
├─ AnimationController   — open/close/collapse/snap; respects prefers-reduced-motion
├─ SessionBridge        — restore on startup (hook ZenStartup / session restore)
└─ TargetRegistry       — presets (Claude/ChatGPT/Gemini/Perplexity/DeepWiki/GitHub/Notion/Slack)
```

## 7.2 State model

```jsonc
// per scope key: "tab:<id>" | "ws:<uuid>" | "global"
{
  "version": 1,
  "scope": "workspace",           // Current-Tab | Workspace-wide | Entire-Browser
  "target": { "id": "claude", "url": "https://claude.ai/" },
  "geometry": { "x": 1180, "y": 520, "w": 420, "h": 640, "snap": "br", "corner": true },
  "opacity": 0.96,
  "collapsed": false,
  "autohideOnPageFocus": false,
  "lastActiveUrl": "https://claude.ai/chat/…"   // remembers last page
}
```
Persisted via: Mod path → JSON in profile or `zen.float.*` prefs; Core path → ZenSessionStore. **[Likely]**

## 7.3 Rendering & the nested browser

Reuse the Glance rendering contract: a `position: fixed` overlay in the content layer hosting a **real `<browser>`** (not an iframe) so the pane is a full web context (extensions, DevTools, media, login/cookies shared per container). Own a *separate* lifecycle from Glance's `#glances` map to avoid ephemeral cleanup. **[Likely; interplay with Glance bookkeeping is Needs-experimentation.]**

## 7.4 Drag/Dock/Resize

- **Drag:** pointer capture on the title bar; update `transform: translate()` on rAF; commit geometry on pointerup. Avoid layout thrash by transforming, not repositioning, during drag.
- **Dock:** compute distance to each edge/corner; within threshold, show a snap ghost; on release, snap and persist `snap` slot. Corners remember independent slots (Smart Dock). Optional "dock into Split View" hands the `<browser>` to `gZenViewSplitter` (mirrors Glance's existing Split action). **[Confirmed Glance→Split precedent]**
- **Resize:** 8 handles, clamp to min/max, persist.

## 7.5 Scope binding (the persistence modes)

```
ScopeBinder
  Tab scope      → show only when bound tab active; hide on tab switch
  Workspace      → subscribe ZenWorkspaces onChange; show/rebind per workspace
  Global         → always visible across tabs & workspaces (the "assistant everywhere")
```
**[Confirmed workspaces emit change events conceptually; exact hook Needs-experimentation.]**

## 7.6 Events consumed

`gBrowser` TabSelect/TabClose · `ZenWorkspaces` workspace-changed · window resize/fullscreen · `prefers-reduced-motion` · chrome key events. On tab/workspace change, ScopeBinder decides visibility; on window resize, DockController re-clamps geometry.

## 7.7 Data-flow diagram

```
 user gesture / hotkey
        │
        ▼
 ShortcutManager ──► ZenFloatManager.toggle(targetId)
        │                     │
        │                     ▼
        │              StateStore.load(scopeKey) ──► geometry/opacity/url
        │                     │
        ▼                     ▼
 Drag/Resize/Dock ◄──► FloatWindow(<browser src=url>)
        │                     │
        ▼                     ▼
 StateStore.save() ◄── ScopeBinder(gBrowser, ZenWorkspaces events)
        │
        ▼
 SessionBridge (persist) ──► restore next startup
```

---

# 8. Product Requirements Document

## 8.1 Vision
A persistent, free-floating, draggable assistant pane — backed by a real browser engine — that stays available over any page and follows the user across tabs/workspaces, turning "switch-copy-switch" into "glance-and-ask."

## 8.2 Goals
- G1: Floating pane over page content, draggable + resizable. **[core]**
- G2: Persistence across tab switches with 3 scopes (Tab / Workspace / Global).
- G3: Remembers size, position, target site, last page, per scope.
- G4: Collapse-to-bubble + expand; opacity control; auto-hide on page focus.
- G5: Keyboard summon/toggle from anywhere.
- G6: Edge/corner snapping (Smart Dock).
- G7: Ship as an installable Zen Mod; be upstream-able to core.

## 8.3 Non-goals (v1)
- Not a WebExtension; not cross-browser.
- Not multiple simultaneous floats (v1 = one float; multi-float is roadmap).
- Not a bespoke AI integration/API — it *hosts* existing AI sites; no proprietary model.
- Not drawing over browser chrome/toolbar (stay within content area for v1 safety).
- Not mobile.

## 8.4 Functional requirements
- FR1 Toggle float via hotkey and toolbar button.
- FR2 Drag by title bar; resize by 8 handles; clamp min 280×360.
- FR3 Snap to 4 edges + 4 corners; remember per-slot.
- FR4 Collapse to bubble; expand on click (hover-expand configurable).
- FR5 Opacity slider (50–100%); auto-hide-on-page-focus toggle.
- FR6 Scope selector: Tab / Workspace / Global; persist per scope.
- FR7 Remember size/pos/target/lastUrl; restore on startup.
- FR8 Target registry with presets + custom URL.
- FR9 Respect `prefers-reduced-motion`.
- FR10 "Promote to tab" and "Send to Split View" actions (Glance parity).

## 8.5 Edge cases
- Window resized smaller than float → re-clamp into viewport.
- Fullscreen video/page → hide or respect float? Default: auto-hide in fullscreen, restore after.
- Target site blocks embedding (CSP/XFO) → detect load failure, offer "open in tab." **[Needs exp. per site]**
- Workspace deleted while float bound → fall back to Global or dismiss.
- Two windows open → float is per-window (v1); document the choice.
- Zen update refactors an internal → feature-detect and degrade gracefully with a visible notice (Mod path risk).
- Container tabs → float honors the container of its scope; login isolation preserved.
- PiP + float coexisting → both allowed; float never captures PiP.

## 8.6 Acceptance criteria (samples)
- AC1: With Global scope, switching tabs/workspaces keeps the float visible and at the same geometry. 
- AC2: Restarting Zen restores float target, size, position, and last page for the active scope.
- AC3: Dragging within 24px of a corner snaps and persists that corner slot.
- AC4: Hotkey toggles float in <150ms with no visible layout shift of the page.
- AC5: Collapsed bubble occupies ≤56×56px and is draggable.

## 8.7 User stories
- *As a dev*, I keep Claude floating bottom-right while reading GitHub, so I never switch tabs to ask a question.
- *As a researcher*, my float is workspace-scoped so "Papers" shows Perplexity and "Coding" shows Claude automatically.
- *As a keyboard user*, I summon/dismiss the assistant with one chord without touching the mouse.
- *As a minimalist*, the assistant lives as a bubble and expands only when I click it.

## 8.8 Milestones → see §9.

## 8.9 Risk assessment → see §10.

## 8.10 Success metrics
- Tab-switches-to-AI per session ↓ (proxy: self-reported / instrumented if upstreamed).
- Float session duration (is it kept open? target: >30 min median for daily users).
- Retention: % of installers still enabling it after 2 weeks (target >60%).
- Crash/breakage rate on Zen updates (target: 0 hard breaks; graceful degrade only).

## 8.11 Future roadmap
Multi-float · float profiles per site · quick-inject selected text into the AI (bridge selection→float) · pin float to a page region · sync geometry via Firefox Sync · native ZenSessionStore integration · "ask about this page" context passing.

---

# 9. Engineering Roadmap

| Phase | Deliverables | Dependencies | Testing | Difficulty |
|---|---|---|---|---|
| **0 · Research** (this doc) | RFC, feasibility, spike list | — | N/A | Low |
| **1 · Prototype spike** | Prove Mod `script.js` can reach `ZenGlanceManager`/`gBrowser`/`ZenWorkspaces`; spawn a persistent nested `<browser>` overlay showing claude.ai | Zen build/install; §5 unknowns | Manual: pane renders + survives tab switch | **High** (burns down all core unknowns) |
| **2 · Rendering** | FloatWindow with title bar, real `<browser>`, target registry | P1 | Loads all preset sites; CSP failures handled | Med |
| **3 · Persistence** | StateStore + scopes (Tab/WS/Global) + remember geometry/url | P2, ZenWorkspaces events | AC1, AC2 | Med |
| **4 · Drag/Dock/Resize** | DragController, ResizeController, DockController (Smart Dock), collapse-bubble, opacity | P2 | AC3–AC5, snapping | Med-High |
| **5 · Workspace integration** | ScopeBinder wired to workspace events; per-WS targets | P3, P4 | Switch WS → correct float | Med |
| **6 · Animations & polish** | open/close/snap/collapse anims; reduced-motion; auto-hide; Split-View handoff | P4 | Perf: no jank at 60fps; FR9 | Med |
| **7 · Testing & hardening** | Feature-detect internals; graceful degrade; edge cases §8.5; settings UI via `preferences.json` | all | Full matrix; update-resilience | Med |
| **8 · Release** | Publish Mod to Zen marketplace; docs; then draft upstream proposal to maintainers | P7 | Beta cohort | Low-Med |

**Critical path is Phase 1.** Everything downstream is conventional window-manager work; the *only* novel risk is "can a Mod do this against Zen internals," and P1 answers it in days, not weeks.

---

# 10. Risks & Blockers

**Technical blockers / cannot-currently-do:**
- **Impossible as a WebExtension** — float over chrome, always-on-top-in-window, workspace/Split access don't exist in the API. **[Confirmed]**
- **Drawing over browser chrome (toolbar/sidebar), not just content** — technically possible via chrome DOM but invasive and update-fragile; **descoped from v1** (stay in content layer).

**Requires modifying Zen itself (for the *robust* version):**
- Stable public hooks for float lifecycle + ZenSessionStore persistence. The Mod version *works* but rides private internals; the durable version wants core APIs (Phase 8 upstream).

**Key risks (Mod path):**
| Risk | Severity | Mitigation |
|---|---|---|
| Zen refactors `ZenGlanceManager`/globals | High | Feature-detect + version-gate + graceful degrade; keep coupling thin; upstream ASAP |
| Nested `<browser>` fights Glance bookkeeping | Med | Own separate lifecycle; don't reuse `#glances`; P1 spike proves it |
| AI sites block embedding (CSP/XFO) | Med | Real `<browser>` usually bypasses XFO **[Likely]**; per-site fallback to tab |
| Perf: extra live web context always resident | Med | Suspend/throttle when collapsed; single float in v1 |
| Security: privileged Mod JS | Med | Same trust model as any Mod; no eval of remote code; scope narrowly; open-source & reviewable |
| Session-restore races on startup | Low-Med | Hook after ZenStartup settles; idempotent restore |

**Impossible with extensions only (restated):** floating over chrome, always-on-top within the window, workspace awareness, Split View control, chrome geometry. All require the chrome-JS (Mod or core) plane. **[Confirmed]**

---

# 11. Open Questions & Challenges to Your Assumptions

I was asked not to just agree. Here are the places your framing may be improvable:

1. **"Floating window" may be the wrong default; Smart Dock + bubble is better.** A truly free-floating pane *occludes your work* and forces manual placement forever. The evidence from the whole competitive field (§2) is that persistent assistants trend toward *docked or magnetically-snapped*, because "always available" matters more than "anywhere I drag it." I recommend floating-capable but **snap-by-default**. (You can still free-float.)

2. **You may not want a *persistent live* AND a *summon* — you want both, layered.** Continuous-AI users actually have two modes: "keep the conversation warm" (persistent) and "quick one-off" (summon). The bubble (idle) + Smart Dock (active) + command-palette summon (§6 #6) covers both. Don't pick one.

3. **"Draw over browser chrome" is a trap.** It sounds powerful but it's the single most update-fragile, visually-risky thing you listed, for near-zero user value over "float in the content area." Drop it. Glance and Web Panels both stay in the content layer for good reason.

4. **Reconsider "one float, three scopes" vs "targets per workspace."** The higher-value primitive might be *per-workspace default target* (Coding→Claude, Research→Perplexity) rather than a single global float you re-point. Workspace-scoped targets map to how you already segment work.

5. **Is a *new* feature even the right ask, or is it "make Glance persistent + dockable"?** Given §0, the cheapest valuable thing you could ship is **a Mod that adds a "pin/persist" toggle to Glance and a snap-to-corner.** That's arguably 60% of the value for 20% of the work, and it's the *most* likely to be accepted upstream because it extends an existing subsystem rather than adding a parallel one. **Strong recommendation: prototype that first (it also doubles as your Phase-1 spike).**

6. **Third-party AI embedding is a dependency you don't control.** Claude/ChatGPT can change framing/anti-embedding policy. A resilient design treats "open in tab" as a first-class fallback, and doesn't hard-couple the product's value to any one site loading in a `<browser>`.

7. **Multi-window story is unglamorous but real.** "Assistant everywhere" across *multiple Zen windows* is a genuinely harder problem (per-window vs shared). v1 should explicitly be per-window and say so.

---

# 12. Sources

**Zen — official docs & source**
- [Zen code structure & prefs](https://docs.zen-browser.app/contribute/desktop/code-structure-and-prefs)
- [zen-browser/desktop (source)](https://github.com/zen-browser/desktop) · [zen-browser/surfer](https://github.com/zen-browser/surfer) · [org repos](https://github.com/orgs/zen-browser/repositories)
- [Split View docs](https://docs.zen-browser.app/user-manual/split-view) · [Glance docs](https://docs.zen-browser.app/user-manual/glance)
- [Mods marketplace / preferences](https://docs.zen-browser.app/themes-store/themes-marketplace-preferences) · [Zen Mods](https://zen-browser.app/mods/)
- DeepWiki: [overview](https://deepwiki.com/zen-browser/desktop) · [Glance Mode](https://deepwiki.com/zen-browser/desktop/3.7.1-glance-mode) · [Split View](https://deepwiki.com/zen-browser/desktop/3.3.3-split-view) · [Mod & Theme Marketplace](https://deepwiki.com/zen-browser/desktop/3.4-settings-and-preferences) · [Preferences system](https://deepwiki.com/zen-browser/desktop/5.1-preferences-system)
- Issues/discussions: [Web panel customization #852](https://github.com/zen-browser/desktop/discussions/852) · [#370](https://github.com/zen-browser/desktop/issues/370) · [Enhance Split View #512](https://github.com/zen-browser/desktop/issues/512)/[#813](https://github.com/zen-browser/desktop/discussions/813) · [Split for PiP #1743](https://github.com/zen-browser/desktop/issues/1743) · [Glance critique #10773](https://github.com/zen-browser/desktop/discussions/10773) · [zen-floating-tabbar mod](https://github.com/anaarkei/zen-floating-tabbar)

**Firefox / Mozilla / MDN**
- [sidebarAction API](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/sidebarAction) · [sidebar_action manifest](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/sidebar_action) · [Sidebars UI](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/user_interface/Sidebars) · [Chrome incompatibilities](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Chrome_incompatibilities)
- userChrome.js / privileged chrome: [fx-autoconfig](https://github.com/MrOtherGuy/fx-autoconfig) · [uc.css.js](https://github.com/aminomancer/uc.css.js/)

**Competitors**
- [Arc alternatives / Little Arc](https://allthings.how/best-arc-browser-alternatives-in-2025/) · [Arc vs SigmaOS](https://efficient.app/compare/arc-browser-vs-sigmaos) · [Arc vs Sidekick](https://efficient.app/compare/arc-browser-vs-sidekick) · [Zen features guide](https://supasidebar.com/blog/zen-browser-features-guide-2026)

---

## Appendix A — The single most important recommendation

If you do one thing: **build the Phase-1 spike as "Persistent, dockable Glance" Mod.** It simultaneously (a) proves every core technical unknown, (b) delivers ~60% of Zen Float's value immediately, and (c) is the most upstream-acceptable shape because it *extends Glance* rather than adding a parallel window system. Everything else in this RFC is the plan for turning that spike into the full product.
