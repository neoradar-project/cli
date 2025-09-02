"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.geoHelper = exports.GeoHelper = void 0;
const dms_conversion_1 = __importDefault(require("dms-conversion"));
const coordinate_parser_1 = __importDefault(require("coordinate-parser"));
const projection_1 = require("@turf/projection");
const logger_1 = require("./logger");
class GeoHelper {
    /**
     * Converts ESE geo coordinates to Cartesian coordinates using Mercator projection
     */
    convertESEGeoCoordinatesToCartesian(latStr, lonStr) {
        if (!this.isValidInput(latStr, lonStr)) {
            return null;
        }
        try {
            const reformattedLat = this.reformatCoordinates(latStr);
            const reformattedLon = this.reformatCoordinates(lonStr);
            const coordinates = new coordinate_parser_1.default(`${reformattedLat} ${reformattedLon}`);
            return (0, projection_1.toMercator)([coordinates.getLongitude(), coordinates.getLatitude()]);
        }
        catch (error) {
            (0, logger_1.logESEParsingError)('Failed to convert ESE coordinates to Cartesian', `Lat: ${latStr}, Lon: ${lonStr}`, error instanceof Error ? error.message : 'Unknown error');
            return null;
        }
    }
    /**
     * Converts ESE geo coordinates to decimal degrees
     */
    convertESEGeoCoordinates(latStr, lonStr) {
        if (!this.isValidInput(latStr, lonStr)) {
            return null;
        }
        try {
            const reformattedLat = this.reformatCoordinates(latStr);
            const reformattedLon = this.reformatCoordinates(lonStr);
            const coordinates = new coordinate_parser_1.default(`${reformattedLat} ${reformattedLon}`);
            return {
                lat: coordinates.getLatitude(),
                lon: coordinates.getLongitude()
            };
        }
        catch (error) {
            (0, logger_1.logESEParsingError)('Failed to convert ESE coordinates to decimal degrees', `Lat: ${latStr}, Lon: ${lonStr}`, error instanceof Error ? error.message : 'Unknown error');
            return null;
        }
    }
    /**
     * Converts decimal geo coordinates to ESE format
     */
    convertGeoCoordinatesToESE(latStr, lonStr) {
        const lat = Number(latStr);
        const lon = Number(lonStr);
        if (!this.isValidDecimalCoordinates(lat, lon)) {
            return null;
        }
        try {
            const dmsConverter = new dms_conversion_1.default(lat, lon);
            const { longitude, latitude } = dmsConverter.dmsArrays;
            const [lonDeg, lonMin, lonSec, lonDir] = longitude;
            const [latDeg, latMin, latSec, latDir] = latitude;
            const formattedLon = `${lonDir}${this.formatESEDegrees(lonDeg)}.${this.formatESEMin(lonMin)}.${this.formatESESec(lonSec)}`;
            const formattedLat = `${latDir}${this.formatESEDegrees(latDeg)}.${this.formatESEMin(latMin)}.${this.formatESESec(latSec)}`;
            return `${formattedLat}:${formattedLon}`;
        }
        catch (error) {
            (0, logger_1.logESEParsingError)('Failed to convert decimal coordinates to ESE format', `Lat: ${latStr}, Lon: ${lonStr}`, error instanceof Error ? error.message : 'Unknown error');
            return null;
        }
    }
    /**
     * Validates input strings are not null, undefined, or empty
     */
    isValidInput(latStr, lonStr) {
        return Boolean(latStr?.trim()) && Boolean(lonStr?.trim());
    }
    /**
     * Validates decimal coordinates are within valid ranges
     */
    isValidDecimalCoordinates(lat, lon) {
        return !isNaN(lat) &&
            !isNaN(lon) &&
            lat >= -90 &&
            lat <= 90 &&
            lon >= -180 &&
            lon <= 180;
    }
    /**
     * Reformats ESE coordinate string to standard DMS format
     * Expected input format: [N/S/E/W]DDD.MM.SS.SSS
     */
    reformatCoordinates(coord) {
        if (!coord || typeof coord !== 'string') {
            throw new Error('Invalid coordinate string');
        }
        const parts = coord.split(".");
        if (parts.length !== 4) {
            throw new Error('Invalid ESE coordinate format, expected 4 parts');
        }
        const [degreesPart, minutes, seconds, milliseconds] = parts;
        if (degreesPart.length < 4) {
            throw new Error('Invalid degrees part in ESE coordinate');
        }
        const direction = degreesPart.substring(0, 1);
        const degrees = degreesPart.substring(1, 4);
        return `${Number(degrees)}:${minutes}:${seconds}.${milliseconds}${direction}`;
    }
    /**
     * Formats degrees for ESE output (3 digits, zero-padded)
     */
    formatESEDegrees(degrees) {
        return degrees.toString().padStart(3, '0');
    }
    /**
     * Formats minutes for ESE output (2 digits, zero-padded)
     */
    formatESEMin(minutes) {
        return minutes.toString().padStart(2, '0');
    }
    /**
     * Formats seconds for ESE output (3 decimal places)
     */
    formatESESec(seconds) {
        return seconds.toFixed(3);
    }
}
exports.GeoHelper = GeoHelper;
exports.geoHelper = new GeoHelper();
//# sourceMappingURL=geo-helper.js.map