# ADR-023 — Target Presets & Switching

**Status:** Accepted · **Scope:** ZF-023 · **Code:** `src/zen-float.uc.mjs` · **Validation:** `reviews/ZF-023-VALIDATION.md`

Decisions taken while implementing ZF-023 that deviate from the ticket or resolve ambiguity in it.

## D-1 — Preset list taken verbatim from the PRD

The ticket said "check what the PRD lists; if the PRD names specific presets, use exactly those." `ZEN_FLOAT_RFC.md:283` names eight: **Claude, ChatGPT, Gemini, Perplexity, DeepWiki, GitHub, Notion, Slack** — implemented exactly, in that order, with Claude as the default (matching `RFC:293`). Each descriptor carries `type:"web"` so the EDD §13 `type:"internal"` extension needs no shape change. URL choices worth knowing: Slack → `https://app.slack.com/` (the client, not the marketing site) and Notion → `https://www.notion.so/` (the app domain; it redirects to `notion.com` when logged out — verified, harmless).

## D-2 — `loadURI(nsIURI)` instead of `fixupAndLoadURIString`

The ticket allowed either. Chose `browser.loadURI(uri, {triggeringPrincipal})` (`browser-custom-element.mjs:905`) with the **already-validated** `nsIURI`, because `fixupAndLoadURIString` would re-run fixup at load time and could produce a URI different from the one that passed the scheme allowlist. Validating and then loading a *string* leaves a gap between check and use; loading the exact validated URI closes it.

**System principal is deliberate.** The urlbar treats user-typed navigation as system-principal-triggered (`UrlbarInput.mjs:4335-4338` branches on `triggeringPrincipal.isSystemPrincipal` as the normal urlbar path). A target chosen by the user in privileged float UI is the same category of load: user-initiated through chrome, not content-initiated. The scheme allowlist upstream is what keeps that principal safe — no content-supplied string ever reaches `loadURI` unvalidated.

## D-3 — Fixup **without** keyword lookup (deliberate divergence from the urlbar)

The urlbar passes `FIXUP_FLAG_FIX_SCHEME_TYPOS | FIXUP_FLAG_ALLOW_KEYWORD_LOOKUP` (`UrlbarInput.mjs:1423`), so non-URL input becomes a *search*. The float's custom-URL field passes **only** `FIXUP_FLAG_FIX_SCHEME_TYPOS`: this is a target field, not a search box, so `hello world` must be rejected (`code:"unparsable"`) rather than silently turned into a search query in the companion pane.

## D-4 — Validation returns a result; it never throws

`TargetPresets.validate()` / `.resolve()` / `FloatWindow.switchTarget()` all return `{ok:true,url,uri}` or `{ok:false,code,reason}`. Rejection is a value the presentation layer renders, per the ticket. Note that Gecko's `URIFixup` logs `NS_ERROR_MALFORMED_URI` to the console before throwing internally on unparsable input — we catch it; the console line is Gecko's, not an escaped exception.

## D-5 — Preset URLs go through the same gate as user input

`resolve()` runs even our own preset URLs through `validate()`. One gate, no bypass: a typo'd or later-edited preset cannot smuggle in a scheme the allowlist would reject.

## D-6 — The title acts as the picker trigger

Rather than adding a fourth button, the existing title element (plus a small chevron) toggles the panel — this matches the PRD mock (`RFC:256`, `⣿ Claude ⌄`) and keeps the 32px bar uncluttered. The panel is anchored inside the bar (`position:relative` on the bar), so it is removed with the bar on teardown and needs no separate lifecycle.

## D-7 — Chrome stays presentation-only

`FloatChrome` receives presets as **plain data** (`TargetPresets.forDisplay()`) and returns selections through `onSwitchTarget`, receiving the verdict back to render. It does not import `TargetPresets`, hold a browser, or perform validation — consistent with the ZF-022 ownership matrix.

## D-8 — Ticket-number collision left visible, not renumbered

The backlog already had a ZF-023 ("embedding fallback / open-in-tab"). This milestone shipped under the ZF-023 label the implementation ticket used. Both are now recorded in the backlog with a pointer, and the embedding-fallback ticket is flagged for renumbering (suggest ZF-024) rather than silently overwritten.
