# CLAUDE.md

## The NeoRadar constellation

Six repos, developed together. Cross-repo references use `@id` tokens, never paths:
`@client` (C# radar client), `@server` (Go compute tier), `@hub` (JS management dashboard),
`@cli` (JS package and dataset build pipeline), `@schemas` (shared JSON Schemas), `@pluginsdk` (C#
plugin SDK, vendored into `@client` at `extern/NeoRadar.PluginSdk`). Data ids:
`@packages` (built packages), `@sectorsrc` (CLI source sector files), `@data` (runtime data root).

Resolve an id in this order: the `NEORADAR_<ID>_DIR` env var; then `neoradar.repos.local.json`
at this repo root (gitignored, per-machine); then an upward scan using the `defaultSubpaths` in
`neoradar.repos.json`. If an id does not resolve, say so and work from this repo alone. Never
guess a path. A sibling repo is normally ABSENT in CI, which is the expected case, not an error.

These pairs move in LOCKSTEP. A one-sided edit is a break, not a cleanup:
- `@server/internal/contract/` and `@client/src/NeoRadar.Core/ServerLink/Contract/`
- `@server/internal/contract/testdata/*.json` and `@client/tests/NeoRadar.Core.Tests/ServerLink/Vectors/*.json`
- `@server/internal/contract/vocabulary.json` and `@client/tests/NeoRadar.Core.Tests/ServerLink/vocabulary.json`

Stance: alpha. Do not write backwards-compatibility or fallback layers unless asked, especially
in ServerLink. Document any process change and how it rolls out to other sector files. The
infrastructure serves thousands of users, so handle failure paths and never swallow an error.
Never add `Co-Authored-By` or any AI attribution to a commit or PR.

This block is identical in all six repos. Editing one copy alone is a break.

---

Guidance for Claude Code when working in this repository.

## What this is

`neoradar-cli` is the package authoring tool for NeoRadar: it converts EuroScope sector
sources (SCT2/ESE, ASR profiles, TopSky data files, symbol PNGs) into the client's package
format, indexes GeoJSON features, zips packages for distribution, and builds the
server-only artifacts. Node/TypeScript (commonjs), commander-based; commands live in
`src/commands/`, shared helpers in `src/helper/`. Commands: `init`, `convert`,
`topsky-convert`, `index`, `distribute`, `migrate-labels`, `create-plugin-archives`,
`generate-symbols`, `build-airways`.

## The convert pipeline

`convert <packagePath>` (in `src/commands/convert.ts`) works on a package environment
directory: it finds SCT2 + ESE under `sector_files/`, parses them into GeoJSON datasets
plus the NSE `position`/`procedure` sections under `package/datasets/`, converts `ASRs/`
to STP profiles (unless `--skip-profiles`), generates the symbol texture atlas from
`symbols/`, parses `atc-data`, runs the TopSky pipeline over `topsky/` when that folder exists,
runs the indexer (which writes `mapItemsIndex` into
nse.json and updates the manifest), and finally emits `server-dataset.json`. It is
override-heavy and asks for confirmation first; the confirmation text is the contract for
what it will and will not touch.

## ESE parsing: the `Only ...` blocks, DISPLAY, and the per-flight filters

`EseHelper` drops `SECTOR:Only ...` and `SECTORLINE:Only ...` blocks for non-GNG files
(`config.json`'s `sectorFileFromGNG`). Dropping the header is not enough: the block's own
`OWNER:` / `BORDER:` / `ARRAPT:` / `DEPAPT:` / `ACTIVE:` / `COORD:` lines still follow it in the
stream, and the handlers write straight onto `context.currentSector` / `currentSectorLine`. Both
skips used to `return` without moving those, so a skipped block's fields landed on the PREVIOUS
one. `handleOwner` assigns, so the owner chain was replaced outright; `handleCoord` pushes, so a
skipped sectorline's points would have extended the previous ring. Both now park the strays on a
scratch object that never reaches the result (`ese-only-sector-bleed.test.ts`).

That bug refiled 35 volumes of the UK file under the wrong sector, because
`atc-data-parser.ts` groups volumes by `owners[0]`. `LFAPP CTA-7 (DB-45)` sits immediately before
five `Only LL*` blocks and took `Only LLAPP`'s `OWNER:LLN:...`, so a Farnborough CTA volume was
published as Heathrow North Approach's and handed Farnborough's airspace to whoever held LLN.

**`DISPLAY` is edge-scoped, not sector-scoped.** A `DISPLAY:<A>:<B>:<C>` line sits inside a
`SECTORLINE` / `CIRCLE_SECTORLINE` block and belongs to that one edge: the manual highlights the
edge when the local controller covers sector `A` and sectors `B` and `C` have different owners.
`handleDisplay` pushes `{ownedVolume: A, compareVolumes: [B, C]}` onto
`context.currentSectorLine.displaySectorLines`, and `createBorderLines` emits it as
`borderLines[id].displaySectorLines` - the same field `DISPLAY_SECTORLINE` writes. A `DISPLAY` with
no enclosing sectorline, whether outside any block or under a skipped `Only ...` one, is logged and
dropped rather than attached elsewhere. **Volumes carry no display rules**; there is no
`Volume.displaySectorLines` and no `Sector.displaySectorLines`. Before this the rule was attached to
a SECTOR of the same NAME as the sectorline, which kept 373 of the UK file's 2869 rules, all at volume
level, and the client then drew every edge of that volume; the rebuilt UK package carries 2553 rules
on 833 of its 999 border lines. Rollout: every sector file must be re-converted before its border
lines carry the rules, and the client needs no change because it already reads them off the border
lines (`ese-display-edge-scope.test.ts`).

**`DEPAPT`/`ARRAPT`/`GUEST` are per-flight filters and are emitted PER VOLUME.** Each volume
carries `departureAirports`, `arrivalAirports` (the block's own lists, `[]` when absent) and
`guests` (`{position, departureAirport, arrivalAirport}`, a `*` parsed as `null`). The semantics
both consumers implement: a volume applies to a flight when both lists are empty, or its origin is
in `departureAirports`, or its destination is in `arrivalAirports`; a `GUEST` entry marks an
aircraft tracked by that position with matching airports as that position's traffic inside the
volume. 305 of the UK file's SECTOR blocks carry an airport filter and 518 lines carry a `GUEST`.
The sector-level union alone was lossy - 35 sectors mix filtered and unfiltered volumes, and a
consumer reading it could not tell which. LLN is the worked example: both its volumes carry
`ARRAPT:EGLL:EGWU`, so a 6000 ft EGJJ to EGLC crossing the estuary is out of scope for Heathrow
North however deep into `LLNTH_W` it flies. The sector-level
`activeAirports` / `departureAirports` / `arrivalAirports` unions stay as they are: they drive
airport ACTIVATION, not filtering. The EuroScope manual documents `DEPAPT`/`ARRAPT` only as airport
activation; the UK file and EuroScope's own behaviour are the authority here, not the manual's
wording. Rollout: re-convert every sector file; volumes in an older package carry none of the three
fields (`ese-flight-filters.test.ts`). Known blocker: the LFXX rebuild is skipped because its
`airways.db` sits inside `package/` and `convert` refuses the run (see Licensed databases below);
move the file out before re-converting.

**Placeholder sectors survive into the dataset.** A `SECTOR:<name>:0:0` block with no border (UK:
`London TC SW`, `London TC LAM`, 178 of 747 volumes) is a name the COPX `FROM`/`TO` columns refer
to, not airspace. It is emitted as a volume with `floor == ceiling`, which both consumers treat as
a placeholder that never wins containment, and `@server` import-vacc turns it into an alias of the
owning sector so those COPX rows resolve (UK COP resolution went from 17% to 100% on that alone).
Dropping zero-band volumes here would silently break coordination levels.

## The [RADAR] section becomes datasets/radars.json

`src/helper/radars.ts` (`RadarSectionParser`, driven from `EseHelper.handleLine`'s `RADAR` case)
reads EuroScope's `RADAR2:<name>:<lat>:<lon>:` plus three `range:antenna:cone` triples (primary,
secondary, Mode S; an empty range means that sensor is absent) and the `HOLE:<P floor>:<S floor>:<C
floor>` blocks whose `COORD` lines follow them: inside the polygon a sensor kind with a floor has no
coverage below it. `src/commands/converter/ese.ts` writes `package/datasets/radars.json` (schema
`@schemas/datasets/radars.schema.json`, vertices `[latitude, longitude]` degrees) only when the
section has at least one station. **The file's presence turns the client's coverage simulation on
for every controller loading the package**: out of every sensor's reach a target draws nothing.
Rollout: any sector file with a `[RADAR]` section gets it on its next `convert`; the UK file yields
49 stations and 29 holes, the first being no primary return below 500 ft over the whole country. A
file left behind by an ESE that has since lost the section is reported, not deleted
(`ese-radars.test.ts`).

## The TopSky pipeline: topsky/ becomes datasets

`src/commands/converter/topsky/` turns a vAcc's TopSky DATA files into package datasets. The spec
is `@client` `docs/roadmap/safety-nets-plan.md` § 9.4, and § 9.7 there says which client code
reads each output. Two entry points, one pipeline (`runTopSkyPipeline`): `topsky-convert
<packagePath> [--only maps,msaw,areas,stca,radars] [--timezone <IANA>]` runs it alone and touches
nothing else; `convert` runs it after the ESE step and BEFORE the indexer, and skips it quietly
when `topsky/` is absent, as it does for `ASRs/`.

`<packageEnvironment>/topsky/` holds verbatim copies of the vAcc's files (the UK's come from the
`TopSky_NERC` profile). **They are never edited here**: an error in one is warned about and
reported upstream, which is the whole rollout argument. Dispatch is by file NAME, case
insensitive (`KNOWN_FILES` in `index.ts`):

| File | Module | Writes |
|---|---|---|
| `TopSkyMaps.txt`, `TopSkyMapsLocal.txt` | `topsky-maps.ts` | `datasets/<folder>.geojson` per map `FOLDER`, a `/` in the name flattened to ` - ` |
| `TopSkyMSAW.txt` | `topsky-msaw.ts` | `datasets/msaw.geojson` |
| `TopSkyAreas.txt` | `topsky-areas.ts` | `datasets/areas.geojson` |
| `TopSkySTCA.txt` | `topsky-stca.ts` | `datasets/stca-runways.json`, only when the file exists |
| `TopSkyRadars.txt` | `topsky-radars.ts` | a `rawVideo` block on the matching station of `datasets/radars.json` |
| `TopSkyAirspace.txt`, `TopSkySettings.txt`, `TopSkySettingsLocal.txt` | none | nothing; recognised and skipped |
| `TopSkyAreasManualAct.txt` | none | REFUSES the stage and sets exit code 1 |
| any other `.txt` | none | one warning naming it |

The shared modules: `topsky-lexer.ts` reads every file (a `//` comment only at line start or after
whitespace, so URLs survive; blocks grouped by header keyword; line numbers kept for warnings).
`topsky-coords.ts` reads sexagesimal AND decimal degrees and projects through `@turf/projection`;
`geoHelper.convertESEGeoCoordinatesToCartesian` reads sexagesimal only and returned null for 171
of the UK's MSAW polygons. `topsky-active.ts` is the `ACTIVE` rule grammar, shared with the
conditional map port when it comes. **The DST fold** turns a summer/winter pair of UTC schedules
into one local-time rule in `--timezone` (default: this machine's zone, so build UK packages on a
UK clock or pass `Europe/London`); it folds only a bucket of identical local times whose periods run
contiguously 0101 to 1231, and leaves the rest as UTC.

`topsky-radars.ts` MERGES rather than writes: a TopSky station matches a `radars.json` station by
name, then by location within 500 m; an unmatched one is ADDED with no coverage sensors and a
warning naming its coordinates. It therefore needs the ESE step's `radars.json` first, which is
why `convert` runs it after ESE. The UK run: 17 by name, 4 by location, 1 added (`RADAR:Belfast`
at `N059.39`, a digit out, for the vAcc to fix).

Every warning goes through `logTopSkyParsingWarning` (file, line number, line) into
`neoradar-cli.log`, and the run prints per-file counts. **Not built:** reporting a dataset whose
source file has since left `topsky/`; it stays in `datasets/` silently. **The indexer layers every
`datasets/*.geojson`**, so a full `convert` adds `msaw`, `areas` and each map folder to
`manifest.mapLayers`. Tests: `test/topsky-*.test.ts`, the whole-folder one
(`topsky-uk-folder.test.ts`) skipped when the UK package is absent.

**Rollout for another vAcc:** copy its TopSky data files into `topsky/` and run `convert`. A vAcc
without TopSky gets none of these datasets, and the client's explainers say so (no MSAW, no APW).

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
`profile.schema.json`, `systems/{expressions,labels,lists,mapstyle,shapes,targets}.schema.json`)
describe the package and system files this CLI writes and the desktop client reads. Nothing
covers `datasets/atc-data.json` or `server-dataset.json`; the TypeScript types in
`src/definitions/package-atc-data.ts` are their only description.
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
