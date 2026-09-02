import fs from "fs";
import path from "path";
import { processFile } from "./checksum";

export interface PackageFile {
  path: string;
  size: number;
  checksum: string;
  isRequired: boolean;
}

// airways.db and navdata.db are Navigraph-derived and server-only. They must never reach a package folder or a
// distributed zip, nor may their SQLite WAL/SHM sidecars, which hold live database pages.
export const LICENSED_ARTIFACT_EXCLUDE_PATTERNS: RegExp[] = [
  /(^|[\\/])airways\.db(-wal|-shm|-journal)?$/i,
  /(^|[\\/])navdata\.db(-wal|-shm|-journal)?$/i,
];

const SQLITE_MAGIC = Buffer.from("SQLite format 3\0", "latin1");

export function isLicensedArtifactPath(candidatePath: string): boolean {
  return LICENSED_ARTIFACT_EXCLUDE_PATTERNS.some((pattern) => pattern.test(candidatePath));
}

// Filename alone is not enough: a renamed database still carries its header.
export function hasSqliteMagic(fullPath: string): boolean {
  let fd: number | undefined;
  try {
    fd = fs.openSync(fullPath, "r");
    const head = Buffer.alloc(SQLITE_MAGIC.length);
    const read = fs.readSync(fd, head, 0, SQLITE_MAGIC.length, 0);
    return read === SQLITE_MAGIC.length && head.equals(SQLITE_MAGIC);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "EISDIR") return false;
    throw error;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

export function isLicensedArtifactFile(baseDir: string, relPath: string): boolean {
  return isLicensedArtifactPath(relPath) || hasSqliteMagic(path.join(baseDir, relPath));
}

// Same test for a path already absolute, e.g. inside an fs.cpSync filter.
export function isLicensedArtifact(fullPath: string): boolean {
  return isLicensedArtifactPath(fullPath) || hasSqliteMagic(fullPath);
}

export function findLicensedArtifacts(baseDir: string): string[] {
  if (!fs.existsSync(baseDir)) return [];
  return scanDirectoryRecursive(baseDir, "", [], true).filter((relPath) => isLicensedArtifactFile(baseDir, relPath));
}

// Hard refusal: stop rather than let a build carry licensed data forward.
export function assertNoLicensedArtifacts(baseDir: string, context: string): void {
  const hits = findLicensedArtifacts(baseDir);
  if (hits.length === 0) return;

  throw new Error(
    `${context} refused: licensed server-only database files found under ${baseDir}:\n` +
      hits.map((relPath) => `  ${relPath}`).join("\n") +
      `\nThese are Navigraph-derived and must not ship in a package. Move them outside the package folder ` +
      `(build-airways writes to server-artifacts/ by default) and re-run.`
  );
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
