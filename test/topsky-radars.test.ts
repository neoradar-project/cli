import test from "node:test";
import assert from "node:assert/strict";

import { mergeRawVideo, parseTopSkyRadars } from "../src/commands/converter/topsky/topsky-radars";
import { RadarSection } from "../src/helper/radars";

// TopSkyRadars.txt is the raw video half of a station: what SIZES a return, where the ESE
// [RADAR] section decides whether one is seen. Every block below is a real UK one.

const ALANSHILL = [
  "RADAR:Alanshill",
  "POSITIONS:SCO:STC:EGPD",
  "LOCATION:N057.38.35.040:W002.09.56.220",
  "ALTITUDE:506",
  "BEAMWIDTH:1.4",
  "PULSEWIDTH:1",
  "MAXANGLE:87",
  "RANGE:0:60",
];

const BOVINGDON = [
  "RADAR:Bovingdon",
  "POSITIONS:LON:LTC",
  "LOCATION:N051.42.32.400:W000.32.27.900",
  "ALTITUDE:151",
  "BEAMWIDTH:1.25",
  "PULSEWIDTH:1",
  "MAXANGLE:87",
  "RANGE:0:200",
];

function parse(lines: string[]) {
  return parseTopSkyRadars("TopSkyRadars.txt", lines.join("\n"));
}

function section(stations: RadarSection["stations"]): RadarSection {
  return { stations, holes: [] };
}

test("a RADAR block becomes the raw video block, with the guide's defaults where a line is absent", () => {
  const result = parse([...BOVINGDON, "", ...ALANSHILL]);

  assert.equal(result.parsed.length, 2);
  const bovingdon = result.parsed[0];
  assert.equal(bovingdon.name, "Bovingdon");
  assert.equal(bovingdon.rawVideo.beamwidthDeg, 1.25);
  assert.equal(bovingdon.rawVideo.pulseWidthUs, 1);
  assert.equal(bovingdon.rawVideo.maxAngleDeg, 87);
  assert.equal(bovingdon.rawVideo.maxRangeNm, 200);
  assert.equal(bovingdon.rawVideo.antennaAltitudeFt, 151);
  assert.deepEqual(bovingdon.rawVideo.positions, ["LON", "LTC"]);
});

test("an omitted BEAMWIDTH, PULSEWIDTH or MAXANGLE takes 1.5, 1.0 and 90", () => {
  const result = parse(["RADAR:Bare", "POSITIONS:LON", "LOCATION:N051.00.00.000:W001.00.00.000"]);

  assert.deepEqual(result.parsed[0].rawVideo, {
    beamwidthDeg: 1.5,
    pulseWidthUs: 1.0,
    maxAngleDeg: 90,
    positions: ["LON"],
  });
});

test("a station with no LOCATION is dropped, because nothing could match it to a radars.json station", () => {
  assert.equal(parse(["RADAR:Nowhere", "POSITIONS:LON"]).parsed.length, 0);
});

// The UK file has one copy-paste error, Pease Pottage at Perwinnes' coordinates, and a location
// match would otherwise merge the second station's raw video onto the first.
test("two stations sharing a LOCATION are warned about and both kept", () => {
  const result = parse([
    "RADAR:Perwinnes",
    "POSITIONS:SCO",
    "LOCATION:N057.11.00.000:W002.03.00.000",
    "",
    "RADAR:Pease Pottage",
    "POSITIONS:LTC",
    "LOCATION:N057.11.00.000:W002.03.00.000",
  ]);

  assert.equal(result.parsed.length, 2);
});

test("a station matches an ESE station by name first", () => {
  const eseSection = section([
    { name: "Bovingdon", latitude: 51.709, longitude: -0.5411, primary: { rangeNm: 120, antennaAltitudeFt: 151 } },
  ]);
  const merged = mergeRawVideo(eseSection, parse(BOVINGDON));

  assert.equal(merged.matchedByName, 1);
  assert.equal(merged.matchedByLocation, 0);
  assert.equal(merged.added, 0);
  assert.equal(eseSection.stations[0].rawVideo?.beamwidthDeg, 1.25);
  assert.ok(eseSection.stations[0].primary, "the ESE sensors are untouched");
});

// The UK's TopSky file spells it "Alanshill" and its ESE "Allanshill", 20 m apart.
test("a station whose name differs matches by location within 500 m", () => {
  const eseSection = section([
    { name: "Allanshill", latitude: 57.643055, longitude: -2.165277, primary: { rangeNm: 60, antennaAltitudeFt: 506 } },
  ]);
  const merged = mergeRawVideo(eseSection, parse(ALANSHILL));

  assert.equal(merged.matchedByName, 0);
  assert.equal(merged.matchedByLocation, 1);
  assert.equal(eseSection.stations[0].rawVideo?.beamwidthDeg, 1.4);
});

// The UK file's second coordinate error, found by running this: RADAR:Belfast sits at
// N059.39.21.540 where Belfast International is N054.39, one digit out, so it matches neither by
// name nor by location and is added as a station of its own 300 nm north of the aerodrome whose
// logins it serves. Adding it is right, because the vAcc's file is never edited here; the warning
// is what makes it findable.
test("a station matching nothing is added, with no coverage sensors and a warning", () => {
  const eseSection = section([]);
  const merged = mergeRawVideo(eseSection, parse(BOVINGDON));

  assert.equal(merged.added, 1);
  assert.equal(eseSection.stations.length, 1);
  assert.equal(eseSection.stations[0].name, "Bovingdon");
  assert.equal(eseSection.stations[0].primary, undefined);
  assert.ok(eseSection.stations[0].rawVideo);
});

test("a station whose name matches but whose location is 300 nm out still matches by NAME", () => {
  const eseSection = section([
    { name: "Bovingdon", latitude: 57.0, longitude: -0.5411, primary: { rangeNm: 120, antennaAltitudeFt: 151 } },
  ]);
  const merged = mergeRawVideo(eseSection, parse(BOVINGDON));

  assert.equal(merged.matchedByName, 1);
  assert.equal(merged.added, 0);
});

test("terrain lines are counted rather than converted: the ESE HOLE polygons already mask coverage", () => {
  const result = parse([...BOVINGDON, "NOTERRAIN"]);

  assert.equal(result.terrainLinesDropped, 1);
});
