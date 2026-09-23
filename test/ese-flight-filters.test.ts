import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Ora } from "ora";

import { EseHelper } from "../src/helper/ese-helper";
import { NseNavaid } from "../src/definitions/package-defs";
import { eseParser } from "../src/commands/converter/ese";
import { atcData } from "../src/commands/converter/atc-data-parser";
import { ATCData } from "../src/definitions/package-atc-data";

// DEPAPT/ARRAPT/GUEST scope a volume to the flights it applies to. Unioning them to the sector
// only lost which volume carried which filter, so LLNTH_W/LLSTH_W (ARRAPT:EGLL) looked like it
// applied to every flight and the server called an EGJJ to EGLC crossing Concerned for LLN.

const NAVAID_TYPES = ["vor", "ndb", "fix", "airport"] as const;

const fakeSpinner = { text: "", info() {}, warn() {}, fail() {}, succeed() {} } as unknown as Ora;

// Modelled on the real LLNTH_W / LLSTH_W / LCTWR blocks of the UK file.
const AIRSPACE_FIXTURE = [
  "SECTORLINE:LLNTH_STH_W",
  "COORD:N051.28.20.335:E000.03.03.711",
  "COORD:N051.28.39.000:W000.27.41.000",
  "SECTOR:LLNTH_W:0:9500",
  "OWNER:LLN:LLS:TCSE",
  "BORDER:LLNTH_STH_W",
  "ARRAPT:EGLL:EGWU",
  "SECTOR:LLSTH_W:0:9500",
  "OWNER:LLS:LLN:LLF:TCSE",
  "ACTIVE:EGLL:27L",
  "ACTIVE:EGLL:27R",
  "GUEST:TCNW:EGLL:*",
  "GUEST:TMS:*:EGLC",
  "BORDER:LLSTH_W:LLNTH_STH_W",
  "ARRAPT:EGLL",
  "SECTOR:LCTWR:0:2000",
  "OWNER:LLT:LLS",
  "BORDER:LLNTH_STH_W",
  "ARRAPT:EGLC",
  "DEPAPT:EGLC",
  "SECTOR:LLNTH_E:0:9500",
  "OWNER:LLN:LLS",
  "BORDER:LLNTH_STH_W",
];

async function parse(lines: string[]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "neoradar-filters-"));
  const file = path.join(dir, "test.ese");
  fs.writeFileSync(file, lines.join("\n"));
  try {
    return await EseHelper.parseEseContent(file, [] as NseNavaid[], false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function sectorNamed<T extends { name: string }>(sectors: T[], name: string): T {
  const found = sectors.find((sector) => sector.name === name);
  assert.ok(found, `${name} must be produced from the fixture`);
  return found;
}

test("an ARRAPT-only block keeps its arrival airports and no departure airports", async () => {
  const parsed = await parse(["[AIRSPACE]", ...AIRSPACE_FIXTURE, ""]);

  const north = sectorNamed(parsed.sectors, "LLNTH_W");
  assert.deepEqual(north.arrApts, ["EGLL", "EGWU"]);
  assert.deepEqual(north.depApts, []);
});

test("a block with both DEPAPT and ARRAPT keeps both", async () => {
  const parsed = await parse(["[AIRSPACE]", ...AIRSPACE_FIXTURE, ""]);

  const tower = sectorNamed(parsed.sectors, "LCTWR");
  assert.deepEqual(tower.depApts, ["EGLC"]);
  assert.deepEqual(tower.arrApts, ["EGLC"]);
});

test("a block with neither DEPAPT nor ARRAPT nor GUEST keeps three empty lists", async () => {
  const parsed = await parse(["[AIRSPACE]", ...AIRSPACE_FIXTURE, ""]);

  const east = sectorNamed(parsed.sectors, "LLNTH_E");
  assert.deepEqual(east.depApts, []);
  assert.deepEqual(east.arrApts, []);
  assert.deepEqual(east.guests, []);
});

test("a GUEST wildcard becomes null on the side it stands for", async () => {
  const parsed = await parse(["[AIRSPACE]", ...AIRSPACE_FIXTURE, ""]);

  const south = sectorNamed(parsed.sectors, "LLSTH_W");
  assert.deepEqual(south.guests, [
    { position: "TCNW", departureAirport: "EGLL", arrivalAirport: null },
    { position: "TMS", departureAirport: null, arrivalAirport: "EGLC" },
  ]);
});

test("a GUEST under a skipped Only sector does not land on the previous sector", async () => {
  const parsed = await parse([
    "[AIRSPACE]",
    "SECTOR:LLSTH_W:0:9500",
    "OWNER:LLS:LLN",
    "GUEST:TCNW:EGLL:*",
    "SECTOR:Only LLAPP:0:9500",
    "OWNER:LLN:LLS",
    "GUEST:TCSE:EGLL:*",
    "ARRAPT:EGLL",
    "",
  ]);

  const kept = parsed.sectors.filter((sector) => !sector.name.startsWith("Only"));
  assert.equal(kept.length, 1, "the Only block must not be published");
  assert.deepEqual(kept[0].guests, [{ position: "TCNW", departureAirport: "EGLL", arrivalAirport: null }]);
  assert.deepEqual(kept[0].arrApts, [], "the skipped block's ARRAPT landed on the previous sector");
});

test("a malformed GUEST line is dropped rather than emitted half-parsed", async () => {
  const parsed = await parse(["[AIRSPACE]", "SECTOR:LLSTH_W:0:9500", "OWNER:LLS", "GUEST:TCNW", ""]);

  assert.deepEqual(sectorNamed(parsed.sectors, "LLSTH_W").guests, []);
});

function navaidFeatureCollection(type: string, name: string): string {
  return JSON.stringify({
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { uuid: `${type}-${name}-uuid`, name, type, freq: 113.6 },
        geometry: { type: "Point", coordinates: [-30140.5, 6711542.7] },
      },
    ],
  });
}

const ESE_FIXTURE = [
  "[POSITIONS]",
  "LON_N_CTR:London North:127.100:LLN:L:LLN:CTR:::0401:0407:N051.28.40.000:W000.27.05.000",
  "LON_S_CTR:London South:129.100:LLS:S:LLS:CTR:::0501:0507:N051.28.40.000:W000.27.05.000",
  "LCY_TWR:London City Tower:118.075:LLT:T:LLT:TWR:::0601:0607:N051.30.19.000:E000.03.19.000",
  "",
  "[AIRSPACE]",
  ...AIRSPACE_FIXTURE,
  "",
].join("\n");

interface ParseResult {
  envDir: string;
  parsed: ATCData;
}

let parsePromise: Promise<ParseResult> | null = null;

function runParseOnce(): Promise<ParseResult> {
  parsePromise ??= (async () => {
    const envDir = fs.mkdtempSync(path.join(os.tmpdir(), "neoradar-filters-atc-"));
    const datasetsDir = path.join(envDir, "package", "datasets");
    fs.mkdirSync(datasetsDir, { recursive: true });

    fs.writeFileSync(
      path.join(envDir, "package", "manifest.json"),
      JSON.stringify({ name: "Test Package", id: "TEST_PACKAGE_1.2.3", version: "1.2.3", namespace: "testvacc", mapLayers: [] })
    );

    for (const type of NAVAID_TYPES) {
      fs.writeFileSync(path.join(datasetsDir, `${type}.geojson`), navaidFeatureCollection(type, type.toUpperCase() + "1"));
    }

    fs.writeFileSync(path.join(envDir, "test.ese"), ESE_FIXTURE);

    const eseResult = await eseParser.start(fakeSpinner, path.join(envDir, "test.ese"), datasetsDir, false);
    assert.ok(eseResult, "ESE parse must succeed for the fixture");

    return { envDir, parsed: await atcData.parseAtcdata(envDir, eseResult.parsedEse) };
  })();
  return parsePromise;
}

after(async () => {
  if (!parsePromise) return;
  const { envDir } = await parsePromise.catch(() => ({ envDir: "" }));
  if (envDir) fs.rmSync(envDir, { recursive: true, force: true });
});

function volumeOf(parsed: ATCData, identifier: string, volumeId: string) {
  const sector = parsed.sectors[identifier];
  assert.ok(sector, `${identifier} sector must be produced from the fixture`);
  const volume = sector.volumes.find((v) => v.id === volumeId);
  assert.ok(volume, `${volumeId} volume must be produced from the fixture`);
  return volume;
}

test("every emitted volume carries its own departureAirports, arrivalAirports and guests", async () => {
  const { parsed } = await runParseOnce();

  const south = volumeOf(parsed, "LLS", "LLSTH_W");
  assert.deepEqual(south.departureAirports, []);
  assert.deepEqual(south.arrivalAirports, ["EGLL"]);
  assert.deepEqual(south.guests, [
    { position: "TCNW", departureAirport: "EGLL", arrivalAirport: null },
    { position: "TMS", departureAirport: null, arrivalAirport: "EGLC" },
  ]);

  const north = volumeOf(parsed, "LLN", "LLNTH_W");
  assert.deepEqual(north.arrivalAirports, ["EGLL", "EGWU"]);
  assert.deepEqual(north.departureAirports, []);
  assert.deepEqual(north.guests, []);

  const unfiltered = volumeOf(parsed, "LLN", "LLNTH_E");
  assert.deepEqual(unfiltered.departureAirports, []);
  assert.deepEqual(unfiltered.arrivalAirports, []);
  assert.deepEqual(unfiltered.guests, []);
});

test("the sector-level airport unions still cover every volume of the sector", async () => {
  const { parsed } = await runParseOnce();

  const lln = parsed.sectors["LLN"];
  assert.deepEqual(lln.activeAirports, ["EGLL", "EGWU"]);
  assert.deepEqual(lln.departureAirports, []);
  assert.deepEqual(lln.arrivalAirports, ["EGLL", "EGWU"]);

  const tower = parsed.sectors["LLT"];
  assert.deepEqual(tower.activeAirports, ["EGLC"]);
  assert.deepEqual(tower.departureAirports, ["EGLC"]);
  assert.deepEqual(tower.arrivalAirports, ["EGLC"]);
});
