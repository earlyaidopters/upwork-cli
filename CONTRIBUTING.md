# Contributing

Use Node.js 22.5 or later. Run `npm ci` and `npm test` before opening a change. Keep tests offline and use synthetic people, jobs, URLs, and evidence.

For parser fixes, add the smallest fixture that reproduces the issue plus a nearby case that should remain unchanged. For proposal changes, preserve exact-content fingerprints, separate Connects confirmation, terminal submission records, and browser ownership. Never weaken a gate to make a failing test pass.

Describe the concrete behavior that changes, why it matters, and how you verified it. Include operating system and Node version for browser issues. Remove personal data from logs before sharing them. Do not upload browser profiles, cookies, raw network payloads, application files, or local databases.

Release checks must cover offline tests, a clean isolated installation, the npm archive contents, privacy scanning, documentation links, and command examples. Live browser claims need separately documented live evidence. Do not represent unit tests as live submission verification.

## Private release policy

The repository stays private and package.json sets `private: true` to block npm publication. This does not prevent local packing or installation. Prepare future GitHub releases as drafts. Changing visibility, publishing to npm, or distributing files publicly requires explicit owner approval. Tests and CI do not grant that approval.
