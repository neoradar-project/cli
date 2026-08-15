import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { findLicensedArtifacts, isLicensedArtifactPath, processAllFiles } from "../src/helper/publish/file-scanner";

function makePackageDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "neoradar-package-"));
  fs.mkdirSync(path.join(dir, "datasets"), { recursive: true });
  fs.writeFileSync(path.join(dir, "datasets", "nse.json"), "{}");
  fs.writeFileSync(path.join(dir, "datasets", "airways.db"), "not-a-real-db");
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
