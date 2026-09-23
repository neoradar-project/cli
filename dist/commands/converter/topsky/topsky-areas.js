"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AREAS_DATASET_FILE = void 0;
exports.parseAreas = parseAreas;
exports.buildAreasDataset = buildAreasDataset;
const topsky_active_1 = require("./topsky-active");
const topsky_coords_1 = require("./topsky-coords");
const topsky_lexer_1 = require("./topsky-lexer");
exports.AREAS_DATASET_FILE = "areas.geojson";
const AREAS_SCHEMA = "https://raw.githubusercontent.com/neoradar-project/schemas/refs/heads/main/datasets/areas.schema.json";
const INHIBIT_KEYWORDS = {
    NOMSAW: "msaw",
    NOAIW: "aiw",
    NOAPW: "apw",
    NOSAP: "sap",
    NOCLAMRAM: "clamRam",
};
// LIMITS is in HUNDREDS of feet; absent means the whole column while the area is active.
const HUNDREDS = 100;
const DEFAULT_LOWER_FT = 0;
const DEFAULT_UPPER_FT = 999999;
const CIRCLE_SPACING_DEGREES = 5;
const METRES_PER_NM = 1852;
function kindOf(line) {
    const type = (line.fields[1] ?? "").trim().toUpperCase();
    if (type === "M")
        return "mtcdInhibit";
    if (type === "S")
        return "stcaInhibit";
    if (type === "DD")
        return "clamRamInhibit";
    if (type === "T" || /^[1-5]F?$/.test(type))
        return "tsa";
    (0, topsky_lexer_1.warn)(line, `AREA type "${line.fields[1]}" is not one of T, 1 to 5, 1F to 5F, M, S or DD`);
    return null;
}
// A COORD line is either COORD:<lat>:<lon> or the sector file's REGIONS shape, one field holding
// "lat lon". Both appear in the wild, so both are read.
function coordOf(line) {
    if (line.fields.length >= 3)
        return (0, topsky_coords_1.coordinateFrom)(line, 1, 2, "vertex");
    const spaced = (0, topsky_coords_1.parseSpacedLatLon)(line.fields[1] ?? "");
    if (!spaced) {
        (0, topsky_lexer_1.warn)(line, `vertex "${line.fields[1] ?? ""}" is not a coordinate`);
        return null;
    }
    return spaced;
}
function bufferTriple(line) {
    const above = (0, topsky_lexer_1.numberField)(line, 1, "buffer above the separation level");
    const belowIfr = (0, topsky_lexer_1.numberField)(line, 2, "buffer below it for IFR");
    const belowVfr = (0, topsky_lexer_1.numberField)(line, 3, "buffer below it for VFR");
    if (above === undefined || belowIfr === undefined || belowVfr === undefined)
        return undefined;
    return [above, belowIfr, belowVfr];
}
function area(block, zone, result) {
    const kind = kindOf(block.header);
    if (!kind)
        return;
    const name = (block.header.fields[2] ?? "").trim();
    if (!name) {
        (0, topsky_lexer_1.warn)(block.header, "AREA has no name, so nothing could reference it");
        return;
    }
    const properties = { name, kind };
    const activation = [];
    const inhibits = [];
    const ring = [];
    let circleRing = null;
    let boundCircle = null;
    let lowerFt = DEFAULT_LOWER_FT;
    let upperFt = DEFAULT_UPPER_FT;
    for (const line of block.lines) {
        if (INHIBIT_KEYWORDS[line.keyword]) {
            inhibits.push(INHIBIT_KEYWORDS[line.keyword]);
            continue;
        }
        switch (line.keyword) {
            case "CATEGORY":
                properties.category = (line.fields[1] ?? "").trim();
                break;
            case "GROUP":
                // Plugin type A only; nothing in a dataset reads it.
                break;
            case "USERTEXT":
                properties.userText = line.fields.slice(1).join(":").trim();
                break;
            case "LABEL": {
                const at = (0, topsky_coords_1.coordinateFrom)(line, 1, 2, "label position");
                const text = line.fields.slice(3).join(":").trim();
                if (at) {
                    const mercator = (0, topsky_coords_1.toMercator)(at);
                    if (mercator)
                        properties.label = { x: mercator[0], y: mercator[1], text };
                }
                break;
            }
            case "LIMITS": {
                const lower = (0, topsky_lexer_1.numberField)(line, 1, "lower limit");
                const upper = (0, topsky_lexer_1.numberField)(line, 2, "upper limit");
                if (lower !== undefined)
                    lowerFt = lower * HUNDREDS;
                if (upper !== undefined)
                    upperFt = upper * HUNDREDS;
                break;
            }
            case "ELEVATION": {
                const min = (0, topsky_lexer_1.numberField)(line, 1, "minimum ground elevation");
                const max = (0, topsky_lexer_1.numberField)(line, 2, "maximum ground elevation");
                if (min !== undefined)
                    properties.elevationMinFt = min * HUNDREDS;
                if (max !== undefined)
                    properties.elevationMaxFt = max * HUNDREDS;
                break;
            }
            case "BOUND": {
                // BOUND:C:<lat>:<lon>:<radiusNm>: the containment test the client runs, where the COORD
                // lines beside it only draw.
                if ((line.fields[1] ?? "").trim().toUpperCase() !== "C") {
                    (0, topsky_lexer_1.warn)(line, "only BOUND:C is defined");
                    break;
                }
                const centre = (0, topsky_coords_1.coordinateFrom)(line, 2, 3, "bound centre");
                const radiusNm = (0, topsky_lexer_1.numberField)(line, 4, "bound radius");
                if (centre && radiusNm !== undefined && radiusNm > 0) {
                    const mercator = (0, topsky_coords_1.toMercator)(centre);
                    if (mercator)
                        boundCircle = { x: mercator[0], y: mercator[1], radiusM: radiusNm * METRES_PER_NM };
                }
                break;
            }
            case "CIRCLE": {
                const centre = (0, topsky_coords_1.coordinateFrom)(line, 1, 2, "circle centre");
                const radiusNm = (0, topsky_lexer_1.numberField)(line, 3, "circle radius");
                const spacing = line.fields[4] ? Number(line.fields[4]) : CIRCLE_SPACING_DEGREES;
                if (!centre || radiusNm === undefined || radiusNm <= 0)
                    break;
                if (ring.length > 0) {
                    (0, topsky_lexer_1.warn)(line, "CIRCLE and COORD never appear on the same area; the COORD ring is dropped");
                    ring.length = 0;
                }
                circleRing = (0, topsky_coords_1.densifyCircle)(centre, radiusNm, Number.isFinite(spacing) ? spacing : CIRCLE_SPACING_DEGREES);
                const mercator = (0, topsky_coords_1.toMercator)(centre);
                if (mercator && !boundCircle) {
                    boundCircle = { x: mercator[0], y: mercator[1], radiusM: radiusNm * METRES_PER_NM };
                }
                result.counts.circles++;
                break;
            }
            case "COORD": {
                if (circleRing) {
                    (0, topsky_lexer_1.warn)(line, "COORD after a CIRCLE on the same area is dropped");
                    break;
                }
                const point = coordOf(line);
                if (point)
                    ring.push(point);
                break;
            }
            case "ACTIVE": {
                const rule = (0, topsky_active_1.parseActive)(line);
                if (rule)
                    activation.push(rule);
                break;
            }
            case "APW_BUFFER_LAT":
                properties.apwBufferLatNm = bufferTriple(line);
                break;
            case "APW_BUFFER_VERT":
                properties.apwBufferVertFt = bufferTriple(line);
                break;
            case "SAP_BUFFER_LAT":
                properties.sapBufferLatNm = bufferTriple(line);
                break;
            case "SAP_BUFFER_VERT":
                properties.sapBufferVertFt = bufferTriple(line);
                break;
            default:
                (0, topsky_lexer_1.warn)(line, `unknown AREA property "${line.keyword}"`);
                break;
        }
    }
    const polygon = (0, topsky_coords_1.ringToPolygon)(circleRing ?? ring);
    if (!polygon) {
        (0, topsky_lexer_1.warn)(block.header, `area "${name}" has no usable geometry and is dropped`);
        return;
    }
    const folded = (0, topsky_active_1.foldSchedules)(activation, zone);
    result.counts.foldedSchedules += folded.folded;
    result.counts.partialSchedules += folded.partial;
    if (folded.partial > 0) {
        (0, topsky_lexer_1.warn)(block.header, `area "${name}" has ${folded.partial} schedule range(s) that do not match across the periods once converted to ${zone}, so they are kept as the UTC the file wrote and will need the yearly edit`);
    }
    properties.lowerFt = lowerFt;
    properties.upperFt = upperFt;
    if (inhibits.length > 0)
        properties.inhibits = inhibits;
    if (boundCircle)
        properties.circle = boundCircle;
    properties.activation = folded.rules;
    if (folded.rules.some((rule) => rule.kind === "schedule"))
        result.counts.withSchedules++;
    if (folded.rules.some((rule) => rule.kind === "aup"))
        result.counts.withAup++;
    if (folded.rules.length === 0) {
        (0, topsky_lexer_1.warn)(block.header, `area "${name}" has no ACTIVE rule, so it is inactive until a controller activates it`);
    }
    for (const key of Object.keys(properties)) {
        if (properties[key] === undefined)
            delete properties[key];
    }
    result.features.push({ type: "Feature", geometry: polygon, properties });
    result.counts.areas++;
}
function parseAreas(file, content, zone) {
    const result = {
        features: [],
        counts: { areas: 0, circles: 0, withSchedules: 0, withAup: 0, foldedSchedules: 0, partialSchedules: 0 },
    };
    const lines = (0, topsky_lexer_1.lex)(file, content);
    const grouped = (0, topsky_lexer_1.blocks)(lines, ["AREA"]);
    for (const line of grouped.preamble) {
        // CATEGORYDEF is colours, patterns and label switches; the package's map style owns those and
        // keys them on areaActive instead.
        if (line.keyword !== "CATEGORYDEF") {
            (0, topsky_lexer_1.warn)(line, `line before the first AREA block is dropped ("${line.keyword}")`);
        }
    }
    for (const block of grouped.blocks)
        area(block, zone, result);
    return result;
}
function buildAreasDataset(result) {
    return {
        $schema: AREAS_SCHEMA,
        name: "Segregated and restricted areas converted from TopSkyAreas.txt",
        type: "FeatureCollection",
        features: result.features,
    };
}
//# sourceMappingURL=topsky-areas.js.map