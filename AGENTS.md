# Community CLI development

## Private by default

Keep this repository private. Do not change repository visibility, publish to npm, create public mirrors, deploy public documentation, or distribute release assets publicly without the owner's explicit approval for that action. A request to improve the community version is not permission to make it public.

Keep `private: true` in package.json. Local npm packing and installation are allowed. Use draft releases when preparing future releases unless publication is explicitly requested.

## Community usability

Prefer guided setup, plain-language errors, and documented recovery steps. Preserve existing user configuration and evidence when improving onboarding. Default profiles must contain no inherited name, rate, credentials, clients, results, or proof links.

Do not read or change another local installation's live state to test this project. Run tests with temporary state directories. Test parser and proposal changes with synthetic fixtures. Run `npm test` and `npm run check:release` before pushing implementation changes.

## Proposals

Discovery is read-only. Proposal submission requires approval for the exact final content plus separate live Connects confirmation. Preserve workflow states, fingerprints, browser ownership, and terminal submission records. Never retry a blocked live action automatically.
