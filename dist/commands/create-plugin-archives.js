"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPluginArchives = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const zlib_1 = __importDefault(require("zlib"));
const util_1 = require("util");
const ora_1 = __importDefault(require("ora"));
const utils_1 = require("../utils");
const gzip = (0, util_1.promisify)(zlib_1.default.gzip);
class PluginArchiver {
    static PLATFORM_EXTENSIONS = {
        ".dll": "windows",
        ".dylib": "mac",
        ".so": "linux",
    };
    verbose = false;
    hasPluginFiles(directory) {
        try {
            const files = fs_1.default.readdirSync(directory);
            return files.some((file) => {
                const ext = path_1.default.extname(file).toLowerCase();
                return Object.keys(PluginArchiver.PLATFORM_EXTENSIONS).includes(ext);
            });
        }
        catch (error) {
            return false;
        }
    }
    async scanBinaries(pluginDir) {
        const binaries = [];
        try {
            const files = fs_1.default.readdirSync(pluginDir);
            for (const file of files) {
                const filePath = path_1.default.join(pluginDir, file);
                const ext = path_1.default.extname(file).toLowerCase();
                // Skip non-plugin files
                if (!Object.keys(PluginArchiver.PLATFORM_EXTENSIONS).includes(ext)) {
                    continue;
                }
                // Parse platform and architecture from filename
                const { platform, architecture } = this.parseFilename(file);
                if (!platform) {
                    if (this.verbose) {
                        console.warn(`Warning: Cannot parse platform/architecture from ${file}`);
                    }
                    continue;
                }
                // Read file data
                const data = fs_1.default.readFileSync(filePath);
                binaries.push({
                    filename: file,
                    platform,
                    architecture,
                    data,
                    originalSize: data.length,
                    compressedSize: 0,
                });
            }
        }
        catch (error) {
            throw new Error(`Failed to scan binaries in ${pluginDir}: ${error instanceof Error ? error.message : "Unknown error"}`);
        }
        return binaries;
    }
    parseFilename(filename) {
        // Expected formats:
        // windows-x64.dll, mac-arm64.dylib, linux-x64.so
        // windows.dll, mac.dylib, linux.so (legacy)
        const ext = path_1.default.extname(filename);
        const nameWithoutExt = path_1.default.basename(filename, ext);
        const platform = PluginArchiver.PLATFORM_EXTENSIONS[ext.toLowerCase()];
        if (!platform) {
            return { platform: "", architecture: "" };
        }
        const dashIndex = nameWithoutExt.indexOf("-");
        const architecture = dashIndex !== -1 ? nameWithoutExt.substring(dashIndex + 1) : "universal"; // Legacy format
        return { platform, architecture };
    }
    async createSingleArchive(pluginName, pluginDir, outputDir, spinner) {
        if (this.verbose) {
            spinner.text = `Processing plugin: ${pluginName}`;
        }
        // Load metadata
        const metadata = {
            name: pluginName,
            created: new Date().toISOString(),
        };
        // Scan for binary files
        const binaries = await this.scanBinaries(pluginDir);
        if (binaries.length === 0) {
            throw new Error(`No plugin binaries found in ${pluginDir}`);
        }
        // Create archive structure
        const archiveData = {
            metadata,
            binaries: {},
        };
        // Process each binary
        let totalOriginal = 0;
        let totalCompressed = 0;
        for (const binary of binaries) {
            if (this.verbose) {
                spinner.text = `Compressing: ${binary.filename}`;
            }
            // Compress binary data
            const compressedData = await gzip(binary.data);
            binary.compressedSize = compressedData.length;
            // Encode as base64
            const base64Data = compressedData.toString("base64");
            // Add to archive
            archiveData.binaries[binary.filename] = {
                originalSize: binary.originalSize,
                compressedSize: binary.compressedSize,
                data: base64Data,
                compressed: true,
            };
            totalOriginal += binary.originalSize;
            totalCompressed += binary.compressedSize;
            if (this.verbose) {
                const ratio = (1 - binary.compressedSize / binary.originalSize) * 100;
                console.log(`  ${binary.filename}: ${binary.originalSize.toLocaleString()} → ${binary.compressedSize.toLocaleString()} bytes (${ratio.toFixed(1)}% smaller)`);
            }
        }
        // Write archive file
        const archivePath = path_1.default.join(outputDir, `${pluginName}.nrplugin`);
        fs_1.default.writeFileSync(archivePath, JSON.stringify(archiveData, null, 2));
        // Summary
        const overallRatio = totalOriginal > 0 ? (1 - totalCompressed / totalOriginal) * 100 : 0;
        if (this.verbose) {
            console.log(`Archive created: ${archivePath}`);
            console.log(`Overall compression: ${totalOriginal.toLocaleString()} → ${totalCompressed.toLocaleString()} bytes (${overallRatio.toFixed(1)}% smaller)`);
        }
        spinner.info(`Created ${pluginName}.nrplugin - ${binaries.length} binaries, ${overallRatio.toFixed(1)}% compression`);
    }
    async createArchives(buildDir, outputDir, verbose = false) {
        this.verbose = verbose;
        // Validate input directory
        if (!fs_1.default.existsSync(buildDir)) {
            throw new Error(`Build directory not found: ${buildDir}`);
        }
        // Create output directory
        fs_1.default.mkdirSync(outputDir, { recursive: true });
        let archivesCreated = 0;
        try {
            const entries = fs_1.default.readdirSync(buildDir, { withFileTypes: true });
            // Process each subdirectory as a potential plugin
            for (const entry of entries) {
                if (!entry.isDirectory())
                    continue;
                const pluginName = entry.name;
                const pluginDir = path_1.default.join(buildDir, pluginName);
                if (this.hasPluginFiles(pluginDir)) {
                    const spinner = (0, ora_1.default)(`Processing ${pluginName}...`).start();
                    try {
                        await this.createSingleArchive(pluginName, pluginDir, outputDir, spinner);
                        archivesCreated++;
                        spinner.succeed(`${pluginName}.nrplugin created successfully`);
                    }
                    catch (error) {
                        spinner.fail(`Failed to create archive for ${pluginName}: ${error instanceof Error ? error.message : "Unknown error"}`);
                        if (this.verbose) {
                            console.error(error);
                        }
                    }
                }
            }
        }
        catch (error) {
            throw new Error(`Failed to read build directory: ${error instanceof Error ? error.message : "Unknown error"}`);
        }
        return archivesCreated;
    }
}
const createPluginArchives = async (buildDir, confirmationRequired = true, outputDir, verbose = false) => {
    console.log(`Creating plugin archives from: ${buildDir}`);
    const resolvedOutputDir = outputDir || path_1.default.join(path_1.default.dirname(buildDir), "plugins");
    if (confirmationRequired) {
        const confirm = await (0, utils_1.askForConfirmation)(`\n⚠️  CAUTION: This operation will:\n` +
            `   • Create .nrplugin archive files in: ${resolvedOutputDir}\n` +
            `   • Override existing .nrplugin files with the same names\n` +
            `   • Compress plugin binaries using gzip compression\n` +
            `\nInput directory: ${buildDir}\n` +
            `Output directory: ${resolvedOutputDir}\n`);
        if (!confirm) {
            console.log("Archive creation aborted by user.");
            return;
        }
    }
    const spinner = (0, ora_1.default)("Scanning for plugin directories...").start();
    try {
        const archiver = new PluginArchiver();
        const archivesCreated = await archiver.createArchives(buildDir, resolvedOutputDir, verbose);
        if (archivesCreated === 0) {
            spinner.fail("No plugin directories with binaries found.");
            return;
        }
        spinner.succeed(`Successfully created ${archivesCreated} plugin archive${archivesCreated !== 1 ? "s" : ""} in ${resolvedOutputDir}`);
        // Show summary of created files
        try {
            const archiveFiles = fs_1.default
                .readdirSync(resolvedOutputDir)
                .filter((file) => file.endsWith(".nrplugin"))
                .map((file) => {
                const filePath = path_1.default.join(resolvedOutputDir, file);
                const stats = fs_1.default.statSync(filePath);
                const sizeKB = (stats.size / 1024).toFixed(1);
                return `  ${file} (${sizeKB} KB)`;
            });
            if (archiveFiles.length > 0) {
                console.log("\nCreated archives:");
                archiveFiles.forEach((file) => console.log(file));
            }
        }
        catch (error) {
            // Ignore errors when listing files
        }
        console.log(`\nPlugin archives ready for distribution!`);
        console.log(`Place the .nrplugin files in your application's plugins directory.`);
    }
    catch (error) {
        spinner.fail(`Archive creation failed: ${error instanceof Error ? error.message : "Unknown error"}`);
        if (verbose) {
            console.error(error);
        }
    }
};
exports.createPluginArchives = createPluginArchives;
//# sourceMappingURL=create-plugin-archives.js.map