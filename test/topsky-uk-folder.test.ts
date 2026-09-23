import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { parseAreas } from "../src/commands/converter/topsky/topsky-areas";
import { parseMsaw } from "../src/commands/converter/topsky/topsky-msaw";
import { parseTopSkyRadars } from "../src/commands/converter/topsky/topsky-radars";
// The whole UK topsky/ folder, when this machine has it. @sectorsrc is normally ABSENT in CI,
// which is the expected case rather than an error, so the test skips itself. Resolution is the
// documented order: the env var, then an upward scan for the defaultSubpath.
function findSectorSource(): string | null {
  const fromEnv = process.env.NEORADAR_SECTORSRC_DIR;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;

  let at = path.resolve(__dirname, "..");
  for (let up = 0; up < 6; up++) {
    const candidate = path.join(at, "Packages");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(at);
    if (parent === at) break;
    at = parent;
  }
  return null;
}

const SECTOR_SOURCE = findSectorSource();
const FOLDER = SECTOR_SOURCE ? path.join(SECTOR_SOURCE, "UK-Sector-File", "topsky") : null;
const HAVE_FOLDER = Boolean(FOLDER && fs.existsSync(FOLDER));

function read(name: string): string {
  return fs.readFileSync(path.join(FOLDER!, name), "utf8");
}

test("the UK MSAW file yields its 288 polygons, 3 circles and 28 grid rows", { skip: !HAVE_FOLDER }, () => {
  const result = parseMsaw("TopSkyMSAW.txt", read("TopSkyMSAW.txt"));

  assert.equal(result.counts.polygons, 288);
  assert.equal(result.counts.circles, 3);
  assert.equal(result.counts.wedges, 0);
  assert.ok(result.counts.gridCells > 0, "the AIP grid rows expand to cells");
  assert.equal(result.features.length, 288 + 3 + result.counts.gridCells);
  assert.ok(
    result.features.some((feature) => feature.properties?.source === "floor"),
    "the whole-FIR floors are recognised as floors"
  );
});

test("the UK areas file yields its 342 areas, 320 of them on the AUP feed", { skip: !HAVE_FOLDER }, () => {
  const result = parseAreas("TopSkyAreas.txt", read("TopSkyAreas.txt"), "Europe/London");

  assert.equal(result.counts.areas, 342);
  assert.equal(result.counts.withAup, 320);
  assert.equal(result.features.length, 342);
  assert.ok(
    result.features.every((feature) => typeof feature.properties?.lowerFt === "number"),
    "every area carries a level band"
  );
  assert.ok(
    result.features.some((feature) => feature.properties?.name === "EGD064A"),
    "the worked example is in there"
  );
});

test("the UK schedules fold into Europe/London rather than needing the yearly edit", { skip: !HAVE_FOLDER }, () => {
  const result = parseAreas("TopSkyAreas.txt", read("TopSkyAreas.txt"), "Europe/London");

  assert.ok(result.counts.foldedSchedules > 0, "at least one activation folds");
  // The ones that stay are real: their author clamped a summer range to the end of the day, so
  // the local times genuinely differ by a minute and folding them would move an activation.
  assert.ok(
    result.counts.partialSchedules < result.counts.foldedSchedules,
    "most of them fold; the ones that do not are the author's own end-of-day clamps"
  );
});

test("the UK radars file yields its 22 stations", { skip: !HAVE_FOLDER }, () => {
  const result = parseTopSkyRadars("TopSkyRadars.txt", read("TopSkyRadars.txt"));

  assert.equal(result.parsed.length, 22);
  assert.ok(
    result.parsed.every((station) => station.rawVideo.positions.length > 0),
    "every station serves at least one login prefix"
  );
});
