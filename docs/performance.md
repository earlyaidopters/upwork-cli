# Performance and verification

## Cache lookup

Hunts previously loaded and parsed the full job history to hydrate the jobs observed in the current pull. They now read only matching IDs through the SQLite primary key, in batches of 500. Memory and JSON parsing for that step scale with the observed jobs rather than the entire history.

Run `npm run benchmark:cache` to create an isolated 10,000-job database, warm both paths, and compare five samples for a 50-job lookup. It removes the temporary database afterward.

A local macOS run on Node v26.5.0 measured a 46.03 ms median for the full-cache read and 1.01 ms for the indexed read, a 45.7x difference for this specific step. Browser navigation still dominates most live hunts; this is not a claim that live searches are 45.7x faster. Results vary by machine and history size.

## Correctness and recovery

- Cached eligibility expires and is recomputed for the current country.
- Fresh unknown details replace an older confirmed result. Ordinary card refreshes preserve structured location data.
- Net-new counts are calculated inside the write transaction.
- Invalid configuration, profile fields, and numeric CLI options fail before browser work.
- Unknown eligibility is never labeled eligible. `--eligible-only` filters to inspected, confirmed results.
- Proposal review requires non-negative integer Connects. Missing live base Connects blocks live validation.
- Empty profiles supply no inherited evidence. Unmatched proof is omitted from packets.
- CSV exports neutralize formula-like text. Trace capture restricts hosts and redacts query parameters.

## What the checks prove

`npm test` covers unit regressions and an actual CLI lifecycle in a temporary state directory. The CLI test configures a member, runs offline diagnostics, imports a synthetic job, reads the cache, lints and reviews a synthetic application, and confirms submission without approval is rejected without changing state.

`npm run check:release` packs the project, checks the file allowlist and selected private-data patterns, verifies documentation links, installs the archive into a temporary directory, checks empty defaults, and runs installed setup and history commands. Pattern scans are a release check, not a guarantee that every possible kind of personal information can be detected.

CI runs these checks on Linux and macOS with Node 22 and 24. Live account authentication and paid submission are outside these offline checks. No live proposal or existing personal state is used for testing.
