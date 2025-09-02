"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanDirectoryRecursive = scanDirectoryRecursive;
exports.processAllFiles = processAllFiles;
exports.calculateTotalSize = calculateTotalSize;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const checksum_1 = require("./checksum");
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