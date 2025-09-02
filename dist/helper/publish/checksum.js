"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateFileHash = calculateFileHash;
exports.calculateZipHash = calculateZipHash;
exports.getFileSize = getFileSize;
exports.processFile = processFile;
const fs_1 = __importDefault(require("fs"));
const crypto_1 = __importDefault(require("crypto"));
const path_1 = __importDefault(require("path"));
async function calculateFileHash(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto_1.default.createHash("sha256");
        const stream = fs_1.default.createReadStream(filePath);
        stream.on("data", (data) => hash.update(data));
        stream.on("end", () => resolve(hash.digest("hex")));
        stream.on("error", (error) => reject(error));
    });
}
async function calculateZipHash(zipPath) {
    return calculateFileHash(zipPath);
}
function getFileSize(filePath) {
    const stats = fs_1.default.statSync(filePath);
    return stats.size;
}
async function processFile(basePath, filePath) {
    const fullPath = path_1.default.join(basePath, filePath);
    const size = getFileSize(fullPath);
    const checksum = await calculateFileHash(fullPath);
    return {
        path: filePath,
        size,
        checksum,
        isRequired: true,
    };
}
//# sourceMappingURL=checksum.js.map