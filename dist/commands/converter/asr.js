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
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = require("fs");
const path_1 = require("path");
const turf = __importStar(require("@turf/turf"));
const projection_1 = require("@turf/projection");
class AsrFolderConverter {
    static createUniqueId(type, name) {
        const typeStr = type.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
        const formatted = `${typeStr}-${name}`.toLowerCase().replace(/[^a-z0-9-]/g, "-");
        return formatted.replace(/-+/g, "-").replace(/-$/g, "");
    }
    static cleanName(name) {
        return name.trim();
    }
    static parseAsrLines(lines) {
        let items = [];
        let centerPoint = null;
        let windowArea = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
        for (const line of lines) {
            const parts = line.split(":");
            if (parts.length < 2)
                continue;
            const type = parts[0].trim();
            // If a layer line is found, parse it
            const mappedType = this.layerTypeMapping[type];
            if (mappedType) {
                const item = this.parseLayerLine(mappedType, parts);
                if (item)
                    items.push(item);
            }
            // Window area line
            if (type === "WINDOWAREA" && parts.length >= 5) {
                const bounds = parts.slice(1, 5).map((x) => parseFloat(x));
                const [minLat, minLon, maxLat, maxLon] = bounds;
                const point1 = turf.point([minLon, minLat]);
                const point2 = turf.point([maxLon, maxLat]);
                const center = turf.center(turf.featureCollection([point1, point2]));
                const [lon, lat] = center.geometry.coordinates;
                const [minX, minY] = (0, projection_1.toMercator)([minLon, minLat]);
                const [maxX, maxY] = (0, projection_1.toMercator)([maxLon, maxLat]);
                windowArea = { minX, minY, maxX, maxY };
                const [x, y] = (0, projection_1.toMercator)([lon, lat]);
                if (!centerPoint) {
                    centerPoint = { x, y };
                }
            }
        }
        return { items, centerPoint, windowArea };
    }
    static parseLayerLine(type, parts) {
        const name = parts[1].trim();
        if (!name)
            return null;
        const cleanedName = this.cleanName(name);
        const item = {
            showLabel: false,
            uuid: this.createUniqueId(type, cleanedName),
        };
        if (this.pointTypes.has(type)) {
            item.pointType = "icon+text";
        }
        else if (this.textOnlyTypes.has(type)) {
            item.pointType = "text";
        }
        return item;
    }
    static convertContent(asrContent, filename) {
        const lines = asrContent.split("\n");
        const { items, centerPoint, windowArea } = this.parseAsrLines(lines);
        return {
            name: (0, path_1.parse)(filename).name,
            type: "profile",
            updatedAt: new Date().toISOString(),
            map: {
                center: centerPoint || { x: 0, y: 0 },
                windowArea,
                zoom: 7,
                orientation: 0,
                items,
            },
        };
    }
    static ensureDirectoryExists(dirPath) {
        if (!(0, fs_1.existsSync)(dirPath)) {
            (0, fs_1.mkdirSync)(dirPath, { recursive: true });
        }
    }
    static processFile(filepath, inputBasePath, outputBasePath) {
        try {
            const content = (0, fs_1.readFileSync)(filepath, "utf8");
            const relativePath = (0, path_1.relative)(inputBasePath, filepath);
            const parsedPath = (0, path_1.parse)(relativePath);
            const outputDirPath = (0, path_1.join)(outputBasePath, (0, path_1.parse)(relativePath).dir);
            this.ensureDirectoryExists(outputDirPath);
            const outputFilePath = (0, path_1.join)(outputDirPath, `${parsedPath.name}.stp`);
            const stpData = this.convertContent(content, parsedPath.name);
            (0, fs_1.writeFileSync)(outputFilePath, JSON.stringify(stpData, null, 2));
        }
        catch (error) {
            console.error(`Error processing file ${filepath}:`, error);
        }
    }
    static processDirectory(dirPath, inputBasePath, outputBasePath) {
        const items = (0, fs_1.readdirSync)(dirPath);
        for (const item of items) {
            const fullPath = (0, path_1.join)(dirPath, item);
            const stat = (0, fs_1.statSync)(fullPath);
            if (stat.isDirectory()) {
                this.processDirectory(fullPath, inputBasePath, outputBasePath);
            }
            else if (stat.isFile() && item.toLowerCase().endsWith(".asr")) {
                this.processFile(fullPath, inputBasePath, outputBasePath);
            }
        }
    }
    static convertFolder(inputPath, outputPath) {
        if (!(0, fs_1.existsSync)(inputPath)) {
            throw new Error(`Input folder does not exist: ${inputPath}`);
        }
        this.ensureDirectoryExists(outputPath);
        try {
            this.processDirectory(inputPath, inputPath, outputPath);
        }
        catch (error) {
            console.error("Error during ASR folder conversion:", error);
            throw error;
        }
    }
}
AsrFolderConverter.layerTypeMapping = {
    "ARTCC high boundary": "artccHigh",
    "ARTCC low boundary": "artccLow",
    "ARTCC boundary": "artcc",
    Regions: "region",
    "Low airways": "lowAirway",
    "High airways": "highAirway",
    Sids: "sid",
    Stars: "star",
    Geo: "geo",
    Fixes: "fix",
    VORs: "vor",
    NDBs: "ndb",
    Airports: "airport",
    Runways: "runway",
    "Free text": "label",
};
AsrFolderConverter.pointTypes = new Set(["fix", "vor", "ndb", "airport"]);
AsrFolderConverter.textOnlyTypes = new Set(["label"]);
exports.default = AsrFolderConverter;
//# sourceMappingURL=asr.js.map