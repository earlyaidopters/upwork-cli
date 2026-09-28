# upwork-cli

Find relevant work. Keep a history of what you have seen. Write proposals from your own evidence.

Built for the [Early AI-dopters](https://www.skool.com/earlyaidopters) community, this CLI brings Upwork search, lane-based ranking, SQLite history, and proposal preparation into one terminal workflow. A dedicated Chrome profile handles your signed-in session. Your evidence profile supplies your experience and voice.

**Open source, MIT licensed, and not affiliated with Upwork.** Everything runs on your machine against your own signed-in account. Offline tests and a clean package installation are verified on every change. Browser automation depends on Upwork’s current pages and can stop when those pages change; fixes are welcome as pull requests. Filling and submitting proposals through the browser is off by default; see [Live proposal automation](#live-proposal-automation-opt-in).

[Get started](#get-started) · [Pick your lanes](#pick-your-lanes) · [Find work](#find-work) · [Write like yourself](#write-like-yourself) · [Proposal workflow](#proposal-workflow) · [Troubleshooting](#troubleshooting)

## What you get

| Capability | What it does |
| --- | --- |
| Lanes | Pick the kinds of work you want; each lane brings its own searches and ranking signals |
| Search and hunts | Search one phrase or run every query in your lanes with duplicate jobs removed |
| Net-new results | Save every observation, then show jobs first seen in the current pull |
| Local ranking | Explain the lane, keyword, budget, activity, and client signals behind a score |
| Eligibility inspection | Open job details to check location restrictions omitted from search cards |
| Persistent history | Keep jobs, sightings, and pull runs in local SQLite |
| Evidence packets | Pair exact screening questions with your relevant proof |
| Human writing guides | Build your voice profile, draft from evidence, and edit specific weak patterns |
| Guarded proposals | Review and paste yourself, or opt in to guarded browser filling and submission |
| Portable exports | Export tables, JSON, JSONL, CSV, or Markdown |

The CLI does not generate prose by calling an AI model. Use the packet with your preferred assistant or write the application yourself. No model API key is needed.

## Get started

You need Node.js **22.5 or later**, npm, Google Chrome, and an Upwork freelancer account. Chrome discovery includes macOS, Windows, and Linux paths; live behavior must be checked on your platform. The CLI uses Node’s built-in SQLite, which may print an experimental-feature warning on older supported Node versions.

Clone and install:

```bash
git clone https://github.com/earlyaidopters/upwork-cli.git
cd upwork-cli
npm ci
npm link
upwork-cli setup
upwork-cli auth
upwork-cli doctor
```

`npm link` installs the local command. You can skip it and run `node src/cli.mjs` instead of `upwork-cli`.

`auth` opens a dedicated Chrome window. Sign in there and complete any verification yourself. The CLI attaches to that session through localhost. It never needs cookies copied from your everyday browser.

`init` creates private configuration and profile files. It leaves existing files intact. **`init --force` overwrites both files**, so use it only when you intend to reset them.

`setup` asks for your country, hourly rate, and lanes, saves them privately, and preserves your existing evidence and preferences. Press Enter to keep a field unchanged. It does not open a browser or apply to jobs. For an assistant or a non-interactive terminal, supply explicit values:

```bash
upwork-cli setup --country "Canada" --rate 100 --lanes ai-automation,ai-agents
```

These are examples; use your own country, rate, and lanes. `upwork-cli init` remains available for empty defaults.

### Set your country and search preferences

Edit `~/.upwork-cli/config.json`. Set `eligibility.freelancerCountry` to your actual country; the default is `null`. For example:

```json
{
  "eligibility": {
    "freelancerCountry": "Canada",
    "inspectTop": 25,
    "excludeIneligible": true
  }
}
```

Canada is an example, not an account setting. Keep the other generated fields or supply a partial config; defaults are merged when loaded. `ranking.priorityKeywords`, `ranking.negativeKeywords`, and `ranking.minimumHourlyTarget` apply on top of every lane. `presets` adds your own named query lists.

Scores explain relative fit; they are not predictions of winning a job.

## Pick your lanes

A lane is a kind of work. It decides which searches `hunt` runs and what counts as a strong title match when jobs are ranked. List them:

```bash
upwork-cli lanes
```

| Lane | For |
| --- | --- |
| `ai-automation` | n8n, Make, Zapier, and AI-powered business workflows |
| `ai-agents` | Agents, RAG, chatbots, MCP servers, and LLM integrations |
| `ai-apps` | Full-stack apps, SaaS MVPs, and prototypes built with AI coding tools |
| `ai-training` | Teaching teams to use AI tools through workshops, courses, and coaching |
| `ai-consulting` | Advisory, roadmaps, audits, and fractional AI leadership |
| `ai-creative` | AI video, images, voice, and content production |

Pick one or more by id or number:

```bash
upwork-cli setup --lanes 1,2
```

With no lanes selected, every lane competes. Each job is scored against each of your lanes and keeps its best one, so the `lane` field in JSON output tells you why it ranked. `ai-training` and `ai-consulting` also require AI context, so a generic sales trainer or marketing strategist ranks low.

Terms match whole words. `rag` matches "RAG pipeline" and not "storage". A term ending in `*` matches as a prefix, so `automat*` matches automate and automation.

### Add your own lane

Add it under `customLanes` in `~/.upwork-cli/config.json`, then select it. A custom lane with a built-in id replaces that lane.

```json
{
  "lanes": ["shopify-ai"],
  "customLanes": {
    "shopify-ai": {
      "label": "Shopify AI",
      "titleTerms": ["shopify", "ecommerce"],
      "contextTerms": ["ai", "chatbot*", "gpt*"],
      "requireContext": true,
      "priorityKeywords": ["shopify ai"],
      "negativeKeywords": ["theme customization"],
      "queries": ["shopify ai", "shopify chatbot", "ecommerce ai automation"]
    }
  }
}
```

Run `upwork-cli lanes --queries` to see every lane’s searches. Lane improvements are welcome as pull requests.

## Find work

Start with a small live pull:

```bash
upwork-cli doctor
upwork-cli hunt --pages 1 --sort recent --max-age-hours 168 --inspect-top 25 --eligible-only
```

`hunt` with no argument runs every query in your lanes. Name one lane to run only its queries, for example `upwork-cli hunt ai-agents`. Supply your own phrases when you need a narrower hunt:

```bash
upwork-cli hunt --queries "Claude Code,Claude Cowork,MCP server" --pages 1 --sort recent
upwork-cli search "AI workshop" --pages 2 --sort recent --format markdown --output shortlist.md
upwork-cli feed recent --batches 3 --max-age-hours 48
```

Results go to stdout; progress and run totals go to stderr. Use JSON when piping to another program:

```bash
upwork-cli hunt ai-consulting --format json --output jobs.json
upwork-cli history stats
upwork-cli history runs --limit 10
upwork-cli history trends --days 30
upwork-cli history queries --days 30
```

### Why a second pull can show no jobs

Search, hunt, and feed save all observed jobs, including refreshed records. By default they output only jobs first seen in that pull. `--all` includes previously seen jobs. `cache` reads stored jobs without a live search.

```bash
upwork-cli hunt ai-automation --pages 1 --all
upwork-cli cache --format csv --output cached-jobs.csv
```

Net-new describes the database comparison, not when the client published the job. Use recency filters as well.

### Read eligibility and client fields carefully

Only the highest-ranked `--inspect-top` candidates receive fresh full-detail inspection. Cached detail eligibility expires after 24 hours by default, controlled by `eligibility.maxDetailAgeHours`. It is recomputed for your current country. Jobs outside the inspected group can have unknown eligibility. The normal filter removes confirmed incompatible jobs; unknown eligibility can still appear in discovery output.

Use `--eligible-only` for an actionable shortlist. It requires both a fresh `detailInspectedAt` and `eligibleForProfile === true`. Check the title and description for hard restrictions too. The parser recognizes standard platform location labels and selected explicit country restrictions; it cannot interpret every legal, residency, language, or regional requirement.

Unknown eligibility stays labeled unknown, including when a page was inspected but the restriction could not be resolved. Citizenship requirements need manual verification; residence does not establish citizenship. Missing payment or client-history data is not proof of a bad client. Check the live posting before deciding. `--include-ineligible` is for inspecting excluded records deliberately.

## Write like yourself

The starter profile has **no name, rate, biography, credentials, results, or proof links**. Add your own before drafting:

```bash
upwork-cli proposal profile
upwork-cli proposal playbook
```

These commands print the files to open. Follow the guides in order:

1. [Voice workbook](docs/voice-workbook.md): capture your vocabulary, cadence, and verified experience.
2. [Proposal writing](docs/proposal-writing.md): choose evidence, answer screening questions, and edit without flattening your voice.
3. [Assistant instructions](docs/agent-instructions.md): give your assistant the boundaries for discovery, drafting, review, and browser ownership.

The profile is private. Keep it out of Git and issue reports. The repository’s `profile.example.json` documents the empty starting structure.

## Proposal workflow

Replace `JOB_ID` below with the ID or URL of a job you selected. Read-only inspection can avoid opening the application form:

```bash
upwork-cli proposal inspect JOB_ID --no-form
upwork-cli proposal packet JOB_ID --no-form --output packet.md
```

When you deliberately start an application, capture its live terms and exact questions:

```bash
upwork-cli proposal template JOB_ID --rate 100 --output application.json
```

The rate is an example, not a recommendation. Review every term. For fixed-price work, inspect the generated fixed price, payment mode, and duration. Write the cover letter and each answer without changing the question text.

```bash
upwork-cli proposal lint application.json
upwork-cli proposal validate application.json
upwork-cli proposal review application.json
upwork-cli proposal status application.json
```

`lint` reports specific writing patterns and excerpts. It does not verify achievements or detect who wrote the text. Resolve errors and assess warnings in context.

Before anything is submitted, show the user the complete final application: cover letter in one code block, each question followed by its answer in a separate code block, rate, base Connects, boost, and maximum total. State **NOT SUBMITTED** and wait for exact-content approval.

### Submit it yourself (default)

`proposal review` prints the cover letter and every answer in separate blocks, ready to paste. Open the job in Upwork, paste each block, set your rate and any boost, and submit. Then record it so your history stays accurate:

```bash
upwork-cli proposal record-submitted application.json --proposal-id 1234567890 --confirm "RECORD SUBMITTED 1234567890"
```

The proposal ID is the number in the page address after you submit.

### Live proposal automation (opt-in)

Section 3.5 of Upwork’s [Terms of Use](https://www.upwork.com/legal#terms-of-use) prohibits robots, scrapers, and similar mechanisms without written permission. Upwork says it can warn, restrict, or permanently block accounts using unapproved automation. For that reason `proposal fill` and `proposal submit` refuse to run until you turn them on for your own installation:

```bash
upwork-cli setup --enable-live-proposals
```

Turn them off with `--disable-live-proposals`. The choice is yours and so is the account risk. Discovery commands also drive your browser, so keep pulls small and spaced out either way. When enabled, a submit also ticks Upwork’s policy acknowledgement dialog as part of the approved submission.

```text
DRAFT → REVIEWED → FILLED → READY → SUBMITTED
                    ↘ BLOCKED
                    ↘ MANUAL_CONTROL
```

After approval, `proposal fill application.json` makes one guarded live attempt and verifies the form. Keep the READY form open and unchanged. Submission uses the exact approval phrase emitted by review and the separate live Connects confirmation. Run `upwork-cli proposal submit --help` for the required arguments. Never generate approval on the user’s behalf.

Any content or terms change invalidates approval. A successful submission is terminal. A failed live action becomes BLOCKED and must not be retried automatically. Follow the stored `nextAction` returned by `proposal status`.

For manual takeover, run `proposal handoff application.json` first. Use `proposal resume application.json` only when the user returns control. If they submitted manually, reconcile with `proposal record-submitted --help`; do not replay the application to find out what happened.

## Your data stays local

| Location | Contents |
| --- | --- |
| `~/.upwork-cli/config.json` | Browser, country, ranking, and search preferences |
| `~/.upwork-cli/profile.json` | Your private voice and evidence |
| `~/.upwork-cli/chrome-profile/` | Dedicated signed-in Chrome profile |
| `~/.upwork-cli/data/jobs.sqlite` | Job history and observations |
| `~/.upwork-cli/data/proposal-workflows.json` | Workflow state, checkpoints, and errors |
| `~/.upwork-cli/data/proposals.json` | Submission audit records |

Chrome stores its own session material. Keep the state directory private. Application exports and packets can contain your writing, client details, and rates. They are not safe to publish by default.

Use `UPWORK_CLI_HOME` for an isolated state directory. Additional overrides are `UPWORK_CLI_CONFIG`, `UPWORK_CLI_PROFILE`, `UPWORK_CLI_CHROME`, `UPWORK_CLI_PORT`, and `UPWORK_CLI_CDP_TIMEOUT_MS`. Set a distinct browser port as well when running separate sessions.

## Troubleshooting

| Symptom | Next step |
| --- | --- |
| Chrome executable missing | Install Chrome or set `UPWORK_CLI_CHROME` to its executable |
| Login or verification required | Run `upwork-cli auth`, complete the step in its dedicated window, then run `doctor` |
| Your normal browser is signed in but the CLI is not | Sign in to the dedicated profile; do not copy cookies |
| No results on a repeated pull | Inspect `history runs`; try `--all` to include previously seen jobs |
| Unknown location eligibility | Set your country, inspect details, and read the live restriction |
| `proposal fill` says live automation is off | Submit it yourself and run `record-submitted`, or opt in with `setup --enable-live-proposals` |
| Proposal is BLOCKED | Read `proposal status` and perform only its required recovery step |
| Submission outcome uncertain | Check My Proposals manually and reconcile; do not submit again |
| READY checkpoint is stale | Stop and inspect status; do not refresh or refill automatically |

## Development

```bash
npm ci
npm test
node src/cli.mjs --help
npm run check:release
```

Run `upwork-cli doctor --offline` to check local readiness without connecting to Chrome. Invalid settings and numeric command options fail before browser work.

The tests run offline. They cover parsing, ranking, storage, proposal validation, browser ownership, and workflow state. An end-to-end CLI test exercises setup, diagnostics, import, cache, proposal review, and approval rejection using isolated state. They do not prove the live Upwork UI still matches every selector. Never test submissions using another person’s account or existing proposal state.

Use synthetic fixtures in tests. Do not commit profiles, browser sessions, job exports, proposal drafts, or private handoffs. See [CONTRIBUTING.md](CONTRIBUTING.md) for the release checks.

See [performance and verification](docs/performance.md) for the repeatable cache benchmark and validation scope.
