"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RadarSectionParser = exports.RADARS_DATASET_FILE = void 0;
exports.parseRadarLine = parseRadarLine;
exports.parseHoleHeader = parseHoleHeader;
exports.buildRadarsDataset = buildRadarsDataset;
exports.writeRadarsDataset = writeRadarsDataset;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const geo_helper_1 = require("./geo-helper");
const logger_1 = require("./logger");
exports.RADARS_DATASET_FILE = "radars.json";
const RADARS_SCHEMA = "https://raw.githubusercontent.com/neoradar-project/schemas/refs/heads/main/datasets/radars.schema.json";
// RADAR2:<name>:<lat>:<lon>:<P range>:<P antenna>:<P cone>:<S range>:<S antenna>:<S cone>:<C range>:<C antenna>:<C cone>
const RADAR2_FIELD_COUNT = 13;
const SENSOR_OFFSETS = [
    ["primary", 4],
    ["secondary", 7],
    ["modeS", 10],
];
// HOLE:<primary floor>:<secondary floor>:<Mode S floor>, each optional, followed by COORD lines.
const HOLE_FLOORS = [
    ["primaryBelowFt", 1],
    ["secondaryBelowFt", 2],
    ["modeSBelowFt", 3],
];
const MIN_HOLE_VERTICES = 3;
function isSkippable(line) {
    return line.startsWith(";") || !line.trim();
}
// A RADAR2 line becomes a station; an empty range leaves that sensor out. Returns null, with a
// warning naming the line, for anything the client could not use.
function parseRadarLine(line) {
    if (isSkippable(line))
        return null;
    const parts = line.split(":").map((part) => part.trim());
    if (parts[0] !== "RADAR2") {
        (0, logger_1.logESEParsingWarning)(`Unsupported [RADAR] line dropped, only RADAR2 carries the per-sensor ranges: "${line}"`);
        return null;
    }
    while (parts.length < RADAR2_FIELD_COUNT)
        parts.push("");
    const name = parts[1];
    if (!name) {
        (0, logger_1.logESEParsingWarning)(`RADAR2 line has no station name: "${line}"`);
        return null;
    }
    const coords = geo_helper_1.geoHelper.convertESEGeoCoordinates(parts[2], parts[3]);
    if (!coords || (coords.lat === 0 && coords.lon === 0)) {
        (0, logger_1.logESEParsingWarning)(`RADAR2 station "${name}" has an unparseable position ${parts[2]}:${parts[3]}`);
        return null;
    }
    const station = { name, latitude: coords.lat, longitude: coords.lon };
    for (const [key, offset] of SENSOR_OFFSETS) {
        const sensor = parseSensor(parts[offset], parts[offset + 1], parts[offset + 2], name, key);
        if (sensor)
            station[key] = sensor;
    }
    if (!station.primary && !station.secondary && !station.modeS) {
        (0, logger_1.logESEParsingWarning)(`RADAR2 station "${name}" has no usable sensor and is dropped`);
        return null;
    }
    return station;
}
function parseSensor(range, antenna, cone, station, kind) {
    if (!range)
        return undefined;
    const rangeNm = Number(range);
    if (!Number.isFinite(rangeNm) || rangeNm <= 0) {
        (0, logger_1.logESEParsingWarning)(`RADAR2 station "${station}" ${kind} range "${range}" is not a positive number; sensor dropped`);
        return undefined;
    }
    const antennaAltitudeFt = antenna ? Number(antenna) : 0;
    if (!Number.isFinite(antennaAltitudeFt)) {
        (0, logger_1.logESEParsingWarning)(`RADAR2 station "${station}" ${kind} antenna altitude "${antenna}" is not a number; sensor dropped`);
        return undefined;
    }
    const sensor = { rangeNm, antennaAltitudeFt };
    if (cone) {
        const coneSlopeFtPerNm = Number(cone);
        if (!Number.isFinite(coneSlopeFtPerNm) || coneSlopeFtPerNm < 0) {
            (0, logger_1.logESEParsingWarning)(`RADAR2 station "${station}" ${kind} cone slope "${cone}" is not a non-negative number; sensor dropped`);
            return undefined;
        }
        sensor.coneSlopeFtPerNm = coneSlopeFtPerNm;
    }
    return sensor;
}
// A HOLE header with no floor at all hides nothing and is dropped with its COORD lines.
function parseHoleHeader(line) {
    const parts = line.split(":").map((part) => part.trim());
    const hole = { polygon: [] };
    let floors = 0;
    for (const [key, index] of HOLE_FLOORS) {
        const text = parts[index] ?? "";
        if (!text)
            continue;
        const floor = Number(text);
        if (!Number.isFinite(floor)) {
            (0, logger_1.logESEParsingWarning)(`HOLE floor "${text}" is not a number: "${line}"`);
            return null;
        }
        hole[key] = floor;
        floors++;
    }
    if (floors === 0) {
        (0, logger_1.logESEParsingWarning)(`HOLE with no floor for any sensor is dropped: "${line}"`);
        return null;
    }
    return hole;
}
// The [RADAR] section is stateful: a HOLE header owns the COORD lines after it until the next
// header or station. One parser per ESE file.
class RadarSectionParser {
    stations = [];
    holes = [];
    current = null;
    // True while the COORD lines of a dropped HOLE are being consumed without a warning each.
    discardingHole = false;
    handleLine(line) {
        if (isSkippable(line))
            return;
        const key = line.split(":", 1)[0].trim();
        switch (key) {
            case "RADAR2": {
                this.closeHole();
                const station = parseRadarLine(line);
                if (station)
                    this.stations.push(station);
                break;
            }
            case "HOLE":
                this.closeHole();
                this.current = parseHoleHeader(line);
                this.discardingHole = this.current === null;
                break;
            case "COORD":
                this.handleCoord(line);
                break;
            default:
                (0, logger_1.logESEParsingWarning)(`Unsupported [RADAR] line dropped: "${line}"`);
                break;
        }
    }
    finish() {
        this.closeHole();
        return { stations: this.stations, holes: this.holes };
    }
    handleCoord(line) {
        if (this.discardingHole)
            return;
        if (!this.current) {
            (0, logger_1.logESEParsingWarning)(`COORD outside a HOLE block in [RADAR] is dropped: "${line}"`);
            return;
        }
        const parts = line.split(":").map((part) => part.trim());
        const coords = geo_helper_1.geoHelper.convertESEGeoCoordinates(parts[1] ?? "", parts[2] ?? "");
        if (!coords) {
            (0, logger_1.logESEParsingWarning)(`HOLE vertex is unparseable and the hole is dropped: "${line}"`);
            this.current = null;
            this.discardingHole = true;
            return;
        }
        this.current.polygon.push([coords.lat, coords.lon]);
    }
    closeHole() {
        if (this.current) {
            if (this.current.polygon.length < MIN_HOLE_VERTICES) {
                (0, logger_1.logESEParsingWarning)(`HOLE with ${this.current.polygon.length} vertices is not an area and is dropped`);
            }
            else {
                this.holes.push(this.current);
            }
        }
        this.current = null;
        this.discardingHole = false;
    }
}
exports.RadarSectionParser = RadarSectionParser;
function buildRadarsDataset(section) {
    return {
        $schema: RADARS_SCHEMA,
        name: "Radar stations and holes from the ESE [RADAR] section",
        stations: section.stations,
        holes: section.holes,
    };
}
// Writes datasets/radars.json when the ESE carried at least one station, because the file's
// presence is what turns the client's coverage simulation on for the package. With no station
// nothing is written, and a file left by an earlier convert is reported rather than removed.
function writeRadarsDataset(datasetsOutputPath, section) {
    const filePath = path_1.default.join(datasetsOutputPath, exports.RADARS_DATASET_FILE);
    if (section.stations.length === 0) {
        if (section.holes.length > 0) {
            (0, logger_1.logESEParsingWarning)(`[RADAR] has ${section.holes.length} holes but no station; nothing written, holes need a station to punch through`);
        }
        if (fs_1.default.existsSync(filePath)) {
            (0, logger_1.logESEParsingWarning)(`ESE has no [RADAR] stations but ${filePath} exists; delete it to turn coverage simulation off`);
        }
        return undefined;
    }
    fs_1.default.mkdirSync(datasetsOutputPath, { recursive: true });
    fs_1.default.writeFileSync(filePath, JSON.stringify(buildRadarsDataset(section), null, 2) + "\n", "utf8");
    return filePath;
}
//# sourceMappingURL=radars.js.map