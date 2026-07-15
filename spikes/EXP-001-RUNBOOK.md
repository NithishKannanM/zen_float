# EXP-001 Runbook (tailored to your flatpak Zen 1.21.6b)

Detected on this machine:
- Zen: flatpak `app.zen_browser.zen` 1.21.6b
- Profile: `~/.var/app/app.zen_browser.zen/.zen/ee9mww81.Default (release)/` (has `chrome/`, no JS loader yet)
- App files (autoconfig target, **root-owned, read-only**): `/var/lib/flatpak/app/app.zen_browser.zen/x86_64/stable/<hash>/files/zen/`

## Why this needs a human / sudo
fx-autoconfig requires `config.js` + `defaults/pref/config-prefs.js` next to the binary in the app dir, which is read-only on flatpak. There is **no pure-userspace way** to load privileged chrome JS in stock Firefox/Zen. Options below.

---

## Path A — Sine (recommended; least fiddly for flatpak)
Sine (`CosmoCreeper/Sine`) has a flatpak-aware installer that wires up the loader for you.
1. Install Sine per its README for flatpak Zen.
2. Copy the spike into the profile JS dir Sine/fx-autoconfig creates:
   ```
   cp "spikes/exp-001-probe.uc.mjs" "$HOME/.var/app/app.zen_browser.zen/.zen/ee9mww81.Default (release)/chrome/JS/"
   ```
   (create `chrome/JS/` if absent)
3. Enable terminal logging (so output is capturable), then launch from a terminal:
   ```
   # one-time prefs (add to profile prefs.js or set via about:config):
   #   browser.dom.window.dumps.enabled = true
   #   devtools.chrome.enabled = true
   flatpak run app.zen_browser.zen 2>&1 | tee /tmp/exp001.log
   ```
4. Let it fully start, then quit Zen. Paste `/tmp/exp001.log` lines matching `[EXP-001]` back to me.

## Path B — Manual fx-autoconfig (needs sudo to touch app dir)
1. Follow `MrOtherGuy/fx-autoconfig` "manual install": place `config.js` + `config-prefs.js` into the app `files/zen/` dir. On flatpak this dir is root-owned → requires `sudo` and may be reset by flatpak updates.
2. Put `utils/` loader + this spike under the profile `chrome/`.
3. Same launch+capture as Path A step 3–4.

## Path C — Read live in Browser Console (no terminal capture)
If you skip `dump`/stdout: after loading via A or B, open **Ctrl+Shift+J**, filter `[EXP-001]`, screenshot/paste the four checkpoint blocks.

---

## What to paste back
All lines containing `[EXP-001]`. Critically I need the **four checkpoint blocks**:
`IMPORT_TIME`, `DOMContentLoaded`, `MozAfterPaint(first)`, and `browser-delayed-startup-finished` — plus the `SessionStore … RESOLVED` line and the `base-class module` line.

I'll fill the Observed column of the EXP-001 report and lock the `init()` hook before we touch EXP-002.
```
