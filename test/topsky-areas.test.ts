import test from "node:test";
import assert from "node:assert/strict";

import { parseAreas } from "../src/commands/converter/topsky/topsky-areas";
import { foldSchedules, offsetMinutes } from "../src/commands/converter/topsky/topsky-active";
import { lex } from "../src/commands/converter/topsky/topsky-lexer";
import { parseActive } from "../src/commands/converter/topsky/topsky-active";

// TopSkyAreas.txt is one file serving five things: the areas the proximity and route probes watch
// and the inhibit areas for the other nets. Every line below is a real UK one.

const EGD064A = [
  "AREA:1:EGD064A",
  "LIMITS:50:660",
  "LABEL:N050.52.46.994:W006.52.33.562:D064A",
  "COORD:N051.20.16.000:W007.11.15.000",
  "COORD:N051.16.16.000:W006.16.43.000",
  "COORD:N050.28.38.000:W006.00.46.000",
  "COORD:N050.17.52.000:W007.05.21.000",
  "ACTIVE:AUP:EGD064A",
];

function parse(lines: string[], zone = "UTC") {
  return parseAreas("TopSkyAreas.txt", lines.join("\n"), zone);
}

function active(line: string) {
  return parseActive(lex("TopSkyAreas.txt", line)[0]);
}

test("the EGD064A block converts end to end", () => {
  const result = parse(EGD064A);

  assert.equal(result.counts.areas, 1);
  const properties = result.features[0].properties!;
  assert.equal(properties.name, "EGD064A");
  assert.equal(properties.kind, "tsa");
  assert.equal(properties.lowerFt, 5000);
  assert.equal(properties.upperFt, 66000);
  assert.deepEqual(properties.activation, [{ kind: "aup", ref: "EGD064A" }]);
  assert.equal((properties.label as { text: string }).text, "D064A");
});

test("LIMITS is hundreds of feet and an absent one is the whole column", () => {
  const withLimits = parse(EGD064A).features[0].properties!;
  assert.equal(withLimits.lowerFt, 5000);
  assert.equal(withLimits.upperFt, 66000);

  const without = parse(EGD064A.filter((line) => !line.startsWith("LIMITS"))).features[0].properties!;
  assert.equal(without.lowerFt, 0);
  assert.equal(without.upperFt, 999999);
});

test("a CIRCLE area carries the circle itself, because that is what the containment test uses", () => {
  const result = parse([
    "AREA:1:EBR08",
    "LIMITS:0:15",
    "ACTIVE:1",
    "CIRCLE:N051.05.25.000:E002.39.10.000:2:5",
  ]);

  const properties = result.features[0].properties!;
  const circle = properties.circle as { x: number; y: number; radiusM: number };
  assert.ok(circle);
  assert.ok(Math.abs(circle.radiusM - 2 * 1852) < 1);
  assert.equal(result.counts.circles, 1);
  assert.ok((result.features[0].geometry as GeoJSON.Polygon).coordinates[0].length > 4, "still drawn as a ring");
});

test("the ACTIVE:ID rule keeps only the lists that are not a wildcard", () => {
  assert.deepEqual(active("ACTIVE:ID:*:*:KTAG:*"), {
    kind: "position",
    yours: [],
    notYours: [],
    online: ["KTAG"],
    notOnline: [],
  });
});

test("ACTIVE:1 is always and ACTIVE:AUP names the feed record", () => {
  assert.deepEqual(active("ACTIVE:1"), { kind: "always" });
  assert.deepEqual(active("ACTIVE:AUP:EGD064A"), { kind: "aup", ref: "EGD064A" });
});

test("a schedule keeps its period, its weekdays and its times, and starts life in UTC", () => {
  assert.deepEqual(active("ACTIVE:0101:0329:12345:1630:0729"), {
    kind: "schedule",
    from: "0101",
    to: "0329",
    days: "12345",
    start: "16:30",
    end: "07:29",
    zone: "UTC",
  });
});

test("the ACTIVE:RWY rule is anchored on its ARR and DEP keywords, not a field count", () => {
  assert.deepEqual(active("ACTIVE:RWY:ARR:27L,27R:09L:DEP:27R"), {
    kind: "runways",
    arr: ["27L", "27R"],
    notArr: ["09L"],
    dep: ["27R"],
    notDep: [],
  });
});

test("an ACTIVE line matching no form is dropped rather than left to never activate silently", () => {
  assert.equal(active("ACTIVE:SOMETHING:ELSE"), null);
});

// The UK file splits one schedule at the daylight-saving dates and its own header says it needs a
// yearly edit. One local-time rule needs none, and the fold is self-checking.
test("the DST-split winter and summer ranges fold into one local rule", () => {
  const rules = [
    active("ACTIVE:0101:0329:12345:1630:0729")!,
    active("ACTIVE:0330:1026:12345:1530:0629")!,
    active("ACTIVE:1027:1231:12345:1630:0729")!,
  ];

  const folded = foldSchedules(rules, "Europe/London");

  assert.equal(folded.folded, 1);
  assert.equal(folded.partial, 0);
  assert.equal(folded.rules.length, 1);
  assert.deepEqual(folded.rules[0], {
    kind: "schedule",
    from: "0101",
    to: "1231",
    days: "12345",
    start: "16:30",
    end: "07:29",
    zone: "Europe/London",
  });
});

test("ranges that do not agree once converted are left as the UTC the file wrote", () => {
  const rules = [
    active("ACTIVE:0101:0329:12345:1630:0729")!,
    active("ACTIVE:0330:1026:12345:1400:0629")!,
    active("ACTIVE:1027:1231:12345:1630:0729")!,
  ];

  const folded = foldSchedules(rules, "Europe/London");

  assert.equal(folded.folded, 0);
  assert.equal(folded.partial, 3);
  assert.equal(folded.rules.length, 3);
  assert.ok(folded.rules.every((rule) => rule.kind === "schedule" && rule.zone === "UTC"));
});

// The two halves of a year either side of a summer period share a local time, and folding them
// into one 0101 to 1231 rule would make the area active all summer under the winter times too.
test("two winter halves either side of a summer gap are NOT folded together", () => {
  const rules = [
    active("ACTIVE:0101:0329:67:0000:2359")!,
    active("ACTIVE:0330:1026:67:0000:2359")!,
    active("ACTIVE:1027:1231:67:0000:2359")!,
  ];

  const folded = foldSchedules(rules, "Europe/London");

  assert.equal(folded.folded, 0);
  assert.equal(folded.rules.length, 3);
});

// A night closure writes two ranges per period. Each one folds on its own rather than being
// compared with the other and called a disagreement.
test("two ranges inside one period fold separately", () => {
  const rules = [
    active("ACTIVE:0101:0329:1234567:0000:0600")!,
    active("ACTIVE:0101:0329:1234567:1800:0000")!,
    active("ACTIVE:0330:1026:1234567:2300:0500")!,
    active("ACTIVE:0330:1026:1234567:1700:2300")!,
    active("ACTIVE:1027:1231:1234567:0000:0600")!,
    active("ACTIVE:1027:1231:1234567:1800:0000")!,
  ];

  const folded = foldSchedules(rules, "Europe/London");

  assert.equal(folded.folded, 2);
  assert.equal(folded.partial, 0);
  assert.equal(folded.rules.length, 2);
  const starts = folded.rules
    .map((rule) => (rule.kind === "schedule" ? rule.start : ""))
    .sort();
  assert.deepEqual(starts, ["00:00", "18:00"]);
});

test("the zone offset comes from the platform's own data, one hour apart across the change", () => {
  assert.equal(offsetMinutes("Europe/London", new Date(Date.UTC(2026, 0, 15, 12))), 0);
  assert.equal(offsetMinutes("Europe/London", new Date(Date.UTC(2026, 5, 15, 12))), 60);
});

test("the NO* lines become the inhibits every net honours", () => {
  const result = parse([
    "AREA:S:SOMEZONE",
    "ACTIVE:1",
    "NOMSAW",
    "NOAIW",
    "COORD:N051.00.00.000:W001.00.00.000",
    "COORD:N052.00.00.000:W001.00.00.000",
    "COORD:N052.00.00.000:E000.00.00.000",
  ]);

  const properties = result.features[0].properties!;
  assert.equal(properties.kind, "stcaInhibit");
  assert.deepEqual(properties.inhibits, ["msaw", "aiw"]);
});

test("the per-area buffer overrides are kept as the three-value triples they are", () => {
  const result = parse([...EGD064A, "APW_BUFFER_LAT:5:5:0", "APW_BUFFER_VERT:2000:2000:0"]);

  const properties = result.features[0].properties!;
  assert.deepEqual(properties.apwBufferLatNm, [5, 5, 0]);
  assert.deepEqual(properties.apwBufferVertFt, [2000, 2000, 0]);
});

test("an area with no usable geometry is dropped rather than written as an empty shape", () => {
  const result = parse(["AREA:1:BROKEN", "LIMITS:0:100", "COORD:N051.00.00.000:W001.00.00.000"]);

  assert.equal(result.counts.areas, 0);
  assert.equal(result.features.length, 0);
});
