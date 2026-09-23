"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseMaps = parseMaps;
exports.mergeMapsByFolder = mergeMapsByFolder;
const geo_helper_1 = require("../../../helper/geo-helper");
const topsky_helper_1 = require("../topsky-helper");
const topsky_lexer_1 = require("./topsky-lexer");
/**
 * The map conversion as it has always been, moved onto the shared lexer with its OUTPUT
 * UNCHANGED. The conditional map system (ACTIVE and AND_ACTIVE on a MAP block, ZOOM, LAYER,
 * STYLE, SYMBOL, TEXT, ASRDATA, SCTFILEDATA) is its own roadmap and still lands nowhere; this
 * file is where it will go.
 */
function parseMaps(file, content) {
    const maps = [];
    let colourMap = {};
    let currentMap = (0, topsky_helper_1.createEmptyMap)();
    let currentColor = null;
    let currentFillColor = null;
    let currentLineString = null;
    let currentMultiLineString = null;
    const colourOf = (name) => colourMap[name || "unknown"] || [255, 255, 255];
    for (const line of (0, topsky_lexer_1.lex)(file, content)) {
        const raw = line.raw;
        if (line.keyword === "COLORDEF") {
            if ((0, topsky_helper_1.pushMapIfValid)(currentMap, maps)) {
                currentMap = (0, topsky_helper_1.createEmptyMap)();
            }
            const colorDef = (0, topsky_helper_1.parseColorDef)(raw);
            if (colorDef) {
                colourMap[colorDef[0]] = colorDef[1];
            }
            else {
                (0, topsky_lexer_1.warn)(line, "COLORDEF needs a name and three components");
            }
            continue;
        }
        if (line.keyword === "MAP") {
            const resetResult = (0, topsky_helper_1.pushFeatureIfValid)(currentLineString, currentMultiLineString, colourOf(currentColor), currentMap);
            currentLineString = resetResult.lineString;
            currentMultiLineString = resetResult.multiLineString;
            if ((0, topsky_helper_1.pushMapIfValid)(currentMap, maps)) {
                currentMap = (0, topsky_helper_1.createEmptyMap)();
            }
            currentMap.name = line.fields.slice(1).join(":").trim();
            currentColor = null;
            continue;
        }
        if (line.keyword === "FOLDER") {
            currentMap.folder = line.fields.slice(1).join(":").trim();
            continue;
        }
        if (line.keyword === "COLOR") {
            const parts = line.fields.slice(1);
            if (parts.length === 1) {
                currentColor = parts[0];
            }
            else if (parts.length >= 2) {
                currentColor = parts[0];
                currentFillColor = parts[1];
            }
            for (const name of [currentColor, currentFillColor]) {
                if (name && !colourMap[name])
                    (0, topsky_lexer_1.warn)(line, `colour "${name}" is not defined by a COLORDEF`);
            }
            const resetResult = (0, topsky_helper_1.pushFeatureIfValid)(currentLineString, currentMultiLineString, colourOf(currentColor), currentMap);
            currentLineString = resetResult.lineString;
            currentMultiLineString = resetResult.multiLineString;
            continue;
        }
        if (line.keyword === "COORD") {
            if (!currentLineString) {
                currentLineString = { type: "LineString", coordinates: [] };
            }
            if (line.fields.length !== 3) {
                (0, topsky_lexer_1.warn)(line, "COORD needs a latitude and a longitude");
                continue;
            }
            const cartesian = geo_helper_1.geoHelper.convertESEGeoCoordinatesToCartesian(line.fields[1], line.fields[2]);
            if (cartesian) {
                currentLineString.coordinates.push(cartesian);
            }
            else {
                (0, topsky_lexer_1.warn)(line, "COORD holds coordinates that cannot be read");
            }
            continue;
        }
        if (line.keyword === "COORDLINE") {
            if (currentLineString) {
                const resetResult = (0, topsky_helper_1.pushFeatureIfValid)(currentLineString, null, colourMap[currentColor || "unknown"] || [0, 0, 0], currentMap);
                currentLineString = resetResult.lineString;
            }
            continue;
        }
        if (line.keyword === "COORDPOLY") {
            if (currentLineString && currentLineString.coordinates.length > 0) {
                const strokeColour = colourMap[currentColor || "unknown"] || [0, 0, 0];
                const fillColour = colourMap[currentFillColor || "unknown"] || [255, 255, 255];
                currentMap.featureCollection.features.push({
                    type: "Feature",
                    geometry: { type: "Polygon", coordinates: [currentLineString.coordinates] },
                    properties: {
                        name: currentMap.name,
                        type: currentMap.folder,
                        uuid: (0, topsky_helper_1.getUUID)(currentMap),
                        lineStyle: { color: strokeColour },
                        fillStyle: { color: fillColour },
                    },
                });
                currentLineString = null;
                currentMultiLineString = null;
            }
            continue;
        }
        if (line.keyword === "LINE") {
            if (!currentMultiLineString) {
                currentMultiLineString = { type: "MultiLineString", coordinates: [] };
            }
            if (line.fields.length !== 5) {
                (0, topsky_lexer_1.warn)(line, "LINE needs two coordinate pairs");
                continue;
            }
            const from = geo_helper_1.geoHelper.convertESEGeoCoordinatesToCartesian(line.fields[1], line.fields[2]);
            const to = geo_helper_1.geoHelper.convertESEGeoCoordinatesToCartesian(line.fields[3], line.fields[4]);
            if (from && to) {
                currentMultiLineString.coordinates.push([from, to]);
            }
            else {
                (0, topsky_lexer_1.warn)(line, "LINE holds coordinates that cannot be read");
            }
            continue;
        }
    }
    (0, topsky_helper_1.pushFeatureIfValid)(currentLineString, currentMultiLineString, colourOf(currentColor), currentMap);
    (0, topsky_helper_1.pushMapIfValid)(currentMap, maps);
    return maps;
}
// Merges every converted map by its FOLDER, which is the one geojson file per folder the client
// loads. Unchanged from the original conversion.
function mergeMapsByFolder(maps) {
    const merged = {};
    for (const map of maps) {
        if (!map.folder)
            continue;
        const collection = merged[map.folder] ?? (merged[map.folder] = { type: "FeatureCollection", features: [] });
        collection.features.push(...map.featureCollection.features);
    }
    return merged;
}
//# sourceMappingURL=topsky-maps.js.map