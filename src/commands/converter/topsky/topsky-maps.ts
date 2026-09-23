import { geoHelper } from "../../../helper/geo-helper";
import {
  createEmptyMap,
  getUUID,
  parseColorDef,
  pushFeatureIfValid,
  pushMapIfValid,
  TopSkyMap,
} from "../topsky-helper";
import { lex, warn } from "./topsky-lexer";

/**
 * The map conversion as it has always been, moved onto the shared lexer with its OUTPUT
 * UNCHANGED. The conditional map system (ACTIVE and AND_ACTIVE on a MAP block, ZOOM, LAYER,
 * STYLE, SYMBOL, TEXT, ASRDATA, SCTFILEDATA) is its own roadmap and still lands nowhere; this
 * file is where it will go.
 */
export function parseMaps(file: string, content: string): TopSkyMap[] {
  const maps: TopSkyMap[] = [];

  let colourMap: Record<string, number[]> = {};
  let currentMap: TopSkyMap = createEmptyMap();
  let currentColor: string | null = null;
  let currentFillColor: string | null = null;
  let currentLineString: GeoJSON.LineString | null = null;
  let currentMultiLineString: GeoJSON.MultiLineString | null = null;

  const colourOf = (name: string | null): number[] =>
    colourMap[name || "unknown"] || [255, 255, 255];

  for (const line of lex(file, content)) {
    const raw = line.raw;

    if (line.keyword === "COLORDEF") {
      if (pushMapIfValid(currentMap, maps)) {
        currentMap = createEmptyMap();
      }
      const colorDef = parseColorDef(raw);
      if (colorDef) {
        colourMap[colorDef[0]] = colorDef[1];
      } else {
        warn(line, "COLORDEF needs a name and three components");
      }
      continue;
    }

    if (line.keyword === "MAP") {
      const resetResult = pushFeatureIfValid(
        currentLineString,
        currentMultiLineString,
        colourOf(currentColor),
        currentMap
      );
      currentLineString = resetResult.lineString;
      currentMultiLineString = resetResult.multiLineString;

      if (pushMapIfValid(currentMap, maps)) {
        currentMap = createEmptyMap();
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
      } else if (parts.length >= 2) {
        currentColor = parts[0];
        currentFillColor = parts[1];
      }
      for (const name of [currentColor, currentFillColor]) {
        if (name && !colourMap[name]) warn(line, `colour "${name}" is not defined by a COLORDEF`);
      }

      const resetResult = pushFeatureIfValid(
        currentLineString,
        currentMultiLineString,
        colourOf(currentColor),
        currentMap
      );
      currentLineString = resetResult.lineString;
      currentMultiLineString = resetResult.multiLineString;
      continue;
    }

    if (line.keyword === "COORD") {
      if (!currentLineString) {
        currentLineString = { type: "LineString", coordinates: [] };
      }
      if (line.fields.length !== 3) {
        warn(line, "COORD needs a latitude and a longitude");
        continue;
      }
      const cartesian = geoHelper.convertESEGeoCoordinatesToCartesian(line.fields[1], line.fields[2]);
      if (cartesian) {
        currentLineString.coordinates.push(cartesian);
      } else {
        warn(line, "COORD holds coordinates that cannot be read");
      }
      continue;
    }

    if (line.keyword === "COORDLINE") {
      if (currentLineString) {
        const resetResult = pushFeatureIfValid(
          currentLineString,
          null,
          colourMap[currentColor || "unknown"] || [0, 0, 0],
          currentMap
        );
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
            uuid: getUUID(currentMap),
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
        warn(line, "LINE needs two coordinate pairs");
        continue;
      }
      const from = geoHelper.convertESEGeoCoordinatesToCartesian(line.fields[1], line.fields[2]);
      const to = geoHelper.convertESEGeoCoordinatesToCartesian(line.fields[3], line.fields[4]);
      if (from && to) {
        currentMultiLineString.coordinates.push([from, to]);
      } else {
        warn(line, "LINE holds coordinates that cannot be read");
      }
      continue;
    }
  }

  pushFeatureIfValid(currentLineString, currentMultiLineString, colourOf(currentColor), currentMap);
  pushMapIfValid(currentMap, maps);
  return maps;
}

// Merges every converted map by its FOLDER, which is the one geojson file per folder the client
// loads. Unchanged from the original conversion.
export function mergeMapsByFolder(maps: TopSkyMap[]): Record<string, GeoJSON.FeatureCollection> {
  const merged: Record<string, GeoJSON.FeatureCollection> = {};
  for (const map of maps) {
    if (!map.folder) continue;
    const collection =
      merged[map.folder] ?? (merged[map.folder] = { type: "FeatureCollection", features: [] });
    collection.features.push(...map.featureCollection.features);
  }
  return merged;
}
