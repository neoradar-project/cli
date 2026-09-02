# CLAUDE.md

## The NeoRadar constellation

Five repos, developed together. Cross-repo references use `@id` tokens, never paths:
`@client` (C# radar client), `@server` (Go compute tier), `@hub` (JS management dashboard),
`@cli` (JS package and dataset build pipeline), `@schemas` (shared JSON Schemas). Data ids:
`@packages` (built packages), `@sectorsrc` (CLI source sector files), `@data` (runtime data root).

Resolve an id in this order: the `NEORADAR_<ID>_DIR` env var; then `neoradar.repos.local.json`
at this repo root (gitignored, per-machine); then an upward scan using the `defaultSubpaths` in
`neoradar.repos.json`. If an id does not resolve, say so and work from this repo alone. Never
guess a path. A sibling repo is normally ABSENT in CI, which is the expected case, not an error.

These pairs move in LOCKSTEP. A one-sided edit is a break, not a cleanup:
- `@server/internal/contract/` and `@client/src/NeoRadar.Core/ServerLink/Contract/`
- `@server/internal/contract/testdata/*.json` and `@client/tests/NeoRadar.Core.Tests/ServerLink/Vectors/*.json`

Stance: alpha. Do not write backwards-compatibility or fallback layers unless asked, especially
in ServerLink. Document any process change and how it rolls out to other sector files. The
infrastructure serves thousands of users, so handle failure paths and never swallow an error.
Never add `Co-Authored-By` or any AI attribution to a commit or PR.

This block is identical in all five repos. Editing one copy alone is a break.

---

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

The packaged nse.json carries only `position` and `mapItemsIndex`. `src/helper/nse.ts`
scrubs `RETIRED_SECTIONS` (`vor`, `ndb`, `fix`, `airport`, `runway`) on every write:
`updateNSE` merges into pre-existing nse.json files, so a re-convert of an old package
drops the retired sections too. The client's local route parser is gone; navaids reach
the server via server-dataset.json instead.

`procedure` is also no longer written into the packaged nse: `src/commands/converter/ese.ts`
deliberately skips it so the client receives procedures over the config channel and an
AIRAC turnover does not need a package release. `eseProcessedData.procedure` still feeds
`emitServerDataset`.

Same split on the ATC data: `writeAtcData` strips `copx` from the packaged
`datasets/atc-data.json` (coordination is computed server-side and nothing in the client
reads it), while `emitServerDataset` receives the full object including `copx`.

## Licensed databases are never packaged

`build-airways` compiles `airway.txt` + `isec.txt` into airways.db: Navigraph-derived,
licensed, server-only. Its default output is `<navDataPath>/server-artifacts/airways.db`,
deliberately outside any package. navdata.db is the same class of file.

`src/helper/publish/file-scanner.ts` is the guard, and it detects two ways: the filename
(`airways.db` / `navdata.db` plus their `-wal`/`-shm`/`-journal` sidecars, which hold live
database pages) and the SQLite header, so a renamed database is still caught.

Both `convert` and `distribute` call `assertNoLicensedArtifacts(<env>/package, ...)` before
doing any work and **refuse the run** (message + `process.exitCode = 1`) if the package folder
holds one. The `distribute` copy loop and `processAllFiles` still filter licensed files as a
second line of defence. Refusal, not a warning: the earlier warn-and-drop behaviour let two
locally built zips ship a 40 MB airways.db.

## The full pipeline: sector source to client package + server dataset

One `convert` run produces two independent outputs from the same parse. Nothing is
shared between them at runtime: the package is a public download, the dataset artifact
is an operator upload.

```
sector_files/*.sct2 + *.ese      ASRs/*.asr      symbols/*.png      atc-data source
        |                            |                 |                  |
        v                            v                 v                  v
  eseParser + sctParser        asr -> STP        atlas-generator     atc-data-parser
  (sector-file-tools)          profiles          (free-tex-packer)   (ESE sectors,
        |                            |                 |              positions, copx)
        |                            |                 |                  |
        +------------ package/datasets/*.geojson -------+                  |
        |            package/datasets/nse.json                             |
        |              (position + mapItemsIndex only)                     |
        |            package/datasets/atc-data.json  <---- minus copx -----+
        |            package/profiles/*.stp, package/images/atlas          |
        |            package/manifest.json (layers + mapItemsIndex)        |
        |                                                                  |
        |                          indexer (writes mapItemsIndex,          |
        |                           updates manifest layer list)           |
        v                                                                  v
  neoradar-cli distribute                                    emitServerDataset ->
  -> dist/<pkg>.zip + files/ delta tree                      <envRoot>/server-dataset.json
  -> manifest.json (ProviderManifest, schemaVersion 1.0.0)    (envelope: format,
  -> uploadToS3 (S3 or Cloudflare R2) when --publish            formatVersion 1, namespace,
  -> purgeCloudflareCache                                       packageVersion, generator,
        |                                                       generatedAt, atcDataSha256,
        v                                                       nseSha256, atcData, nse
  NeoRadar desktop client                                       {position, procedure, vor,
  (PackageProviderSettings -> manifest.json -> zip/delta)        ndb, fix, airport})
                                                                       |
                                                                       v
                                                      neoradar-hub /<vacc>/datasets page
                                                      (checkDatasetArtifact pre-flight,
                                                       then POST via the /api/panel BFF)
                                                                       |
                                                                       v
                                              neoradar-server: stage -> diff -> publish
                                              (POST /v1/panel/{vacc}/datasets,
                                               GET  .../datasets/staged,
                                               POST .../versions, .../versions/rollback)
                                                                       |
                                                                       v
                                              connected clients over the ServerLink
                                              config channel (procedures, routes,
                                              squawk allocation, 4D prediction)
```

Licensed data never enters either output. `build-airways` writes airways.db to
`<navDataPath>/server-artifacts/`, outside any package; open-navdata.db is uploaded
straight to the server through the hub's `/admin/navdata` page. Both are excluded
defensively from `distribute` (see the section above), and the AIRAC / navdata versions
a vAcc is pinned to are hub-managed (`/admin/airac`, `/admin/navdata`,
`/{vacc}/airac`, `/{vacc}/navdata`), not CLI-managed.

### Where the schemas repo fits

The JSON Schemas at `@schemas` (`package/manifest.schema.json`,
`profile.schema.json`, `systems/{expressions,labels,lists,mapstyle,targets}.schema.json`)
describe the package and system files this CLI writes and the desktop client reads.
**The CLI does not currently consume them.** `init-package` and the converters write
those files from hand-rolled TypeScript types in `src/definitions/`, and nothing
validates the result. `ajv` is a declared dependency but has no import anywhere in
`src/`, so it looks like the intended validator was never wired up. Treat the schemas as
editor tooling and documentation until someone closes that loop.

## Build / test

The repo is pnpm-managed (`packageManager: pnpm@10.0.0`). `npm run` also works for the
scripts, or invoke the tools directly:

```bash
pnpm build      # node scripts/get-version.js (regenerates src/version.json) + tsc
pnpm typecheck  # tsc -p tsconfig.test.json --noEmit (covers src/ and test/)
pnpm test       # tsc -p tsconfig.test.json && node --test "dist-test/test/*.test.js"
```

Direct equivalent when the scripts are unavailable: `./node_modules/.bin/tsc` (build) and
`./node_modules/.bin/tsc -p tsconfig.test.json && node --test "dist-test/test/*.test.js"`.
Tests are `node:test` files in `test/`, compiled to `dist-test/` first; the glob means a
new `test/*.test.ts` is picked up without editing package.json.

`dist/` is TRACKED in git; after changing `src/`, rebuild so `dist/` matches, and commit
both. CI enforces this (`.github/workflows/ci.yml`) with a `git diff --exit-code` over
`dist/`, excluding `dist/version.json` whose `buildTime` changes on every build.
