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
import ora from "ora";
import { toMercator } from "@turf/turf";

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
  const directories = ["sector_files", "euroscope_data", "icao_data", "ASRs"];

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
  latitude: number | undefined,
  longitude: number | undefined,
  namespace: string | undefined,
  name: string | undefined
) => {
  const packageDirectory = outputDirectory;

  const spinner = ora(
    `Initializing package "${folderName}" in directory: ${packageDirectory}`
  ).start();

  // Create the package directory if it doesn't exist
  if (!fs.existsSync(packageDirectory)) {
    fs.mkdirSync(packageDirectory, { recursive: true });
  } else {
    spinner.fail(
      `Package directory already exists: ${packageDirectory}. Please choose a different name or remove the existing directory.`
    );
    return;
  }

  spinner.text = `Downloading base package from ${BASE_PACKAGE_GITHUB_ORG}/${BASE_PACKAGE_GITHUB_REPO}...`;

  // Get latest release information with ky
  const response = (await ky
    .get(
      `https://api.github.com/repos/${BASE_PACKAGE_GITHUB_ORG}/${BASE_PACKAGE_GITHUB_REPO}/releases/latest`
    )
    .json()) as any;

  const basePackageVersion = response.tag_name;
  const downloadUrl = response.zipball_url as string;

  spinner.info(`Found latest version: ${basePackageVersion}`);

  await downloadBasePackage(packageDirectory, downloadUrl);

  spinner.info(`Package extracted to: ${packageDirectory}`);

  spinner.text = "Updating manifest.json...";
  const packageJsonPath = path.join(
    packageDirectory,
    "package",
    "manifest.json"
  );

  // Read the existing manifest.json
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));

  // Update the manifest.json with the new information
  packageJson.name = (name || folderName) + " " + getCurrentAiracCycle();
  packageJson.description = `Package for ${
    name || folderName
  } sector files, AIRAC cycle ${getCurrentAiracCycle()}`;
  packageJson.id =
    (name || folderName).toUpperCase().replace(/\s+/g, "_") +
    "_" +
    getCurrentAiracCycle();
  packageJson.basePackageVersion = basePackageVersion;
  packageJson.namespace =
    namespace || folderName.toLowerCase().replace(/\s+/g, "_");
  
  // Convert lat and lon to mercator coordinates if provided
  if (latitude !== undefined && longitude !== undefined) {
    const [mercatorX, mercatorY] = toMercator([longitude, latitude]);
    packageJson.centerPoint = [mercatorX, mercatorY];
  }

  // Write the updated manifest.json back to the file
  fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));

  spinner.info(`manifest.json updated: ${packageJsonPath}`);

  spinner.text = "Creating additional directories...";
  createOtherDirectories(packageDirectory);

  spinner.text = "Create config.json file...";
  const configFilePath = path.join(packageDirectory, "config.json");

  fs.writeFileSync(
    configFilePath,
    JSON.stringify(defaultPackageConfig, null, 2)
  );
  spinner.info(`config.json created: ${configFilePath}`);

  spinner.succeed("Package initialization complete.");
};
