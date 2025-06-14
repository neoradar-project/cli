import fs from "fs";
import { parseSct, SCT, toGeoJson } from "sector-file-tools";
import { Ora } from "ora";
import { uuidManager } from "../../helper/uuids";
import { multiLineString } from "@turf/helpers";
import {
  convertColorFeaturePropertyToGeojsonProperties,
  extractAirwaySegment,
} from "../../utils";

const IGNORED_TYPES = ["low-airway", "high-airway"];

async function generateGeoJsonFilesForType(path: string, type: string, allFeatures: any[]): Promise<void> {
    const features = allFeatures;
    const geojson = {
      type: "FeatureCollection",
      features: features,
    };
    const data = JSON.stringify(geojson);
    const formattedType = type.replace(/-([a-z])/g, (match, letter) => letter.toUpperCase());
    const filePath = `${path}/${formattedType}.geojson`;
    await fs.promises.writeFile(filePath, data, "utf8");
    return;
  }


const handleAirwaysUUID = (sctData: SCT, features: GeoJSON.Feature[]) => {
  sctData.lowAirway.forEach((airway) => {
    const lines = airway.segments.map((segment): number[][] => {
      const segmentExtract = extractAirwaySegment(segment);
      return segmentExtract;
    });
    const multiline = multiLineString(lines);
    multiline.properties = {
      type: "lowAirway",
      uuid: uuidManager.getSharedUUID("lowAirway", airway.id),
      name: airway.id,
    };
    features.push(multiline);
  });

  sctData.highAirway.forEach((airway) => {
    const lines = airway.segments.map((segment): number[][] => {
      const segmentExtract = extractAirwaySegment(segment);
      return segmentExtract;
    });
    const multiline = multiLineString(lines);
    multiline.properties = {
      type: "highAirway",
      uuid: uuidManager.getSharedUUID("highAirway", airway.id),
      name: airway.id,
    };
    features.push(multiline);
  });
};

export const cliParseSCT = async (
  spinner: Ora,
  sctFilePath: string,
  isGNG: boolean,
  outputPath: string
) => {
  // Implementation for parsing SCT files

  spinner.text = `Reading file: ${sctFilePath}`;
  const sctFileContent = await fs.promises.readFile(sctFilePath, "utf-8");
  if (!sctFileContent) {
    spinner.fail("SCT file is empty or not found.");
  }
  try {
    spinner.text = "Running GeoTools parser on SCT file...";
    const parsedSCT = parseSct(sctFileContent);
    if (!parsedSCT) {
      spinner.fail("Failed to parse SCT file.");
      return;
    }

    spinner.text = "Converting SCT to GeoJSON...";
    const geoJsonData = toGeoJson(
      parsedSCT,
      { freetext: {}, positions: [] },
      null,
      true
    );

    if (!geoJsonData || !geoJsonData.features) {
      spinner.fail("Failed to convert SCT to GeoJSON.");
      return;
    }

    spinner.text = "Adding UUIDs to GeoJSON features...";
    let features = geoJsonData.features as GeoJSON.Feature[];
    features.forEach((feature) => {
      uuidManager.addUUIDToFeature(feature);
    });

    handleAirwaysUUID(parsedSCT, features);

    // Convert colours
    spinner.text = "Converting colours in GeoJSON features...";
    features.forEach((f) => {
      if (f.properties?.color) {
        f.properties = convertColorFeaturePropertyToGeojsonProperties(
          f,
          (f.properties?.type ?? "") === "region"
        ).properties;
      }
    });

    const allTypes: Set<string> = new Set();
    features.forEach((feature) => {
      if (feature.properties && feature.properties.type) {
        allTypes.add(feature.properties.type);
      }
    });

    spinner.text = `Found ${allTypes.size} feature types: ${Array.from(
      allTypes
    ).join(", ")}`;

    const datasetsToWrite: string[] = Array.from(allTypes.keys()).filter(
      (type) => !IGNORED_TYPES.includes(type)
    );

    uuidManager.registerTypes(datasetsToWrite);

    spinner.text = `Writing GeoJSON files for types: ${datasetsToWrite.join(", ")}`;
    datasetsToWrite.forEach(async (type) => {
      await generateGeoJsonFilesForType(
        outputPath,
        type,
        features.filter((f) => f.properties?.type === type)
      );
    });

    spinner.succeed(`SCT file parsed successfully: ${sctFilePath}`);
  } catch (error) {
    spinner.fail(
      `Failed to parse SCT file: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
    throw error;
  }
};
