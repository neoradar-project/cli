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
import { getCurrentAiracCycle } from "../utils";
import { defaultPackageConfig } from "../definitions/package-config";

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

const createOtherDirectories = (packageDirectory: string) => {
  const directories = [
    "sector_files",
    "dist",
    "euroscope_data",
    "icao_data",
    "ASRs",
  ];

  directories.forEach((dir) => {
    const dirPath = path.join(packageDirectory, dir);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
      console.log(`Created directory: ${dirPath}`);
    }
  });
};

export const initPackage = async (
  folderName: string,
  outputDirectory: string,
  namespace: string | undefined,
  name: string | undefined
) => {
  const packageDirectory = outputDirectory;

  console.log(
    `Initializing package "${folderName}" in directory: ${packageDirectory}`
  );

  // Create the package directory if it doesn't exist
  if (!fs.existsSync(packageDirectory)) {
    fs.mkdirSync(packageDirectory, { recursive: true });
  } else {
    console.log(
      `Directory already exists: ${packageDirectory}. Please select another one.`
    );
    return;
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

  const basePackageVersion = response.tag_name;
  const downloadUrl = response.zipball_url as string;

  console.log(`Found latest version: ${basePackageVersion}`);

  console.log(`Downloading base package...`);

  await downloadBasePackage(packageDirectory, downloadUrl);

  console.log(`Package extracted to: ${packageDirectory}`);

  console.log("Updating manifest.json...");
  const packageJsonPath = path.join(
    packageDirectory,
    "package",
    "manifest.json"
  );

  // Read the existing manifest.json
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));

  // Update the manifest.json with the new information
  packageJson.name = (name || folderName) + " " + getCurrentAiracCycle();
  packageJson.description = `Package for ${name || folderName} sector files, AIRAC cycle ${getCurrentAiracCycle()}`;
  packageJson.id = (name || folderName).toUpperCase().replace(/\s+/g, "_") + "_" + getCurrentAiracCycle();
  packageJson.basePackageVersion = basePackageVersion;
  packageJson.namespace = namespace || folderName.toLowerCase().replace(/\s+/g, "_");

  // Write the updated manifest.json back to the file
  fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));

  console.log(`manifest.json updated: ${packageJsonPath}`);

  console.log("Creating additional directories...");
  createOtherDirectories(packageDirectory);


  console.log("Create config.json file...");
  const configFilePath = path.join(packageDirectory, "config.json");

  fs.writeFileSync(configFilePath, JSON.stringify(defaultPackageConfig, null, 2));
  console.log(`config.json created: ${configFilePath}`);

  console.log("Package initialization complete.");
};
