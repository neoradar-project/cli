"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TOPSKY_STAGES = exports.TOPSKY_FOLDER = void 0;
exports.defaultTimezone = defaultTimezone;
exports.runTopSkyPipeline = runTopSkyPipeline;
exports.topSkyOutputNames = topSkyOutputNames;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const radars_1 = require("../../../helper/radars");
const logger_1 = require("../../../helper/logger");
const topsky_areas_1 = require("./topsky-areas");
const topsky_msaw_1 = require("./topsky-msaw");
const topsky_maps_1 = require("./topsky-maps");
const topsky_radars_1 = require("./topsky-radars");
const topsky_stca_1 = require("./topsky-stca");
exports.TOPSKY_FOLDER = "topsky";
// The pipeline stages, which are also the values --only takes.
exports.TOPSKY_STAGES = ["maps", "msaw", "areas", "stca", "radars"];
// A manual activation override file makes the plugin warn its user of a non-standard setup, so a
// package build that merged one silently would ship a picture no other controller sees. The same
// refusal posture assertNoLicensedArtifacts takes.
const REFUSED_FILE = "topskyareasmanualact.txt";
// Files the pipeline knows. Anything else in the folder is warned about once and left alone; the
// ones mapped to null are read by TopSky and carry nothing a dataset wants yet.
const KNOWN_FILES = {
    "topskymaps.txt": "maps",
    "topskymapslocal.txt": "maps",
    "topskymsaw.txt": "msaw",
    "topskyareas.txt": "areas",
    "topskystca.txt": "stca",
    "topskyradars.txt": "radars",
    "topskyairspace.txt": null,
    "topskysettings.txt": null,
    "topskysettingslocal.txt": null,
};
function defaultTimezone() {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    }
    catch {
        return "UTC";
    }
}
function wants(options, stage) {
    return !options.only || options.only.includes(stage);
}
// A FOLDER name becomes a file name and a manifest layer id, and the UK file has folders like
// "Release/Delegation Lines". A separator in there would write outside datasets/, so it is
// flattened and the run says which names were changed.
function layerFileName(folder) {
    return folder.replace(/[\/:*?"<>|]+/g, " - ").replace(/\s+/g, " ").trim();
}
function write(filePath, body) {
    fs_1.default.mkdirSync(path_1.default.dirname(filePath), { recursive: true });
    fs_1.default.writeFileSync(filePath, JSON.stringify(body, null, 2) + "\n", "utf8");
    return filePath;
}
function readRadars(datasetsPath) {
    const filePath = path_1.default.join(datasetsPath, radars_1.RADARS_DATASET_FILE);
    if (!fs_1.default.existsSync(filePath))
        return null;
    try {
        return JSON.parse(fs_1.default.readFileSync(filePath, "utf8"));
    }
    catch (error) {
        (0, logger_1.logTopSkyParsingWarning)(radars_1.RADARS_DATASET_FILE, 0, "", `existing radars.json cannot be read (${error instanceof Error ? error.message : "unknown error"}), so no raw video was merged`);
        return null;
    }
}
/**
 * The one TopSky pipeline. `topsky-convert` runs it alone and `convert` runs it as part of the
 * normal package build, after the ESE step (which writes radars.json the raw video merges onto)
 * and before the indexer (which picks the new datasets up as map layers).
 *
 * Dispatch is by file NAME, because the folder now holds more than maps: the old command read
 * every .txt as a maps file and would write nothing useful from an MSAW or areas file.
 */
async function runTopSkyPipeline(packageEnvironmentPath, options) {
    const spinner = options.spinner;
    const folder = path_1.default.join(packageEnvironmentPath, exports.TOPSKY_FOLDER);
    const datasetsPath = path_1.default.join(packageEnvironmentPath, "package", "datasets");
    const result = { ran: false, refused: false, files: [], written: [], warnings: 0 };
    if (!fs_1.default.existsSync(folder)) {
        spinner?.info(`No ${exports.TOPSKY_FOLDER}/ folder, skipping the TopSky data pipeline.`);
        return result;
    }
    const before = logger_1.topSkyParsingErrorCount;
    const entries = fs_1.default
        .readdirSync(folder)
        .filter((entry) => fs_1.default.statSync(path_1.default.join(folder, entry)).isFile());
    const refused = entries.find((entry) => entry.toLowerCase() === REFUSED_FILE);
    if (refused) {
        spinner?.fail(`${exports.TOPSKY_FOLDER}/${refused} is a manual activation override; the package build does not merge one. Remove it and fold the change into TopSkyAreas.txt.`);
        result.refused = true;
        return result;
    }
    result.ran = true;
    const maps = [];
    let radarSection = null;
    const radarsDataset = readRadars(datasetsPath);
    for (const entry of entries) {
        const lower = entry.toLowerCase();
        if (!(lower in KNOWN_FILES)) {
            if (lower.endsWith(".txt")) {
                spinner?.warn(`Unknown TopSky file ${entry}, skipped. Known: ${Object.keys(KNOWN_FILES).join(", ")}`);
            }
            result.files.push({ file: entry, stage: "skipped", parsed: 0, written: 0 });
            continue;
        }
        const stage = KNOWN_FILES[lower];
        if (stage === null) {
            // Read by TopSky, nothing here yet: TopSkyAirspace.txt's QNHTL and APPLINE and the
            // settings files belong to other plans.
            result.files.push({ file: entry, stage: "skipped", parsed: 0, written: 0 });
            continue;
        }
        if (!wants(options, stage)) {
            result.files.push({ file: entry, stage: "skipped", parsed: 0, written: 0 });
            continue;
        }
        const content = fs_1.default.readFileSync(path_1.default.join(folder, entry), "utf8");
        switch (stage) {
            case "maps": {
                const parsed = (0, topsky_maps_1.parseMaps)(entry, content);
                maps.push(...parsed);
                result.files.push({ file: entry, stage, parsed: parsed.length, written: 0 });
                break;
            }
            case "msaw": {
                const parsed = (0, topsky_msaw_1.parseMsaw)(entry, content);
                const filePath = write(path_1.default.join(datasetsPath, topsky_msaw_1.MSAW_DATASET_FILE), (0, topsky_msaw_1.buildMsawDataset)(parsed));
                result.written.push(filePath);
                result.files.push({ file: entry, stage, parsed: parsed.features.length, written: parsed.features.length });
                spinner?.info(`MSAW: ${parsed.counts.polygons} polygons, ${parsed.counts.circles} circles, ${parsed.counts.wedges} sectors, ${parsed.counts.boxes} boxes, ${parsed.counts.gridCells} grid cells.`);
                break;
            }
            case "areas": {
                const parsed = (0, topsky_areas_1.parseAreas)(entry, content, options.timezone);
                const filePath = write(path_1.default.join(datasetsPath, topsky_areas_1.AREAS_DATASET_FILE), (0, topsky_areas_1.buildAreasDataset)(parsed));
                result.written.push(filePath);
                result.files.push({ file: entry, stage, parsed: parsed.counts.areas, written: parsed.counts.areas });
                spinner?.info(`Areas: ${parsed.counts.areas} areas, ${parsed.counts.circles} circles, ${parsed.counts.withAup} on the AUP feed, ${parsed.counts.withSchedules} scheduled, ${parsed.counts.foldedSchedules} schedules folded into ${options.timezone}, ${parsed.counts.partialSchedules} left as UTC.`);
                break;
            }
            case "stca": {
                const parsed = (0, topsky_stca_1.parseStcaRunways)(entry, content);
                const count = parsed.finalApproaches.length + parsed.parallelOperations.length;
                const filePath = write(path_1.default.join(datasetsPath, topsky_stca_1.STCA_RUNWAYS_DATASET_FILE), (0, topsky_stca_1.buildStcaRunwaysDataset)(parsed));
                result.written.push(filePath);
                result.files.push({ file: entry, stage, parsed: count, written: count });
                spinner?.info(`STCA: ${parsed.finalApproaches.length} final approach corridors, ${parsed.parallelOperations.length} parallel operations.`);
                break;
            }
            case "radars": {
                const parsed = (0, topsky_radars_1.parseTopSkyRadars)(entry, content);
                if (!radarsDataset) {
                    spinner?.warn(`${entry} carries ${parsed.parsed.length} stations but there is no datasets/radars.json to merge them onto; run the ESE conversion first.`);
                    result.files.push({ file: entry, stage, parsed: parsed.parsed.length, written: 0 });
                    break;
                }
                radarSection = radarsDataset;
                const merged = (0, topsky_radars_1.mergeRawVideo)(radarSection, parsed);
                spinner?.info(`Radars: ${merged.matchedByName} matched by name, ${merged.matchedByLocation} by location, ${merged.added} added, ${merged.terrainLinesDropped} terrain lines dropped (the ESE HOLE polygons already mask coverage).`);
                result.files.push({ file: entry, stage, parsed: parsed.parsed.length, written: merged.matchedByName + merged.matchedByLocation + merged.added });
                break;
            }
        }
    }
    if (radarSection) {
        const filePath = write(path_1.default.join(datasetsPath, radars_1.RADARS_DATASET_FILE), (0, radars_1.buildRadarsDataset)(radarSection));
        result.written.push(filePath);
    }
    if (maps.length > 0) {
        const merged = (0, topsky_maps_1.mergeMapsByFolder)(maps);
        for (const [folderName, collection] of Object.entries(merged)) {
            if (collection.features.length === 0) {
                spinner?.warn(`No features found for map folder "${folderName}", skipping.`);
                continue;
            }
            const layer = layerFileName(folderName);
            if (layer !== folderName) {
                spinner?.warn(`Map folder "${folderName}" holds a path separator; written as "${layer}.geojson".`);
            }
            const filePath = path_1.default.join(datasetsPath, `${layer}.geojson`);
            fs_1.default.mkdirSync(datasetsPath, { recursive: true });
            fs_1.default.writeFileSync(filePath, JSON.stringify(collection), "utf8");
            result.written.push(filePath);
        }
        spinner?.info(`Maps: ${maps.length} maps merged into ${Object.keys(merged).length} folders.`);
    }
    result.warnings = logger_1.topSkyParsingErrorCount - before;
    return result;
}
// The dataset files a run may overwrite, named in convert's confirmation text so the contract for
// what it touches stays complete.
function topSkyOutputNames() {
    return [
        `datasets/${topsky_msaw_1.MSAW_DATASET_FILE}`,
        `datasets/${topsky_areas_1.AREAS_DATASET_FILE}`,
        `datasets/${topsky_stca_1.STCA_RUNWAYS_DATASET_FILE}`,
        `the rawVideo blocks in datasets/${radars_1.RADARS_DATASET_FILE}`,
        "one datasets/<folder>.geojson per TopSky map folder",
    ];
}
//# sourceMappingURL=index.js.map