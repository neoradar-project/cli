import fs from "fs";
import path from "path";
import { processFile } from "./checksum";

export interface PackageFile {
  path: string;
  size: number;
  checksum: string;
  isRequired: boolean;
}

// airways.db is Navigraph-derived and server-only (server-link addendum D44/A§11) — never ship it (or its SQLite
// WAL/SHM sidecars, which hold live database pages) in a distributed package.
export const LICENSED_ARTIFACT_EXCLUDE_PATTERNS: RegExp[] = [/(^|[\\/])airways\.db(-wal|-shm|-journal)?$/i];

export function isLicensedArtifactPath(candidatePath: string): boolean {
  return LICENSED_ARTIFACT_EXCLUDE_PATTERNS.some((pattern) => pattern.test(candidatePath));
}

export function findLicensedArtifacts(baseDir: string): string[] {
  return scanDirectoryRecursive(baseDir, "", [], true).filter((relPath) => isLicensedArtifactPath(relPath));
}

export function scanDirectoryRecursive(baseDir: string, currentDir: string = "", excludePatterns: RegExp[] = [], ignoreHidden: boolean = true): string[] {
  const fullPath = path.join(baseDir, currentDir);
  const entries = fs.readdirSync(fullPath, { withFileTypes: true });

  let files: string[] = [];

  for (const entry of entries) {
    const relativePath = path.join(currentDir, entry.name);

    if (ignoreHidden && entry.name.startsWith(".")) continue;

    const shouldExclude = excludePatterns.some((pattern) => pattern.test(relativePath));
    if (shouldExclude) continue;

    if (entry.isDirectory()) {
      files = files.concat(scanDirectoryRecursive(baseDir, relativePath, excludePatterns, ignoreHidden));
    } else {
      files.push(relativePath);
    }
  }

  return files;
}

export async function processAllFiles(baseDir: string, excludePatterns: RegExp[] = [], ignoreHidden: boolean = true): Promise<PackageFile[]> {
  const files = scanDirectoryRecursive(baseDir, "", excludePatterns, ignoreHidden);
  const packageFiles: PackageFile[] = [];

  for (const file of files) {
    const processedFile = await processFile(baseDir, file);
    packageFiles.push(processedFile);
  }

  return packageFiles;
}

export function calculateTotalSize(baseDir: string, excludePatterns: RegExp[] = [/manifest\.json$/], ignoreHidden: boolean = true): number {
  const files = scanDirectoryRecursive(baseDir, "", excludePatterns, ignoreHidden);
  let totalSize = 0;

  for (const file of files) {
    const fullPath = path.join(baseDir, file);
    const stats = fs.statSync(fullPath);
    totalSize += stats.size;
  }

  return totalSize;
}
