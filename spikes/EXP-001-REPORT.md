# EXP-001 / EXP-001B — Experiment Report (REAL DATA)

**Environment:** Zen flatpak `app.zen_browser.zen` **1.21.6b**, buildID **20260708113753**, Linux/Wayland.
**Method:** Could not install fx-autoconfig (root-owned flatpak app dir, no passwordless sudo). Instead launched a **disposable headless instance** (`--headless --new-instance --marionette -remote-allow-system-access`, throwaway temp profile) and evaluated JS in **chrome context** via the Marionette wire protocol on 127.0.0.1:2828. User's real Zen + profile untouched. Data below is measured, not inferred.

**Scope caveat:** This validates **A2 (chrome-global reachability)** and characterizes the runtime. It does **NOT** validate **A1 (the fx-autoconfig `.uc.mjs` load path)** — that still requires an actual loader install — nor **A3 (startup-timing checkpoints)**, since Marionette attaches post-startup.

---

## EXP-001 result — globals (A2): PASS

| Global | Exists | ctor | liveness probe |
|---|---|---|---|
| `gBrowser` | ✅ | — | `tabs.length = 2` |
| `gZenGlanceManager` | ✅ | `nsZenGlanceManager` | `openGlance = function` |
| `gZenWorkspaces` | ✅ | `nsZenWorkspaces` | `init = function`, `activeWorkspace = string` |
| `gZenViewSplitter` | ✅ | `nsZenViewSplitter` | proto: init, insertIntoContextMenu, handleTabClose, onTabSelect, removeTabFromGroup, _calculateDropSide |
| `gZenKeyboardShortcutsManager` | ✅ | Object | `setShortcut = function` |
| `gZenMods` | ✅ | `nsZenMods` | `getMods = function` |
| `gZenStartup` | ✅ | `ZenStartup` | — |
| `gZenCompactModeManager` | ✅ | Object | — |
| `gZenUIManager` | ✅ | Object | — |
| `#zenKeyset` element | ✅ | — | present (ZF-070 can append `<key>`) |

**Every EDD-referenced global is live in chrome scope.** A2 validated.

## EXP-001B result — deeper characterization

**Base classes (confirms EDD §2.11 + adds one):** `chrome://browser/content/zen-components/ZenCommonUtils.mjs` exports:
`nsZenDOMOperatedFeature`, `nsZenPreloadedFeature`, **`nsZenMultiWindowFeature`** ← *new*, relevant to the multi-window concern; v2 `ZenFloatManager` should likely extend it.

**Workspaces change API (answers EXP-004 without a spike):** `gZenWorkspaces` exposes public
`addChangeListeners` / `removeChangeListeners`, plus `activeWorkspace`, `getActiveWorkspace`, `changeWorkspace`, `changeWorkspaceWithID`, `isWorkspaceActive`, `onLocationChange`, `switchIfNeeded`.
→ **ZF-060/061 use `addChangeListeners`; the MutationObserver fallback (TD-5) is unnecessary.**

**Glance API (EXP-002 preview):** `openGlance, closeGlance, quickOpenGlance, quickCloseGlance, fullyOpenGlance, splitGlance, manageTabClose, onTabClose, onTabOpen, shouldOpenTabInGlance`. **No `persist`/`pin`** → persistence must be added, as planned. `quickOpenGlance`/`quickCloseGlance` (no-animation variants) are promising for a persistent float.

**Correction to the EDD:** live `zen.glance.activation-method` = **`"alt"`** (the RFC was right; the EDD's "corrected to ctrl" was itself wrong — the shipped pref value is `alt`). Real value wins.

**Pref landscape:** `zen.glance`=6, `zen.workspaces`=14, `zen.splitView`=7, `zen.view`=28, `zen.mods`=5. `zen.ai`=0, `zen.float`=0 → **our namespace is clear.**

---

## ★ MAJOR DISCOVERY (EXP-001B) — Zen 1.21.6b already ships an AI subsystem

Two pre-existing AI primitives, **both disabled by default** in this build, that the RFC/EDD were unaware of:

1. **`AIWindow` component** — `moz-src:///browser/components/aiwindow/ui/modules/AIWindow.sys.mjs`, global `AIWindow`, content URL `chrome://browser/content/aiwindow/aiWindow.html`. It's a **substantial AI window / "smart window" / immersive subsystem**, not a toy. Static surface includes:
   `toggleAIWindow`, `launchWindow`, `launchSignInFlow`, `getActiveConversation`, `moveConversationToSidebar`, `openSidebarAndContinue`, `updateImmersiveView`, `shouldUseImmersiveView`, `immersiveViewURIs`, `getSmartbarForWindow`, `initializeAITabsToolbar`, `isAIWindowActive/Enabled`, `hasActiveChatInBrowser`, `chatStore`, `AIControlSmartWindow`, `AIControlDefault`, policy gates (`isManagedByPolicy`, `isBlocked`, `enable`, `block`, `makeAvailable`), `AIWindowEnabledPref`.
   Shape reads as a **dedicated AI browsing window + sidebar experience** (window/tab-level, immersive), **not** a lightweight floating-over-your-page pane.

2. **Firefox AI Chatbot sidebar** — `browser.ml.chat.*` (42 prefs: `enabled`, `provider`, `sidebar`, `page`, `prompts.*`, `shortcuts`). Mozilla's provider-configurable AI sidebar (ChatGPT/Claude/Gemini/…), inherited by Zen. Edge-docked.

Runtime state here: `browser.ml.chat.enabled=false`, `browser.ml.enable=false`, `AIWindow` present but not enabled. `aiwindow`/`zen.ai` pref branches empty.

### Why this matters
The RFC/EDD positioned Zen Float against Arc/SigmaOS etc. — but the *host browser itself* now contains AI-window and AI-sidebar machinery. This does **not** invalidate Zen Float's core thesis (a **floating, draggable, in-page, workspace-following** assistant pane — distinct from AIWindow's heavy window/immersive model and from an edge-docked sidebar), but it is a genuine **architecture decision point**:

- **Reuse:** Zen Float could sit on `AIWindow.chatStore` / provider plumbing / sign-in flow instead of just embedding third-party sites in a `<browser>`.
- **Differentiate:** keep Zen Float as the lightweight floating pane and treat AIWindow/ml.chat as separate, heavier surfaces (with interop via `moveConversationToSidebar`-style handoffs).
- **Risk:** if Zen/Firefox is actively investing in AIWindow, a parallel Zen Float may face upstream reluctance (affects the v2 upstream story, backlog ZF-125).

**Recommendation:** a short follow-up spike (**EXP-001C**) to enable `AIWindow` in a throwaway profile and observe *what it actually renders* (separate OS window? in-window overlay? full tab?) before committing EXP-002's host design — because if AIWindow already provides an in-window floating host, EXP-002 should test *that* rather than the Glance recipe.

---

## Architecture impact summary

| Finding | Impact | Action |
|---|---|---|
| A2 globals all reachable | Confirms Mod/`.uc.mjs` and core paths can drive Zen internals | Proceed |
| `nsZenMultiWindowFeature` exists | Better multi-window base than self-init | Update EDD §2.11 / ZF-121 to extend it |
| `gZenWorkspaces.addChangeListeners` | EXP-004 answered | Drop TD-5 fallback; simplify ZF-060/061 |
| activation-method = `alt` | EDD had wrong "correction" | Re-correct docs to `alt` |
| **AIWindow + ml.chat exist (disabled)** | Overlaps Zen Float; unknown to RFC/EDD | **DECISION NEEDED** before EXP-002: reuse vs differentiate; run EXP-001C to characterize |
| A1 (fx-autoconfig load) still unproven | v1 delivery mechanism unverified | Needs a real loader install (you, with sudo) or accept core-only path |

---

## EXP-001C — AIWindow characterization (real data): RESOLVED
`AIWindow.id = "smartWindow"`; `AIWINDOW_URL = newTabURL = chrome://browser/content/aiwindow/aiWindow.html`; `firstrunURL = chrome://browser/content/aiwindow/firstrun.html`; immersive-view URIs = those two chrome pages. State: `isEnabled/isAvailable/isAllowed=false`, `canRunOnDevice=true`, `isManagedByPolicy=false`. Gated by `browser.ai.control.smartWindow` (siblings: `sidebarChatbot`, `smartTabGroups`, `linkPreviewKeyPoints`, `pdfjsAltText`, `translations`).
**Conclusion:** AIWindow = Mozilla "Smart Window", an **immersive full-window/new-tab AI surface** (+ sidebar handoff), **not** an in-page floating host. → **No pivot.** Zen Float proceeds on the Glance recipe, differentiated as the lightweight floating pane; AIWindow is a future interop target only.

---

## EXP-002 — persistent nested `<browser>` (make-or-break): **PASS**
Method: `gBrowser.addTab` with Glance options, unregistered (no glance-id); OOP-correct liveness signals.

| Signal | lazy | after select | selected-away + `docShellIsActive=true` | 15 switches |
|---|---|---|---|---|
| `browsingContext` | ✅ | ✅ | ✅ | 15/15 |
| `docShellIsActive` | false | true | **true** | 15/15 |
| alive / not closed | ✅ | ✅ | ✅ | ✅ |
| Glance attrs | none | none | none | none |

**Proven:** unregistered nested browser (1) persists across 20+ tab switches, (2) is ignored by Glance, (3) stays **live+rendering while unselected** via `linkedBrowser.docShellIsActive=true` (reassert on each `TabSelect`), (4) sits in `.browserSidebarContainer`/`.browserStack` (reparentable to a fixed overlay).
**Gotcha found:** `browser.docShell` is null for remote/OOP browsers (caused a false-negative in the first pass); use `browsingContext`/`docShellIsActive`/`frameLoader`.
**ZF-020 recipe locked:** addTab(Glance opts) → don't register in glances → `docShellIsActive=true` + reassert on TabSelect → reparent container into `.zen-float-overlay`.
**Not covered (honest):** visual paint in overlay (needs headful EXP-002D); real third-party site load (EXP-003 — example.com didn't load headless); A1 fx-autoconfig load path (loader not installable here).

## Next
Architecture bet validated. Proceeding to **ZF-001** (bootstrap). Remaining unknowns: A1 (needs real loader install by user w/ sudo, or accept core-only), visual/embedding (EXP-002D/EXP-003, need a display).
