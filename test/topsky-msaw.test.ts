import test from "node:test";
import assert from "node:assert/strict";

import { parseMsaw } from "../src/commands/converter/topsky/topsky-msaw";

// TopSkyMSAW.txt is the UK vAcc's own authoring of three layers. Every record kind here is real,
// and the resolution rule is the client's: highest wins, never file order.

function parse(lines: string[]) {
  return parseMsaw("TopSkyMSAW.txt", lines.join("\n"));
}

test("a P record in decimal degrees and one in sexagesimal land on the same ground", () => {
  const decimal = parse(["P:4:51.0:-1.0:52.0:-1.0:52.0:0.0:51.0:0.0:1500"]);
  const sexagesimal = parse([
    "P:4:N051.00.00.000:W001.00.00.000:N052.00.00.000:W001.00.00.000:N052.00.00.000:E000.00.00.000:N051.00.00.000:E000.00.00.000:1500",
  ]);

  assert.equal(decimal.features.length, 1);
  assert.equal(sexagesimal.features.length, 1);
  const a = (decimal.features[0].geometry as GeoJSON.Polygon).coordinates[0][0];
  const b = (sexagesimal.features[0].geometry as GeoJSON.Polygon).coordinates[0][0];
  assert.ok(Math.abs(a[0] - b[0]) < 1, "within a metre in x");
  assert.ok(Math.abs(a[1] - b[1]) < 1, "within a metre in y");
});

test("a P record whose vertex count disagrees with its coordinates is dropped, not truncated", () => {
  const result = parse(["P:4:51.0:-1.0:52.0:-1.0:52.0:0.0:1500"]);

  assert.equal(result.features.length, 0);
});

test("a whole-degree polygon is called a floor and a small one an airport area", () => {
  const floor = parse(["P:4:51.0:-3.0:54.0:-3.0:54.0:1.0:51.0:1.0:1000"]);
  const smaa = parse(["P:4:51.40:-0.50:51.45:-0.50:51.45:-0.40:51.40:-0.40:1500"]);

  assert.equal(floor.features[0].properties?.source, "floor");
  assert.equal(smaa.features[0].properties?.source, "smaa");
});

test("an L row becomes one cell per altitude, west to east from its own south-west corner", () => {
  const result = parse(["L:49.0:-3:0.5:0.5:2:1700:1800"]);

  assert.equal(result.features.length, 2);
  assert.equal(result.counts.gridCells, 2);
  assert.equal(result.features[0].properties?.msaFt, 1700);
  assert.equal(result.features[1].properties?.msaFt, 1800);
  assert.equal(result.features[0].properties?.source, "grid");

  const first = (result.features[0].geometry as GeoJSON.Polygon).coordinates[0];
  const second = (result.features[1].geometry as GeoJSON.Polygon).coordinates[0];
  const westOf = (ring: number[][]) => Math.min(...ring.map((point) => point[0]));
  assert.ok(westOf(first) < westOf(second), "the first cell is the westernmost");
});

test("an L row declaring more cells than it carries altitudes for is dropped", () => {
  assert.equal(parse(["L:49.0:-3:0.5:0.5:4:1700:1800"]).features.length, 0);
});

// The UK file's own oddity: a 3.2 NM circle at Gatwick reading 210 where every neighbour reads
// 2100. It converts as written, because the converter never edits the vAcc's file, and it warns.
// Its two dozen coastal areas at a round 100 and 200 ft do NOT warn, or the warning would be
// noise on every run.
test("the Gatwick circle at 210 is converted and warned about, where a round hundred is not", () => {
  const result = parse(["C:N051.10.38.930:W000.22.30.290:3.2:210"]);

  assert.equal(result.features.length, 1);
  assert.equal(result.counts.circles, 1);
  assert.equal(result.features[0].properties?.msaFt, 210);

  const roundHundred = parse(["P:4:51.40:-0.50:51.45:-0.50:51.45:-0.40:51.40:-0.40:100"]);
  assert.equal(roundHundred.features[0].properties?.msaFt, 100);
});

test("a circle becomes a closed ring with a vertex every five degrees", () => {
  const result = parse(["C:N051.19.14.000:E000.17.14.000:3:2300"]);
  const ring = (result.features[0].geometry as GeoJSON.Polygon).coordinates[0];

  assert.equal(ring.length, 73);
  assert.deepEqual(ring[0], ring[ring.length - 1]);
});

test("the nearest preceding comment survives as the record's label", () => {
  const result = parse(["//Runway 15", "P:4:51.40:-0.50:51.45:-0.50:51.45:-0.40:51.40:-0.40:1500"]);

  assert.equal(result.features[0].properties?.label, "Runway 15");
});

test("an S sector is read although the UK file has none", () => {
  const result = parse(["S:N051.00.00.000:W001.00.00.000:0:90:2:10:2000"]);

  assert.equal(result.counts.wedges, 1);
  assert.equal(result.features[0].properties?.msaFt, 2000);
});

test("order is the record's place in the file, so the explainer can say what read order would have chosen", () => {
  const result = parse([
    "P:4:51.40:-0.50:51.45:-0.50:51.45:-0.40:51.40:-0.40:1500",
    "P:4:51.40:-0.50:51.45:-0.50:51.45:-0.40:51.40:-0.40:2000",
  ]);

  assert.equal(result.features[0].properties?.order, 0);
  assert.equal(result.features[1].properties?.order, 1);
});
