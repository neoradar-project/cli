import test, { after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Ora } from "ora";

import { eseParser } from "../src/commands/converter/ese";
import { atcData } from "../src/commands/converter/atc-data-parser";
import { emitServerDataset } from "../src/helper/server-dataset";
import versionInfo from "../src/version.json";

const NAVAID_TYPES = ["vor", "ndb", "fix", "airport"] as const;

const fakeSpinner = { text: "", info() {}, warn() {}, fail() {}, succeed() {} } as unknown as Ora;

const sha256Hex = (value: string): string => crypto.createHash("sha256").update(value, "utf-8").digest("hex");

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

function makePackageEnvironment(): string {
  const envDir = fs.mkdtempSync(path.join(os.tmpdir(), "neoradar-env-"));
  const datasetsDir = path.join(envDir, "package", "datasets");
  fs.mkdirSync(datasetsDir, { recursive: true });

  fs.writeFileSync(
    path.join(envDir, "package", "manifest.json"),
    JSON.stringify({ name: "Test Package", id: "TEST_PACKAGE_1.2.3", version: "1.2.3", namespace: "testvacc", mapLayers: [] })
  );

  for (const type of NAVAID_TYPES) {
    fs.writeFileSync(path.join(datasetsDir, `${type}.geojson`), navaidFeatureCollection(type, type.toUpperCase() + "1"));
  }

  const eseContent = [
    "[POSITIONS]",
    "LON_CTR:London Control:127.100:LON:L:LON:CTR:::0401:0407:N051.28.40.000:W000.27.05.000",
    "",
    "[SIDSSTARS]",
    "SID:EGLL:27R:BPK7F:BPK WOBUN",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(envDir, "test.ese"), eseContent);

  return envDir;
}

interface PipelineResult {
  envDir: string;
  artifactPath: string;
  artifact: any;
  artifactRaw: string;
  packagedNse: any;
  atcDataOnDisk: string;
}

let pipelinePromise: Promise<PipelineResult> | null = null;

// Runs the same stages convert() wires together: ESE parse (writes nse.json),
// ATC data parse (writes atc-data.json), then the artifact emission under test.
function runPipelineOnce(): Promise<PipelineResult> {
  pipelinePromise ??= (async () => {
    const envDir = makePackageEnvironment();
    const datasetsDir = path.join(envDir, "package", "datasets");

    const eseResult = await eseParser.start(fakeSpinner, path.join(envDir, "test.ese"), datasetsDir, false);
    assert.ok(eseResult, "ESE parse must succeed for the fixture");

    const parsedAtcData = await atcData.parseAtcdata(envDir, eseResult.parsedEse);

    const artifactPath = emitServerDataset(envDir, parsedAtcData, {
      position: eseResult.parsedEse.position,
      procedure: eseResult.parsedEse.procedure,
      vor: eseResult.navaidsByType.vor,
      ndb: eseResult.navaidsByType.ndb,
      fix: eseResult.navaidsByType.fix,
      airport: eseResult.navaidsByType.airport,
    });

    const artifactRaw = fs.readFileSync(artifactPath, "utf-8");
    return {
      envDir,
      artifactPath,
      artifact: JSON.parse(artifactRaw),
      artifactRaw,
      packagedNse: JSON.parse(fs.readFileSync(path.join(datasetsDir, "nse.json"), "utf-8")),
      atcDataOnDisk: fs.readFileSync(path.join(datasetsDir, "atc-data.json"), "utf-8"),
    };
  })();
  return pipelinePromise;
}

after(async () => {
  if (!pipelinePromise) return;
  const { envDir } = await pipelinePromise.catch(() => ({ envDir: "" }));
  if (envDir) fs.rmSync(envDir, { recursive: true, force: true });
});

test("server-dataset artifact lands next to the package root, not inside datasets/", async () => {
  const { envDir, artifactPath } = await runPipelineOnce();
  assert.equal(artifactPath, path.join(envDir, "server-dataset.json"));
  assert.ok(fs.existsSync(artifactPath));
  assert.ok(!fs.existsSync(path.join(envDir, "package", "datasets", "server-dataset.json")));
  assert.ok(!fs.existsSync(path.join(envDir, "package", "server-dataset.json")));
});

test("artifact carries the pinned envelope fields from the manifest and CLI version", async () => {
  const { artifact } = await runPipelineOnce();
  assert.equal(artifact.format, "neoradar-server-dataset");
  assert.equal(artifact.formatVersion, 1);
  assert.equal(artifact.namespace, "testvacc");
  assert.equal(artifact.packageVersion, "1.2.3");
  assert.equal(artifact.generator, `neoradar-cli/${versionInfo.version}`);
  assert.ok(!Number.isNaN(Date.parse(artifact.generatedAt)), "generatedAt must be a parseable ISO8601 timestamp");
  assert.ok(artifact.generatedAt.endsWith("Z"), "generatedAt must be UTC");
});

test("sha256 fields verify against the embedded atcData and nse sections", async () => {
  const { artifact, atcDataOnDisk } = await runPipelineOnce();
  assert.equal(sha256Hex(JSON.stringify(artifact.atcData)), artifact.atcDataSha256);
  assert.equal(sha256Hex(JSON.stringify(artifact.nse)), artifact.nseSha256);
  assert.equal(JSON.stringify(artifact.atcData), atcDataOnDisk, "embedded atcData must be the same object the build wrote to datasets/atc-data.json");
});

test("vor/ndb/fix/airport are artifact-alive but absent from the packaged nse.json", async () => {
  const { artifact, packagedNse } = await runPipelineOnce();

  for (const type of NAVAID_TYPES) {
    assert.ok(Array.isArray(artifact.nse[type]), `${type} section present in artifact`);
    assert.equal(artifact.nse[type].length, 1, `${type} section populated from the retained navaid parse`);
    assert.ok(!(type in packagedNse), `${type} must not appear in packaged nse.json`);
  }
  assert.ok(!("runway" in artifact.nse), "no runway section in the artifact");
  assert.ok(!("mapItemsIndex" in artifact.nse), "no mapItemsIndex in the artifact");

  assert.ok(artifact.nse.position.length >= 1, "position section populated");
  assert.ok(artifact.nse.procedure.length >= 1, "procedure section populated");
  assert.deepEqual(artifact.nse.position, packagedNse.position, "position matches what the package ships");
  assert.deepEqual(artifact.nse.procedure, packagedNse.procedure, "procedure matches what the package ships");
});
