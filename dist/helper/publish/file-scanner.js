"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LICENSED_ARTIFACT_EXCLUDE_PATTERNS = void 0;
exports.isLicensedArtifactPath = isLicensedArtifactPath;
exports.hasSqliteMagic = hasSqliteMagic;
exports.isLicensedArtifactFile = isLicensedArtifactFile;
exports.isLicensedArtifact = isLicensedArtifact;
exports.findLicensedArtifacts = findLicensedArtifacts;
exports.assertNoLicensedArtifacts = assertNoLicensedArtifacts;
exports.scanDirectoryRecursive = scanDirectoryRecursive;
exports.processAllFiles = processAllFiles;
exports.calculateTotalSize = calculateTotalSize;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const checksum_1 = require("./checksum");
// airways.db and navdata.db are Navigraph-derived and server-only. They must never reach a package folder or a
// distributed zip, nor may their SQLite WAL/SHM sidecars, which hold live database pages.
exports.LICENSED_ARTIFACT_EXCLUDE_PATTERNS = [
    /(^|[\\/])airways\.db(-wal|-shm|-journal)?$/i,
    /(^|[\\/])navdata\.db(-wal|-shm|-journal)?$/i,
];
const SQLITE_MAGIC = Buffer.from("SQLite format 3\0", "latin1");
function isLicensedArtifactPath(candidatePath) {
    return exports.LICENSED_ARTIFACT_EXCLUDE_PATTERNS.some((pattern) => pattern.test(candidatePath));
}
// Filename alone is not enough: a renamed database still carries its header.
function hasSqliteMagic(fullPath) {
    let fd;
    try {
        fd = fs_1.default.openSync(fullPath, "r");
        const head = Buffer.alloc(SQLITE_MAGIC.length);
        const read = fs_1.default.readSync(fd, head, 0, SQLITE_MAGIC.length, 0);
        return read === SQLITE_MAGIC.length && head.equals(SQLITE_MAGIC);
    }
    catch (error) {
        const code = error.code;
        if (code === "ENOENT" || code === "EISDIR")
            return false;
        throw error;
    }
    finally {
        if (fd !== undefined)
            fs_1.default.closeSync(fd);
    }
}
function isLicensedArtifactFile(baseDir, relPath) {
    return isLicensedArtifactPath(relPath) || hasSqliteMagic(path_1.default.join(baseDir, relPath));
}
// Same test for a path already absolute, e.g. inside an fs.cpSync filter.
function isLicensedArtifact(fullPath) {
    return isLicensedArtifactPath(fullPath) || hasSqliteMagic(fullPath);
}
function findLicensedArtifacts(baseDir) {
    if (!fs_1.default.existsSync(baseDir))
        return [];
    return scanDirectoryRecursive(baseDir, "", [], true).filter((relPath) => isLicensedArtifactFile(baseDir, relPath));
}
// Hard refusal: stop rather than let a build carry licensed data forward.
function assertNoLicensedArtifacts(baseDir, context) {
    const hits = findLicensedArtifacts(baseDir);
    if (hits.length === 0)
        return;
    throw new Error(`${context} refused: licensed server-only database files found under ${baseDir}:\n` +
        hits.map((relPath) => `  ${relPath}`).join("\n") +
        `\nThese are Navigraph-derived and must not ship in a package. Move them outside the package folder ` +
        `(build-airways writes to server-artifacts/ by default) and re-run.`);
}
function scanDirectoryRecursive(baseDir, currentDir = "", excludePatterns = [], ignoreHidden = true) {
    const fullPath = path_1.default.join(baseDir, currentDir);
    const entries = fs_1.default.readdirSync(fullPath, { withFileTypes: true });
    let files = [];
    for (const entry of entries) {
        const relativePath = path_1.default.join(currentDir, entry.name);
        if (ignoreHidden && entry.name.startsWith("."))
            continue;
        const shouldExclude = excludePatterns.some((pattern) => pattern.test(relativePath));
        if (shouldExclude)
            continue;
        if (entry.isDirectory()) {
            files = files.concat(scanDirectoryRecursive(baseDir, relativePath, excludePatterns, ignoreHidden));
        }
        else {
            files.push(relativePath);
        }
    }
    return files;
}
async function processAllFiles(baseDir, excludePatterns = [], ignoreHidden = true) {
    const files = scanDirectoryRecursive(baseDir, "", excludePatterns, ignoreHidden);
    const packageFiles = [];
    for (const file of files) {
        const processedFile = await (0, checksum_1.processFile)(baseDir, file);
        packageFiles.push(processedFile);
    }
    return packageFiles;
}
function calculateTotalSize(baseDir, excludePatterns = [/manifest\.json$/], ignoreHidden = true) {
    const files = scanDirectoryRecursive(baseDir, "", excludePatterns, ignoreHidden);
    let totalSize = 0;
    for (const file of files) {
        const fullPath = path_1.default.join(baseDir, file);
        const stats = fs_1.default.statSync(fullPath);
        totalSize += stats.size;
    }
    return totalSize;
}
//# sourceMappingURL=file-scanner.js.map