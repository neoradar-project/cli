"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkIfColourIsValid = exports.pushFeatureIfValid = exports.getUUID = exports.parseColorDef = exports.pushMapIfValid = exports.EMPTY_MAP = exports.createEmptyMap = void 0;
const logger_1 = require("../../helper/logger");
const createEmptyMap = () => ({
    name: "",
    folder: "",
    featureCollection: {
        type: "FeatureCollection",
        features: [],
    },
});
exports.createEmptyMap = createEmptyMap;
exports.EMPTY_MAP = (0, exports.createEmptyMap)();
const pushMapIfValid = (map, maps) => {
    if (map.featureCollection.features.length > 0) {
        maps.push(map);
        return true;
    }
    return false;
};
exports.pushMapIfValid = pushMapIfValid;
const parseColorDef = (line) => {
    const parts = line.split(":");
    if (parts.length < 3) {
        (0, logger_1.logSCTParsingWarning)(`Invalid COLORDEF line: "${line}". Expected format: "COLORDEF:<colorName>:<r>:<g>:<b>"`);
        return undefined;
    }
    const colorName = parts[1];
    const colorValues = parts.slice(2).map(Number);
    return [colorName, colorValues];
};
exports.parseColorDef = parseColorDef;
const getUUID = (map) => {
    // Generate a UUID based on the map name and folder
    return `${map.name}-${map.folder}`.replace(/\s+/g, "-").toLowerCase();
};
exports.getUUID = getUUID;
const pushFeatureIfValid = (currentLineString, currentMultiLineString, color, map) => {
    if (currentLineString && currentLineString.coordinates.length > 0) {
        const feature = {
            type: "Feature",
            geometry: currentLineString,
            properties: {
                name: map.name,
                type: map.folder,
                uuid: (0, exports.getUUID)(map),
                lineStyle: { color: color },
            },
        };
        map.featureCollection.features.push(feature);
    }
    if (currentMultiLineString && currentMultiLineString.coordinates.length > 0) {
        const feature = {
            type: "Feature",
            geometry: currentMultiLineString,
            properties: {
                name: map.name,
                type: map.folder,
                uuid: (0, exports.getUUID)(map),
                lineStyle: { color: color },
            },
        };
        map.featureCollection.features.push(feature);
    }
    return { lineString: null, multiLineString: null };
};
exports.pushFeatureIfValid = pushFeatureIfValid;
const checkIfColourIsValid = (color, colourMap, spinner) => {
    if (color && !colourMap[color]) {
        (0, logger_1.logSCTParsingWarning)(`Color "${color}" not defined in COLORDEF.`);
        spinner.warn(`Unknown color "${color}" in map.`);
        return false;
    }
    return true;
};
exports.checkIfColourIsValid = checkIfColourIsValid;
//# sourceMappingURL=topsky-helper.js.map