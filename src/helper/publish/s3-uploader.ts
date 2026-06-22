import path from "path";
import fs from "fs";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { scanDirectoryRecursive } from "./file-scanner";

const DEFAULT_CACHE_CONTROL = "max-age=0, no-cache, no-store, must-revalidate";

export interface S3UploadOptions {
  region?: string;
  bucket: string;
  path: string;
  makePublic: boolean;
  // "r2" switches to Cloudflare R2 semantics (region "auto", no per-object ACL).
  provider?: "s3" | "r2";
  // Custom S3 endpoint. Required for R2: https://<account-id>.r2.cloudflarestorage.com
  endpoint?: string;
  // Applied to all files except manifest.json. Defaults to no-cache.
  cacheControl?: string;
}

export async function uploadToS3(sourceDir: string, options: S3UploadOptions): Promise<void> {
  const isR2 = options.provider === "r2";

  try {
    console.log(`Initializing ${isR2 ? "R2 (Cloudflare)" : "S3"} upload...`);

    // R2 is S3-compatible: same SDK, but it needs the account endpoint and uses the
    // pseudo-region "auto". Credentials still come from AWS_ACCESS_KEY_ID/SECRET.
    const clientConfig: any = { region: isR2 ? "auto" : options.region };
    if (options.endpoint) {
      clientConfig.endpoint = options.endpoint;
    }

    const s3Client = new S3Client(clientConfig);

    const files = scanDirectoryRecursive(sourceDir);
    console.log(`Found ${files.length} files to upload`);

    let uploadedCount = 0;
    const totalFiles = files.length;

    for (const file of files) {
      const sourcePath = path.join(sourceDir, file);
      const s3Key = path.join(options.path, file).replace(/\\/g, "/");

      const fileContent = fs.readFileSync(sourcePath);
      const fileType = getContentType(file);

      // manifest.json is the mutable index the client polls for updates; it must never
      // be cached or published updates won't propagate. Every other file uses the
      // configured Cache-Control (default: no-cache, which is safe whether or not paths
      // are versioned).
      const isManifest = path.basename(file).toLowerCase() === "manifest.json";
      const cacheControl = isManifest ? DEFAULT_CACHE_CONTROL : options.cacheControl || DEFAULT_CACHE_CONTROL;

      try {
        const params: any = {
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

        const command = new PutObjectCommand(params);
        await s3Client.send(command);

        uploadedCount++;

        if (uploadedCount % 5 === 0 || uploadedCount === totalFiles) {
          console.log(`Uploading files (${uploadedCount}/${totalFiles})`);
        }
      } catch (error) {
        console.error(`Failed to upload: ${file}`);
        throw error;
      }
    }

    console.log(`${isR2 ? "R2" : "S3"} upload complete!`);
    const target = isR2 ? `${options.bucket}/${options.path} (R2)` : `s3://${options.bucket}/${options.path}`;
    console.log(`Files uploaded to ${target}`);
  } catch (error) {
    console.error(`${isR2 ? "R2" : "S3"} upload failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    throw error;
  }
}

function getContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();

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
