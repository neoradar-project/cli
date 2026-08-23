"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SERVER_DATASET_FILENAME = void 0;
exports.emitServerDataset = emitServerDataset;
const crypto_1 = __importDefault(require("crypto"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const version_json_1 = __importDefault(require("../version.json"));
exports.SERVER_DATASET_FILENAME = "server-dataset.json";
const sha256Hex = (value) => crypto_1.default.createHash("sha256").update(value, "utf-8").digest("hex");
function emitServerDataset(packageEnvironmentPath, atcData, nse) {
    const manifestPath = path_1.default.join(packageEnvironmentPath, "package", "manifest.json");
    const manifest = JSON.parse(fs_1.default.readFileSync(manifestPath, "utf-8"));
    const atcDataJson = JSON.stringify(atcData);
    const nseJson = JSON.stringify(nse);
    const envelope = {
        format: "neoradar-server-dataset",
        formatVersion: 1,
        namespace: manifest.namespace,
        packageVersion: manifest.version,
        generator: `neoradar-cli/${version_json_1.default.version}`,
        generatedAt: new Date().toISOString(),
        atcDataSha256: sha256Hex(atcDataJson),
        nseSha256: sha256Hex(nseJson),
    };
    // Splice the pre-stringified sections in verbatim so the embedded bytes are exactly
    // the ones hashed above (no canonicalization drift between hash and embed).
    const head = JSON.stringify(envelope);
    const artifact = `${head.slice(0, -1)},"atcData":${atcDataJson},"nse":${nseJson}}`;
    // Next to the package root, never inside datasets/: server-only, must not ship in the package.
    const outputPath = path_1.default.join(packageEnvironmentPath, exports.SERVER_DATASET_FILENAME);
    fs_1.default.writeFileSync(outputPath, artifact, "utf-8");
    return outputPath;
}
//# sourceMappingURL=server-dataset.js.map