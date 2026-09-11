import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { EseHelper } from "../src/helper/ese-helper";
import { NseNavaid } from "../src/definitions/package-defs";

// CIRCLE_SECTORLINE is how every tower and small approach volume is drawn. Unprojecting the
// navaid's degrees collapsed all of them onto (0, 0), which left those sectors with no geometry
// at all: no containment, no boundary line, and nothing for the server to predict against.

const EGLL_LAT = 51.4775;
const EGLL_LON = -0.4613889;
const EARTH_RADIUS_M = 6378137;

function mercator(lat: number, lon: number): { x: number; y: number } {
  return {
    x: (EARTH_RADIUS_M * lon * Math.PI) / 180,
    y: EARTH_RADIUS_M * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)),
  };
}

function navaids(): NseNavaid[] {
  const projected = mercator(EGLL_LAT, EGLL_LON);
  return [
    {
      name: "EGLL",
      freq: 0,
      type: "airport",
      lat: EGLL_LAT,
      lon: EGLL_LON,
      x: projected.x,
      y: projected.y,
      uuid: "airport-egll",
    },
  ];
}

async function parseFixture(lines: string[]): Promise<{ id: number; points: number[][] }[]> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "neoradar-circle-"));
  const file = path.join(dir, "test.ese");
  fs.writeFileSync(file, lines.join("\n"));
  try {
    const parsed = await EseHelper.parseEseContent(file, navaids(), false);
    return parsed.sectorLines.map((line) => ({ id: line.id, points: line.points as unknown as number[][] }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("a navaid-centred CIRCLE_SECTORLINE is drawn around the navaid, not around (0, 0)", async () => {
  const sectorLines = await parseFixture(["[AIRSPACE]", "CIRCLE_SECTORLINE:LLTWR:EGLL:2.5", "SECTOR:EGLL TOWER:0:2000", "OWNER:LLT", "BORDER:LLTWR", ""]);

  assert.equal(sectorLines.length, 1);
  const points = sectorLines[0].points;
  assert.ok(points.length > 3, `expected a ring, got ${points.length} points`);

  const centre = mercator(EGLL_LAT, EGLL_LON);
  for (const [x, y] of points) {
    const offset = Math.hypot(x - centre.x, y - centre.y);
    // 2.5nm is 4630m; Mercator stretches by 1/cos(lat), so allow up to 8km at 51 degrees north.
    assert.ok(offset < 8000, `ring point (${x}, ${y}) is ${Math.round(offset)}m from EGLL`);
    assert.ok(Math.hypot(x, y) > 1e6, `ring point (${x}, ${y}) collapsed towards the origin`);
  }
});

test("an explicit-coordinate CIRCLE_SECTORLINE is drawn around those coordinates", async () => {
  const sectorLines = await parseFixture([
    "[AIRSPACE]",
    "CIRCLE_SECTORLINE:LLTWR:N051.28.39.000:W000.27.41.000:2.5",
    "SECTOR:EGLL TOWER:0:2000",
    "OWNER:LLT",
    "BORDER:LLTWR",
    "",
  ]);

  assert.equal(sectorLines.length, 1);
  const centre = mercator(EGLL_LAT, EGLL_LON);
  for (const [x, y] of sectorLines[0].points) {
    assert.ok(Math.hypot(x - centre.x, y - centre.y) < 8000, `ring point (${x}, ${y}) is not near EGLL`);
  }
});

test("a circle ring closes and is round enough to use as a boundary", async () => {
  const sectorLines = await parseFixture(["[AIRSPACE]", "CIRCLE_SECTORLINE:LLTWR:EGLL:2.5", "SECTOR:EGLL TOWER:0:2000", "OWNER:LLT", "BORDER:LLTWR", ""]);

  const points = sectorLines[0].points;
  const centre = mercator(EGLL_LAT, EGLL_LON);
  const radii = points.map(([x, y]) => Math.hypot(x - centre.x, y - centre.y));
  const min = Math.min(...radii);
  const max = Math.max(...radii);

  assert.ok(max - min < 0.02 * max, `ring is not round: radii span ${Math.round(min)}m to ${Math.round(max)}m`);

  const [firstX, firstY] = points[0];
  const [lastX, lastY] = points[points.length - 1];
  assert.ok(Math.hypot(firstX - lastX, firstY - lastY) < 1, "ring does not close on itself");
});

test("a CIRCLE_SECTORLINE naming an unknown navaid yields no points rather than a ring at (0, 0)", async () => {
  const sectorLines = await parseFixture(["[AIRSPACE]", "CIRCLE_SECTORLINE:XXTWR:NOSUCH:2.5", "SECTOR:X TOWER:0:2000", "OWNER:XXT", "BORDER:XXTWR", ""]);

  assert.equal(sectorLines.length, 1);
  assert.equal(sectorLines[0].points.length, 0);
});
