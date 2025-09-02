"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseAtcPositionLine = void 0;
const geo_helper_1 = require("../../../helper/geo-helper");
const logger_1 = require("../../../helper/logger");
const utils_1 = require("../../../utils");
const parseAtcPositionLine = (line, isGNG) => {
    const data = line.split(":");
    if (data.length < 4) {
        (0, logger_1.logESEParsingWarning)("Invalid ATC position line format: insufficient data fields (minimum fields needed is 4)", line);
        return null;
    }
    try {
        const visibilityPoints = parseVisibilityPoints(data);
        const cleanedData = data.map(utils_1.cleanEndLines);
        const callsign = generateCallsign(cleanedData, isGNG);
        return {
            callsign,
            name: cleanedData[1],
            frequency: cleanedData[2],
            identifier: cleanedData[3],
            subSector: cleanedData[4],
            sector: cleanedData[5],
            facility: cleanedData[6],
            squawkStart: cleanedData[9],
            squawkEnd: cleanedData[10],
            visibilityPoints,
        };
    }
    catch (error) {
        (0, logger_1.logESEParsingError)("ATC position line", `Failed to parse ATC position line: ${line}`, error instanceof Error ? error.message : "Unknown error");
        return null;
    }
};
exports.parseAtcPositionLine = parseAtcPositionLine;
const parseVisibilityPoints = (data) => {
    const points = [];
    for (let i = 11; i < data.length; i += 2) {
        if (i + 1 >= data.length)
            break;
        try {
            const geo = geo_helper_1.geoHelper.convertESEGeoCoordinates(data[i], data[i + 1]);
            if (geo) {
                points.push([geo.lat, geo.lon]);
            }
        }
        catch (error) {
            (0, logger_1.logESEParsingWarning)(`Invalid geo coordinates at index ${i}: ${data[i]}, ${data[i + 1]}`, error instanceof Error ? error.message : "Unknown error");
        }
    }
    return points;
};
const generateCallsign = (cleanedData, isGNG) => {
    if (!isGNG) {
        return cleanedData[0];
    }
    const sector = cleanedData[5];
    const subSector = cleanedData[4].replace("-", ""); // Remove - which should be null per RFC
    const facility = cleanedData[6];
    let callsign = `${sector}_`;
    if (subSector.length > 0) {
        callsign += `${subSector}_`;
    }
    callsign += facility;
    return callsign;
};
//# sourceMappingURL=atc-position-parser.js.map