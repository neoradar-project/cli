import fs from "fs";
import { Position } from "sector-file-tools";
import { Navaid, Segment } from "sector-file-tools/dist/src/sct";
import readline from "readline";

export const getCurrentAiracCycle = () => {
  const today = new Date();
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth() + 1; // Months are 0-indexed in JavaScript
  const cycleMonth = Math.ceil(month / 2) * 2; // AIRAC cycles are every 28 days, so we round up to the nearest even month
  const cycleYear = cycleMonth > 12 ? year + 1 : year; // If the month exceeds December, increment the year
  const cycleMonthStr = cycleMonth > 9 ? cycleMonth.toString() : `0${cycleMonth}`;
  return `${cycleYear.toFixed(0).slice(2)}${cycleMonthStr}`;
};

export const fileFilesWithExtension = (directory: string, extensions: string[]): string[] => {
  const matchingFiles: string[] = [];
  try {
    const files = fs.readdirSync(directory);
    files.forEach((file) => {
      if (extensions.some((ext) => file.endsWith(ext))) {
        matchingFiles.push(file);
      }
    });
  } catch (error) {
    console.error(`Error reading directory ${directory}: ${error instanceof Error ? error.message : "Unknown error"}`);
    return [];
  }
  return matchingFiles;
};

export function extractAirwaySegment(segment: Segment): number[][] {
  let returnSegment: number[][] = [];
  returnSegment.push(
    "position" in segment.start
      ? [(segment.start as Navaid).position.lonFloat, (segment.start as Navaid).position.latFloat]
      : [(segment.start as Position).lonFloat, (segment.start as Position).latFloat]
  );
  returnSegment.push(
    "position" in segment.end
      ? [(segment.end as Navaid).position.lonFloat, (segment.end as Navaid).position.latFloat]
      : [(segment.end as Position).lonFloat, (segment.end as Position).latFloat]
  );
  return returnSegment;
}

export function getFeatureName(feature: GeoJSON.Feature<any>): string | null {
  if (!feature || !feature.properties || !feature.properties.type) {
    console.warn("Feature without properties or type:", feature);
    return null;
  }
  const type = feature.properties.type;

  // Standard name property types
  if (["airport", "fix", "highAirway", "lowAirway", "ndb", "vor"].includes(type)) {
    if (feature.properties.name) {
      return feature.properties.name;
    }
  }

  if (["region"].includes(type)) {
    if (feature.properties.region) {
      return feature.properties.region;
    }
  }

  // Section property types
  if (["artcc-high", "artcc-low", "artcc", "geo", "high-airway", "low-airway", "sid", "star"].includes(type)) {
    if (feature.properties.section) {
      return feature.properties.section;
    }
  }

  // Label specific
  if (type === "label") {
    if (feature.properties.section) {
      return feature.properties.section;
    }

    if (feature.properties.value) {
      return feature.properties.value;
    }
  }

  // Runway specific (combine ICAO and name)
  if (type === "runway") {
    if (feature.properties.icao && feature.properties.name) {
      return `${feature.properties.icao}-${feature.properties.name}-${feature.properties.oppositeId}`;
    }
  }

  // Default fallback
  if (feature.properties.name) {
    return feature.properties.name;
  }

  return null;
}

export async function generateGeoJsonFilesForType(path: string, fileOrTypeName: string, allFeatures: any[]) {
  const features = allFeatures;
  const geojson = {
    type: "FeatureCollection",
    features: features,
  };
  const data = JSON.stringify(geojson);
  const formattedType = fileOrTypeName.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
  const filePath = `${path}/${formattedType}.geojson`;
  fs.writeFileSync(filePath, data, "utf8");
}

export const convertColorFeaturePropertyToGeojsonProperties = (feature: GeoJSON.Feature, isPolygon: boolean = false): GeoJSON.Feature => {
  const { properties } = feature;
  if (!properties) {
    return feature;
  }
  const { color, ...rest } = properties;
  if (!color) {
    return feature;
  }

  const style = {
    color,
  };

  if (isPolygon) {
    return {
      ...feature,
      properties: {
        ...rest,
        fillStyle: {
          color,
        },
      },
    };
  } else {
    return {
      ...feature,
      properties: {
        ...rest,
        lineStyle: {
          color,
        },
      },
    };
  }
};

export const cleanEndLines = (value: string): string => value.replace(/\r/g, "");

export const askForConfirmation = (message: string): Promise<boolean> => {
  console.warn(message);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise<boolean>((resolve) => {
    rl.question("Do you want to continue? Y(es)/n(o): ", (answer: string) => {
      rl.close();
      resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
    });
  });
};
