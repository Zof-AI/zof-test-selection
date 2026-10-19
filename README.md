# @zof-ai/test-selection

Select likely relevant tests using local static dependencies from `@zof-ai/change-impact`. Reports explain every selection, conservative fallback and override. No tests or source code are executed, and no data leaves the machine.

Version 0.1.0 is prepared under the Apache-2.0 license. Use the GitHub source installation below; npm registry publication is not claimed.

<!-- ZOF_RELEASE_INSTALL_START -->
## Install from GitHub source

Requires Node.js 22 or 24, npm, and Git. Filesystem operations require Linux or macOS with Python 3.10 or newer; Windows file operations fail closed. Clone this repository and explicitly prepare its reviewed release dependencies:

```sh
git clone https://github.com/Zof-AI/zof-test-selection.git
cd zof-test-selection
node scripts/bootstrap.mjs --allow-network
npm ci --ignore-scripts --prefer-offline
npm run build
npm test
```

The bootstrap downloads only the exact `v0.1.0` dependency assets from [GitHub Releases](https://github.com/Zof-AI/zof-test-selection/releases), as listed in `scripts/release-dependencies.json`, verifies SHA256 and byte size, and adds them to the npm cache. It does not extract archives, run package scripts, collect application data, or send credentials. Downloads require the explicit flag and follow only HTTPS GitHub asset redirects. Installation then fetches ordinary third-party dependencies from npm. Use a writable npm cache; set `npm_config_cache` consistently for both commands if needed. An unavailable asset, changed hash, or oversized response stops installation.

GitHub source and release artifacts are the initial distribution channel. These instructions do not claim that `@zof-ai` packages are published on npm or that the VS Code extension is listed in Marketplace.
<!-- ZOF_RELEASE_INSTALL_END -->

## Install and run

Use Node.js 22 or 24. Git is required only for revision analysis. After the source installation above:

```sh
npm ci --ignore-scripts
npm run build
node dist/cli.js --root examples/local --changed src/math.ts --json
```

The report selects `tests/math.test.ts` and omits `tests/other.test.ts`. The package identifier is `@zof-ai/test-selection`; the executable name is `zof-test-selection`.

## Three examples

```sh
# Known relationship: one selected test with a static-dependency reason.
node dist/cli.js --root examples/local --changed src/math.ts --list
# Manual full-suite override: JSON says runFullSuite=true.
node dist/cli.js --root examples/local --changed src/math.ts --full-suite --json
# Unknown computed import: default conservative fallback to the runner's full suite.
node dist/cli.js --root examples/uncertain --changed loader.ts --json
```

Use `--base HEAD~1 --head HEAD` for a clean revision comparison, or omit revisions to compare `HEAD` against the working tree. Repeat `--changed FILE` to bypass Git and `--exclude GLOB` to configure exclusions. Git subprocesses never use a shell, external diff, textconv, hooks or filesystem monitors.

## API and CI decisions

```js
import { selectTests, formatReport } from '@zof-ai/test-selection';
const report = await selectTests({
  root: '/absolute/path/to/synthetic-repo',
  changedFiles: ['src/math.ts'],
  fallback: 'full'
});
console.log(formatReport(report));
```

`test-selection/v1` reports contain `mode`, `runFullSuite`, `discoveryComplete`, `selectedTests`, `omittedTests`, per-test `reasons`, `fallbackReasons`, `changedFiles`, `confidence`, `limitations`, and `verificationResult: "not-run"`.

For `mode: "selected"`, pass the JSON list as individual arguments to a trusted test runner. Never `eval` a report or interpolate filenames into shell commands. For `mode: "full"`, run the runner **without selection filters**. The discovered list is informational; frameworks may define additional tests. For `mode: "blocked"`, stop or explicitly choose the full suite. No report implies verification passed.

The default fallback is `full`. `--fallback error` produces blocked mode when dependency analysis is incomplete, no tests are discovered, or any changed file lacks a known test relationship. `--full-suite` overrides selection and strict fallback. `--list` refuses full or blocked mode so an incomplete discovered list cannot silently substitute for a full suite.

Exit codes: `0` report generated, `2` input or operational error, `3` blocked selection or refused list mode. Always inspect `mode` in JSON; exit 0 can request a full suite.

## Optional coverage map

Provide `coverageMap` in the API or `--coverage-map relative/file.json` inside the explicit root:

```json
{"schemaVersion":"coverage-map/v1","tests":{"tests/math.test.ts":["src/math.ts"]}}
```

A map may name nonconventional test files if they exist inside the scanned root. Coverage only adds relationships. It never suppresses static edges or clears analysis uncertainty. Coverage may be stale, so it cannot establish complete regression coverage. Maps are limited to 1 MiB from disk, 5,000 tests and 50,000 relationships. Paths must be safe repository-relative paths; invalid or missing test references fail explicitly. [Example map](examples/coverage-map.json) documents the format.

## Limitations and security

Static imports cannot represent every runtime dependency. Unknown dynamic imports, unsupported changes, aliases, removed files, excluded changes, bounded scans and Python lexical analysis request conservative fallback. Test discovery recognizes conventional `tests/`, `__tests__/`, `.test.*`, `.spec.*`, `test_*.py` and `*_test.py` paths. Empty changes select none unless a full-suite override is used; empty or missing test relationships on actual changes request a full suite.

The underlying impact analyzer bounds file size/count, total source bytes, traversal depth and Git output. Symbolic links, unsafe paths, archives and URLs are not read as coverage maps. Errors omit source content; reports omit environment variables, application logs and source snippets. Shared evidence redaction removes recognizable credentials and sensitive URLs. Do not embed secrets in paths or test names; no redactor recognizes every possible secret. Directory descriptors prevent path replacement from granting access outside the selected root. File contents may still change during capture.

## Validation and release

```sh
npm test
npm pack --ignore-scripts
```

Tests use synthetic Git repositories, known and unrelated tests, missing relationships, dynamic imports, overrides, coverage maps, traversal, symlinks, excessive inputs, redaction, CLI fallback behavior, and a clean tarball installation with explicit candidate dependencies. Registry publication and live registry installation are not claimed. Linux/macOS workflows are configured; only completed runs verify platform behavior. See [security policy](SECURITY.md) and [release procedure](docs/RELEASE.md).

## Filesystem and Git boundaries

Filesystem operations use bounded, directory-relative descriptors on Linux/macOS with Python 3.10 or newer. Symlinks, hard-linked inputs, special files and traversal are rejected. Open descriptors remain attached to the original directory when names change. File contents can still change during a read or snapshot; this is not an atomic filesystem snapshot. Windows filesystem operations fail closed; in-memory JSON validation and analysis do not require the file helper. Git reads use a private bounded snapshot: 256 MiB total, 32 MiB per source/object file, 50,000 entries and 64 directory levels. Repository hooks/configuration are not used; local `.git/info/exclude` and `.git/info/attributes` are preserved. External Git metadata, object alternates, grafts, sparse-checkout metadata, linked worktrees and submodules are unsupported. Limits and unsupported metadata cause an explicit error or incomplete result.
