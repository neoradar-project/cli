import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { EseHelper } from "../src/helper/ese-helper";
import { NseNavaid } from "../src/definitions/package-defs";

// A "Only ..." SECTOR block is dropped for non-GNG files, but its OWNER/BORDER/ARRAPT lines still
// follow it in the stream. They used to land on the PREVIOUS sector, because skipping the block
// left currentSector pointing there. In the UK file that refiled 35 volumes under the wrong
// sector: LFAPP CTA-7, owned by LFR, took "Only LLAPP"'s chain and was published as LLN's, which
// handed Farnborough's CTA to whoever held Heathrow North Approach.

async function parse(lines: string[]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "neoradar-only-"));
  const file = path.join(dir, "test.ese");
  fs.writeFileSync(file, lines.join("\n"));
  try {
    return await EseHelper.parseEseContent(file, [] as NseNavaid[], false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("a skipped Only sector does not overwrite the previous sector's owners", async () => {
  const parsed = await parse([
    "[AIRSPACE]",
    "SECTORLINE:LFCTA07",
    "COORD:N051.16.00.000:W000.46.00.000",
    "COORD:N051.17.00.000:W000.46.00.000",
    "COORD:N051.17.00.000:W000.45.00.000",
    "SECTOR:LFAPP CTA-7 (DB-45):0:4500",
    "OWNER:LFR:TCSW:TCS",
    "BORDER:LFCTA07",
    "ARRAPT:EGLF",
    "SECTOR:Only LLAPP:0:9500",
    "OWNER:LLN:LLS:LLF",
    "ARRAPT:EGLL",
    "",
  ]);

  const kept = parsed.sectors.filter((s) => !s.name.startsWith("Only"));
  assert.equal(kept.length, 1, "the Only block must not be published");

  const cta7 = kept[0];
  assert.equal(cta7.name, "LFAPP CTA-7 (DB-45)");
  assert.deepEqual(cta7.owners, ["LFR", "TCSW", "TCS"], "owners were taken from the skipped Only block");
  assert.deepEqual(cta7.arrApts, ["EGLF"], "arrApts were taken from the skipped Only block");
  // BORDER names are replaced by numeric ids during parsing; one entry, and it is LFCTA07's.
  assert.equal(cta7.borders.length, 1);
});

test("a skipped Only sectorline does not extend the previous sectorline's ring", async () => {
  const parsed = await parse([
    "[AIRSPACE]",
    "SECTORLINE:LFCTA07",
    "COORD:N051.16.00.000:W000.46.00.000",
    "COORD:N051.17.00.000:W000.46.00.000",
    "COORD:N051.17.00.000:W000.45.00.000",
    "SECTORLINE:Only LLAPP",
    "COORD:N052.00.00.000:W001.00.00.000",
    "COORD:N052.01.00.000:W001.00.00.000",
    "",
  ]);

  assert.equal(parsed.sectorLines.length, 1, "the Only sectorline must not be published");
  assert.equal(parsed.sectorLines[0].points.length, 3, "the Only block's COORDs were appended to the real ring");
});
