# ZF-020 — Headful Validation Plan & QA Sign-off

**Type:** Verification only (no implementation/refactor/optimization).
**Environment reality:** flatpak Zen 1.21.6b; **no passwordless sudo** (can't write the flatpak app dir → **fx-autoconfig not installable by QA**); **no Xvfb / Wayland screenshotter** (no clean virtual display). Available: Marionette (`-remote-allow-system-access`), chrome/content screenshots, `import`/`ffmpeg`/`convert`.
**What that means:** I could execute a **subset** headlessly via Marionette + chrome-screenshot (positioning/overlay), but the **loader path** and **real-window paint / interaction / website / multi-monitor** matrix require a real display + loader install and are **BLOCKED** for autonomous execution. Each item below is marked **PASS / FAIL / BLOCKED / PENDING** with evidence.

Evidence captured: `reviews/evidence/zf020-overlay-positioning.png` (chrome-context screenshot, 1366×768).

---

## 1. Headful Validation Plan (manual checklist)

Priority: **P0** blocks sign-off · **P1** important · **P2** nice-to-have.
Every row: Purpose · Steps · Expected · Failure symptom · Recovery · Evidence.

### Setup S0 — Loader install (prerequisite for ALL headful tests) — **BLOCKED**
- **Purpose:** load `zen-float.uc.mjs` into a real Zen window.
- **Steps:** install fx-autoconfig (or Sine) into the flatpak (needs sudo to write `…/files/zen/config.js` + `defaults/pref/config-prefs.js`), copy `src/zen-float.uc.mjs` → `<profile>/chrome/JS/`, set `zen.float.enabled=true`, `browser.dom.window.dumps.enabled=true`, `devtools.chrome.enabled=true`, launch from terminal.
- **Expected:** console prints `[ZenFloat] init — internals present; overlay shell ready`.
- **Failure:** no `[ZenFloat]` lines → loader not active.
- **Recovery:** verify autoconfig files + `general.config.filename`; try Sine's flatpak installer.
- **Evidence:** terminal log. · **Priority:** P0.

### Visual rendering (V-series)
| ID | Purpose | Steps | Expected | Failure | Evidence | Pri |
|---|---|---|---|---|---|---|
| V1 | Overlay visible | enable → `gZenFloatManager.openFloat()` | float box appears | nothing shows | screenshot | P0 |
| V2 | Positioning | open float | bottom-right, 420×640, 24px insets | wrong corner/clipped | screenshot | P0 |
| V3 | Browser paints | open float on a page | page content visible in the float region | blank/white float | screenshot | P0 |
| V4 | Frame↔browser alignment | open float | chrome frame borders the browser content exactly | content offset from frame | screenshot | P0 |
| V5 | z-order/clipping | open over a busy page | float above page, clipped to its rect | bleeds/underlaps | screenshot | P1 |
| V6 | No flicker | open/close ×5 | smooth, no flash | flicker/tearing | screen-record | P1 |
| V7 | Opacity (future) | n/a ZF-081 | — | — | — | P2 |

### Interaction (I-series)
| ID | Purpose | Steps | Expected | Failure | Pri |
|---|---|---|---|---|---|
| I1 | Tab switching | open float, switch tabs ×10 | float stays visible + interactive | disappears/freezes | P0 |
| I2 | Spaces switching | switch Zen spaces | float persists (global) / rebinds per design | vanishes/duplicates | P0 |
| I3 | Glance open/close | Alt-click a link | Glance works; float unaffected; no cross-talk | Glance breaks or float reclaimed | P0 |
| I4 | Split View | open split | split unaffected; float not pulled in | split breaks | P1 |
| I5 | Compact mode | toggle compact | float still viewport-correct (C3 residual) | float drifts/clips | P0 |
| I6 | Fullscreen enter/exit | F11 / video FS | float hides in FS, restores after (per ZF-083 later) | float covers FS video | P1 |
| I7 | Maximize/restore | toggle | float re-anchors bottom-right | float mispositioned | P1 |
| I8 | Window resize | drag-resize window | float re-clamps into viewport | float off-screen | P0 |
| I9 | Browser restart | quit+relaunch | no crash; float absent until opened (no persistence yet) | startup error | P1 |
| I10 | Multi-monitor | move window across monitors/DPI | float stays correct on active monitor | wrong monitor/scale | P2 |

### Real-website (W-series) — load each in the float; check load/cookies/login/scroll/focus/input/nav/media/errors
| ID | Site | Key checks | Pri |
|---|---|---|---|
| W1 | example.com | loads, paints | P0 |
| W2 | Claude | login, input, streaming, scroll | P0 |
| W3 | ChatGPT | login, input, nav | P0 |
| W4 | Gemini | login, input | P1 |
| W5 | Perplexity | input, results | P1 |
| W6 | GitHub | scroll, nav, auth | P1 |
| W7 | Notion | editor focus/input | P1 |
| W8 | YouTube | media playback, audio, PiP coexistence | P1 |
Failure symptoms to watch: `X-Frame-Options`/CSP refusal (blank/refused), broken OAuth popups, no keyboard focus, no scroll, media blocked.

### Performance (P-series)
| ID | Metric | Method | Budget | Pri |
|---|---|---|---|---|
| P1 | Startup impact | with/without flag, cold start ×3 | ≤ negligible | P1 |
| P2 | Memory | `about:memory` idle + float open | one extra content proc, bounded | P1 |
| P3 | CPU idle | float open, idle 60s | ~0% when static | P1 |
| P4 | Paint/tab-switch cost | switch tabs with float | no jank | P1 |
| P5 | Leak | open/close ×100, `about:memory` diff | flat; 0 retained docshells | P0 |

### Regression (R-series) — with flag ON and OFF
Glance · Split View · Spaces · Sidebar · startup · private browsing · containers · extensions · theme switching → each must behave identically to pre-ZF-020.

---

## 2. Loader Validation — **BLOCKED (sudo required)**
fx-autoconfig/Sine, module loading, startup timing, logging, feature flag, shutdown, multiple launches: **not executable** here (app dir root-owned, no passwordless sudo). Runbook is `spikes/EXP-001-RUNBOOK.md`. This is a **P0 blocker** for production sign-off — how the feature actually ships is unproven.

---

## 3. Visual Rendering Tests — **PARTIALLY EXECUTED**
Executed headlessly via Marionette chrome-context screenshot (evidence PNG):

| Test | Result | Evidence |
|---|---|---|
| V1 Overlay visible | **PASS** | float box renders |
| V2 Positioning | **PASS** | bottom-right, ~420×640, 24px insets — matches geometry vars exactly |
| z-order over page | **PASS** | float above white page |
| Chrome intact | **PASS** | Zen sidebar/toolbar render normally; no layout breakage |
| Float tab hidden | **PASS** | sidebar shows no float tab (ZF-020c confirmed visually) |
| V3 Browser paints | **PENDING** | chrome screenshot does **not** rasterize OOP browser content; content-context capture was degenerate (1167×8) in headless — cannot confirm content paint without a real display |
| V4 Frame↔browser alignment | **PENDING** | same reason (content not captured) |
| V5 clipping / V6 flicker | **PENDING** | needs real display |

**Net:** overlay presence + positioning + z-order + tab-hiding are **visually certified**. Browser *content* paint and frame/content alignment are **not** — the single most important remaining visual unknown.

---

## 4. Interaction Tests — **BLOCKED/PENDING** (require loader + real display)
None executed headful. Note: I1 (tab switching) persistence + activation is **API-verified** (ZF-020 report, 15/15) but not **visually** verified. I2–I10 all pending.

## 5. Real Website Tests — **PENDING**
None executed. `example.com` did not even load in the headless sandbox (network/headless); real-site + CSP/login/media behavior is entirely unverified (also EXP-003/ZF-023 territory).

## 6. Performance Validation — **PENDING**
Not measured. Requires a real run (`about:memory`, startup timing). API teardown is verified but P5 (100-cycle leak audit) is not.

## 7. Regression Testing — **PARTIAL**
- Glance non-interference: **PASS (API)** — float tab has `glanceId:null`, Glance ignores it.
- Flag-off inertness: **PASS (by construction + syntax)**.
- Full Glance/Split/Spaces/sidebar/private/containers/extensions/theme headful regression: **PENDING**.

## 8. Evidence Collection
| Evidence | Type | Location |
|---|---|---|
| Overlay positioning screenshot | PNG (chrome-context) | `reviews/evidence/zf020-overlay-positioning.png` |
| API + CSS assertions | Marionette JSON | `reviews/ZF-020-REPORT.md` §2 |
| Setup probe | `{frame:true, container:true, computedPos:"fixed", isRemote:true}` | this run |
| Content paint | **FAILED to capture** (degenerate 1167×8) | headless limitation |
Console logs / perf / memory: **not collected** (no headful run).

## 9. Visual Risk Review
| Risk | Status | Note |
|---|---|---|
| Misalignment (frame vs browser) | **OPEN** | two separate fixed elements share geometry vars; steady-state expected aligned, but **unconfirmed visually**; transient-transform drift (C3 residual) unconfirmed |
| Incorrect transforms | Low (frame at documentElement) | C3 guarantees frame; browser-in-tabpanels under compact/workspace transforms unconfirmed |
| Incorrect stacking | **PASS** | frame above page confirmed; frame-vs-browser-content stacking unconfirmed |
| Repaint issues | **OPEN** | not observed; headless compositor unreliable (SWGL errors) — inconclusive |
| Animation glitches | **OPEN** | no animations yet (ZF-082); open/close flicker unconfirmed |
| Event routing / pointer capture | **OPEN** | not testable headless; float must capture its rect, pass through elsewhere |
| Focus problems | **OPEN** | keyboard focus into the float browser unverified |

---

## 10. Release Recommendation

### **NO — not production-ready.**

**What IS certified (real evidence):** overlay renders, **positioning is exact**, z-order correct, Zen chrome uninjured, float tab hidden; and (from ZF-020 report) the browser is live/active/persistent across tab switches with clean teardown and Glance non-interference. Positioning — previously the biggest visual risk — is **no longer a concern**.

**Why not production-ready — concrete remaining blockers (all require a real display and/or loader install with sudo):**
1. **[P0] Browser content paint UNVERIFIED.** No capture shows the nested browser actually painting real content inside the float region, nor frame↔content alignment. This is the core visual claim and it is unproven.
2. **[P0] Loader path UNVERIFIED.** fx-autoconfig/Sine loading of `zen-float.uc.mjs` (the actual ship mechanism) has never run — app dir is root-owned, no passwordless sudo.
3. **[P0] Interaction matrix UNRUN.** Tab-switch (visual), Spaces, Glance coexistence, Compact mode (C3 residual), fullscreen, window resize — none seen in a real window.
4. **[P0] Real-website behavior UNRUN.** Load/CSP/login/focus/input/scroll/media for Claude/ChatGPT/etc. — zero coverage; `example.com` didn't even load headless.
5. **[P1] Performance/leak UNMEASURED.** Startup/memory/CPU and the 100-cycle leak audit not run.

**To reach sign-off:** execute §1 P0 rows in a real Zen window after a one-time loader install. Everything needed is scripted/checklisted above; the only true dependency is a display + sudo — neither available to QA autonomously.

**Do not begin ZF-021 until items 1–4 are closed.**

---

## ADDENDUM — Loader validated + a real defect found (portable-Zen test rig)

Set up a **no-sudo portable test env** (`~/zen-float-test/`: Zen 1.21.7b tarball + fx-autoconfig, isolated from the daily flatpak). Results:

- **A1 LOADER — PASS (previously BLOCKED).** fx-autoconfig loaded the real `zen-float.uc.mjs`; init ran at delayed-startup: `[ZenFloat] init — internals present; overlay shell ready`. Marionette confirmed `gZenFloatManager` (ctor `nsZenFloatManager`), `enabledPref:true`, `hasFloatWindow:true`, `frameInDOM:true`. The ship mechanism works, no sudo, no app-dir hack.
- **DEFECT F-1 (P0) — placeholder frame occludes the browser.** `document.elementFromPoint` at the float center returns `.zen-float-overlay` with `background: rgb(255,255,255)` (opaque). The no-move browser floats at the same rect *behind* the opaque frame → `openFloat()` shows a blank white box, not the page. Root cause: ZF-002's placeholder frame has an opaque fill and equal z-index; it was never meant to sit over the browser. **Fix (ZF-021+ / ZF-020 follow-up, NOT this task):** make the frame a border/titlebar with a transparent content region (or stack the browser above the frame). Workaround for manual testing: hide the frame (`.zen-float-overlay{display:none}`) to view the browser.

This does not change the ZF-020 verdict (**NO — not production-ready**); it adds a concrete, now-visible P0 defect and closes the A1 blocker.
