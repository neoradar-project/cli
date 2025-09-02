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
async function uploadToS3(sourceDir, options) {
    try {
        console.log("Initializing S3 upload...");
        const s3Client = new client_s3_1.S3Client({ region: options.region });
        const files = (0, file_scanner_1.scanDirectoryRecursive)(sourceDir);
        console.log(`Found ${files.length} files to upload`);
        let uploadedCount = 0;
        const totalFiles = files.length;
        for (const file of files) {
            const sourcePath = path_1.default.join(sourceDir, file);
            const s3Key = path_1.default.join(options.path, file).replace(/\\/g, "/");
            const fileContent = fs_1.default.readFileSync(sourcePath);
            const fileType = getContentType(file);
            try {
                const params = {
                    Bucket: options.bucket,
                    Key: s3Key,
                    Body: fileContent,
                    ContentType: fileType,
                    CacheControl: "max-age=0, no-cache, no-store, must-revalidate",
                };
                if (options.makePublic) {
                    params.ACL = "public-read";
                }
                const command = new client_s3_1.PutObjectCommand(params);
                await s3Client.send(command);
                uploadedCount++;
                if (uploadedCount % 5 === 0 || uploadedCount === totalFiles) {
                    console.log(`Uploading files to S3 (${uploadedCount}/${totalFiles})`);
                }
            }
            catch (error) {
                console.error(`Failed to upload: ${file}`);
                throw error;
            }
        }
        console.log("S3 upload complete!");
        console.log(`Files uploaded to s3://${options.bucket}/${options.path}`);
    }
    catch (error) {
        console.error(`S3 upload failed: ${error instanceof Error ? error.message : "Unknown error"}`);
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