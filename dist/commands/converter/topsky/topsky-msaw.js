"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MSAW_DATASET_FILE = void 0;
exports.parseMsaw = parseMsaw;
exports.buildMsawDataset = buildMsawDataset;
const topsky_coords_1 = require("./topsky-coords");
const topsky_lexer_1 = require("./topsky-lexer");
exports.MSAW_DATASET_FILE = "msaw.geojson";
const MSAW_SCHEMA = "https://raw.githubusercontent.com/neoradar-project/schemas/refs/heads/main/datasets/msaw.schema.json";
// A dropped trailing zero is what this looks for: the UK file has a 3.2 NM circle at Gatwick
// reading 210 where every neighbour reads 2100. Low values that ARE a round hundred are real
// (the UK has two dozen coastal areas at 100 and 200 ft), so only a low value that is not one
// is worth an author's eye, which keeps the warning from crying wolf 29 times a run.
const SUSPICIOUS_MSA_FT = 300;
const ROUND_HUNDRED = 100;
// A polygon whose bounding box spans a whole degree or more is a FIR floor rather than a
// per-airport surveillance minimum area.
const FLOOR_SPAN_DEGREES = 1;
const CIRCLE_SPACING_DEGREES = 5;
function feature(polygon, msaFt, source, order, label) {
    return {
        type: "Feature",
        geometry: polygon,
        properties: { msaFt, source, order, label },
    };
}
function spanOf(ring) {
    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLon = Infinity;
    let maxLon = -Infinity;
    for (const point of ring) {
        minLat = Math.min(minLat, point.lat);
        maxLat = Math.max(maxLat, point.lat);
        minLon = Math.min(minLon, point.lon);
        maxLon = Math.max(maxLon, point.lon);
    }
    return Math.max(maxLat - minLat, maxLon - minLon);
}
function checkMsa(line, msaFt) {
    if (msaFt < SUSPICIOUS_MSA_FT && msaFt % ROUND_HUNDRED !== 0) {
        (0, topsky_lexer_1.warn)(line, `minimum safe altitude ${msaFt} ft is under ${SUSPICIOUS_MSA_FT} and is not a round hundred; a dropped trailing zero looks exactly like this`);
    }
}
function push(result, line, ring, msaFt, source, order) {
    const polygon = (0, topsky_coords_1.ringToPolygon)(ring);
    if (!polygon) {
        (0, topsky_lexer_1.warn)(line, "record has fewer than three distinct vertices and is not an area");
        return false;
    }
    checkMsa(line, msaFt);
    result.features.push(feature(polygon, msaFt, source, order, line.comment));
    return true;
}
// P:<n>:<lat>:<lon> x n:<msaFt>. The vertex count is authoritative, so a line carrying more or
// fewer pairs than it declares is a malformed record rather than a silent truncation.
function polygon(result, line, order) {
    const count = (0, topsky_lexer_1.numberField)(line, 1, "vertex count");
    if (count === undefined || count < 3) {
        (0, topsky_lexer_1.warn)(line, `P record declares ${line.fields[1]} vertices, which is not an area`);
        return;
    }
    const expected = 2 + count * 2 + 1;
    if (line.fields.length !== expected) {
        (0, topsky_lexer_1.warn)(line, `P record declares ${count} vertices but carries ${line.fields.length - 3} coordinate fields`);
        return;
    }
    const ring = [];
    for (let i = 0; i < count; i++) {
        const point = (0, topsky_coords_1.parseLatLon)(line.fields[2 + i * 2], line.fields[3 + i * 2]);
        if (!point) {
            (0, topsky_lexer_1.warn)(line, `vertex ${i + 1} "${line.fields[2 + i * 2]}:${line.fields[3 + i * 2]}" is not a coordinate`);
            return;
        }
        ring.push(point);
    }
    const msaFt = Number(line.fields[expected - 1]);
    if (!Number.isFinite(msaFt)) {
        (0, topsky_lexer_1.warn)(line, `minimum safe altitude "${line.fields[expected - 1]}" is not a number`);
        return;
    }
    const source = spanOf(ring) >= FLOOR_SPAN_DEGREES ? "floor" : "smaa";
    if (push(result, line, ring, msaFt, source, order))
        result.counts.polygons++;
}
// C:<lat>:<lon>:<radiusNm>:<msaFt>
function circle(result, line, order) {
    const centre = (0, topsky_coords_1.coordinateFrom)(line, 1, 2, "circle centre");
    if (!centre)
        return;
    const radiusNm = (0, topsky_lexer_1.numberField)(line, 3, "circle radius");
    const msaFt = (0, topsky_lexer_1.numberField)(line, 4, "minimum safe altitude");
    if (radiusNm === undefined || msaFt === undefined)
        return;
    if (radiusNm <= 0) {
        (0, topsky_lexer_1.warn)(line, `circle radius ${radiusNm} is not positive`);
        return;
    }
    if (push(result, line, (0, topsky_coords_1.densifyCircle)(centre, radiusNm, CIRCLE_SPACING_DEGREES), msaFt, "smaa", order)) {
        result.counts.circles++;
    }
}
// S:<lat>:<lon>:<bearing1>:<bearing2>:<rMinNm>:<rMaxNm>:<msaFt>, clockwise from bearing 1, true.
// No UK record uses one; the Developer Guide still defines it, so it is read.
function wedge(result, line, order) {
    const centre = (0, topsky_coords_1.coordinateFrom)(line, 1, 2, "sector centre");
    if (!centre)
        return;
    const bearing1 = (0, topsky_lexer_1.numberField)(line, 3, "first bearing");
    const bearing2 = (0, topsky_lexer_1.numberField)(line, 4, "second bearing");
    const innerNm = (0, topsky_lexer_1.numberField)(line, 5, "inner radius");
    const outerNm = (0, topsky_lexer_1.numberField)(line, 6, "outer radius");
    const msaFt = (0, topsky_lexer_1.numberField)(line, 7, "minimum safe altitude");
    if (bearing1 === undefined || bearing2 === undefined)
        return;
    if (innerNm === undefined || outerNm === undefined || msaFt === undefined)
        return;
    if (outerNm <= innerNm) {
        (0, topsky_lexer_1.warn)(line, `sector outer radius ${outerNm} is not beyond its inner radius ${innerNm}`);
        return;
    }
    const ring = (0, topsky_coords_1.densifyWedge)(centre, bearing1, bearing2, innerNm, outerNm, CIRCLE_SPACING_DEGREES);
    if (push(result, line, ring, msaFt, "smaa", order))
        result.counts.wedges++;
}
// A:<latMin>:<latMax>:<lonMin>:<lonMax>:<msaFt>. Commented out in the UK file, kept because the
// grammar allows it and another vAcc may use it.
function box(result, line, order) {
    const latMin = (0, topsky_lexer_1.numberField)(line, 1, "minimum latitude");
    const latMax = (0, topsky_lexer_1.numberField)(line, 2, "maximum latitude");
    const lonMin = (0, topsky_lexer_1.numberField)(line, 3, "minimum longitude");
    const lonMax = (0, topsky_lexer_1.numberField)(line, 4, "maximum longitude");
    const msaFt = (0, topsky_lexer_1.numberField)(line, 5, "minimum safe altitude");
    if (latMin === undefined || latMax === undefined)
        return;
    if (lonMin === undefined || lonMax === undefined || msaFt === undefined)
        return;
    const ring = [
        { lat: latMin, lon: lonMin },
        { lat: latMax, lon: lonMin },
        { lat: latMax, lon: lonMax },
        { lat: latMin, lon: lonMax },
    ];
    const source = spanOf(ring) >= FLOOR_SPAN_DEGREES ? "floor" : "smaa";
    if (push(result, line, ring, msaFt, source, order))
        result.counts.boxes++;
}
// L:<latMin>:<lonMin>:<dLat>:<dLon>:<n>:<msa1>:...:<msaN>. One row of the AIP ENR 6-81 Area
// Minimum Altitude grid: n cells running WEST to EAST from the row's own south-west corner.
function gridRow(result, line, order) {
    const latMin = (0, topsky_lexer_1.numberField)(line, 1, "row south edge");
    const lonMin = (0, topsky_lexer_1.numberField)(line, 2, "row west edge");
    const dLat = (0, topsky_lexer_1.numberField)(line, 3, "cell height");
    const dLon = (0, topsky_lexer_1.numberField)(line, 4, "cell width");
    const count = (0, topsky_lexer_1.numberField)(line, 5, "cell count");
    if (latMin === undefined || lonMin === undefined)
        return;
    if (dLat === undefined || dLon === undefined || count === undefined)
        return;
    if (dLat <= 0 || dLon <= 0 || count < 1) {
        (0, topsky_lexer_1.warn)(line, "L row has a non-positive cell size or no cells");
        return;
    }
    if (line.fields.length !== 6 + count) {
        (0, topsky_lexer_1.warn)(line, `L row declares ${count} cells but carries ${line.fields.length - 6} altitudes`);
        return;
    }
    for (let i = 0; i < count; i++) {
        const msaFt = Number(line.fields[6 + i]);
        if (!Number.isFinite(msaFt)) {
            (0, topsky_lexer_1.warn)(line, `cell ${i + 1} altitude "${line.fields[6 + i]}" is not a number`);
            continue;
        }
        const west = lonMin + i * dLon;
        const ring = [
            { lat: latMin, lon: west },
            { lat: latMin + dLat, lon: west },
            { lat: latMin + dLat, lon: west + dLon },
            { lat: latMin, lon: west + dLon },
        ];
        if (push(result, line, ring, msaFt, "grid", order))
            result.counts.gridCells++;
    }
}
function parseMsaw(file, content) {
    const result = {
        features: [],
        counts: { polygons: 0, circles: 0, wedges: 0, boxes: 0, gridCells: 0 },
    };
    const lines = (0, topsky_lexer_1.lex)(file, content);
    for (let order = 0; order < lines.length; order++) {
        const line = lines[order];
        switch (line.keyword) {
            case "P":
                polygon(result, line, order);
                break;
            case "C":
                circle(result, line, order);
                break;
            case "S":
                wedge(result, line, order);
                break;
            case "A":
                box(result, line, order);
                break;
            case "L":
                gridRow(result, line, order);
                break;
            default:
                (0, topsky_lexer_1.warn)(line, `unknown MSAW record "${line.keyword}"`);
                break;
        }
    }
    return result;
}
function buildMsawDataset(result) {
    return {
        $schema: MSAW_SCHEMA,
        name: "Minimum safe altitude surface converted from TopSkyMSAW.txt",
        type: "FeatureCollection",
        features: result.features,
    };
}
//# sourceMappingURL=topsky-msaw.js.map