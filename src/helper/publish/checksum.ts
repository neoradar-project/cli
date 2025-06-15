import fs from "fs";
import crypto from "crypto";
import path from "path";

export async function calculateFileHash(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);

    stream.on("data", (data) => hash.update(data));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", (error) => reject(error));
  });
}

export async function calculateZipHash(zipPath: string): Promise<string> {
  return calculateFileHash(zipPath);
}

export function getFileSize(filePath: string): number {
  const stats = fs.statSync(filePath);
  return stats.size;
}

export async function processFile(
  basePath: string,
  filePath: string
): Promise<{
  path: string;
  size: number;
  checksum: string;
  isRequired: boolean;
}> {
  const fullPath = path.join(basePath, filePath);
  const size = getFileSize(fullPath);
  const checksum = await calculateFileHash(fullPath);

  return {
    path: filePath,
    size,
    checksum,
    isRequired: true,
  };
}
