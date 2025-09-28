"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EseHelper = void 0;
const geo_helper_1 = require("./geo-helper");
const turf = __importStar(require("@turf/turf"));
const projection_1 = require("@turf/projection");
const fs_1 = __importDefault(require("fs"));
const atc_position_parser_1 = require("../commands/converter/nse/atc-position-parser");
const procedure_parser_1 = require("../commands/converter/nse/procedure-parser");
const logger_1 = require("./logger");
class EseHelper {
    static isGNG = false;
    static createEmptySector() {
        return {
            name: "",
            actives: [],
            owners: [],
            borders: [],
            depApts: [],
            arrApts: [],
            floor: 0,
            ceiling: 0,
            displaySectorLines: [],
        };
    }
    static createEmptySectorLine() {
        return {
            id: 0,
            points: [],
            displaySectorLines: [],
        };
    }
    static async parseEseContent(eseFilePath, allNavaids, isGNG = false) {
        const lines = fs_1.default.readFileSync(eseFilePath, "utf8").split("\n");
        this.isGNG = isGNG;
        const result = {
            position: [],
            procedure: [],
            sectors: [],
            sectorLines: [],
        };
        const context = {
            currentSector: this.createEmptySector(),
            currentSectorLine: this.createEmptySectorLine(),
            baseMatrixInt: 690,
            numericIDReplacementMatrix: {},
            processingNewSector: false,
            pendingDisplayData: [],
            pendingSectorLineDisplayData: [],
        };
        let currentSection = "";
        for (const rawLine of lines) {
            const line = this.cleanLine(rawLine);
            if (!this.isValidLine(line))
                continue;
            if (this.isSectionHeader(line)) {
                if (currentSection === "AIRSPACE" && context.processingNewSector) {
                    this.finalizeSector(context);
                }
                currentSection = this.extractSectionName(line);
                continue;
            }
            this.handleLine(line, currentSection, result, context, allNavaids);
        }
        if (context.processingNewSector) {
            this.finalizeSector(context);
        }
        this.processPendingDisplayData(context, result);
        return result;
    }
    static handleLine(line, section, result, context, allNavaids) {
        switch (section) {
            case "FREETEXT":
                break;
            case "POSITIONS":
                this.handlePosition(line, result);
                break;
            case "AIRSPACE":
                this.handleAirspace(line, result, context, allNavaids);
                break;
            default:
                this.handleDefault(line, result);
                break;
        }
    }
    static finalizeSector(context) {
        if (context.currentSector.borders.length === 0) {
            (0, logger_1.logESEParsingWarning)(`Sector "${context.currentSector.name}" has no borders defined`);
        }
        context.processingNewSector = false;
    }
    static cleanLine(line) {
        return line.replace(/[�\r]/g, "").trim();
    }
    static isValidLine(line) {
        return Boolean(line && !line.startsWith(";="));
    }
    static isSectionHeader(line) {
        return line.startsWith("[") && line.endsWith("]");
    }
    static extractSectionName(line) {
        return line.slice(1, -1);
    }
    static handlePosition(line, result) {
        if (line.startsWith(";") || !line.trim())
            return;
        const position = (0, atc_position_parser_1.parseAtcPositionLine)(line, this.isGNG);
        if (position) {
            result.position.push(position);
        }
        else {
            (0, logger_1.logESEParsingWarning)(`Failed to parse ATC position line: "${line}"`);
        }
    }
    static handleDefault(line, result) {
        const data = line.split(":");
        if (data.length >= 3 && this.isProcedure(data[0])) {
            this.handleProcedure(line, result);
        }
    }
    static isProcedure(value) {
        return value.includes("STAR") || value.includes("SID");
    }
    static handleProcedure(line, result) {
        const proc = (0, procedure_parser_1.parseESEProcedure)(line);
        if (proc) {
            result.procedure.push(proc);
        }
    }
    static handleAirspace(line, result, context, allNavaids) {
        const handlers = {
            SECTORLINE: () => this.handleSectorLine(line, result, context, allNavaids),
            CIRCLE_SECTORLINE: () => this.handleSectorLine(line, result, context, allNavaids),
            DISPLAY: () => this.handleDisplay(line, context, result), // Added result parameter
            COORD: () => this.handleCoord(line, context),
            SECTOR: () => this.handleNewSector(line, result, context),
            OWNER: () => this.handleOwner(line, context),
            BORDER: () => this.handleBorder(line, context),
            DEPAPT: () => this.handleDepApt(line, context),
            ARRAPT: () => this.handleArrApt(line, context),
            ACTIVE: () => this.handleActive(line, context),
            DISPLAY_SECTORLINE: () => this.handleDisplaySectorLine(line, context, result),
        };
        const prefix = line.split(":")[0];
        const handler = handlers[prefix];
        if (handler) {
            handler();
        }
    }
    static handleSectorLine(line, result, context, allNavaids) {
        const id = line.split(":")[1];
        if (id.startsWith("Only") && !this.isGNG)
            return;
        const numericId = this.getNumericId(id, context);
        context.currentSectorLine = {
            id: numericId,
            points: [],
            displaySectorLines: [],
        };
        result.sectorLines.push(context.currentSectorLine);
        if (line.startsWith("CIRCLE_SECTORLINE:")) {
            this.handleCircleSectorLine(line, context, allNavaids);
        }
    }
    static getNumericId(id, context) {
        if (/^\d+$/.test(id)) {
            return Number(id);
        }
        if (!context.numericIDReplacementMatrix[id]) {
            context.numericIDReplacementMatrix[id] = context.baseMatrixInt++;
        }
        return context.numericIDReplacementMatrix[id];
    }
    static handleCircleSectorLine(line, context, allNavaids) {
        const parts = line.split(":");
        const geo = this.getCircleCenter(parts, allNavaids);
        if (!geo || !this.isValidGeoCoord(geo)) {
            (0, logger_1.logESEParsingError)(`Invalid or missing coordinates for circle sectorline: "${line}"`);
            return;
        }
        try {
            const radius = Number(parts[parts.length === 5 ? 4 : 3]);
            if (isNaN(radius)) {
                (0, logger_1.logESEParsingError)(`Invalid radius for circle sectorline: "${line}" - radius: "${parts[parts.length === 5 ? 4 : 3]}"`);
                return;
            }
            const circle = turf.circle(turf.point([geo.lon, geo.lat]), radius, {
                steps: 10,
                units: "nauticalmiles",
            });
            const circlePoints = circle.geometry.coordinates[0]
                .map((coord) => (0, projection_1.toMercator)([coord[1], coord[0]]))
                .filter((cartesian) => cartesian[0] && cartesian[1]);
            context.currentSectorLine.points = circlePoints;
        }
        catch (error) {
            (0, logger_1.logESEParsingError)(`Failed to create circle for sectorline: "${line}" - center: lat=${geo.lat}, lon=${geo.lon} - error: ${error}`);
        }
    }
    static getCircleCenter(parts, navaids) {
        if (parts.length === 5) {
            const coords = geo_helper_1.geoHelper.convertESEGeoCoordinates(parts[2], parts[3]);
            if (!coords) {
                (0, logger_1.logESEParsingError)(`Failed to convert coordinates from parts: lat="${parts[2]}", lon="${parts[3]}"`);
                return null;
            }
            return { lat: Number(coords.lat), lon: Number(coords.lon) };
        }
        const navaidName = parts[2].trim();
        const navaid = navaids.find((n) => n.name === navaidName);
        if (!navaid?.lat || !navaid?.lon) {
            (0, logger_1.logESEParsingError)(`Navaid "${navaidName}" not found or missing coordinates`);
            return null;
        }
        const toCartesian = (0, projection_1.toWgs84)([Number(navaid.lon), Number(navaid.lat)]);
        return { lat: toCartesian[1], lon: toCartesian[0] };
    }
    static isValidGeoCoord(geo) {
        return Boolean(geo?.lat && geo?.lon && !isNaN(geo.lat) && !isNaN(geo.lon));
    }
    static handleCoord(line, context) {
        const [, lat, lon] = line.split(":");
        const geo = geo_helper_1.geoHelper.convertESEGeoCoordinatesToCartesian(lat, lon);
        if (geo) {
            context.currentSectorLine.points.push(geo);
        }
        else {
            (0, logger_1.logESEParsingError)(`Failed to convert coordinates to cartesian: lat="${lat}", lon="${lon}"`);
        }
    }
    static getOriginalId(numericId, context) {
        // Find the key where the value matches the numeric ID
        for (const [key, value] of Object.entries(context.numericIDReplacementMatrix)) {
            if (value === numericId) {
                return key;
            }
        }
        return null;
    }
    static handleDisplay(line, context, result) {
        const [, sectorId, adjSector1, adjSector2] = line.split(":");
        // Get the original string ID for the current sector line
        const originalSectorLineId = this.getOriginalId(context.currentSectorLine.id, context);
        if (!originalSectorLineId) {
            // logESEParsingWarning(`Could not find original ID for sector line: ${context.currentSectorLine.id}`);
            return;
        }
        // Try to find the sector with the matching name (using sectorId from the line)
        const targetSector = result.sectors.find((sector) => sector.name === originalSectorLineId);
        if (targetSector) {
            targetSector.displaySectorLines.push({
                ownedVolume: sectorId,
                compareVolumes: [adjSector1, adjSector2],
            });
        }
        else {
            // Defer processing if sector doesn't exist yet
            context.pendingDisplayData.push({
                sectorLineId: originalSectorLineId, // For reference/debugging
                sectorId: sectorId, // The sector that should own this display rule
                adjSector1,
                adjSector2,
            });
        }
    }
    static processPendingDisplayData(context, result) {
        for (const pendingDisplay of context.pendingDisplayData) {
            const targetSector = result.sectors.find((sector) => sector.name === pendingDisplay.sectorLineId);
            if (targetSector) {
                targetSector.displaySectorLines.push({
                    ownedVolume: pendingDisplay.sectorId,
                    compareVolumes: [pendingDisplay.adjSector1, pendingDisplay.adjSector2],
                });
            }
        }
        for (const pending of context.pendingSectorLineDisplayData) {
            const sectorLine = result.sectorLines.find((sl) => sl.id === pending.borderId);
            if (sectorLine) {
                sectorLine.displaySectorLines.push({
                    ownedVolume: pending.ownedVolume,
                    compareVolumes: pending.compareVolumes,
                });
            }
        }
        // Clear the pending data after processing
        context.pendingSectorLineDisplayData = [];
        context.pendingDisplayData = [];
    }
    static handleNewSector(line, result, context) {
        const [, name, floor, ceiling] = line.split(":");
        if (name.startsWith("Only") && !this.isGNG)
            return;
        if (context.processingNewSector) {
            this.finalizeSector(context);
        }
        const floorNum = Number(floor);
        const ceilingNum = Number(ceiling);
        if (isNaN(floorNum) || isNaN(ceilingNum)) {
            (0, logger_1.logESEParsingWarning)(`Invalid altitude values for sector "${name}": floor="${floor}", ceiling="${ceiling}"`);
        }
        context.currentSector = {
            ...this.createEmptySector(),
            name,
            floor: floorNum,
            ceiling: ceilingNum,
        };
        result.sectors.push(context.currentSector);
        context.processingNewSector = true;
    }
    static splitAndClean(line, prefix) {
        return line
            .replace(`${prefix}:`, "")
            .split(":")
            .map((item) => item.replace(/[\r�]/g, ""));
    }
    static handleOwner(line, context) {
        context.currentSector.owners = this.splitAndClean(line, "OWNER");
    }
    static handleBorder(line, context) {
        const parts = this.splitAndClean(line, "BORDER");
        const invalidBorders = [];
        context.currentSector.borders = parts
            .map((item) => {
            if (!item)
                return null;
            if (/^\d+$/.test(item)) {
                return Number(item);
            }
            const replacementId = context.numericIDReplacementMatrix[item];
            if (!replacementId) {
                invalidBorders.push(item);
                return null;
            }
            return replacementId;
        })
            .filter((item) => item !== null);
        if (invalidBorders.length > 0) {
            (0, logger_1.logESEParsingWarning)(`Sector "${context.currentSector.name}" references undefined border IDs: ${invalidBorders.join(", ")}`);
        }
    }
    static handleDepApt(line, context) {
        const data = this.splitAndClean(line, "DEPAPT");
        context.currentSector.depApts = data;
        // for (const icao of data) {
        //   if (!icao) continue;
        //   if (icao.length !== 4) {
        //     logESEParsingWarning(`Invalid ICAO code in DEPAPT line: "${line}"`);
        //     continue;
        //   }
        //   context.currentSector.actives.push({ type: "depApt", icao });
        // }
    }
    static handleArrApt(line, context) {
        const data = this.splitAndClean(line, "ARRAPT");
        context.currentSector.arrApts = data;
        // for (const icao of data) {
        //   if (!icao) continue;
        //   if (icao.length !== 4) {
        //     logESEParsingWarning(`Invalid ICAO code in ARRAPT line: "${line}"`);
        //     continue;
        //   }
        //   context.currentSector.actives.push({ type: "arrApt", icao });
        // }
    }
    static handleActive(line, context) {
        const [icao, runway] = this.splitAndClean(line, "ACTIVE");
        if (!icao || !runway) {
            (0, logger_1.logESEParsingWarning)(`Invalid ACTIVE line format: "${line}" - expected ICAO and runway`);
            return;
        }
        context.currentSector.actives.push({ type: "runway", icao, runway });
    }
    static handleDisplaySectorLine(line, context, result) {
        const [borderId, ownedVolume, ...others] = this.splitAndClean(line, "DISPLAY_SECTORLINE");
        const borderIdNum = Number(borderId);
        if (isNaN(borderIdNum)) {
            (0, logger_1.logESEParsingError)(`Invalid border ID in DISPLAY_SECTORLINE: "${borderId}" in line: "${line}"`);
            return;
        }
        const displayData = {
            ownedVolume,
            compareVolumes: others,
        };
        const borderExists = result.sectorLines.find((sl) => sl.id === borderIdNum);
        if (!borderExists) {
            context.pendingSectorLineDisplayData.push({ borderId: borderIdNum, ...displayData });
        }
        else {
            borderExists.displaySectorLines.push(displayData);
            console.log(`Added DISPLAY_SECTORLINE to existing border ID: ${borderIdNum}`);
        }
    }
}
exports.EseHelper = EseHelper;
//# sourceMappingURL=ese-helper.js.map