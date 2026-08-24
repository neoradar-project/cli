# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

`neoradar-cli` is the package authoring tool for NeoRadar: it converts EuroScope sector
sources (SCT2/ESE, ASR profiles, TopSky maps, symbol PNGs) into the client's package
format, indexes GeoJSON features, zips packages for distribution, and builds the
server-only artifacts. Node/TypeScript (commonjs), commander-based; commands live in
`src/commands/`, shared helpers in `src/helper/`. Commands: `init`, `convert`,
`topsky-convert`, `index`, `distribute`, `create-plugin-archives`, `generate-symbols`,
`build-airways`.

## The convert pipeline

`convert <packagePath>` (in `src/commands/convert.ts`) works on a package environment
directory: it finds SCT2 + ESE under `sector_files/`, parses them into GeoJSON datasets
plus the NSE `position`/`procedure` sections under `package/datasets/`, converts `ASRs/`
to STP profiles (unless `--skip-profiles`), generates the symbol texture atlas from
`symbols/`, parses `atc-data`, runs the indexer (which writes `mapItemsIndex` into
nse.json and updates the manifest), and finally emits `server-dataset.json`. It is
override-heavy and asks for confirmation first; the confirmation text is the contract for
what it will and will not touch.

## server-dataset.json (spec ruling P6)

`src/helper/server-dataset.ts` emits the raw-importer-inputs artifact the panel stages:
envelope `{format: "neoradar-server-dataset", formatVersion: 1, namespace,
packageVersion, generator, generatedAt, atcDataSha256, nseSha256, atcData, nse}` where
`nse` carries the six server sections (`position`, `procedure`, `vor`, `ndb`, `fix`,
`airport`; the navaid sections stripped from the packaged nse.json live on here). The
sha256 fields are computed over the pre-stringified section JSON and those exact bytes
are spliced verbatim into the artifact (no canonicalization drift between hash and
embed; the server verifies hash-over-embedded-bytes). It lands NEXT TO `package/` in
the package environment root, never inside `package/` or `datasets/`: server-only, must
not ship in the package.

## nse.json slim rule

The packaged nse.json carries only the client-live sections: `position`, `procedure`,
`mapItemsIndex`. `src/helper/nse.ts` scrubs `RETIRED_SECTIONS` (`vor`, `ndb`, `fix`,
`airport`, `runway`) on every write: `updateNSE` merges into pre-existing nse.json
files, so a re-convert of an old package drops the retired sections too. The client's
local route parser is gone; navaids reach the server via server-dataset.json instead.

## airways.db is never packaged

`build-airways` compiles `airway.txt` + `isec.txt` into airways.db: Navigraph-derived,
licensed, server-only (server-link addendum D44/A§11). Its default output is
`<navDataPath>/server-artifacts/airways.db`, deliberately outside any package.
`distribute` additionally excludes it defensively: `LICENSED_ARTIFACT_EXCLUDE_PATTERNS`
in `src/helper/publish/file-scanner.ts` matches `airways.db` plus its SQLite
`-wal`/`-shm`/`-journal` sidecars (which hold live database pages) anywhere in the
package tree, logging each exclusion.

## Build / test

The repo is pnpm-managed but pnpm is not on PATH here; `npm run` works, or invoke the
tools directly:

```bash
npm run build   # node scripts/get-version.js (regenerates src/version.json) + tsc
npm test        # tsc -p tsconfig.test.json && node --test dist-test/test/build-airways.test.js \
                #   dist-test/test/file-scanner.test.js dist-test/test/server-dataset.test.js
```

Direct equivalent when npm scripts are unavailable: `./node_modules/.bin/tsc` (build) and
`./node_modules/.bin/tsc -p tsconfig.test.json && node --test dist-test/test/...` (test).
Tests are `node:test` files in `test/`, compiled to `dist-test/` first. `dist/` is
TRACKED in git; after changing `src/`, rebuild so `dist/` matches, and commit both.
