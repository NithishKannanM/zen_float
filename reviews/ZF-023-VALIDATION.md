# ZF-023 — Target Presets & Target Switching Validation

**Build:** Zen 1.21.7b portable, `zen-float.uc.mjs` @ ZF-023, **loaded via fx-autoconfig** (real ship path).
**Driver:** Marionette chrome context — two `ExecuteAsyncScript` matrices + a screenshot pass.
**Ground truth:** `registry.state` vs the live `host.browser.currentURI.spec`; `browser.remoteType` for process switches; picker state read out of the DOM; listener counts via `nsIEventListenerService` on **window** and **tab** (the ZF-021d/ZF-022 standard). Real network was used throughout (claude.ai, github.com, chatgpt.com, perplexity.ai, deepwiki.com, notion, example.com/org).

## Result matrix

| # | Scenario | Method | Expected | Observed | Verdict |
|---|---|---|---|---|---|
| V1 | **Preset switch across origins** (claude.ai → github.com) | driven | process switch occurs; url/title/favicon/loading all update after it | `remoteType` `webIsolated=https://claude.ai` → `webIsolated=https://github.com`; title `"GitHub · Change is constant…"`; `loading=false`; **same tab reused** | **PASS** |
| V2 | **Rapid switching ×3** (perplexity → deepwiki → chatgpt, 120ms apart) | driven | final state = last requested target; no stale metadata applied late | `url === liveUrl === https://chatgpt.com/`, `title="ChatGPT"`, `loading=false` | **PASS** |
| V3 | **Custom URL validation** | driven | valid https loads; bare domain fixed up; every blocked scheme rejected without loading or throwing | see table below — 7/7 correct, `url` identical before and after the blocked batch | **PASS** |
| V4 | **Switch mid-load** (previous target still loading) | driven | clean interruption; new target loads; loading returns to false | interrupted a blackholed load; `notion` loaded (via redirect); `loading=false`; same tab | **PASS** |
| V5 | **Close with the picker open** | driven | full teardown; listener census at baseline | picker was open with 8 items → bar gone, picker gone, `floatTabs=0`, window `13/10` = baseline, tab `0/0/0`, **0 new errors** | **PASS** |
| V6 | **Reload after a switch** reloads the *current* target | driven | loading true→false; URL unchanged and still the switched target | `target-loading [true,false]`; url stayed `https://github.com/` | **PASS** |
| V8 | Picker: **Enter** commits the custom URL | driven (real `KeyboardEvent`) | URL loads; picker closes; input cleared | `example.org` loaded; `pickerOpen=false`; `inputValue=""` | **PASS** |
| V9 | Picker: invalid scheme typed + Enter | driven | inline error; picker stays open; nothing loads | error `"javascript: URLs are not allowed"`, `[invalid]` set, still open, url unchanged | **PASS** |
| V10 | Picker: **Escape** closes | driven | picker closes; error cleared | `open=false`, `[invalid]` cleared | **PASS** |
| V11 | Picker: clicking a preset item switches | driven (real `.click()`) | target loads; picker closes | `https://github.com/` loaded; picker closed | **PASS** |

### V3 detail — one gate, no bypass

| Input | Result | Loaded? |
|---|---|---|
| `https://example.com/` | `ok:true` → `https://example.com/` | yes |
| `example.com` / `example.org` (bare domain) | `ok:true` → fixed up to `http://example.org/` | yes |
| `javascript:alert(1)` | `ok:false, code:"blocked-scheme"` | no |
| `data:text/html,<script>alert(1)</script>` | `ok:false, code:"blocked-scheme"` | no |
| `file:///etc/passwd` | `ok:false, code:"blocked-scheme"` | no |
| `chrome://browser/content/browser.xhtml` | `ok:false, code:"blocked-scheme"` | no |
| `about:config` | `ok:false, code:"blocked-scheme"` | no |
| `""` (empty) | `ok:false, code:"empty"` | no |
| `hello world` | `ok:false, code:"unparsable"` | no |

None threw; `registry.url` was byte-identical before and after the whole blocked batch.

## Visual evidence (V7)

- `reviews/evidence/zf023-picker.png` — picker open over a live GitHub page: all 8 PRD presets listed with icon hints, **GitHub highlighted as the active target**, custom-URL input focused, title bar showing GitHub's real favicon and title.
- `reviews/evidence/zf023-switched-target.png` — the float after switching to GitHub, page compositing live below the bar.

## Coverage honesty

- **Driven on the real build:** every row. Switches went through the product entry points (`switchTarget`, real preset clicks, real `KeyboardEvent`s), not internal shortcuts.
- **The remoteness re-registration built in ZF-022 is now exercised under real product use** (V1): a genuine cross-origin Fission process switch, after which title/favicon/loading all still update. That was the point of the ticket's requirement, and it holds.
- **`https://www.notion.so/` redirects to `www.notion.com`.** Not a defect: the switch, the load and the metadata are all correct, and the preset intentionally points at the app domain (logged-in users land in their workspace). The first V4 run was scored FAIL by an over-strict assertion that pinned the exact host; re-run redirect-tolerant, it passes. Flagged so nobody reads the redirect as a bug later.
- **Gecko logs `NS_ERROR_MALFORMED_URI @ URIFixup.sys.mjs:450` for unparsable input.** `getFixupURIInfo` logs before throwing; we catch it and return `{ok:false, code:"unparsable"}`. So the console shows a message even though nothing throws at our layer and nothing loads — expected, not a ZF error.
- **Third-party console noise is not ZF's.** Loading real sites produced CSP/eval/tracker warnings from github.com, chatgpt.com and notion.com, plus the pre-existing `handleEvent is not callable` (measured in ZF-021d as ~1 per `TabClose` with **no float open**). No ZF-originated error appeared in any row.
- **Not exercised:** persistence of the selected target (explicitly out of scope — the float always opens on the default preset), per-workspace targets, multi-window, session restore. Slack/Gemini/Claude presets were resolved and validated but only Claude, GitHub, ChatGPT, Perplexity, DeepWiki and Notion were actually loaded end-to-end; the others share the identical code path.
- **Logged-out reality:** several presets render marketing or sign-in pages in a fresh profile. That is the site's behaviour, not the float's; embedding refusal handling is ZF-023's successor ticket (`ZF-023 — Embedding fallback` in the backlog, unrelated numbering collision noted below).

## Verdict

All seven required scenarios pass, plus four added rows for the picker's real interaction paths. Switching reuses the existing tab and browser (no respawn, enrollment untouched), validation is a single gate that no preset or custom URL bypasses, and teardown from the picker-open state returns the listener census exactly to baseline at both window and tab scope.

**Backlog note:** this work closes the original ZF-022 ACs ("switching target reloads browser", "custom URL accepted/validated") and ADR-022 D-4. The backlog already contains a *different* ticket numbered ZF-023 (embedding fallback / open-in-tab); this milestone was delivered under the ZF-023 label given in the implementation ticket, so the two now collide by number — recorded in the backlog rather than silently renumbered.
