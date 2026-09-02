import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  assertNoLicensedArtifacts,
  findLicensedArtifacts,
  hasSqliteMagic,
  isLicensedArtifact,
  isLicensedArtifactPath,
  processAllFiles,
} from "../src/helper/publish/file-scanner";

const SQLITE_HEADER = Buffer.concat([Buffer.from("SQLite format 3\0", "latin1"), Buffer.alloc(96)]);

function makePackageDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "neoradar-package-"));
  fs.mkdirSync(path.join(dir, "datasets"), { recursive: true });
  fs.writeFileSync(path.join(dir, "datasets", "nse.json"), "{}");
  fs.writeFileSync(path.join(dir, "datasets", "airways.db"), "not-a-real-db");
  fs.writeFileSync(path.join(dir, "manifest.json"), "{}");
  return dir;
}

function makeCleanPackageDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "neoradar-clean-package-"));
  fs.mkdirSync(path.join(dir, "datasets"), { recursive: true });
  fs.writeFileSync(path.join(dir, "datasets", "nse.json"), "{}");
  fs.writeFileSync(path.join(dir, "manifest.json"), "{}");
  return dir;
}

test("isLicensedArtifactPath matches airways.db regardless of directory, not lookalike names", () => {
  assert.ok(isLicensedArtifactPath("airways.db"));
  assert.ok(isLicensedArtifactPath("/pkg/datasets/airways.db"));
  assert.ok(isLicensedArtifactPath("datasets\\airways.db"));
  assert.ok(!isLicensedArtifactPath("myairways.db"), "must not match a filename that merely ends with airways.db");
  assert.ok(!isLicensedArtifactPath("nse.json"));
});

test("isLicensedArtifactPath also catches SQLite WAL/SHM sidecars left by an open connection", () => {
  assert.ok(isLicensedArtifactPath("/pkg/datasets/airways.db-wal"), "airways.db-wal holds live database pages");
  assert.ok(isLicensedArtifactPath("/pkg/datasets/airways.db-shm"));
  assert.ok(isLicensedArtifactPath("/pkg/datasets/airways.db-journal"));
});

test("findLicensedArtifacts flags a stray airways.db inside a package's datasets/", () => {
  const dir = makePackageDir();
  const hits = findLicensedArtifacts(dir);
  assert.deepEqual(hits, [path.join("datasets", "airways.db")]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("processAllFiles with LICENSED_ARTIFACT_EXCLUDE_PATTERNS drops airways.db but keeps nse.json", async () => {
  const dir = makePackageDir();
  const { LICENSED_ARTIFACT_EXCLUDE_PATTERNS } = await import("../src/helper/publish/file-scanner");
  const files = await processAllFiles(dir, LICENSED_ARTIFACT_EXCLUDE_PATTERNS, true);
  const paths = files.map((f) => f.path);
  assert.ok(paths.includes(path.join("datasets", "nse.json")), "nse.json survives");
  assert.ok(!paths.some((p) => isLicensedArtifactPath(p)), "airways.db is excluded");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("isLicensedArtifactPath matches navdata.db and its sidecars", () => {
  assert.ok(isLicensedArtifactPath("sector_files/navdata.db"));
  assert.ok(isLicensedArtifactPath("navdata.db-wal"));
  assert.ok(isLicensedArtifactPath("navdata.db-shm"));
  assert.ok(!isLicensedArtifactPath("mynavdata.db"));
});

test("hasSqliteMagic reads the header, not the extension", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "neoradar-magic-"));
  const renamed = path.join(dir, "enroute.bin");
  const text = path.join(dir, "nse.json");
  fs.writeFileSync(renamed, SQLITE_HEADER);
  fs.writeFileSync(text, "{}");

  assert.ok(hasSqliteMagic(renamed), "a renamed SQLite file still carries its header");
  assert.ok(!hasSqliteMagic(text));
  assert.ok(!hasSqliteMagic(path.join(dir, "does-not-exist")));
  assert.ok(!hasSqliteMagic(dir), "a directory is not a database");

  fs.rmSync(dir, { recursive: true, force: true });
});

test("findLicensedArtifacts catches a database renamed to hide it", () => {
  const dir = makeCleanPackageDir();
  fs.writeFileSync(path.join(dir, "datasets", "enroute.bin"), SQLITE_HEADER);

  assert.deepEqual(findLicensedArtifacts(dir), [path.join("datasets", "enroute.bin")]);

  fs.rmSync(dir, { recursive: true, force: true });
});

test("assertNoLicensedArtifacts throws on a package holding airways.db and passes on a clean one", () => {
  const dirty = makePackageDir();
  assert.throws(() => assertNoLicensedArtifacts(dirty, "Conversion"), /Conversion refused/);
  fs.rmSync(dirty, { recursive: true, force: true });

  const clean = makeCleanPackageDir();
  assert.doesNotThrow(() => assertNoLicensedArtifacts(clean, "Conversion"));
  fs.rmSync(clean, { recursive: true, force: true });
});

test("assertNoLicensedArtifacts on a missing package folder is a no-op", () => {
  assert.doesNotThrow(() => assertNoLicensedArtifacts(path.join(os.tmpdir(), "neoradar-absent-package"), "Conversion"));
});

test("isLicensedArtifact rejects an absolute path by name or by header, which is what distribute filters on", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "neoradar-absolute-"));
  const named = path.join(dir, "airways.db");
  const renamed = path.join(dir, "enroute.bin");
  const keep = path.join(dir, "nse.json");
  fs.writeFileSync(named, "not-a-real-db");
  fs.writeFileSync(renamed, SQLITE_HEADER);
  fs.writeFileSync(keep, "{}");

  assert.ok(isLicensedArtifact(named), "matched on filename");
  assert.ok(isLicensedArtifact(renamed), "matched on the SQLite header despite the harmless name");
  assert.ok(!isLicensedArtifact(keep));
  assert.ok(!isLicensedArtifact(dir), "a directory is not an artifact");

  fs.rmSync(dir, { recursive: true, force: true });
});
