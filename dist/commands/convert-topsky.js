"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.convertTopsky = void 0;
const fs_1 = __importDefault(require("fs"));
const ora_1 = __importDefault(require("ora"));
const logger_1 = require("../helper/logger");
const geo_helper_1 = require("../helper/geo-helper");
const topsky_helper_1 = require("./converter/topsky-helper");
const convertTopsky = async (packageEnvironmentPath) => {
    const spinner = (0, ora_1.default)("Converting TopSky map...").start();
    const topSkyMapsFolder = `${packageEnvironmentPath}/topsky`;
    if (!fs_1.default.existsSync(topSkyMapsFolder)) {
        spinner.fail("TopSky maps folder does not exist.");
        return;
    }
    const topSkyMaps = fs_1.default
        .readdirSync(topSkyMapsFolder)
        .map((file) => {
        const filePath = `${topSkyMapsFolder}/${file}`;
        if (!fs_1.default.statSync(filePath).isFile()) {
            spinner.warn(`Skipping non-file entry: ${file}`);
            return null;
        }
        if (!file.endsWith(".txt")) {
            spinner.warn(`Skipping non-text file: ${file}`);
            return null;
        }
        const fileContent = fs_1.default.readFileSync(filePath, "utf-8");
        return {
            name: file.replace(".txt", ""),
            content: fileContent,
        };
    })
        .filter((file) => file !== null);
    if (topSkyMaps.length === 0) {
        spinner.fail("No TopSky maps found to convert.");
        return;
    }
    spinner.info(`Found ${topSkyMaps.length} TopSky maps.`);
    spinner.start("Processing TopSky maps...");
    const allConvertedMaps = [];
    for (const rawMap of topSkyMaps) {
        // Reset the converted maps for each file
        const convertedTopSkyMaps = [];
        // Go line by line in the text file
        const lines = rawMap.content
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line.length > 0 && !line.startsWith(",") && !line.startsWith("//"));
        let colourMap = {};
        let currentMap = (0, topsky_helper_1.createEmptyMap)();
        let currentColor = null;
        let currentFillColor = null;
        let currentLineString = null;
        let currentMultiLineString = null;
        for (const line of lines) {
            if (line.startsWith("COLORDEF")) {
                if ((0, topsky_helper_1.pushMapIfValid)(currentMap, convertedTopSkyMaps)) {
                    currentMap = (0, topsky_helper_1.createEmptyMap)();
                }
                const colorDef = (0, topsky_helper_1.parseColorDef)(line);
                if (colorDef) {
                    colourMap[colorDef[0]] = colorDef[1];
                }
                else {
                    spinner.warn(`Skipping invalid COLORDEF line: "${line}"`);
                }
            }
            if (line.startsWith("MAP:")) {
                const resetResult = (0, topsky_helper_1.pushFeatureIfValid)(currentLineString, currentMultiLineString, colourMap[currentColor || "unknown"] || [255, 255, 255], currentMap);
                currentLineString = resetResult.lineString;
                currentMultiLineString = resetResult.multiLineString;
                if ((0, topsky_helper_1.pushMapIfValid)(currentMap, convertedTopSkyMaps)) {
                    currentMap = (0, topsky_helper_1.createEmptyMap)();
                }
                currentMap.name = line.replace("MAP:", "").trim();
                currentColor = null; // Reset current color for the new map
            }
            if (line.startsWith("FOLDER:")) {
                currentMap.folder = line.replace("FOLDER:", "").trim();
            }
            if (line.startsWith("COLOR:")) {
                const parts = line.replace("COLOR:", "").trim().split(":");
                if (parts.length === 1) {
                    currentColor = parts[0];
                    (0, topsky_helper_1.checkIfColourIsValid)(currentColor, colourMap, spinner);
                }
                else if (parts.length === 2) {
                    currentColor = parts[0];
                    currentFillColor = parts[1];
                    (0, topsky_helper_1.checkIfColourIsValid)(currentColor, colourMap, spinner);
                    (0, topsky_helper_1.checkIfColourIsValid)(currentFillColor, colourMap, spinner);
                }
                // Also close and push the current LineString or MultiLineString if it exists
                const resetResult = (0, topsky_helper_1.pushFeatureIfValid)(currentLineString, currentMultiLineString, colourMap[currentColor || "unknown"] || [255, 255, 255], currentMap);
                currentLineString = resetResult.lineString;
                currentMultiLineString = resetResult.multiLineString;
            }
            if (line.startsWith("COORD:")) {
                // This is a LineString
                if (!currentLineString) {
                    currentLineString = {
                        type: "LineString",
                        coordinates: [],
                    };
                }
                const coord = line.replace("COORD:", "").trim();
                const parts = coord.split(":");
                if (parts.length !== 2) {
                    (0, logger_1.logSCTParsingWarning)(`Invalid COORD line: "${line}". Expected format: "COORD:N056.04.00.000:W010.00.00.000"`);
                    spinner.warn(`Invalid COORD line: "${line}"`);
                    continue;
                }
                const cartesian = geo_helper_1.geoHelper.convertESEGeoCoordinatesToCartesian(parts[0], parts[1]);
                if (cartesian) {
                    currentLineString.coordinates.push(cartesian);
                }
                else {
                    (0, logger_1.logSCTParsingWarning)(`Invalid ESE coordinates in line: "${line}"`);
                    spinner.warn(`Invalid ESE coordinates in line: "${line}"`);
                }
            }
            if (line.startsWith("COORDLINE")) {
                // End of the current LineString
                if (currentLineString) {
                    const geojsonColour = colourMap[currentColor || "unknown"];
                    const resetResult = (0, topsky_helper_1.pushFeatureIfValid)(currentLineString, null, geojsonColour || [0, 0, 0], currentMap);
                    currentLineString = resetResult.lineString;
                }
            }
            if (line.startsWith("COORDPOLY")) {
                // Convert the current LineString to a Polygon
                if (currentLineString && currentLineString.coordinates.length > 0) {
                    const geojsonStrokeColour = colourMap[currentColor || "unknown"];
                    const geojsonFillColour = colourMap[currentFillColor || "unknown"] || [255, 255, 255];
                    const polygon = {
                        type: "Polygon",
                        coordinates: [currentLineString.coordinates],
                    };
                    const feature = {
                        type: "Feature",
                        geometry: polygon,
                        properties: {
                            name: currentMap.name,
                            type: currentMap.folder,
                            uuid: (0, topsky_helper_1.getUUID)(currentMap),
                            lineStyle: { color: geojsonStrokeColour || [0, 0, 0] },
                            fillStyle: {
                                color: geojsonFillColour || [255, 255, 255],
                            },
                        },
                    };
                    currentMap.featureCollection.features.push(feature);
                    currentLineString = null; // Reset for next LineString
                    currentMultiLineString = null; // Reset for next MultiLineString
                }
            }
            if (line.startsWith("LINE:")) {
                // This is a MultiLineString
                if (!currentMultiLineString) {
                    currentMultiLineString = {
                        type: "MultiLineString",
                        coordinates: [],
                    };
                }
                const coord = line.replace("LINE:", "").trim();
                const parts = coord.split(":");
                if (parts.length !== 4) {
                    (0, logger_1.logSCTParsingWarning)(`Invalid LINE line: "${line}". Expected format: "LINE:N056.04.00.000:W010.00.00.000:N056.04.00.000:W010.00.00.000"`);
                    continue;
                }
                const cartesian1 = geo_helper_1.geoHelper.convertESEGeoCoordinatesToCartesian(parts[0], parts[1]);
                const cartesian2 = geo_helper_1.geoHelper.convertESEGeoCoordinatesToCartesian(parts[2], parts[3]);
                if (cartesian1 && cartesian2) {
                    currentMultiLineString.coordinates.push([cartesian1, cartesian2]);
                }
                else {
                    (0, logger_1.logSCTParsingWarning)(`Invalid ESE coordinates in line: "${line}"`);
                    spinner.warn(`Invalid ESE coordinates in line: "${line}"`);
                }
            }
        }
        // Push the last map if it has features
        const resetResult = (0, topsky_helper_1.pushFeatureIfValid)(currentLineString, currentMultiLineString, colourMap[currentColor || "unknown"] || [255, 255, 255], currentMap);
        (0, topsky_helper_1.pushMapIfValid)(currentMap, convertedTopSkyMaps);
        spinner.info(`Converted TopSky map file "${rawMap.name}" with ${convertedTopSkyMaps.length} maps extracted.`);
        // Add to the collection of all maps
        allConvertedMaps.push(...convertedTopSkyMaps);
    }
    // Now merge the feature collections per "folder" property
    const foldersFound = new Set();
    allConvertedMaps.forEach((map) => {
        if (map.folder) {
            foldersFound.add(map.folder);
        }
    });
    const convertedGeoJsonMaps = {};
    foldersFound.forEach((folder) => {
        const folderMaps = allConvertedMaps.filter((map) => map.folder === folder);
        if (folderMaps.length > 0) {
            const featCol = {
                type: "FeatureCollection",
                features: [],
            };
            folderMaps.forEach((map) => {
                featCol.features.push(...map.featureCollection.features);
            });
            convertedGeoJsonMaps[folder] = featCol;
        }
    });
    spinner.info(`Merged maps by folder, resulting in ${Object.keys(convertedGeoJsonMaps).length} different folders.`);
    // Write the converted maps to files
    const datasetsFolder = `${packageEnvironmentPath}/package/datasets`;
    for (const [folder, featureCollection] of Object.entries(convertedGeoJsonMaps)) {
        if (featureCollection.features.length === 0) {
            spinner.warn(`No features found for folder "${folder}", skipping.`);
            continue;
        }
        const outputFilePath = `${datasetsFolder}/${folder}.geojson`;
        fs_1.default.writeFileSync(outputFilePath, JSON.stringify(featureCollection));
        spinner.info(`Written GeoJSON for folder "${folder}" to "${outputFilePath}".`);
    }
    spinner.succeed("TopSky maps converted successfully.");
    return allConvertedMaps;
};
exports.convertTopsky = convertTopsky;
//# sourceMappingURL=convert-topsky.js.map