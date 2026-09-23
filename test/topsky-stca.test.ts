import test from "node:test";
import assert from "node:assert/strict";

import { parseStcaRunways } from "../src/commands/converter/topsky/topsky-stca";

// The UK's TopSky package carries no TopSkySTCA.txt, so every line here is from the Developer
// Guide's grammar rather than from a live file. The defaults are the ones it states.

function parse(lines: string[]) {
  return parseStcaRunways("TopSkySTCA.txt", lines.join("\n"));
}

test("FINALAPP with nothing but a runway takes the guide's defaults", () => {
  const result = parse(["FINALAPP:EGLL:27L"]);

  assert.equal(result.finalApproaches.length, 1);
  assert.deepEqual(result.finalApproaches[0], {
    icao: "EGLL",
    runway: "27L",
    rangeNm: 10,
    xteNm: 0.5,
  });
});

test("FINALAPP carries its own length, width, threshold and course when given", () => {
  const result = parse(["FINALAPP:EGLL:27L:12:0.4:N051.28.39.000:W000.26.00.000:269.7"]);

  const corridor = result.finalApproaches[0];
  assert.equal(corridor.rangeNm, 12);
  assert.equal(corridor.xteNm, 0.4);
  assert.equal(corridor.courseT, 269.7);
  assert.ok(corridor.end, "the threshold is projected");
  assert.ok(Math.abs(corridor.end!.y - 6708000) < 20000, "roughly Heathrow's northing in 3857");
});

test("SOIR takes two runways, and a /alt suffix is the level assumed under a cleared-for-approach", () => {
  const result = parse(["SOIR:EGLL:27L/2000:27R/3000"]);

  const pair = result.parallelOperations[0];
  assert.equal(pair.icao, "EGLL");
  assert.deepEqual(pair.left, { runway: "27L", approachAltFt: 2000, noz: undefined });
  assert.deepEqual(pair.right, { runway: "27R", approachAltFt: 3000, noz: undefined });
  assert.equal(pair.rangeNm, 10);
  assert.equal(pair.widthInNm, 0.3);
  assert.equal(pair.widthOutNm, 0.3);
  assert.equal(pair.departure, false);
});

test("a DEPARTURE pair says so, and custom courses replace the runway bearings", () => {
  const result = parse(["SOIR:EGLL:27L:27R", "DEPARTURE", "CRS1:265", "CRS2:275"]);

  const pair = result.parallelOperations[0];
  assert.equal(pair.departure, true);
  assert.equal(pair.left.courseT, 265);
  assert.equal(pair.right.courseT, 275);
});

test("the NTZ is a polygon of its own, because it EXTENDS alerting rather than inhibiting it", () => {
  const result = parse([
    "SOIR:EGLL:27L:27R",
    "NTZ:N051.28.00.000:W000.20.00.000",
    "NTZ:N051.29.00.000:W000.20.00.000",
    "NTZ:N051.29.00.000:W000.30.00.000",
    "NTZ:N051.28.00.000:W000.30.00.000",
  ]);

  const ntz = result.parallelOperations[0].ntz;
  assert.ok(ntz);
  assert.equal(ntz!.type, "Polygon");
  assert.equal(ntz!.coordinates[0].length, 5);
});

test("a SOIR with no second runway is dropped rather than written half formed", () => {
  assert.equal(parse(["SOIR:EGLL:27L"]).parallelOperations.length, 0);
});
