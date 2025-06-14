const BASE_PACKAGE_GITHUB_ORG = "neoradar-project";
const BASE_PACKAGE_GITHUB_REPO = "base-package";

import fs from "fs";
import ky from "ky";
const tmpDir = require("os").tmpdir();
const tmpZipPath = require("path").join(
  tmpDir,
  `base-package-${Date.now()}.zip`
);
import yauzl from "yauzl";
import path from "path";

const downloadBasePackage = async (
  packageDirectory: string,
  downloadUrl: string
) => {
  const downloadedBytes = await (await ky.get(downloadUrl)).arrayBuffer();

  // Save to temporary file
  fs.writeFileSync(tmpZipPath, new Uint8Array(downloadedBytes));

  // Create the package subdirectory
  const packageOutputDir = path.join(packageDirectory, "package");
  if (!fs.existsSync(packageOutputDir)) {
    fs.mkdirSync(packageOutputDir, { recursive: true });
  }

  // Extract zip file to package directory
  await new Promise<void>((resolve, reject) => {
    yauzl.open(tmpZipPath, { lazyEntries: true }, (err: any, zipfile: any) => {
      if (err) return reject(err);

      let rootFolderName = "";

      zipfile.readEntry();
      zipfile.on("entry", (entry: any) => {
        if (/\/$/.test(entry.fileName)) {
          // Directory entry
          if (!rootFolderName) {
            // This is the root folder from GitHub zip
            rootFolderName = entry.fileName;
          }
          zipfile.readEntry();
        } else {
          // File entry
          zipfile.openReadStream(entry, (err: any, readStream: any) => {
            if (err) return reject(err);

            // Remove the root folder from the path
            const relativePath = entry.fileName.replace(rootFolderName, "");
            const outputPath = path.join(packageOutputDir, relativePath);
            const outputDir = path.dirname(outputPath);

            if (!fs.existsSync(outputDir)) {
              fs.mkdirSync(outputDir, { recursive: true });
            }

            readStream.pipe(fs.createWriteStream(outputPath));
            readStream.on("end", () => zipfile.readEntry());
          });
        }
      });

      zipfile.on("end", () => {
        // Clean up temporary file
        fs.unlinkSync(tmpZipPath);
        resolve();
      });
    });
  });
};

export const initPackage = async (
  packageName: string,
  outputDirectory: string
) => {
  const currentDirectory = process.cwd();
  const packageDirectory = outputDirectory || currentDirectory;

  console.log(
    `Initializing package "${packageName}" in directory: ${packageDirectory}`
  );

  // Create the package directory if it doesn't exist
  if (!fs.existsSync(packageDirectory)) {
    fs.mkdirSync(packageDirectory, { recursive: true });
  }

  console.log(
    `Downloading base package from ${BASE_PACKAGE_GITHUB_ORG}/${BASE_PACKAGE_GITHUB_REPO}...`
  );

  // Get latest release information with ky
  const response = (await ky
    .get(
      `https://api.github.com/repos/${BASE_PACKAGE_GITHUB_ORG}/${BASE_PACKAGE_GITHUB_REPO}/releases/latest`
    )
    .json()) as any;

  const version = response.tag_name;
  const downloadUrl = response.zipball_url as string;

  console.log(`Found latest version: ${version}`);

  console.log(`Downloading base package...`);

  await downloadBasePackage(packageDirectory, downloadUrl);

  console.log(`Package extracted to: ${packageDirectory}`);

  console.log("Updating package.json...");
  const packageJsonPath = path.join(packageDirectory, "package", "package.json");

  // Read the existing package.json
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));

  // Update the package.json with the new information
  packageJson.name = packageName;
  packageJson.basePackageVersion = version;

  // Write the updated package.json back to the file
  fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));

  console.log(`package.json updated: ${packageJsonPath}`);
};
