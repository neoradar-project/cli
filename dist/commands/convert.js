"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.convertSingleSCT = exports.convert = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const utils_1 = require("../utils");
const ora_1 = __importDefault(require("ora"));
const sct_1 = require("./converter/sct");
const indexer_1 = require("./indexer");
const ese_1 = require("./converter/ese");
const config_1 = require("../helper/config");
const logger_1 = require("../helper/logger");
const atc_data_parser_1 = require("./converter/atc-data-parser");
const asr_1 = __importDefault(require("./converter/asr"));
const convertSCT2AndESEFiles = async (sectorFilesPath, datasetsOutputPath) => {
    const sctSpinner = (0, ora_1.default)("Finding SCT2...").start();
    // Find SCT2 files
    const sctFiles = (0, utils_1.fileFilesWithExtension)(sectorFilesPath, [".sct", ".sct2"]);
    // Find ESE files
    const eseFiles = (0, utils_1.fileFilesWithExtension)(sectorFilesPath, [".ese"]);
    let sctFilePath;
    let eseFilePath;
    let parsedESE;
    // Process SCT2 files
    if (sctFiles.length === 0) {
        sctSpinner.fail("No SCT2 files found, skipping SCT2 conversion.");
    }
    else {
        sctFilePath = path_1.default.join(sectorFilesPath, sctFiles[0]);
        // Get ESE file path if available to pass to cliParseSCT
        if (eseFiles.length > 0) {
            eseFilePath = path_1.default.join(sectorFilesPath, eseFiles[0]);
            await (0, sct_1.cliParseSCTESE)(sctSpinner, sctFilePath, eseFilePath, false, datasetsOutputPath);
            if (logger_1.sctParsingErrorCount > 0) {
                sctSpinner.warn(`SCT2 parsing completed with ${logger_1.sctParsingErrorCount} errors. Check logs for details.`);
            }
            else {
                sctSpinner.succeed("SCT2 parsing completed successfully.");
            }
        }
        else {
            sctSpinner.warn("No ESE file found - cannot process SCT2 without ESE file.");
        }
    }
    // Process ESE files
    const eseSpinner = (0, ora_1.default)("Finding ESE...").start();
    if (eseFiles.length === 0) {
        eseSpinner.fail("No ESE files found, skipping ESE conversion.");
    }
    else {
        if (!eseFilePath) {
            eseFilePath = path_1.default.join(sectorFilesPath, eseFiles[0]);
        }
        const config = (0, config_1.parseConfig)(`${sectorFilesPath}/../`);
        try {
            parsedESE = await ese_1.eseParser.start(eseSpinner, eseFilePath, datasetsOutputPath, config?.sectorFileFromGNG || false);
            if (logger_1.eseParsingErrorCount > 0) {
                eseSpinner.warn(`ESE parsing completed with ${logger_1.eseParsingErrorCount} errors. Check logs for details.`);
            }
            else {
                eseSpinner.succeed("ESE parsing completed successfully.");
            }
        }
        catch (error) {
            eseSpinner.fail(`Error during ESE conversion: ${error instanceof Error ? error.message : "Unknown error"}`);
        }
    }
    return parsedESE;
};
const convertASRFolder = async (packagePath) => {
    const spinner = (0, ora_1.default)("Finding ASR files...").start();
    const asrFolderPath = path_1.default.join(packagePath, "ASRs");
    const profilesOutputPath = path_1.default.join(packagePath, "package", "profiles");
    if (!fs_1.default.existsSync(asrFolderPath)) {
        spinner.info("No ASRs directory found, skipping ASR conversion.");
        return;
    }
    const hasAsrFiles = (dirPath) => {
        try {
            const items = fs_1.default.readdirSync(dirPath);
            for (const item of items) {
                const fullPath = path_1.default.join(dirPath, item);
                const stat = fs_1.default.statSync(fullPath);
                if (stat.isDirectory()) {
                    if (hasAsrFiles(fullPath))
                        return true;
                }
                else if (stat.isFile() && item.toLowerCase().endsWith(".asr")) {
                    return true;
                }
            }
            return false;
        }
        catch (error) {
            return false;
        }
    };
    if (!hasAsrFiles(asrFolderPath)) {
        spinner.info("No ASR files found in ASRs directory, skipping conversion.");
        return;
    }
    try {
        spinner.text = "Converting ASR files to STP profiles...";
        if (!fs_1.default.existsSync(profilesOutputPath)) {
            fs_1.default.mkdirSync(profilesOutputPath, { recursive: true });
        }
        if (fs_1.default.existsSync(profilesOutputPath)) {
            const existingFiles = fs_1.default.readdirSync(profilesOutputPath);
            for (const file of existingFiles) {
                const filePath = path_1.default.join(profilesOutputPath, file);
                const stat = fs_1.default.statSync(filePath);
                if (stat.isFile() && file.endsWith(".stp")) {
                    fs_1.default.unlinkSync(filePath);
                }
            }
        }
        asr_1.default.convertFolder(asrFolderPath, profilesOutputPath);
        spinner.succeed("ASR conversion completed successfully.");
        const countStpFiles = (dirPath) => {
            let count = 0;
            try {
                const items = fs_1.default.readdirSync(dirPath);
                for (const item of items) {
                    const fullPath = path_1.default.join(dirPath, item);
                    const stat = fs_1.default.statSync(fullPath);
                    if (stat.isDirectory()) {
                        count += countStpFiles(fullPath);
                    }
                    else if (stat.isFile() && item.endsWith(".stp")) {
                        count++;
                    }
                }
            }
            catch (error) {
                // Ignore errors when counting
            }
            return count;
        };
        const convertedFilesCount = countStpFiles(profilesOutputPath);
        if (convertedFilesCount > 0) {
            spinner.info(`Converted ${convertedFilesCount} ASR file(s) to STP profiles.`);
        }
    }
    catch (error) {
        spinner.fail(`Error during ASR conversion: ${error instanceof Error ? error.message : "Unknown error"}`);
        console.error("ASR conversion failed:", error);
    }
};
const convert = async (packagePath) => {
    console.log(`Starting conversion for package environment at path: ${packagePath}`);
    const confirm = await (0, utils_1.askForConfirmation)("\n⚠️  CAUTION: This operation will:\n" +
        "   • Override existing geojson datasets with the same names\n" +
        "   • Override fields that require update in the NSE\n" +
        "   • Override the atc-data file\n" +
        "   • Override existing STP profiles\n" +
        "   • Add missing layers to the manifest\n" +
        "   • Index all elements overriding the index in the NSE\n" +
        "IT WILL NOT:\n" +
        "   • Remove or edit existing layers in your manifest\n" +
        "   • Remove custom geojson datasets\n" +
        "   • Remove custom STP profiles\n" +
        "   • Change any systems, images or fonts\n");
    if (!confirm) {
        console.log("Conversion aborted by user.");
        return;
    }
    // We first look for the SCT2 file in the package path
    const sectorFilesPath = `${packagePath}/sector_files`;
    const datasetsOutputPath = `${packagePath}/package/datasets`;
    const parsedESE = await convertSCT2AndESEFiles(sectorFilesPath, datasetsOutputPath);
    await convertASRFolder(packagePath);
    await atc_data_parser_1.atcData.parseAtcdata(packagePath, parsedESE);
    // Running the indexer after conversion
    await (0, indexer_1.indexer)(packagePath, `${datasetsOutputPath}/nse.json`, true);
    console.log(`Conversion completed for package environment at path: ${packagePath}`);
};
exports.convert = convert;
const convertSingleSCT = async (sctFilePath, layerName) => {
    console.log(`Starting conversion for SCT file at path: ${sctFilePath} with new layer name: ${layerName}`);
    const confirm = await (0, utils_1.askForConfirmation)("\n⚠️  CAUTION: This operation will:\n" +
        "   • Override existing geojson file with the same name as the specified layer name\n" +
        "IT WILL ONLY:\n" +
        "   • Create a single geojson file from the SCT file with the specified layer name\n" +
        "IT WILL NOT:\n" +
        "   • Remove or edit your manifest\n" +
        "   • Change any systems, images or fonts\n");
    if (!confirm) {
        console.log("Conversion aborted by user.");
        return;
    }
    const sctSpinner = (0, ora_1.default)("Starting conversion...").start();
    await (0, sct_1.cliParseSingleSCT)(sctSpinner, sctFilePath, layerName);
    // Perform the conversion logic here
};
exports.convertSingleSCT = convertSingleSCT;
//# sourceMappingURL=convert.js.map