import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { runTopSkyPipeline, TOPSKY_FOLDER } from "../src/commands/converter/topsky";
import { parseStages } from "../src/commands/convert-topsky";

// The pipeline dispatches by file NAME, because the folder now holds more than maps: the old
// command read every .txt as a maps file and would write nothing useful from an MSAW one.

const MSAW = "P:4:51.40:-0.50:51.45:-0.50:51.45:-0.40:51.40:-0.40:1500\n";
const AREAS = [
  "AREA:1:EGD064A",
  "LIMITS:50:660",
  "ACTIVE:AUP:EGD064A",
  "COORD:N051.20.16.000:W007.11.15.000",
  "COORD:N051.16.16.000:W006.16.43.000",
  "COORD:N050.28.38.000:W006.00.46.000",
  "",
].join("\n");
const MAPS = [
  "COLORDEF:White:255:255:255",
  "MAP:Test map",
  "FOLDER:TestFolder",
  "COLOR:White",
  "COORD:N051.00.00.000:W001.00.00.000",
  "COORD:N052.00.00.000:W001.00.00.000",
  "COORDLINE",
  "",
].join("\n");

function environment(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "neoradar-topsky-"));
  const folder = path.join(root, TOPSKY_FOLDER);
  fs.mkdirSync(folder, { recursive: true });
  fs.mkdirSync(path.join(root, "package", "datasets"), { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(folder, name), content, "utf8");
  }
  return root;
}

function datasets(root: string): string[] {
  return fs.readdirSync(path.join(root, "package", "datasets")).sort();
}

test("each known file name reaches its own writer", async () => {
  const root = environment({
    "TopSkyMSAW.txt": MSAW,
    "TopSkyAreas.txt": AREAS,
    "TopSkyMaps.txt": MAPS,
  });
  try {
    const result = await runTopSkyPipeline(root, { timezone: "UTC" });

    assert.equal(result.ran, true);
    assert.equal(result.refused, false);
    assert.deepEqual(datasets(root), ["TestFolder.geojson", "areas.geojson", "msaw.geojson"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("an unknown TopSky file is skipped rather than read as a maps file", async () => {
  const root = environment({ "TopSkySomethingElse.txt": MAPS });
  try {
    const result = await runTopSkyPipeline(root, { timezone: "UTC" });

    assert.equal(result.ran, true);
    assert.deepEqual(datasets(root), []);
    assert.equal(result.files[0].stage, "skipped");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a manual activation override file REFUSES the run rather than being merged silently", async () => {
  const root = environment({ "TopSkyAreas.txt": AREAS, "TopSkyAreasManualAct.txt": "AREA:EGD064A\n" });
  try {
    const result = await runTopSkyPipeline(root, { timezone: "UTC" });

    assert.equal(result.refused, true);
    assert.equal(result.ran, false);
    assert.deepEqual(datasets(root), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("--only runs the stages it names and leaves the rest alone", async () => {
  const root = environment({ "TopSkyMSAW.txt": MSAW, "TopSkyAreas.txt": AREAS });
  try {
    await runTopSkyPipeline(root, { timezone: "UTC", only: ["msaw"] });

    assert.deepEqual(datasets(root), ["msaw.geojson"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a missing topsky folder says so once and writes nothing", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "neoradar-topsky-"));
  try {
    const result = await runTopSkyPipeline(root, { timezone: "UTC" });

    assert.equal(result.ran, false);
    assert.equal(result.refused, false);
    assert.deepEqual(result.written, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the raw video merge needs radars.json and says so rather than writing one from nothing", async () => {
  const root = environment({
    "TopSkyRadars.txt": [
      "RADAR:Bovingdon",
      "POSITIONS:LON",
      "LOCATION:N051.42.32.400:W000.32.27.900",
      "BEAMWIDTH:1.25",
      "",
    ].join("\n"),
  });
  try {
    const result = await runTopSkyPipeline(root, { timezone: "UTC" });

    assert.equal(result.ran, true);
    assert.deepEqual(datasets(root), []);
    assert.equal(result.files[0].written, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the raw video block lands on the station radars.json already has", async () => {
  const root = environment({
    "TopSkyRadars.txt": [
      "RADAR:Bovingdon",
      "POSITIONS:LON:LTC",
      "LOCATION:N051.42.32.400:W000.32.27.900",
      "BEAMWIDTH:1.25",
      "PULSEWIDTH:1",
      "",
    ].join("\n"),
  });
  const radarsPath = path.join(root, "package", "datasets", "radars.json");
  fs.writeFileSync(
    radarsPath,
    JSON.stringify({
      name: "radars",
      stations: [
        { name: "Bovingdon", latitude: 51.709, longitude: -0.5411, primary: { rangeNm: 120, antennaAltitudeFt: 151 } },
      ],
      holes: [],
    })
  );
  try {
    await runTopSkyPipeline(root, { timezone: "UTC" });

    const written = JSON.parse(fs.readFileSync(radarsPath, "utf8"));
    assert.equal(written.stations[0].rawVideo.beamwidthDeg, 1.25);
    assert.deepEqual(written.stations[0].rawVideo.positions, ["LON", "LTC"]);
    assert.ok(written.stations[0].primary, "the ESE sensors survive the merge");
    assert.ok(written.$schema, "the dataset keeps its schema line");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("--only refuses a stage name it does not know rather than running the lot", () => {
  assert.deepEqual(parseStages("msaw,areas"), ["msaw", "areas"]);
  assert.equal(parseStages(undefined), undefined);
  assert.throws(() => parseStages("msaw,zones"), /zones/);
});
