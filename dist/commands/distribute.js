"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.distributeCommand = void 0;
const ora_1 = __importDefault(require("ora"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const zip_a_folder_1 = require("zip-a-folder");
const indexer_1 = require("./indexer");
const checksum_1 = require("../helper/publish/checksum");
const file_scanner_1 = require("../helper/publish//file-scanner");
const s3_uploader_1 = require("../helper/publish//s3-uploader");
const config_1 = require("../helper/config");
const distributeCommand = async (packageEnvironmentPath, newPackageName, newVersion, skipIndexing, publish, keepDeploy) => {
    const spinner = (0, ora_1.default)("Preparing package for distribution...").start();
    const manifestPath = `${packageEnvironmentPath}/package/manifest.json`;
    if (!fs_1.default.existsSync(manifestPath)) {
        return spinner.fail(`Manifest file not found at ${manifestPath}. Please ensure the package environment is set up correctly.`);
    }
    try {
        if (!skipIndexing) {
            spinner.text = `Running the indexer...`;
            await (0, indexer_1.indexer)(packageEnvironmentPath, undefined, true);
            spinner.info(`Indexer completed successfully.`);
        }
        spinner.text = `Updating manifest general information...`;
        const manifest = JSON.parse(fs_1.default.readFileSync(manifestPath, "utf-8"));
        if (newPackageName) {
            manifest.name = newPackageName;
        }
        if (newVersion) {
            manifest.version = newVersion;
        }
        const newPackageID = newPackageName ? newPackageName.toLocaleUpperCase().replaceAll(" ", "_") + "_" + manifest.version : manifest.id;
        manifest.id = newPackageID;
        manifest.createdAt = new Date().toISOString();
        spinner.text = `Installing fonts in the manifest...`;
        const fontsPath = `${packageEnvironmentPath}/package/fonts`;
        if (fs_1.default.existsSync(fontsPath)) {
            const fontFiles = fs_1.default
                .readdirSync(fontsPath)
                .filter((file) => file.endsWith(".ttf") || file.endsWith(".otf") || file.endsWith(".sdf") || file.endsWith(".fnt"));
            manifest.fonts = manifest.fonts || [];
            let fontsAdded = 0;
            fontFiles.forEach((fontFile) => {
                const fontName = fontFile.replace(/\.(ttf|otf|sdf|fnt)$/, "");
                if (!manifest.fonts.find((f) => f.alias === fontName)) {
                    manifest.fonts.push({ alias: fontName, src: `${fontFile}` });
                    fontsAdded++;
                }
            });
            if (fontsAdded > 0) {
                spinner.info(`Added ${fontsAdded} new fonts to the manifest.`);
            }
            else {
                spinner.info("No new fonts to add to the manifest.");
            }
        }
        else {
            spinner.warn(`Fonts directory not found at ${fontsPath}. Skipping font installation.`);
        }
        fs_1.default.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
        spinner.info(`Manifest updated with new package name: ${newPackageName || manifest.name}`);
        spinner.text = `Preparing package files...`;
        const tempPackagePath = `${packageEnvironmentPath}/temp_package`;
        if (fs_1.default.existsSync(tempPackagePath)) {
            fs_1.default.rmSync(tempPackagePath, { recursive: true, force: true });
        }
        fs_1.default.mkdirSync(tempPackagePath, { recursive: true });
        const packageFiles = fs_1.default.readdirSync(`${packageEnvironmentPath}/package`);
        packageFiles.forEach((file) => {
            const sourcePath = `${packageEnvironmentPath}/package/${file}`;
            const destPath = `${tempPackagePath}/${file}`;
            if (fs_1.default.lstatSync(sourcePath).isDirectory()) {
                fs_1.default.cpSync(sourcePath, destPath, { recursive: true });
            }
            else {
                fs_1.default.copyFileSync(sourcePath, destPath);
            }
        });
        const filesToRemove = [".DS_Store", ".gitkeep"];
        spinner.text = `Cleaning up unnecessary files...`;
        let filesRemovedCounter = 0;
        const removeFilesRecursively = (dir) => {
            const files = fs_1.default.readdirSync(dir);
            files.forEach((file) => {
                const filePath = `${dir}/${file}`;
                if (fs_1.default.lstatSync(filePath).isDirectory()) {
                    removeFilesRecursively(filePath);
                }
                else if (filesToRemove.includes(file)) {
                    fs_1.default.unlinkSync(filePath);
                    spinner.info(`Removed file: ${filePath}`);
                    filesRemovedCounter++;
                }
            });
        };
        removeFilesRecursively(tempPackagePath);
        spinner.info(`Package files prepared for distribution. Removed ${filesRemovedCounter} unnecessary files.`);
        spinner.text = `Creating zip file for distribution...`;
        if (!fs_1.default.existsSync(tempPackagePath)) {
            spinner.fail(`Temporary package path does not exist: ${tempPackagePath}. Please ensure the package environment is set up correctly.`);
            return;
        }
        if (!fs_1.default.existsSync(`${packageEnvironmentPath}/dist`)) {
            fs_1.default.mkdirSync(`${packageEnvironmentPath}/dist`, { recursive: true });
            spinner.info(`Created dist directory at ${packageEnvironmentPath}/dist`);
        }
        const zipFilePath = `${packageEnvironmentPath}/dist/${newPackageID}.zip`;
        await (0, zip_a_folder_1.zip)(tempPackagePath, zipFilePath);
        fs_1.default.rmSync(tempPackagePath, { recursive: true, force: true });
        spinner.info(`Temporary package directory cleaned up: ${tempPackagePath}`);
        spinner.succeed(`Package prepared for distribution successfully! Zip file created at: ${zipFilePath}`);
        if (publish) {
            await handlePublishing(packageEnvironmentPath, newPackageID, manifest, zipFilePath, spinner, keepDeploy);
        }
    }
    catch (error) {
        spinner.fail(`Failed to prepare package for distribution: ${error instanceof Error ? error.message : String(error)}`);
        return;
    }
};
exports.distributeCommand = distributeCommand;
async function handlePublishing(packageEnvironmentPath, packageId, manifest, zipFilePath, spinner, keepDeploy) {
    spinner.text = "Reading publish configuration...";
    const config = (0, config_1.parseConfig)(`${packageEnvironmentPath}`);
    if (!config) {
        spinner.fail(`Configuration file not found or invalid at ${packageEnvironmentPath}/config.json. Please create a valid configuration file.`);
        return;
    }
    if (!config.publish) {
        spinner.info("Publish configuration not found, skipping publishing step.");
        return;
    }
    const publishConfig = config.publish;
    if (!publishConfig.bucketName || !publishConfig.region) {
        spinner.fail("publish config must contain bucketName and region");
        return;
    }
    if (publishConfig.envVariableAccessKeyId && publishConfig.envVariableSecretAccessKey) {
        if (process.env[publishConfig.envVariableAccessKeyId]) {
            process.env.AWS_ACCESS_KEY_ID = process.env[publishConfig.envVariableAccessKeyId];
        }
        if (process.env[publishConfig.envVariableSecretAccessKey]) {
            process.env.AWS_SECRET_ACCESS_KEY = process.env[publishConfig.envVariableSecretAccessKey];
        }
        spinner.info("Using custom environment variables for AWS credentials");
    }
    else {
        spinner.info("Using default AWS credential chain (~/.aws/credentials, IAM roles, etc.)");
    }
    spinner.text = "Setting up deployment structure...";
    const deployDir = path_1.default.join(packageEnvironmentPath, "deploy");
    const distDir = path_1.default.join(deployDir, "dist");
    const filesDir = path_1.default.join(deployDir, "files");
    if (fs_1.default.existsSync(deployDir)) {
        fs_1.default.rmSync(deployDir, { recursive: true, force: true });
    }
    fs_1.default.mkdirSync(distDir, { recursive: true });
    fs_1.default.mkdirSync(filesDir, { recursive: true });
    const deployZipPath = path_1.default.join(distDir, path_1.default.basename(zipFilePath));
    fs_1.default.copyFileSync(zipFilePath, deployZipPath);
    spinner.text = "Calculating package checksums...";
    const zipSize = fs_1.default.statSync(deployZipPath).size;
    const zipChecksum = await (0, checksum_1.calculateZipHash)(deployZipPath);
    spinner.text = "Processing package files for delta updates...";
    const packageDir = path_1.default.join(packageEnvironmentPath, "package");
    const packageFiles = await (0, file_scanner_1.processAllFiles)(packageDir, [], true);
    for (const file of packageFiles) {
        const sourcePath = path_1.default.join(packageDir, file.path);
        const targetPath = path_1.default.join(filesDir, file.path);
        fs_1.default.mkdirSync(path_1.default.dirname(targetPath), { recursive: true });
        fs_1.default.copyFileSync(sourcePath, targetPath);
    }
    spinner.text = "Generating provider manifest...";
    const s3Path = publishConfig.s3Path || packageId;
    const baseUrl = publishConfig.baseUrl || `https://${publishConfig.bucketName}.s3.${publishConfig.region}.amazonaws.com/${s3Path}`;
    const downloadUrl = publishConfig.downloadUrl || `${baseUrl}/dist/${path_1.default.basename(zipFilePath)}`;
    const providerManifest = {
        schemaVersion: "1.0.0",
        updatedAt: new Date().toISOString(),
        packageInfo: {
            id: manifest.id,
            name: manifest.name,
            description: manifest.description || "",
            version: manifest.version,
            namespace: manifest.namespace,
            createdAt: manifest.createdAt,
            downloadUrl: downloadUrl,
            deltaFilesBaseUrl: `${baseUrl}/files`,
            size: zipSize,
            checksums: {
                sha256: zipChecksum,
            },
            files: packageFiles,
        },
    };
    const manifestOutputPath = path_1.default.join(deployDir, "manifest.json");
    fs_1.default.writeFileSync(manifestOutputPath, JSON.stringify(providerManifest, null, 2));
    spinner.info(`Provider manifest generated: ${manifestOutputPath}`);
    spinner.info(`Delta files set up in: ${filesDir}`);
    spinner.info(`Total files: ${packageFiles.length}`);
    spinner.text = "Uploading to S3...";
    try {
        await (0, s3_uploader_1.uploadToS3)(deployDir, {
            region: publishConfig.region,
            bucket: publishConfig.bucketName,
            path: s3Path,
            makePublic: publishConfig.makePublic !== false,
        });
        spinner.succeed("Package published successfully!");
        spinner.info(`Package available at: ${baseUrl}`);
        spinner.info(`Manifest URL: ${baseUrl}/manifest.json`);
        spinner.info(`Download URL: ${downloadUrl}`);
        const shouldKeepDeploy = keepDeploy || publishConfig.keepDeploy;
        if (shouldKeepDeploy) {
            spinner.info(`Deploy directory preserved at: ${deployDir}`);
        }
        else {
            fs_1.default.rmSync(deployDir, { recursive: true, force: true });
            spinner.info("Deploy directory cleaned up");
        }
    }
    catch (error) {
        spinner.fail(`Failed to upload to S3: ${error instanceof Error ? error.message : "Unknown error"}`);
        throw error;
    }
}
//# sourceMappingURL=distribute.js.map