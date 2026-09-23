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

// DISPLAY is scoped to the SECTORLINE block it sits in. Attaching it to a SECTOR whose name
// matched the sectorline's kept 373 of the UK file's 2869 rules and left all 999 border lines
// without one, so no shared edge was ever highlighted.

const NAVAID_TYPES = ["vor", "ndb", "fix", "airport"] as const;

const fakeSpinner = { text: "", info() {}, warn() {}, fail() {}, succeed() {} } as unknown as Ora;

// Modelled on the UK file's LLNTH_W / LLNTH_STH_W pair: no SECTOR is named after either sectorline.
const AIRSPACE_FIXTURE = [
  "SECTORLINE:LLNTH_W",
  "DISPLAY:LLNTH_W:London TC SE:LLNTH_W",
  "COORD:N051.28.20.335:E000.03.03.711",
  "COORD:N051.28.39.000:W000.27.41.000",
  "SECTORLINE:LLNTH_STH_W",
  "DISPLAY:LLNTH_W:LLNTH_W:LLSTH_W",
  "DISPLAY:LLSTH_W:LLNTH_W:LLSTH_W",
  "COORD:N051.28.20.335:E000.03.03.711",
  "COORD:N051.28.39.000:W000.27.41.000",
  "SECTOR:LLNTH_W:0:9500",
  "OWNER:LLN:LLS:TCSE",
  "BORDER:LLNTH_W:LLNTH_STH_W",
  "SECTOR:LLSTH_W:0:9500",
  "OWNER:LLS:LLN:TCSE",
  "BORDER:LLSTH_W:LLNTH_STH_W",
];

async function parse(lines: string[]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "neoradar-display-"));
  const file = path.join(dir, "test.ese");
  fs.writeFileSync(file, lines.join("\n"));
  try {
    return await EseHelper.parseEseContent(file, [] as NseNavaid[], false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function rulesOn(sectorLines: { id: number; displaySectorLines: { ownedVolume: string; compareVolumes: string[] }[] }[], index: number) {
  return sectorLines[index].displaySectorLines;
}

test("a DISPLAY rule lands on the sectorline block it sits in, not on a like-named sector", async () => {
  const parsed = await parse(["[AIRSPACE]", ...AIRSPACE_FIXTURE, ""]);

  assert.equal(parsed.sectorLines.length, 2);
  const first = rulesOn(parsed.sectorLines, 0);
  assert.equal(first.length, 1);
  assert.deepEqual(first[0], { ownedVolume: "LLNTH_W", compareVolumes: ["London TC SE", "LLNTH_W"] });
});

test("two DISPLAY rules on one sectorline both survive", async () => {
  const parsed = await parse(["[AIRSPACE]", ...AIRSPACE_FIXTURE, ""]);

  const second = rulesOn(parsed.sectorLines, 1);
  assert.equal(second.length, 2);
  assert.deepEqual(
    second.map((rule) => rule.ownedVolume),
    ["LLNTH_W", "LLSTH_W"]
  );
  for (const rule of second) {
    assert.deepEqual(rule.compareVolumes, ["LLNTH_W", "LLSTH_W"]);
  }
});

test("a DISPLAY under a skipped Only sectorline is dropped, not attached to the previous edge", async () => {
  const parsed = await parse([
    "[AIRSPACE]",
    "SECTORLINE:LLNTH_W",
    "DISPLAY:LLNTH_W:London TC SE:LLNTH_W",
    "COORD:N051.28.20.335:E000.03.03.711",
    "COORD:N051.28.39.000:W000.27.41.000",
    "SECTORLINE:Only LLAPP",
    "DISPLAY:Only LLAPP:LLN:LLS",
    "COORD:N052.00.00.000:W001.00.00.000",
    "",
  ]);

  assert.equal(parsed.sectorLines.length, 1, "the Only sectorline must not be published");
  const rules = rulesOn(parsed.sectorLines, 0);
  assert.equal(rules.length, 1, "the skipped block's DISPLAY was attached to the previous edge");
  assert.equal(rules[0].compareVolumes[0], "London TC SE");
});

test("a DISPLAY before any sectorline block is dropped", async () => {
  const parsed = await parse(["[AIRSPACE]", "DISPLAY:LLNTH_W:LLNTH_W:LLSTH_W", "SECTORLINE:LLNTH_W", "COORD:N051.28.20.335:E000.03.03.711", ""]);

  assert.equal(parsed.sectorLines.length, 1);
  assert.deepEqual(rulesOn(parsed.sectorLines, 0), []);
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
  "LTC_SE_CTR:London TC South East:120.525:TCSE:E:TCSE:CTR:::0601:0607:N051.28.40.000:W000.27.05.000",
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
    const envDir = fs.mkdtempSync(path.join(os.tmpdir(), "neoradar-display-atc-"));
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

test("the emitted package carries display rules on borderLines and none on volumes", async () => {
  const { parsed } = await runParseOnce();

  const lln = parsed.sectors["LLN"];
  assert.ok(lln, "LLN sector must be produced from the fixture");
  const volume = lln.volumes.find((v) => v.id === "LLNTH_W");
  assert.ok(volume, "LLNTH_W volume must be produced from the fixture");
  assert.ok(!("displaySectorLines" in volume), "volumes must carry no display rules");

  const rulesByBorder = Object.values(parsed.borderLines).map((border) => border.displaySectorLines.length);
  assert.deepEqual(rulesByBorder.sort(), [1, 2]);
});

test("the shared LLNTH_STH_W edge carries one rule per adjoining volume", async () => {
  const { parsed } = await runParseOnce();

  const shared = Object.values(parsed.borderLines).find((border) => border.displaySectorLines.length === 2);
  assert.ok(shared, "the shared edge must carry both rules");
  assert.deepEqual(
    shared.displaySectorLines.map((rule) => rule.ownedVolume),
    ["LLNTH_W", "LLSTH_W"]
  );

  const lls = parsed.sectors["LLS"];
  const southVolume = lls.volumes.find((v) => v.id === "LLSTH_W");
  assert.ok(southVolume?.definition.includes(shared.id), "the shared edge must be one of LLSTH_W's border ids");
});
