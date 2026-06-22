"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadToS3 = uploadToS3;
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const client_s3_1 = require("@aws-sdk/client-s3");
const file_scanner_1 = require("./file-scanner");
const DEFAULT_CACHE_CONTROL = "max-age=0, no-cache, no-store, must-revalidate";
async function uploadToS3(sourceDir, options) {
    const isR2 = options.provider === "r2";
    try {
        console.log(`Initializing ${isR2 ? "R2 (Cloudflare)" : "S3"} upload...`);
        // R2 is S3-compatible: same SDK, but it needs the account endpoint and uses the
        // pseudo-region "auto". Credentials still come from AWS_ACCESS_KEY_ID/SECRET.
        const clientConfig = { region: isR2 ? "auto" : options.region };
        if (options.endpoint) {
            clientConfig.endpoint = options.endpoint;
        }
        const s3Client = new client_s3_1.S3Client(clientConfig);
        const files = (0, file_scanner_1.scanDirectoryRecursive)(sourceDir);
        console.log(`Found ${files.length} files to upload`);
        let uploadedCount = 0;
        const totalFiles = files.length;
        for (const file of files) {
            const sourcePath = path_1.default.join(sourceDir, file);
            const s3Key = path_1.default.join(options.path, file).replace(/\\/g, "/");
            const fileContent = fs_1.default.readFileSync(sourcePath);
            const fileType = getContentType(file);
            // manifest.json is the mutable index the client polls for updates; it must never
            // be cached or published updates won't propagate. Every other file uses the
            // configured Cache-Control (default: no-cache, which is safe whether or not paths
            // are versioned).
            const isManifest = path_1.default.basename(file).toLowerCase() === "manifest.json";
            const cacheControl = isManifest ? DEFAULT_CACHE_CONTROL : options.cacheControl || DEFAULT_CACHE_CONTROL;
            try {
                const params = {
                    Bucket: options.bucket,
                    Key: s3Key,
                    Body: fileContent,
                    ContentType: fileType,
                    CacheControl: cacheControl,
                };
                // R2 does not support per-object ACLs - public access is granted by binding a
                // custom domain (or enabling r2.dev), so only send ACL for real S3.
                if (options.makePublic && !isR2) {
                    params.ACL = "public-read";
                }
                const command = new client_s3_1.PutObjectCommand(params);
                await s3Client.send(command);
                uploadedCount++;
                if (uploadedCount % 5 === 0 || uploadedCount === totalFiles) {
                    console.log(`Uploading files (${uploadedCount}/${totalFiles})`);
                }
            }
            catch (error) {
                console.error(`Failed to upload: ${file}`);
                throw error;
            }
        }
        console.log(`${isR2 ? "R2" : "S3"} upload complete!`);
        const target = isR2 ? `${options.bucket}/${options.path} (R2)` : `s3://${options.bucket}/${options.path}`;
        console.log(`Files uploaded to ${target}`);
    }
    catch (error) {
        console.error(`${isR2 ? "R2" : "S3"} upload failed: ${error instanceof Error ? error.message : "Unknown error"}`);
        throw error;
    }
}
function getContentType(filePath) {
    const ext = path_1.default.extname(filePath).toLowerCase();
    switch (ext) {
        case ".json":
            return "application/json";
        case ".zip":
            return "application/zip";
        case ".png":
            return "image/png";
        case ".jpg":
        case ".jpeg":
            return "image/jpeg";
        case ".txt":
            return "text/plain";
        case ".yaml":
        case ".yml":
            return "application/yaml";
        case ".ttf":
            return "font/ttf";
        case ".wav":
            return "audio/wav";
        case ".geojson":
            return "application/geo+json";
        default:
            return "application/octet-stream";
    }
}
//# sourceMappingURL=s3-uploader.js.map