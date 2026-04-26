"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const build_airways_1 = require("../src/commands/build-airways");
function makeFixture() {
    const dir = node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), "neoradar-airways-"));
    const airway = node_path_1.default.join(dir, "airway.txt");
    const isec = node_path_1.default.join(dir, "isec.txt");
    const out = node_path_1.default.join(dir, "airways.db");
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
(0, node_test_1.default)("parseAirwayFile groups disjoint subnets and respects level", () => {
    const { airwaysByName } = (0, build_airways_1.parseAirwayFile)(AIRWAY_SAMPLE);
    const a1 = airwaysByName.get("A1");
    strict_1.default.ok(a1, "A1 should exist");
    strict_1.default.equal(a1.length, 2, "A1 should have two subnets (B-level chain and H-level pair)");
    const bSub = a1.find((s) => s.level === "B");
    const hSub = a1.find((s) => s.level === "H");
    strict_1.default.equal(bSub.fixes.length, 3, "B subnet has ALPHA/BRAVO/CHARLI");
    strict_1.default.equal(hSub.fixes.length, 2, "H subnet has DELTA/ECHO");
    const bIdents = new Set(bSub.fixes.map((f) => f.ident));
    strict_1.default.deepEqual(bIdents, new Set(["ALPHA", "BRAVO", "CHARLI"]));
});
(0, node_test_1.default)("parseAirwayFile dedupes mirrored segments to one connection per direction", () => {
    const { airwaysByName } = (0, build_airways_1.parseAirwayFile)(AIRWAY_SAMPLE);
    const bSub = airwaysByName.get("A1").find((s) => s.level === "B");
    const pairs = new Set(bSub.segments.map((s) => `${s.fromIdx}->${s.toIdx}`));
    strict_1.default.equal(bSub.segments.length, pairs.size, "no duplicate (from,to) pairs");
    strict_1.default.ok(bSub.segments.length >= 2, "at least two distinct connections");
});
(0, node_test_1.default)("buildAirwaysDb produces correct schema and row counts", () => {
    const fx = makeFixture();
    node_fs_1.default.writeFileSync(fx.airway, AIRWAY_SAMPLE);
    node_fs_1.default.writeFileSync(fx.isec, ISEC_SAMPLE);
    const result = (0, build_airways_1.buildAirwaysDb)({ airwayPath: fx.airway, isecPath: fx.isec, outputPath: fx.out, silent: true });
    const db = new better_sqlite3_1.default(fx.out, { readonly: true });
    const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all()
        .map((r) => r.name);
    strict_1.default.deepEqual(tables, ["airways", "direct_segments", "sqlite_sequence", "waypoints"]);
    const wpCount = db.prepare("SELECT COUNT(*) AS c FROM waypoints").get().c;
    strict_1.default.equal(wpCount, 5, "5 waypoints from ISEC, airway fixes overlap");
    const aCount = db.prepare("SELECT COUNT(*) AS c FROM airways").get().c;
    strict_1.default.equal(aCount, 2, "2 airways: A1/B and A1/H");
    strict_1.default.equal(result.airways, 2);
    const segs = db.prepare("SELECT * FROM direct_segments ORDER BY id").all();
    strict_1.default.equal(segs.length, result.segments);
    for (const s of segs) {
        strict_1.default.ok(s.from_identifier && s.to_identifier && s.airway_name, "denorm columns populated");
        strict_1.default.notEqual(s.from_waypoint_id, s.to_waypoint_id);
    }
    const view = db
        .prepare("SELECT name FROM sqlite_master WHERE type='view' AND name='traversable_paths'")
        .get();
    strict_1.default.ok(view, "traversable_paths view exists");
    db.close();
    node_fs_1.default.rmSync(fx.dir, { recursive: true, force: true });
});
(0, node_test_1.default)("buildAirwaysDb leaves can_traverse=0 for non-traversable segments", () => {
    const fx = makeFixture();
    node_fs_1.default.writeFileSync(fx.airway, AIRWAY_SAMPLE);
    node_fs_1.default.writeFileSync(fx.isec, ISEC_SAMPLE);
    (0, build_airways_1.buildAirwaysDb)({ airwayPath: fx.airway, isecPath: fx.isec, outputPath: fx.out, silent: true });
    const db = new better_sqlite3_1.default(fx.out, { readonly: true });
    const nonTraversable = db
        .prepare("SELECT COUNT(*) AS c FROM direct_segments WHERE can_traverse = 0")
        .get();
    strict_1.default.ok(nonTraversable.c >= 1, "DELTA->ECHO segment is non-traversable (N flag)");
    db.close();
    node_fs_1.default.rmSync(fx.dir, { recursive: true, force: true });
});
(0, node_test_1.default)("buildAirwaysDb is idempotent — rebuilding overwrites cleanly", () => {
    const fx = makeFixture();
    node_fs_1.default.writeFileSync(fx.airway, AIRWAY_SAMPLE);
    node_fs_1.default.writeFileSync(fx.isec, ISEC_SAMPLE);
    (0, build_airways_1.buildAirwaysDb)({ airwayPath: fx.airway, isecPath: fx.isec, outputPath: fx.out, silent: true });
    const r2 = (0, build_airways_1.buildAirwaysDb)({ airwayPath: fx.airway, isecPath: fx.isec, outputPath: fx.out, silent: true });
    const db = new better_sqlite3_1.default(fx.out, { readonly: true });
    const aCount = db.prepare("SELECT COUNT(*) AS c FROM airways").get().c;
    strict_1.default.equal(aCount, r2.airways, "airway count matches second-pass result, no duplicates from prior run");
    db.close();
    node_fs_1.default.rmSync(fx.dir, { recursive: true, force: true });
});
//# sourceMappingURL=build-airways.test.js.map