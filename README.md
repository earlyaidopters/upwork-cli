# Upwork Job CLI

Find relevant work. Keep a history of what you have seen. Write proposals from your own evidence.

Built for the Early AI adopters community, this CLI brings Upwork search, local ranking, SQLite history, and proposal preparation into one terminal workflow. A dedicated Chrome profile handles your signed-in session. Your evidence profile supplies your experience and voice.

**Community edition, v0.11.0.** Offline tests and a clean package installation are verified. Browser automation depends on Upwork’s current pages and can stop when those pages change. Live submission has financial consequences; every proposal requires exact-content approval and a separate Connects confirmation.

[Get started](#get-started) · [Find work](#find-work) · [Write like yourself](#write-like-yourself) · [Proposal workflow](#proposal-workflow) · [Troubleshooting](#troubleshooting)

## What you get

| Capability | What it does |
| --- | --- |
| Search and hunts | Search one phrase or combine queries with duplicate jobs removed |
| Net-new results | Save every observation, then show jobs first seen in the current pull |
| Local ranking | Explain the keyword, budget, activity, and client signals behind a score |
| Eligibility inspection | Open job details to check location restrictions omitted from search cards |
| Persistent history | Keep jobs, sightings, and pull runs in local SQLite |
| Evidence packets | Pair exact screening questions with your relevant proof |
| Human writing guides | Build your voice profile, draft from evidence, and edit specific weak patterns |
| Guarded proposals | Review, fill, verify, and submit through durable workflow checkpoints |
| Portable exports | Export tables, JSON, JSONL, CSV, or Markdown |

The CLI does not generate prose by calling an AI model. Use the packet with your preferred assistant or write the application yourself. No model API key is needed.

## Get started

You need Node.js **22.5 or later**, npm, Google Chrome, and an Upwork freelancer account. Chrome discovery includes macOS, Windows, and Linux paths; live behavior must be checked on your platform. The CLI uses Node’s built-in SQLite, which may print an experimental-feature warning on older supported Node versions.

Clone the repository and install locally:

```bash
git clone https://github.com/promptadvisers/upwork-jobs.git
cd upwork-jobs
npm ci
npm link
upwork-jobs init
upwork-jobs auth
upwork-jobs doctor
```

`npm link` installs the local command. You can skip it and run `node src/cli.mjs` instead of `upwork-jobs`.

`auth` opens a dedicated Chrome window. Sign in there and complete any verification yourself. The CLI attaches to that session through localhost. It never needs cookies copied from your everyday browser.

`init` creates private configuration and profile files. It leaves existing files intact. **`init --force` overwrites both files**, so use it only when you intend to reset them.

### Set your country and search preferences

Edit `~/.upwork-jobs/config.json`. Set `eligibility.freelancerCountry` to your actual country; the default is `null`. For example:

```json
{
  "eligibility": {
    "freelancerCountry": "Canada",
    "inspectTop": 25,
    "excludeIneligible": true
  }
}
```

Canada is an example, not an account setting. Keep the other generated fields or supply a partial config; defaults are merged when loaded. Change `ranking.priorityKeywords`, `ranking.negativeKeywords`, `ranking.minimumHourlyTarget`, and `presets` to fit the work you want.

The ranking model favors AI consulting, training, and implementation. Scores explain relative fit; they are not predictions of winning a job.

## Find work

Start with a small live pull:

```bash
upwork-jobs doctor
upwork-jobs hunt ai-trainers --pages 1 --sort recent --max-age-hours 168 --inspect-top 25
```

Other built-in presets are `ai-consulting` and `agentic-systems`. Supply your own phrases when you need a narrower hunt:

```bash
upwork-jobs hunt --queries "Claude Code,Claude Cowork,MCP server" --pages 1 --sort recent
upwork-jobs search "AI workshop" --pages 2 --sort recent --format markdown --output shortlist.md
upwork-jobs feed recent --batches 3 --max-age-hours 48
```

Results go to stdout; progress and run totals go to stderr. Use JSON when piping to another program:

```bash
upwork-jobs hunt ai-consulting --format json --output jobs.json
upwork-jobs history stats
upwork-jobs history runs --limit 10
upwork-jobs history trends --days 30
upwork-jobs history queries --days 30
```

### Why a second pull can show no jobs

Search, hunt, and feed save all observed jobs, including refreshed records. By default they output only jobs first seen in that pull. `--all` includes previously seen jobs. `cache` reads stored jobs without a live search.

```bash
upwork-jobs hunt ai-trainers --pages 1 --all
upwork-jobs cache --format csv --output cached-jobs.csv
```

Net-new describes the database comparison, not when the client published the job. Use recency filters as well.

### Read eligibility and client fields carefully

Only the highest-ranked `--inspect-top` candidates receive fresh full-detail inspection. Jobs outside that group can have unknown eligibility or older cached detail data. The normal filter removes confirmed incompatible jobs; unknown eligibility can still appear in discovery output.

For an actionable shortlist, require both a non-null `detailInspectedAt` and `eligibleForProfile === true`. Check the title and description for hard restrictions too. The parser recognizes standard platform location labels and selected explicit country restrictions; it cannot interpret every legal, residency, language, or regional requirement.

Missing payment or client-history data is not proof of a bad client. Check the live posting before deciding. `--include-ineligible` is for inspecting excluded records deliberately.

## Write like yourself

The starter profile has **no name, rate, biography, credentials, results, or proof links**. Add your own before drafting:

```bash
upwork-jobs proposal profile
upwork-jobs proposal playbook
```

These commands print the files to open. Follow the guides in order:

1. [Voice workbook](docs/voice-workbook.md): capture your vocabulary, cadence, and verified experience.
2. [Proposal writing](docs/proposal-writing.md): choose evidence, answer screening questions, and edit without flattening your voice.
3. [Assistant instructions](docs/agent-instructions.md): give your assistant the boundaries for discovery, drafting, review, and browser ownership.

The profile is private. Keep it out of Git and issue reports. The repository’s `profile.example.json` documents the empty starting structure.

## Proposal workflow

Replace `JOB_ID` below with the ID or URL of a job you selected. Read-only inspection can avoid opening the application form:

```bash
upwork-jobs proposal inspect JOB_ID --no-form
upwork-jobs proposal packet JOB_ID --no-form --output packet.md
```

When you deliberately start an application, capture its live terms and exact questions:

```bash
upwork-jobs proposal template JOB_ID --rate 100 --output application.json
```

The rate is an example, not a recommendation. Review every term. For fixed-price work, inspect the generated fixed price, payment mode, and duration. Write the cover letter and each answer without changing the question text.

```bash
upwork-jobs proposal lint application.json
upwork-jobs proposal validate application.json
upwork-jobs proposal review application.json
upwork-jobs proposal status application.json
```

`lint` reports specific writing patterns and excerpts. It does not verify achievements or detect who wrote the text. Resolve errors and assess warnings in context.

Before any live proposal action, show the user the complete final application: cover letter in one code block, each question followed by its answer in a separate code block, rate, base Connects, boost, and maximum total. State **NOT SUBMITTED** and wait for exact-content approval.

```text
DRAFT → REVIEWED → FILLED → READY → SUBMITTED
                    ↘ BLOCKED
                    ↘ MANUAL_CONTROL
```

After approval, `proposal fill application.json` makes one guarded live attempt and verifies the form. Keep the READY form open and unchanged. Submission uses the exact approval phrase emitted by review and the separate live Connects confirmation. Run `upwork-jobs proposal submit --help` for the required arguments. Never generate approval on the user’s behalf.

Any content or terms change invalidates approval. A successful submission is terminal. A failed live action becomes BLOCKED and must not be retried automatically. Follow the stored `nextAction` returned by `proposal status`.

For manual takeover, run `proposal handoff application.json` first. Use `proposal resume application.json` only when the user returns control. If they submitted manually, reconcile with `proposal record-submitted --help`; do not replay the application to find out what happened.

## Your data stays local

| Location | Contents |
| --- | --- |
| `~/.upwork-jobs/config.json` | Browser, country, ranking, and search preferences |
| `~/.upwork-jobs/profile.json` | Your private voice and evidence |
| `~/.upwork-jobs/chrome-profile/` | Dedicated signed-in Chrome profile |
| `~/.upwork-jobs/data/jobs.sqlite` | Job history and observations |
| `~/.upwork-jobs/data/proposal-workflows.json` | Workflow state, checkpoints, and errors |
| `~/.upwork-jobs/data/proposals.json` | Submission audit records |

Chrome stores its own session material. Keep the state directory private. Application exports and packets can contain your writing, client details, and rates. They are not safe to publish by default.

Use `UPWORK_JOBS_HOME` for an isolated state directory. Additional overrides are `UPWORK_JOBS_CONFIG`, `UPWORK_JOBS_PROFILE`, `UPWORK_JOBS_CHROME`, `UPWORK_JOBS_PORT`, and `UPWORK_JOBS_CDP_TIMEOUT_MS`. Set a distinct browser port as well when running separate sessions.

The optional `trace` diagnostic excludes headers, cookies, request variables, and response bodies. It can still contain URLs and search terms. Review diagnostic files before sharing them.

## Troubleshooting

| Symptom | Next step |
| --- | --- |
| Chrome executable missing | Install Chrome or set `UPWORK_JOBS_CHROME` to its executable |
| Login or verification required | Run `upwork-jobs auth`, complete the step in its dedicated window, then run `doctor` |
| Your normal browser is signed in but the CLI is not | Sign in to the dedicated profile; do not copy cookies |
| No results on a repeated pull | Inspect `history runs`; try `--all` to include previously seen jobs |
| Unknown location eligibility | Set your country, inspect details, and read the live restriction |
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

The tests run offline. They cover parsing, ranking, storage, proposal validation, browser ownership, and workflow state. They do not prove the live Upwork UI still matches every selector. Never test submissions using another person’s account or existing proposal state.

Use synthetic fixtures in tests. Do not commit profiles, browser sessions, job exports, proposal drafts, or private handoffs. See [CONTRIBUTING.md](CONTRIBUTING.md) for the release checks.
