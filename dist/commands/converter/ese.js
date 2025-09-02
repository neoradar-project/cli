"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.eseParser = void 0;
const fs_1 = __importDefault(require("fs"));
const projection_1 = require("@turf/projection");
const ese_helper_1 = require("../../helper/ese-helper");
const utils_1 = require("../../utils");
const nse_1 = require("../../helper/nse");
const logger_1 = require("../../helper/logger");
class ESEParser {
    static NAVAID_TYPES = ["vor", "ndb", "fix", "airport"];
    isGNG = false;
    datasetOutputPath = "";
    nsePath = "";
    async start(spinner, eseFilePath, datasetOutputPath, isGNG) {
        this.datasetOutputPath = datasetOutputPath;
        this.isGNG = isGNG;
        this.nsePath = `${datasetOutputPath}/nse.json`;
        spinner.info(`Parsing ESE file: ${eseFilePath}`);
        const parsedEseData = await this.generateNavdata(eseFilePath);
        return parsedEseData;
    }
    async generateNavdata(eseFilePath) {
        try {
            const allNavaids = await this.processNavaids();
            await this.processRunways();
            const parsedEse = await this.processEseContent(eseFilePath, allNavaids);
            return parsedEse;
        }
        catch (error) {
            (0, logger_1.logESEParsingError)(`Failed to generate navdata: ${error}`);
            throw error;
        }
    }
    async processNavaids() {
        const allNavaids = [];
        for (const type of ESEParser.NAVAID_TYPES) {
            const filePath = `${this.datasetOutputPath}/${type}.geojson`;
            if (!fs_1.default.existsSync(filePath)) {
                (0, logger_1.logESEParsingWarning)(`${type}.geojson file not found at: ${filePath}`);
                continue;
            }
            try {
                const typeData = this.readGeoJsonFeatures(filePath);
                const processedData = typeData
                    .map(item => this.processNavaidItem(item, type))
                    .filter((item) => item !== null);
                (0, nse_1.updateNSE)(this.datasetOutputPath, type, processedData);
                allNavaids.push(...processedData);
            }
            catch (error) {
                (0, logger_1.logESEParsingError)(`Failed to process ${type} navaid data from ${filePath}: ${error}`);
            }
        }
        return allNavaids;
    }
    processNavaidItem(item, type) {
        const itemSource = JSON.stringify(item);
        if (!item.properties?.uuid) {
            (0, logger_1.logESEParsingError)(`Missing UUID for ${type} navaid: ${item.properties?.name || 'unnamed'}. Source: ${itemSource}`);
            return null;
        }
        if (!item.geometry?.coordinates || !Array.isArray(item.geometry.coordinates)) {
            (0, logger_1.logESEParsingError)(`Invalid geometry coordinates for ${type} navaid: ${item.properties.name}. Source: ${itemSource}`);
            return null;
        }
        const [lon, lat] = item.geometry.coordinates;
        if (typeof lon !== 'number' || typeof lat !== 'number') {
            (0, logger_1.logESEParsingError)(`Invalid coordinate values for ${type} navaid ${item.properties.name}: lon=${lon}, lat=${lat}. Source: ${itemSource}`);
            return null;
        }
        try {
            const [wgsLon, wgsLat] = (0, projection_1.toWgs84)([lon, lat]);
            const featureName = (0, utils_1.getFeatureName)(item);
            if (!featureName) {
                (0, logger_1.logESEParsingError)(`No valid name found for ${type} navaid: ${item.properties.name}. Source: ${itemSource}`);
                return null;
            }
            return {
                name: featureName,
                freq: item.properties.freq,
                type: item.properties.type,
                x: lat,
                y: lon,
                lat: wgsLat,
                lon: wgsLon,
                uuid: item.properties.uuid,
            };
        }
        catch (error) {
            (0, logger_1.logESEParsingError)(`Failed to transform coordinates for ${type} navaid ${item.properties.name}: ${error}. Source: ${itemSource}`);
            return null;
        }
    }
    async processRunways() {
        const runwaysFilePath = `${this.datasetOutputPath}/runway.geojson`;
        if (!fs_1.default.existsSync(runwaysFilePath)) {
            (0, logger_1.logESEParsingWarning)(`runway.geojson file not found at: ${runwaysFilePath}`);
            return;
        }
        try {
            const runwaysData = this.readGeoJsonFeatures(runwaysFilePath);
            const nseRunways = runwaysData
                .map(item => this.processRunwayItem(item))
                .filter((item) => item !== null);
            (0, nse_1.updateNSE)(this.datasetOutputPath, "runway", nseRunways);
        }
        catch (error) {
            (0, logger_1.logESEParsingError)(`Failed to process runway data from ${runwaysFilePath}: ${error}`);
        }
    }
    processRunwayItem(item) {
        const itemSource = JSON.stringify(item);
        if (!item.properties?.uuid) {
            (0, logger_1.logESEParsingError)(`Missing UUID for runway: ${item.properties?.name || 'unnamed'}. Source: ${itemSource}`);
            return null;
        }
        const featureName = (0, utils_1.getFeatureName)(item);
        if (!featureName) {
            (0, logger_1.logESEParsingError)(`No valid name found for runway: ${item.properties.name}. Source: ${itemSource}`);
            return null;
        }
        return {
            id: item.id,
            name: featureName,
            oppositeId: item.properties.oppositeId,
            type: item.properties.type,
            icao: item.properties.icao,
            uuid: item.properties.uuid,
        };
    }
    async processEseContent(eseFilePath, allNavaids) {
        try {
            const eseProcessedData = await ese_helper_1.EseHelper.parseEseContent(eseFilePath, allNavaids, this.isGNG);
            (0, nse_1.updateNSE)(this.datasetOutputPath, "position", eseProcessedData.position);
            (0, nse_1.updateNSE)(this.datasetOutputPath, "procedure", eseProcessedData.procedure);
            return eseProcessedData;
        }
        catch (error) {
            (0, logger_1.logESEParsingError)(`Failed to process ESE content from ${eseFilePath}: ${error}`);
        }
        return undefined;
    }
    readGeoJsonFeatures(filePath) {
        try {
            const content = fs_1.default.readFileSync(filePath, "utf-8");
            const parsed = JSON.parse(content);
            if (!parsed.features || !Array.isArray(parsed.features)) {
                (0, logger_1.logESEParsingError)(`Invalid GeoJSON format in ${filePath}: missing or invalid features array. File content: ${content.substring(0, 500)}...`);
                return [];
            }
            return parsed.features;
        }
        catch (error) {
            let fileContent = "";
            try {
                fileContent = fs_1.default.readFileSync(filePath, "utf-8").substring(0, 500);
            }
            catch {
                fileContent = "Unable to read file content";
            }
            (0, logger_1.logESEParsingError)(`Failed to read or parse GeoJSON file ${filePath}: ${error}. File content: ${fileContent}...`);
            return [];
        }
    }
}
exports.eseParser = new ESEParser();
//# sourceMappingURL=ese.js.map