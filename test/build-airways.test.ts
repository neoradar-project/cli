import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

import { buildAirwaysDb, parseAirwayFile } from "../src/commands/build-airways";

function makeFixture(): { dir: string; airway: string; isec: string; out: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "neoradar-airways-"));
  const airway = path.join(dir, "airway.txt");
  const isec = path.join(dir, "isec.txt");
  const out = path.join(dir, "airways.db");
  return { dir, airway, isec, out };
}

const ISEC_SAMPLE = [
  "; comment header",
  ";",
  "ALPHA\t10.000000\t20.000000\t15",
  "BRAVO\t11.000000\t21.000000\t15",
  "CHARLI\t12.000000\t22.000000\t15",
  "DELTA\t13.000000\t23.000000\t15",
  "ECHO\t14.000000\t24.000000\t15",
  "",
].join("\n");

const AIRWAY_SAMPLE = [
  "; header",
  ";",
  "ALPHA\t10.000000\t20.000000\t14\tA1\tB\t\t\t\t\tN\tBRAVO\t11.000000\t21.000000\t\tY",
  "BRAVO\t11.000000\t21.000000\t14\tA1\tB\tALPHA\t10.000000\t20.000000\t\tY\tCHARLI\t12.000000\t22.000000\t\tY",
  "CHARLI\t12.000000\t22.000000\t14\tA1\tB\tBRAVO\t11.000000\t21.000000\t\tY\t\t\t\t\tN",
  "DELTA\t13.000000\t23.000000\t14\tA1\tH\tECHO\t14.000000\t24.000000\t\tN\t\t\t\t\tN",
  "",
].join("\n");

test("parseAirwayFile groups disjoint subnets and respects level", () => {
  const { airwaysByName } = parseAirwayFile(AIRWAY_SAMPLE);
  const a1 = airwaysByName.get("A1");
  assert.ok(a1, "A1 should exist");
  assert.equal(a1!.length, 2, "A1 should have two subnets (B-level chain and H-level pair)");
  const bSub = a1!.find((s) => s.level === "B")!;
  const hSub = a1!.find((s) => s.level === "H")!;
  assert.equal(bSub.fixes.length, 3, "B subnet has ALPHA/BRAVO/CHARLI");
  assert.equal(hSub.fixes.length, 2, "H subnet has DELTA/ECHO");
  const bIdents = new Set(bSub.fixes.map((f) => f.ident));
  assert.deepEqual(bIdents, new Set(["ALPHA", "BRAVO", "CHARLI"]));
});

test("parseAirwayFile dedupes mirrored segments to one connection per direction", () => {
  const { airwaysByName } = parseAirwayFile(AIRWAY_SAMPLE);
  const bSub = airwaysByName.get("A1")!.find((s) => s.level === "B")!;
  const pairs = new Set(bSub.segments.map((s) => `${s.fromIdx}->${s.toIdx}`));
  assert.equal(bSub.segments.length, pairs.size, "no duplicate (from,to) pairs");
  assert.ok(bSub.segments.length >= 2, "at least two distinct connections");
});

test("buildAirwaysDb produces correct schema and row counts", () => {
  const fx = makeFixture();
  fs.writeFileSync(fx.airway, AIRWAY_SAMPLE);
  fs.writeFileSync(fx.isec, ISEC_SAMPLE);

  const result = buildAirwaysDb({ airwayPath: fx.airway, isecPath: fx.isec, outputPath: fx.out, silent: true });

  const db = new Database(fx.out, { readonly: true });
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((r: any) => r.name);
  assert.deepEqual(tables, ["airways", "direct_segments", "waypoints"]);

  const wpCount = (db.prepare("SELECT COUNT(*) AS c FROM waypoints").get() as any).c;
  assert.equal(wpCount, 5, "5 waypoints from ISEC, airway fixes overlap");

  const aCount = (db.prepare("SELECT COUNT(*) AS c FROM airways").get() as any).c;
  assert.equal(aCount, 2, "2 airways: A1/B and A1/H");
  assert.equal(result.airways, 2);

  const segs = db.prepare("SELECT * FROM direct_segments ORDER BY id").all() as any[];
  assert.equal(segs.length, result.segments);
  for (const s of segs) {
    assert.ok(s.from_identifier && s.to_identifier && s.airway_name, "denorm columns populated");
    assert.notEqual(s.from_waypoint_id, s.to_waypoint_id);
  }

  const view = db
    .prepare("SELECT name FROM sqlite_master WHERE type='view' AND name='traversable_paths'")
    .get();
  assert.ok(view, "traversable_paths view exists");

  db.close();
  fs.rmSync(fx.dir, { recursive: true, force: true });
});

test("buildAirwaysDb leaves can_traverse=0 for non-traversable segments", () => {
  const fx = makeFixture();
  fs.writeFileSync(fx.airway, AIRWAY_SAMPLE);
  fs.writeFileSync(fx.isec, ISEC_SAMPLE);

  buildAirwaysDb({ airwayPath: fx.airway, isecPath: fx.isec, outputPath: fx.out, silent: true });

  const db = new Database(fx.out, { readonly: true });
  const nonTraversable = db
    .prepare("SELECT COUNT(*) AS c FROM direct_segments WHERE can_traverse = 0")
    .get() as any;
  assert.ok(nonTraversable.c >= 1, "DELTA->ECHO segment is non-traversable (N flag)");
  db.close();
  fs.rmSync(fx.dir, { recursive: true, force: true });
});

test("buildAirwaysDb is idempotent — rebuilding overwrites cleanly", () => {
  const fx = makeFixture();
  fs.writeFileSync(fx.airway, AIRWAY_SAMPLE);
  fs.writeFileSync(fx.isec, ISEC_SAMPLE);

  buildAirwaysDb({ airwayPath: fx.airway, isecPath: fx.isec, outputPath: fx.out, silent: true });
  const r2 = buildAirwaysDb({ airwayPath: fx.airway, isecPath: fx.isec, outputPath: fx.out, silent: true });

  const db = new Database(fx.out, { readonly: true });
  const aCount = (db.prepare("SELECT COUNT(*) AS c FROM airways").get() as any).c;
  assert.equal(aCount, r2.airways, "airway count matches second-pass result, no duplicates from prior run");
  db.close();
  fs.rmSync(fx.dir, { recursive: true, force: true });
});
