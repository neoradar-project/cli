import path from "path";
import fs from "fs";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { scanDirectoryRecursive } from "./file-scanner";

export interface S3UploadOptions {
  region: string;
  bucket: string;
  path: string;
  makePublic: boolean;
}

export async function uploadToS3(sourceDir: string, options: S3UploadOptions): Promise<void> {
  try {
    console.log("Initializing S3 upload...");

    const s3Client = new S3Client({ region: options.region });

    const files = scanDirectoryRecursive(sourceDir);
    console.log(`Found ${files.length} files to upload`);

    let uploadedCount = 0;
    const totalFiles = files.length;

    for (const file of files) {
      const sourcePath = path.join(sourceDir, file);
      const s3Key = path.join(options.path, file).replace(/\\/g, "/");

      const fileContent = fs.readFileSync(sourcePath);
      const fileType = getContentType(file);

      try {
        const params: any = {
          Bucket: options.bucket,
          Key: s3Key,
          Body: fileContent,
          ContentType: fileType,
          CacheControl: "max-age=0, no-cache, no-store, must-revalidate",
        };

        if (options.makePublic) {
          params.ACL = "public-read";
        }

        const command = new PutObjectCommand(params);
        await s3Client.send(command);

        uploadedCount++;

        if (uploadedCount % 5 === 0 || uploadedCount === totalFiles) {
          console.log(`Uploading files to S3 (${uploadedCount}/${totalFiles})`);
        }
      } catch (error) {
        console.error(`Failed to upload: ${file}`);
        throw error;
      }
    }

    console.log("S3 upload complete!");
    console.log(`Files uploaded to s3://${options.bucket}/${options.path}`);
  } catch (error) {
    console.error(`S3 upload failed: ${error instanceof Error ? error.message : "Unknown error"}`);
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
