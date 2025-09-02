"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.cliParseSCT = void 0;
const fs_1 = __importDefault(require("fs"));
const sector_file_tools_1 = require("sector-file-tools");
const uuids_1 = require("../../helper/uuids");
const helpers_1 = require("@turf/helpers");
const utils_1 = require("../../utils");
const logger_1 = require("../../helper/logger");
const IGNORED_TYPES = ["low-airway", "high-airway"];
const handleAirwaysUUID = (sctData, features) => {
    sctData.lowAirway.forEach((airway) => {
        const lines = airway.segments.map((segment) => {
            const segmentExtract = (0, utils_1.extractAirwaySegment)(segment);
            return segmentExtract;
        });
        const multiline = (0, helpers_1.multiLineString)(lines);
        multiline.properties = {
            type: "lowAirway",
            uuid: uuids_1.uuidManager.getSharedUUID("lowAirway", airway.id),
            name: airway.id,
        };
        features.push(multiline);
    });
    sctData.highAirway.forEach((airway) => {
        const lines = airway.segments.map((segment) => {
            const segmentExtract = (0, utils_1.extractAirwaySegment)(segment);
            return segmentExtract;
        });
        const multiline = (0, helpers_1.multiLineString)(lines);
        multiline.properties = {
            type: "highAirway",
            uuid: uuids_1.uuidManager.getSharedUUID("highAirway", airway.id),
            name: airway.id,
        };
        features.push(multiline);
    });
};
const cliParseSCT = async (spinner, sctFilePath, eseFilePath, isGNG, outputPath) => {
    // Implementation for parsing SCT files
    spinner.text = `Reading file: ${sctFilePath}`;
    const sctFileContent = await fs_1.default.promises.readFile(sctFilePath, "utf-8");
    if (!sctFileContent) {
        spinner.fail("SCT file is empty or not found.");
    }
    const eseFileContent = await fs_1.default.promises.readFile(eseFilePath, "utf-8");
    if (!eseFileContent) {
        spinner.fail("ESE file is empty or not found.");
        return;
    }
    try {
        spinner.text = "Running GeoTools parser on SCT file...";
        const parsedSCT = (0, sector_file_tools_1.parseSct)(sctFileContent);
        if (!parsedSCT) {
            spinner.fail("Failed to parse SCT file.");
            return;
        }
        const parsedESE = (0, sector_file_tools_1.parseEse)(parsedSCT, eseFileContent);
        if (!parsedESE) {
            spinner.fail("Failed to parse ESE file.");
            return;
        }
        const geoJsonData = (0, sector_file_tools_1.toGeoJson)(parsedSCT, parsedESE, null, true);
        if (!geoJsonData || !geoJsonData.features) {
            spinner.fail("Failed to convert SCT to GeoJSON, no features found.");
            return;
        }
        spinner.text = "Adding UUIDs to GeoJSON features...";
        let features = geoJsonData.features;
        features.forEach((feature) => {
            uuids_1.uuidManager.addUUIDToFeature(feature);
        });
        handleAirwaysUUID(parsedSCT, features);
        // Convert colours
        spinner.text = "Converting colours in GeoJSON features...";
        features.forEach((f) => {
            if (f.properties?.color) {
                f.properties = (0, utils_1.convertColorFeaturePropertyToGeojsonProperties)(f, (f.properties?.type ?? "") === "region").properties;
            }
        });
        const allTypes = new Set();
        features.forEach((feature) => {
            if (feature.properties && feature.properties.type) {
                allTypes.add(feature.properties.type);
            }
        });
        const datasetsToWrite = Array.from(allTypes.keys()).filter((type) => !IGNORED_TYPES.includes(type));
        spinner.info(`Found ${datasetsToWrite.length} datasets to write: ${Array.from(allTypes).join(", ")}`);
        uuids_1.uuidManager.registerTypes(datasetsToWrite);
        spinner.text = `Writing GeoJSON files for types: ${datasetsToWrite.join(", ")}`;
        datasetsToWrite.forEach(async (type) => {
            await (0, utils_1.generateGeoJsonFilesForType)(outputPath, type, features.filter((f) => f.properties?.type === type));
        });
    }
    catch (error) {
        (0, logger_1.logSCTParsingError)(`Failed to parse SCT file: ${sctFilePath}`, error instanceof Error ? error.message : "Unknown error");
        spinner.fail(`Failed to parse SCT file: ${error instanceof Error ? error.message : "Unknown error"}`);
        throw error;
    }
};
exports.cliParseSCT = cliParseSCT;
//# sourceMappingURL=sct.js.map