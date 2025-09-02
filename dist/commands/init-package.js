"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initPackage = void 0;
const BASE_PACKAGE_GITHUB_ORG = "neoradar-project";
const BASE_PACKAGE_GITHUB_REPO = "base-package";
const fs_1 = __importDefault(require("fs"));
const ky_1 = __importDefault(require("ky"));
const tmpDir = require("os").tmpdir();
const tmpZipPath = require("path").join(tmpDir, `base-package-${Date.now()}.zip`);
const yauzl_1 = __importDefault(require("yauzl"));
const path_1 = __importDefault(require("path"));
const utils_1 = require("../utils");
const package_config_1 = require("../definitions/package-config");
const ora_1 = __importDefault(require("ora"));
const turf_1 = require("@turf/turf");
const downloadBasePackage = async (packageDirectory, downloadUrl) => {
    const downloadedBytes = await (await ky_1.default.get(downloadUrl)).arrayBuffer();
    // Save to temporary file
    fs_1.default.writeFileSync(tmpZipPath, new Uint8Array(downloadedBytes));
    // Create the package subdirectory
    const packageOutputDir = path_1.default.join(packageDirectory, "package");
    if (!fs_1.default.existsSync(packageOutputDir)) {
        fs_1.default.mkdirSync(packageOutputDir, { recursive: true });
    }
    // Extract zip file to package directory
    await new Promise((resolve, reject) => {
        yauzl_1.default.open(tmpZipPath, { lazyEntries: true }, (err, zipfile) => {
            if (err)
                return reject(err);
            let rootFolderName = "";
            zipfile.readEntry();
            zipfile.on("entry", (entry) => {
                if (/\/$/.test(entry.fileName)) {
                    // Directory entry
                    if (!rootFolderName) {
                        // This is the root folder from GitHub zip
                        rootFolderName = entry.fileName;
                    }
                    zipfile.readEntry();
                }
                else {
                    // File entry
                    zipfile.openReadStream(entry, (err, readStream) => {
                        if (err)
                            return reject(err);
                        // Remove the root folder from the path
                        const relativePath = entry.fileName.replace(rootFolderName, "");
                        const outputPath = path_1.default.join(packageOutputDir, relativePath);
                        const outputDir = path_1.default.dirname(outputPath);
                        if (!fs_1.default.existsSync(outputDir)) {
                            fs_1.default.mkdirSync(outputDir, { recursive: true });
                        }
                        readStream.pipe(fs_1.default.createWriteStream(outputPath));
                        readStream.on("end", () => zipfile.readEntry());
                    });
                }
            });
            zipfile.on("end", () => {
                // Clean up temporary file
                fs_1.default.unlinkSync(tmpZipPath);
                resolve();
            });
        });
    });
};
const createOtherDirectories = (packageDirectory) => {
    const directories = ["sector_files", "euroscope_data", "icao_data", "ASRs"];
    directories.forEach((dir) => {
        const dirPath = path_1.default.join(packageDirectory, dir);
        if (!fs_1.default.existsSync(dirPath)) {
            fs_1.default.mkdirSync(dirPath, { recursive: true });
            console.log(`Created directory: ${dirPath}`);
        }
    });
};
const initPackage = async (packageDirectory, name, latitude, longitude, namespace) => {
    const spinner = (0, ora_1.default)(`Initializing package "${name}" in directory: ${packageDirectory}`).start();
    // Create the package directory if it doesn't exist
    if (!fs_1.default.existsSync(packageDirectory)) {
        fs_1.default.mkdirSync(packageDirectory, { recursive: true });
    }
    else {
        spinner.fail(`Package directory already exists: ${packageDirectory}. Please choose a different name or remove the existing directory.`);
        return;
    }
    spinner.text = `Downloading base package from ${BASE_PACKAGE_GITHUB_ORG}/${BASE_PACKAGE_GITHUB_REPO}...`;
    // Get latest release information with ky
    const response = (await ky_1.default
        .get(`https://api.github.com/repos/${BASE_PACKAGE_GITHUB_ORG}/${BASE_PACKAGE_GITHUB_REPO}/releases/latest`)
        .json());
    const basePackageVersion = response.tag_name;
    const downloadUrl = response.zipball_url;
    spinner.info(`Found latest version: ${basePackageVersion}`);
    await downloadBasePackage(packageDirectory, downloadUrl);
    spinner.info(`Package extracted to: ${packageDirectory}`);
    spinner.text = "Updating manifest.json...";
    const packageJsonPath = path_1.default.join(packageDirectory, "package", "manifest.json");
    // Read the existing manifest.json
    const packageJson = JSON.parse(fs_1.default.readFileSync(packageJsonPath, "utf8"));
    // Update the manifest.json with the new information
    packageJson.name = name + " " + (0, utils_1.getCurrentAiracCycle)();
    packageJson.description = `Package for ${name} sector files, AIRAC cycle ${(0, utils_1.getCurrentAiracCycle)()}`;
    packageJson.id =
        name.toUpperCase().replace(/\s+/g, "_") +
            "_" +
            (0, utils_1.getCurrentAiracCycle)();
    packageJson.basePackageVersion = basePackageVersion;
    packageJson.namespace =
        namespace || name.toLowerCase().replace(/\s+/g, "_");
    // Convert lat and lon to mercator coordinates if provided
    if (latitude !== undefined && longitude !== undefined) {
        const [mercatorX, mercatorY] = (0, turf_1.toMercator)([longitude, latitude]);
        packageJson.centerPoint = [mercatorX, mercatorY];
    }
    // Write the updated manifest.json back to the file
    fs_1.default.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
    spinner.info(`manifest.json updated: ${packageJsonPath}`);
    spinner.text = "Creating additional directories...";
    createOtherDirectories(packageDirectory);
    spinner.text = "Create config.json file...";
    const configFilePath = path_1.default.join(packageDirectory, "config.json");
    fs_1.default.writeFileSync(configFilePath, JSON.stringify(package_config_1.defaultPackageConfig, null, 2));
    spinner.info(`config.json created: ${configFilePath}`);
    spinner.succeed("Package initialization complete.");
};
exports.initPackage = initPackage;
//# sourceMappingURL=init-package.js.map