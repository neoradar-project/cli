"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.askForConfirmation = exports.cleanEndLines = exports.convertColorFeaturePropertyToGeojsonProperties = exports.fileFilesWithExtension = exports.getCurrentAiracCycle = void 0;
exports.extractAirwaySegment = extractAirwaySegment;
exports.getFeatureName = getFeatureName;
exports.generateGeoJsonFilesForType = generateGeoJsonFilesForType;
const fs_1 = __importDefault(require("fs"));
const readline_1 = __importDefault(require("readline"));
const getCurrentAiracCycle = () => {
    const today = new Date();
    const year = today.getUTCFullYear();
    const month = today.getUTCMonth() + 1; // Months are 0-indexed in JavaScript
    const cycleMonth = Math.ceil(month / 2) * 2; // AIRAC cycles are every 28 days, so we round up to the nearest even month
    const cycleYear = cycleMonth > 12 ? year + 1 : year; // If the month exceeds December, increment the year
    const cycleMonthStr = cycleMonth > 9 ? cycleMonth.toString() : `0${cycleMonth}`;
    return `${cycleYear.toFixed(0).slice(2)}${cycleMonthStr}`;
};
exports.getCurrentAiracCycle = getCurrentAiracCycle;
const fileFilesWithExtension = (directory, extensions) => {
    const matchingFiles = [];
    try {
        const files = fs_1.default.readdirSync(directory);
        files.forEach((file) => {
            if (extensions.some((ext) => file.endsWith(ext))) {
                matchingFiles.push(file);
            }
        });
    }
    catch (error) {
        console.error(`Error reading directory ${directory}: ${error instanceof Error ? error.message : "Unknown error"}`);
        return [];
    }
    return matchingFiles;
};
exports.fileFilesWithExtension = fileFilesWithExtension;
function extractAirwaySegment(segment) {
    let returnSegment = [];
    returnSegment.push("position" in segment.start
        ? [segment.start.position.lonFloat, segment.start.position.latFloat]
        : [segment.start.lonFloat, segment.start.latFloat]);
    returnSegment.push("position" in segment.end
        ? [segment.end.position.lonFloat, segment.end.position.latFloat]
        : [segment.end.lonFloat, segment.end.latFloat]);
    return returnSegment;
}
function getFeatureName(feature) {
    if (!feature || !feature.properties || !feature.properties.type) {
        console.warn("Feature without properties or type:", feature);
        return null;
    }
    const type = feature.properties.type;
    // Standard name property types
    if (["airport", "fix", "highAirway", "lowAirway", "ndb", "vor"].includes(type)) {
        if (feature.properties.name) {
            return feature.properties.name;
        }
    }
    if (["region"].includes(type)) {
        if (feature.properties.region) {
            return feature.properties.region;
        }
    }
    // Section property types
    if (["artcc-high", "artcc-low", "artcc", "geo", "high-airway", "low-airway", "sid", "star"].includes(type)) {
        if (feature.properties.section) {
            return feature.properties.section;
        }
    }
    // Label specific
    if (type === "label") {
        if (feature.properties.section) {
            return feature.properties.section;
        }
        if (feature.properties.value) {
            return feature.properties.value;
        }
    }
    // Runway specific (combine ICAO and name)
    if (type === "runway") {
        if (feature.properties.icao && feature.properties.name) {
            return `${feature.properties.icao}-${feature.properties.name}-${feature.properties.oppositeId}`;
        }
    }
    // Default fallback
    if (feature.properties.name) {
        return feature.properties.name;
    }
    return null;
}
async function generateGeoJsonFilesForType(path, fileOrTypeName, allFeatures) {
    const features = allFeatures;
    const geojson = {
        type: "FeatureCollection",
        features: features,
    };
    const data = JSON.stringify(geojson);
    const formattedType = fileOrTypeName.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const filePath = `${path}/${formattedType}.geojson`;
    fs_1.default.writeFileSync(filePath, data, "utf8");
}
const convertColorFeaturePropertyToGeojsonProperties = (feature, isPolygon = false) => {
    const { properties } = feature;
    if (!properties) {
        return feature;
    }
    const { color, ...rest } = properties;
    if (!color) {
        return feature;
    }
    const style = {
        color,
    };
    if (isPolygon) {
        return {
            ...feature,
            properties: {
                ...rest,
                fillStyle: {
                    color,
                },
            },
        };
    }
    else {
        return {
            ...feature,
            properties: {
                ...rest,
                lineStyle: {
                    color,
                },
            },
        };
    }
};
exports.convertColorFeaturePropertyToGeojsonProperties = convertColorFeaturePropertyToGeojsonProperties;
const cleanEndLines = (value) => value.replace(/\r/g, "");
exports.cleanEndLines = cleanEndLines;
const askForConfirmation = (message) => {
    console.warn(message);
    const rl = readline_1.default.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    return new Promise((resolve) => {
        rl.question("Do you want to continue? Y(es)/n(o): ", (answer) => {
            rl.close();
            resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
        });
    });
};
exports.askForConfirmation = askForConfirmation;
//# sourceMappingURL=utils.js.map