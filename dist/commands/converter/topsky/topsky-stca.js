"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.STCA_RUNWAYS_DATASET_FILE = void 0;
exports.parseStcaRunways = parseStcaRunways;
exports.buildStcaRunwaysDataset = buildStcaRunwaysDataset;
const topsky_coords_1 = require("./topsky-coords");
const topsky_lexer_1 = require("./topsky-lexer");
exports.STCA_RUNWAYS_DATASET_FILE = "stca-runways.json";
const STCA_RUNWAYS_SCHEMA = "https://raw.githubusercontent.com/neoradar-project/schemas/refs/heads/main/datasets/stca-runways.schema.json";
// The Developer Guide's defaults, in nautical miles.
const DEFAULT_FINAL_RANGE_NM = 10;
const DEFAULT_FINAL_XTE_NM = 0.5;
const DEFAULT_SOIR_RANGE_NM = 10;
const DEFAULT_NOZ_NM = 0.3;
// "27L/2000" is a runway with the level assumed under a "cleared for approach" clearance.
function runwayWithAlt(field) {
    const text = (field ?? "").trim();
    const slash = text.indexOf("/");
    if (slash < 0)
        return { runway: text };
    const altitude = Number(text.slice(slash + 1));
    return {
        runway: text.slice(0, slash),
        approachAltFt: Number.isFinite(altitude) ? altitude : undefined,
    };
}
function polygonFrom(lines, keyword) {
    const ring = [];
    for (const line of lines) {
        if (line.keyword !== keyword)
            continue;
        const point = (0, topsky_coords_1.coordinateFrom)(line, 1, 2, `${keyword} vertex`);
        if (point)
            ring.push(point);
    }
    if (ring.length === 0)
        return undefined;
    const polygon = (0, topsky_coords_1.ringToPolygon)(ring);
    if (!polygon)
        return undefined;
    return polygon;
}
function finalApproach(block) {
    const line = block.header;
    const icao = (line.fields[1] ?? "").trim().toUpperCase();
    const runway = (line.fields[2] ?? "").trim().toUpperCase();
    if (!icao || !runway) {
        (0, topsky_lexer_1.warn)(line, "FINALAPP needs an ICAO and a runway");
        return null;
    }
    const result = {
        icao,
        runway,
        rangeNm: DEFAULT_FINAL_RANGE_NM,
        xteNm: DEFAULT_FINAL_XTE_NM,
    };
    if (line.fields[3]) {
        const rangeNm = (0, topsky_lexer_1.numberField)(line, 3, "corridor length");
        if (rangeNm !== undefined && rangeNm > 0)
            result.rangeNm = rangeNm;
    }
    if (line.fields[4]) {
        const xteNm = (0, topsky_lexer_1.numberField)(line, 4, "corridor half width");
        if (xteNm !== undefined && xteNm > 0)
            result.xteNm = xteNm;
    }
    if (line.fields[5] && line.fields[6]) {
        const end = (0, topsky_coords_1.coordinateFrom)(line, 5, 6, "threshold");
        if (end) {
            const mercator = (0, topsky_coords_1.toMercator)(end);
            if (mercator)
                result.end = { x: mercator[0], y: mercator[1] };
        }
    }
    if (line.fields[7]) {
        const courseT = (0, topsky_lexer_1.numberField)(line, 7, "approach course");
        if (courseT !== undefined)
            result.courseT = courseT;
    }
    return result;
}
function parallelOperation(block) {
    const line = block.header;
    const icao = (line.fields[1] ?? "").trim().toUpperCase();
    const first = runwayWithAlt(line.fields[2]);
    const second = runwayWithAlt(line.fields[3]);
    if (!icao || !first.runway || !second.runway) {
        (0, topsky_lexer_1.warn)(line, "SOIR needs an ICAO and two runways");
        return null;
    }
    const result = {
        icao,
        left: { runway: first.runway.toUpperCase(), approachAltFt: first.approachAltFt },
        right: { runway: second.runway.toUpperCase(), approachAltFt: second.approachAltFt },
        rangeNm: DEFAULT_SOIR_RANGE_NM,
        widthInNm: DEFAULT_NOZ_NM,
        widthOutNm: DEFAULT_NOZ_NM,
        departure: false,
    };
    if (line.fields[4]) {
        const rangeNm = (0, topsky_lexer_1.numberField)(line, 4, "zone length");
        if (rangeNm !== undefined && rangeNm > 0)
            result.rangeNm = rangeNm;
    }
    if (line.fields[5]) {
        const widthInNm = (0, topsky_lexer_1.numberField)(line, 5, "inner half width");
        if (widthInNm !== undefined && widthInNm > 0)
            result.widthInNm = widthInNm;
    }
    if (line.fields[6]) {
        const widthOutNm = (0, topsky_lexer_1.numberField)(line, 6, "outer half width");
        if (widthOutNm !== undefined && widthOutNm > 0)
            result.widthOutNm = widthOutNm;
    }
    for (const child of block.lines) {
        switch (child.keyword) {
            case "DEPARTURE":
                result.departure = true;
                break;
            case "CRS1": {
                const courseT = (0, topsky_lexer_1.numberField)(child, 1, "first approach course");
                if (courseT !== undefined)
                    result.left.courseT = courseT;
                break;
            }
            case "CRS2": {
                const courseT = (0, topsky_lexer_1.numberField)(child, 1, "second approach course");
                if (courseT !== undefined)
                    result.right.courseT = courseT;
                break;
            }
            case "NOZ1":
            case "NOZ2":
            case "NTZ":
                break;
            default:
                (0, topsky_lexer_1.warn)(child, `unknown SOIR property "${child.keyword}"`);
                break;
        }
    }
    result.left.noz = polygonFrom(block.lines, "NOZ1");
    result.right.noz = polygonFrom(block.lines, "NOZ2");
    result.ntz = polygonFrom(block.lines, "NTZ");
    return result;
}
function parseStcaRunways(file, content) {
    const result = { finalApproaches: [], parallelOperations: [] };
    const lines = (0, topsky_lexer_1.lex)(file, content);
    const grouped = (0, topsky_lexer_1.blocks)(lines, ["FINALAPP", "SOIR"]);
    for (const line of grouped.preamble) {
        (0, topsky_lexer_1.warn)(line, `line before the first FINALAPP or SOIR block is dropped ("${line.keyword}")`);
    }
    for (const block of grouped.blocks) {
        if (block.header.keyword === "FINALAPP") {
            const parsed = finalApproach(block);
            if (parsed)
                result.finalApproaches.push(parsed);
            for (const child of block.lines) {
                if (child.keyword !== "FINALAPP") {
                    (0, topsky_lexer_1.warn)(child, `FINALAPP carries no properties; "${child.keyword}" is dropped`);
                }
            }
            continue;
        }
        const parsed = parallelOperation(block);
        if (parsed)
            result.parallelOperations.push(parsed);
    }
    return result;
}
function buildStcaRunwaysDataset(result) {
    return {
        $schema: STCA_RUNWAYS_SCHEMA,
        name: "Runway-derived STCA regions converted from TopSkySTCA.txt",
        finalApproaches: result.finalApproaches,
        parallelOperations: result.parallelOperations,
    };
}
//# sourceMappingURL=topsky-stca.js.map