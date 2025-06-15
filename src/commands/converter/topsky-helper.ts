import { Ora } from "ora";
import { logSCTParsingWarning } from "../../helper/logger";

export interface TopSkyMap {
  name: string;
  folder: string;
  featureCollection: GeoJSON.FeatureCollection;
}

export const createEmptyMap = (): TopSkyMap => ({
  name: "",
  folder: "",
  featureCollection: {
    type: "FeatureCollection",
    features: [],
  },
});

export const EMPTY_MAP: TopSkyMap = createEmptyMap();

export const pushMapIfValid = (map: TopSkyMap, maps: TopSkyMap[]): boolean => {
  if (map.featureCollection.features.length > 0) {
    maps.push(map);
    return true;
  }
  return false;
};

export const parseColorDef = (line: string): [string, number[]] | undefined => {
  const parts = line.split(":");
  if (parts.length < 3) {
    logSCTParsingWarning(
      `Invalid COLORDEF line: "${line}". Expected format: "COLORDEF:<colorName>:<r>:<g>:<b>"`
    );
    return undefined;
  }
  const colorName = parts[1];
  const colorValues = parts.slice(2).map(Number);
  return [colorName, colorValues];
};

export const getUUID = (map: TopSkyMap): string => {
  // Generate a UUID based on the map name and folder
  return `${map.name}-${map.folder}`.replace(/\s+/g, "-").toLowerCase();
};

export const pushFeatureIfValid = (
  currentLineString: GeoJSON.LineString | null,
  currentMultiLineString: GeoJSON.MultiLineString | null,
  color: number[],
  map: TopSkyMap
): { lineString: null; multiLineString: null } => {
  if (currentLineString && currentLineString.coordinates.length > 0) {
    const feature: GeoJSON.Feature = {
      type: "Feature",
      geometry: currentLineString,
      properties: {
        name: map.name,
        type: map.folder,
        uuid: getUUID(map),
        lineStyle: { color: color },
      },
    };
    map.featureCollection.features.push(feature);
  }

  if (currentMultiLineString && currentMultiLineString.coordinates.length > 0) {
    const feature: GeoJSON.Feature = {
      type: "Feature",
      geometry: currentMultiLineString,
      properties: {
        name: map.name,
        type: map.folder,
        uuid: getUUID(map),
        lineStyle: { color: color },
      },
    };
    map.featureCollection.features.push(feature);
  }

  return { lineString: null, multiLineString: null };
};

export const checkIfColourIsValid = (
  color: string | null,
  colourMap: Record<string, number[]>,
  spinner: Ora
) => {
  if (color && !colourMap[color]) {
    logSCTParsingWarning(`Color "${color}" not defined in COLORDEF.`);
    spinner.warn(`Unknown color "${color}" in map.`);
    return false;
  }
  return true;
};
