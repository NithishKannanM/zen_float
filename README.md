# Zen Float — an agentic engineering workflow for browser-internals R&D

**Zen Float** is a persistent floating browser-companion feature for [Zen Browser](https://zen-browser.app) (a Firefox fork). This repo is two things at once:

1. a **real, validated feature** built against Zen/Firefox internals, and
2. the **agentic engineering workflow** used to build it — a set of role-specialized AI agents (research → experiment → implement → validate → review) backed by persistent graph memory.

The interesting part isn't just the feature; it's the *method*: every architectural claim is grounded in shipped source, every risky assumption is de-risked with a disposable runtime experiment against a real build, and every change passes an adversarial review before it's considered done.

---

## The agent workflow (`.claude/agents/`)

Six role-specialized agents, each with a narrow charter, a restricted toolset, and an explicit standard of evidence:

| Agent | Charter | Discipline it enforces |
|---|---|---|
| **source-researcher** | Answer "how does it actually work" from primary source (`omni.ja`, upstream repos, MDN) | Every claim tagged `[Confirmed] / [Likely] / [Unknown] / [Needs experimentation]`; source beats docs |
| **experiment-runner** | Design + run disposable spikes against a real build before any production code | One variable per experiment; real evidence only; never claim what the harness can't observe |
| **implementer** | Build an approved spec in small, compiling commits | No scope creep, no speculative architecture; self-review before commit |
| **validator** | Prove the change meets its acceptance criteria on a real build | Coverage honesty: `DRIVEN / SIMULATED / STRUCTURAL / INDIRECT / NOT EXERCISED` |
| **adversarial-reviewer** | Try to **reject** the change | Enumerate invariants and attack each; approve only if none break |
| **memory-keeper** | Curate durable findings + keep the code graph fresh | Record only the non-obvious; never leave contradictory records |

Memory is a **[graphify](https://pypi.org/project/graphifyy/)** code-knowledge-graph served over MCP (`.mcp.json`), so agents can query the codebase structurally (`graphify explain "EnrollmentManager"`, `graphify path "A" "B"`) instead of re-reading everything.

```
 research ──► design ──► experiment ──► implement ──► validate ──► review
 (source-   (RFC/EDD/   (spikes on a    (small        (matrix on   (adversarial)
  grounded)  backlog)    real build)     commits)      real build)
     └──────────────────────── memory-keeper + graphify graph ───────────────────┘
```

> **Honest scope:** these agents are Claude Code subagent configurations that a human directs and whose decisions a human owns. The value is the *methodology* they encode and enforce — source-grounded research, runtime validation against real builds, coverage honesty, and adversarial review — not autonomy.

---

## What was actually built & proven

The feature is delivered as a privileged `userChrome` script (`src/zen-float.uc.mjs`), loaded via fx-autoconfig. Highlights that came out of the workflow:

- **Reverse-engineered Zen/Firefox's rendering model from shipped source** — `tabbox.js` (deck-selected marker), `browser-custom-element.mjs` (the `docShellIsActive` → `renderLayers` compositing switch), `AsyncTabSwitcher` / `TabUnloader` (`zenModeActive` keep-alive).
- **Proved the minimum render contract with a runtime experiment matrix** on a real headless build (Marionette): a non-selected `<browser>` renders **iff** `deck-selected` (enrollment) **and** `docShellIsActive` (compositing), with `zenModeActive` for persistence — validated one variable at a time (`reviews/ZF-020-MINIMUM-RENDER-CONTRACT.md`).
- **Shipped a persistent-render `EnrollmentManager`** that maintains that contract across tab switches / fullscreen / customize-mode via event-driven reassert + a synchronous MutationObserver backstop — no polling, no timers.
- **Validated it on a real build** (contract holds across ordinary + rapid tab switching, observer restores enrollment after external strip, leak-free teardown) and put it through **adversarial review**, which found and fixed a real idempotency defect and surfaced one open spec-conflict condition.

Everything is evidence-tagged; where a claim couldn't be verified in the environment (e.g. compositing pixels aren't capturable headless), it's marked as a residual rather than overclaimed.

---

## Repo map

| Path | What |
|---|---|
| `ZEN_FLOAT_RFC.md` | Product/architecture RFC |
| `ZEN_FLOAT_EDD.md` | Engineering design doc |
| `ZEN_FLOAT_BACKLOG.md` | Ticketed engineering backlog |
| `design/` | Lifecycle / render-enrollment designs |
| `spikes/` | Disposable experiments + their reports (EXP-001…002E) |
| `reviews/` | Validation reports, code reviews, root-cause analyses |
| `src/zen-float.uc.mjs` | The feature (privileged userChrome script) |
| `.claude/agents/` | The role agents |
| `.mcp.json` | graphify memory server wiring |

## Using the workflow

```bash
# refresh the code knowledge graph after changes
graphify update . --no-cluster
graphify explain "EnrollmentManager"     # inspect a node + its neighbors

# in Claude Code, delegate to a role agent, e.g.:
#   "use the adversarial-reviewer agent to review the current diff"
#   "use the experiment-runner agent to de-risk <assumption> on a real build"
```
