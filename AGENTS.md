# Community CLI development

## Public repository

This repository is public. Everything committed here is world-visible, so never commit personal data, real job exports, proposal drafts, profiles, browser sessions, or local databases. Use synthetic fixtures only.

Keep `private: true` in package.json so npm publication stays a deliberate owner decision. Do not publish to npm, cut public releases, or change repository settings without the owner's explicit approval for that action.

## Community usability

Prefer guided setup, plain-language errors, and documented recovery steps. Preserve existing user configuration and evidence when improving onboarding. Default profiles must contain no inherited name, rate, credentials, clients, results, or proof links.

Do not read or change another local installation's live state to test this project. Run tests with temporary state directories. Test parser and proposal changes with synthetic fixtures. Run `npm test` and `npm run check:release` before pushing implementation changes.

## Proposals

Discovery is read-only. Live proposal filling and submission are opt-in through `proposals.liveAutomation` (default false); never enable it on a user's behalf, and never weaken or bypass that gate. When it is off, end at `proposal review` so the user pastes and submits. Proposal submission requires approval for the exact final content plus separate live Connects confirmation. Preserve workflow states, fingerprints, browser ownership, and terminal submission records. Never retry a blocked live action automatically.
