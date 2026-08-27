import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Ora } from "ora";

import { eseParser } from "../src/commands/converter/ese";
import { atcData } from "../src/commands/converter/atc-data-parser";
import { ATCData } from "../src/definitions/package-atc-data";

const NAVAID_TYPES = ["vor", "ndb", "fix", "airport"] as const;

const fakeSpinner = { text: "", info() {}, warn() {}, fail() {}, succeed() {} } as unknown as Ora;

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
  "LON_CTR:London Control:127.100:LON:L:LON:CTR:::0401:0407:N051.28.40.000:W000.27.05.000",
  "STC_APP:Stansted Approach:120.625:STC:S:STC:APP:::0501:0507:N051.53.06.000:E000.14.05.000",
  "SCO_CTR:Scottish Control:135.525:SCO:C:SCO:CTR:::0601:0607:N055.52.00.000:W004.25.00.000",
  "",
  "[AIRSPACE]",
  "SECTOR:LON MID:0:66000",
  "OWNER:LON",
  "DEPAPT:EGLL:EGKK",
  "ARRAPT:EGSS:EGGW:EGLL",
  "",
  "SECTOR:STC APPROACH:0:15000",
  "OWNER:STC",
  "DEPAPT:EGSS",
  "",
  "SECTOR:SCO NORTH:0:66000",
  "OWNER:SCO",
  "",
].join("\n");

function makePackageEnvironment(): string {
  const envDir = fs.mkdtempSync(path.join(os.tmpdir(), "neoradar-atcdata-"));
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

  return envDir;
}

interface ParseResult {
  envDir: string;
  parsed: ATCData;
}

let parsePromise: Promise<ParseResult> | null = null;

function runParseOnce(): Promise<ParseResult> {
  parsePromise ??= (async () => {
    const envDir = makePackageEnvironment();
    const datasetsDir = path.join(envDir, "package", "datasets");

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

test("activeAirports stays the union of DEPAPT and ARRAPT", async () => {
  const { parsed } = await runParseOnce();
  const lon = parsed.sectors["LON"];
  assert.ok(lon, "LON sector must be produced from the fixture");
  assert.deepEqual(lon.activeAirports, ["EGLL", "EGKK", "EGSS", "EGGW"]);
});

test("departureAirports carries only DEPAPT entries, arrivalAirports only ARRAPT", async () => {
  const { parsed } = await runParseOnce();
  const lon = parsed.sectors["LON"];
  assert.deepEqual(lon.departureAirports, ["EGLL", "EGKK"]);
  assert.deepEqual(lon.arrivalAirports, ["EGSS", "EGGW", "EGLL"]);
});

test("a sector with DEPAPT but no ARRAPT gets an empty arrivalAirports", async () => {
  const { parsed } = await runParseOnce();
  const stc = parsed.sectors["STC"];
  assert.ok(stc, "STC sector must be produced from the fixture");
  assert.deepEqual(stc.activeAirports, ["EGSS"]);
  assert.deepEqual(stc.departureAirports, ["EGSS"]);
  assert.deepEqual(stc.arrivalAirports, []);
});

test("a sector with neither DEPAPT nor ARRAPT emits empty arrays, matching activeAirports", async () => {
  const { parsed } = await runParseOnce();
  const sco = parsed.sectors["SCO"];
  assert.ok(sco, "SCO sector must be produced from the fixture");
  assert.deepEqual(sco.activeAirports, []);
  assert.deepEqual(sco.departureAirports, []);
  assert.deepEqual(sco.arrivalAirports, []);
});

test("every emitted sector declares all three airport collections", async () => {
  const { parsed } = await runParseOnce();
  const sectors = Object.values(parsed.sectors);
  assert.ok(sectors.length >= 3);

  for (const sector of sectors) {
    assert.ok(Array.isArray(sector.activeAirports), `${sector.identifier} activeAirports`);
    assert.ok(Array.isArray(sector.departureAirports), `${sector.identifier} departureAirports`);
    assert.ok(Array.isArray(sector.arrivalAirports), `${sector.identifier} arrivalAirports`);

    const union = new Set([...sector.departureAirports, ...sector.arrivalAirports]);
    assert.deepEqual(new Set(sector.activeAirports), union, `${sector.identifier} union invariant`);
  }
});
