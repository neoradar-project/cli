import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { EseHelper } from "../src/helper/ese-helper";
import { NseNavaid } from "../src/definitions/package-defs";
import {
  buildRadarsDataset,
  parseHoleHeader,
  parseRadarLine,
  RadarSectionParser,
  RADARS_DATASET_FILE,
  writeRadarsDataset,
} from "../src/helper/radars";

// The ESE [RADAR] section is the source of datasets/radars.json, the file whose presence turns
// the client's coverage simulation on. Bovingdon and Allanshill are two real UK stations; the
// UK file's first HOLE is a 6908-vertex polygon saying there is no primary return below 500 ft.

const BOVINGDON = "RADAR2:Bovingdon:N051.42.32.400:W000.32.27.900:120:151:3100:138:151:3100:234:151:3100";
const ALLANSHILL = "RADAR2:Allanshill:N057.38.35.000:W002.09.55.000:60:506:3100:184:506:3100:312:506:3100";
const SQUARE = [
  "COORD:N051.00.00.000:W001.00.00.000",
  "COORD:N052.00.00.000:W001.00.00.000",
  "COORD:N052.00.00.000:E000.00.00.000",
  "COORD:N051.00.00.000:E000.00.00.000",
];

function tempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

async function parse(lines: string[]) {
  const dir = tempDir("neoradar-radars-");
  const file = path.join(dir, "test.ese");
  fs.writeFileSync(file, lines.join("\n"));
  try {
    return await EseHelper.parseEseContent(file, [] as NseNavaid[], false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function section(lines: string[]) {
  const parser = new RadarSectionParser();
  for (const line of lines) parser.handleLine(line);
  return parser.finish();
}

test("RADAR2 line becomes a station with three sensors in WGS84 degrees", () => {
  const station = parseRadarLine(BOVINGDON);

  assert.ok(station);
  assert.equal(station.name, "Bovingdon");
  assert.ok(Math.abs(station.latitude - 51.709) < 0.001);
  assert.ok(Math.abs(station.longitude - -0.5411) < 0.001);
  assert.deepEqual(station.primary, { rangeNm: 120, antennaAltitudeFt: 151, coneSlopeFtPerNm: 3100 });
  assert.deepEqual(station.secondary, { rangeNm: 138, antennaAltitudeFt: 151, coneSlopeFtPerNm: 3100 });
  assert.deepEqual(station.modeS, { rangeNm: 234, antennaAltitudeFt: 151, coneSlopeFtPerNm: 3100 });
});

test("an empty range leaves that sensor out, and no cone field means no cone", () => {
  const station = parseRadarLine("RADAR2:Cumbernauld:N055.56.21.000:W004.03.26.000:60:123::::::");

  assert.ok(station);
  assert.deepEqual(station.primary, { rangeNm: 60, antennaAltitudeFt: 123 });
  assert.equal(station.secondary, undefined);
  assert.equal(station.modeS, undefined);
});

test("a station the client could not use is dropped, not emitted broken", () => {
  assert.equal(parseRadarLine("RADAR2:NoSensor:N051.00.00.000:W000.00.00.000::::::::"), null);
  assert.equal(parseRadarLine("RADAR2:BadRange:N051.00.00.000:W000.00.00.000:0:100:3100::::::"), null);
  assert.equal(parseRadarLine("RADAR2::N051.00.00.000:W000.00.00.000:60:100:3100::::::"), null);
  assert.equal(parseRadarLine("RADAR2:BadPosition:garbage:W000.00.00.000:60:100:3100::::::"), null);
  assert.equal(parseRadarLine("RADAR:OldFormat:N051.00.00.000:W000.00.00.000:60:100"), null);
  assert.equal(parseRadarLine("; a comment"), null);
});

test("HOLE header carries one floor per sensor kind, absent meaning that kind is untouched", () => {
  assert.deepEqual(parseHoleHeader("HOLE:500::"), { polygon: [], primaryBelowFt: 500 });
  assert.deepEqual(parseHoleHeader("HOLE:10000:10000:10000"), {
    polygon: [],
    primaryBelowFt: 10000,
    secondaryBelowFt: 10000,
    modeSBelowFt: 10000,
  });
  assert.equal(parseHoleHeader("HOLE:::"), null);
  assert.equal(parseHoleHeader("HOLE:abc::"), null);
});

test("a HOLE owns the COORD lines after it until the next header or station", () => {
  const result = section(["HOLE:500::", ...SQUARE, "HOLE:900:900:", ...SQUARE.slice(0, 3), BOVINGDON, "HOLE:1500::", ...SQUARE]);

  assert.equal(result.stations.length, 1);
  assert.equal(result.holes.length, 3);
  assert.equal(result.holes[0].primaryBelowFt, 500);
  assert.equal(result.holes[0].polygon.length, 4);
  assert.deepEqual(result.holes[0].polygon[0], [51, -1]);
  assert.deepEqual(result.holes[1], { primaryBelowFt: 900, secondaryBelowFt: 900, polygon: [[51, -1], [52, -1], [52, 0]] });
  assert.equal(result.holes[2].primaryBelowFt, 1500);
});

test("a hole that is not an area, or has no floor, is dropped with its vertices", () => {
  const result = section(["HOLE:500::", ...SQUARE.slice(0, 2), "HOLE:::", ...SQUARE, BOVINGDON]);

  assert.equal(result.holes.length, 0);
  assert.equal(result.stations.length, 1);
});

test("the ESE parse collects the [RADAR] section and nothing from other sections", async () => {
  const parsed = await parse([
    "[POSITIONS]",
    "[RADAR]",
    "",
    BOVINGDON,
    ALLANSHILL,
    "HOLE:500::",
    ...SQUARE,
    "[AIRSPACE]",
    "SECTORLINE:X",
    "COORD:N051.28.20.335:E000.03.03.711",
  ]);

  assert.deepEqual(
    parsed.radars.stations.map((station) => station.name),
    ["Bovingdon", "Allanshill"]
  );
  assert.equal(parsed.radars.holes.length, 1);
  assert.equal(parsed.radars.holes[0].polygon.length, 4);
  assert.equal(parsed.sectorLines.length, 1);
});

test("an ESE without a [RADAR] section yields no stations and no holes", async () => {
  const parsed = await parse(["[AIRSPACE]", "SECTORLINE:X", "COORD:N051.28.20.335:E000.03.03.711"]);

  assert.deepEqual(parsed.radars, { stations: [], holes: [] });
});

test("radars.json is written only when there is a station, in the schema shape", () => {
  const dir = tempDir("neoradar-radars-out-");
  try {
    assert.equal(writeRadarsDataset(dir, { stations: [], holes: [] }), undefined);
    assert.equal(writeRadarsDataset(dir, section(["HOLE:500::", ...SQUARE])), undefined);
    assert.equal(fs.existsSync(path.join(dir, RADARS_DATASET_FILE)), false);

    const parsed = section([BOVINGDON, "HOLE:500::", ...SQUARE]);
    const written = writeRadarsDataset(dir, parsed);
    assert.equal(written, path.join(dir, RADARS_DATASET_FILE));

    const onDisk = JSON.parse(fs.readFileSync(written!, "utf8"));
    assert.deepEqual(onDisk, JSON.parse(JSON.stringify(buildRadarsDataset(parsed))));
    assert.match(onDisk.$schema, /datasets\/radars\.schema\.json$/);
    assert.equal(onDisk.stations.length, 1);
    assert.equal(onDisk.holes.length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
