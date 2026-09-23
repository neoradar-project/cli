import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { findLabelsFiles, migrateLabelsConfig, migrateLabelsFile, resolveSystemsPath } from "../src/commands/migrate-labels";

const callsign = { itemName: "callsign", color: [255, 255, 255] };
const altitude = { itemName: "computedAltitude" };

const oldAirborne = {
  unconcerned: [[callsign]],
  concerned: [[callsign], [altitude]],
  detailed: [[callsign, altitude]],
  styleVariants: [{ description: "Default", fontSize: 11 }],
};

const oldGround = {
  default: [[callsign]],
  departure: [[altitude]],
  arrival: [[callsign, altitude]],
  detailed: [[altitude]],
  departureDetailed: [[callsign]],
  arrivalDetailed: [[altitude]],
  styleVariants: [{ description: "Ground", fontSize: 10 }],
};

function makeSystemsDir(files: Record<string, unknown>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "neoradar-labels-"));
  for (const [relative, contents] of Object.entries(files)) {
    const filePath = path.join(root, relative);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(contents, null, 2));
  }
  return root;
}

test("airborne row sets become three variants: unconcerned, the six concerned states, then detailed", () => {
  const { config, changed } = migrateLabelsConfig({ $schema: "https://example/labels.schema.json", airborne: oldAirborne });

  assert.ok(changed);
  assert.equal(config.$schema, "https://example/labels.schema.json");
  assert.deepEqual(config.airborne.labels, [
    { description: "Unconcerned", applyToAttentionStates: ["kUnconcerned"], rows: [[callsign]] },
    {
      description: "Concerned",
      applyToAttentionStates: ["kNotified", "kIncomingTransfer", "kAssumed", "kOutgoingTransfer", "kIntruder", "kConcerned"],
      rows: [[callsign], [altitude]],
    },
    { description: "Detailed", detailed: true, rows: [[callsign, altitude]] },
  ]);
  assert.deepEqual(config.airborne.styleVariants, oldAirborne.styleVariants);
});

test("an empty airborne row set still emits its variant, because empty rows now mean no tag", () => {
  const { config } = migrateLabelsConfig({ airborne: { unconcerned: [], concerned: [], detailed: [] } });

  assert.equal(config.airborne.labels.length, 3);
  assert.deepEqual(
    config.airborne.labels.map((label: any) => label.rows),
    [[], [], []]
  );
});

test("ground variants are ordered detailed first, then flight phase, then the catch-all", () => {
  const { config } = migrateLabelsConfig({ ground: oldGround, airborne: oldAirborne });

  assert.deepEqual(config.ground.labels, [
    { description: "Arrival detailed", detailed: true, applyToIsArrival: true, rows: [[altitude]] },
    { description: "Departure detailed", detailed: true, applyToIsDeparture: true, rows: [[callsign]] },
    { description: "Detailed", detailed: true, rows: [[altitude]] },
    { description: "Arrival", applyToIsArrival: true, rows: [[callsign, altitude]] },
    { description: "Departure", applyToIsDeparture: true, rows: [[altitude]] },
    { description: "Default", rows: [[callsign]] },
  ]);
  assert.deepEqual(config.ground.styleVariants, oldGround.styleVariants);
});

test("a ground row set the package never declared emits no variant", () => {
  const { config } = migrateLabelsConfig({ ground: { default: [[callsign]], arrival: [[altitude]] } });

  assert.deepEqual(
    config.ground.labels.map((label: any) => label.description),
    ["Arrival", "Default"]
  );
});

test('a ground "#systemId" reference is passed through verbatim', () => {
  const { config, changed } = migrateLabelsConfig({ ground: "#default", airborne: oldAirborne });

  assert.ok(changed);
  assert.equal(config.ground, "#default");
});

test("a file already carrying labels arrays is reported unchanged and its bytes are left alone", () => {
  const newShape = {
    $schema: "https://example/labels.schema.json",
    tagFontScale: 1.2,
    ground: "#default",
    airborne: { labels: [{ description: "Filtered", applyToFilterStates: ["kUpperFiltered"], rows: [[callsign]] }] },
  };

  const { config, changed } = migrateLabelsConfig(newShape);
  assert.equal(changed, false);
  assert.equal(config, newShape);

  const root = makeSystemsDir({ "default/labels.json": newShape });
  const filePath = path.join(root, "default", "labels.json");
  const before = fs.readFileSync(filePath, "utf-8");

  assert.equal(migrateLabelsFile(filePath).outcome, "already-migrated");
  assert.equal(fs.readFileSync(filePath, "utf-8"), before, "an already-migrated file is not rewritten");

  fs.rmSync(root, { recursive: true, force: true });
});

test("migrating a file twice is a no-op the second time", () => {
  const root = makeSystemsDir({ "lhr/labels.json": { $schema: "x", ground: oldGround, airborne: oldAirborne } });
  const filePath = path.join(root, "lhr", "labels.json");

  assert.equal(migrateLabelsFile(filePath).outcome, "migrated");
  const afterFirst = fs.readFileSync(filePath, "utf-8");

  assert.equal(migrateLabelsFile(filePath).outcome, "already-migrated");
  assert.equal(fs.readFileSync(filePath, "utf-8"), afterFirst);
  assert.ok(afterFirst.endsWith("}\n"), "written with a trailing newline");
  assert.ok(afterFirst.includes('\n  "ground"'), "written with 2-space indentation");

  fs.rmSync(root, { recursive: true, force: true });
});

test("tagFontScale and altitudeFormat survive the migration in their original order", () => {
  const { config } = migrateLabelsConfig({
    $schema: "x",
    tagFontScale: 1.5,
    altitudeFormat: { belowTransition: { prefix: "A", digits: 2 } },
    ground: oldGround,
    airborne: oldAirborne,
  });

  assert.deepEqual(Object.keys(config), ["$schema", "tagFontScale", "altitudeFormat", "ground", "airborne"]);
  assert.equal(config.tagFontScale, 1.5);
  assert.deepEqual(config.altitudeFormat, { belowTransition: { prefix: "A", digits: 2 } });
});

test("findLabelsFiles walks nested system folders and resolveSystemsPath accepts both layouts", () => {
  const built = makeSystemsDir({ "systems/default/labels.json": {}, "systems/lgw/labels.json": {}, "systems/lgw/targets.json": {} });
  assert.equal(resolveSystemsPath(built), path.join(built, "systems"));
  assert.deepEqual(findLabelsFiles(path.join(built, "systems")), [
    path.join(built, "systems", "default", "labels.json"),
    path.join(built, "systems", "lgw", "labels.json"),
  ]);
  fs.rmSync(built, { recursive: true, force: true });

  const environment = makeSystemsDir({ "package/systems/default/labels.json": {} });
  assert.equal(resolveSystemsPath(environment), path.join(environment, "package", "systems"));
  fs.rmSync(environment, { recursive: true, force: true });
});

test("a section that is neither an object nor a reference fails the file instead of dropping it", () => {
  assert.throws(() => migrateLabelsConfig({ airborne: [] as any }), /airborne is present but is not an object/);
  assert.throws(() => migrateLabelsConfig({ ground: 42 as any }), /ground is present but is neither/);

  const root = makeSystemsDir({ "bad/labels.json": { airborne: [] } });
  const result = migrateLabelsFile(path.join(root, "bad", "labels.json"));
  assert.equal(result.outcome, "failed");
  fs.rmSync(root, { recursive: true, force: true });
});
