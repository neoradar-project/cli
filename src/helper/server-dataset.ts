import crypto from "crypto";
import fs from "fs";
import path from "path";
import versionInfo from "../version.json";
import { ATCData } from "../definitions/package-atc-data";
import { NseNavaid, PackageAtcPosition, PackageManifest, PackageProcedure } from "../definitions/package-defs";

// Spec ruling P6 (2026-08-22 admin panel design): the artifact carries RAW importer
// inputs; the Go server does all geometry resolution. No runway section, no mapItemsIndex.
export interface ServerDatasetNse {
  position: PackageAtcPosition[];
  procedure: PackageProcedure[];
  vor: NseNavaid[];
  ndb: NseNavaid[];
  fix: NseNavaid[];
  airport: NseNavaid[];
}

export const SERVER_DATASET_FILENAME = "server-dataset.json";

const sha256Hex = (value: string): string => crypto.createHash("sha256").update(value, "utf-8").digest("hex");

export function emitServerDataset(packageEnvironmentPath: string, atcData: ATCData, nse: ServerDatasetNse): string {
  const manifestPath = path.join(packageEnvironmentPath, "package", "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as PackageManifest;

  const atcDataJson = JSON.stringify(atcData);
  const nseJson = JSON.stringify(nse);

  const envelope = {
    format: "neoradar-server-dataset",
    formatVersion: 1,
    namespace: manifest.namespace,
    packageVersion: manifest.version,
    generator: `neoradar-cli/${versionInfo.version}`,
    generatedAt: new Date().toISOString(),
    atcDataSha256: sha256Hex(atcDataJson),
    nseSha256: sha256Hex(nseJson),
  };

  // Splice the pre-stringified sections in verbatim so the embedded bytes are exactly
  // the ones hashed above (no canonicalization drift between hash and embed).
  const head = JSON.stringify(envelope);
  const artifact = `${head.slice(0, -1)},"atcData":${atcDataJson},"nse":${nseJson}}`;

  // Next to the package root, never inside datasets/: server-only, must not ship in the package.
  const outputPath = path.join(packageEnvironmentPath, SERVER_DATASET_FILENAME);
  fs.writeFileSync(outputPath, artifact, "utf-8");
  return outputPath;
}
