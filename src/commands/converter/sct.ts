import fs from "fs";
import { parseSct, parseEse, SCT, toGeoJson } from "sector-file-tools";
import { Ora } from "ora";
import { uuidManager } from "../../helper/uuids";
import { multiLineString } from "@turf/helpers";
import { convertColorFeaturePropertyToGeojsonProperties, extractAirwaySegment, generateGeoJsonFilesForType } from "../../utils";
import { logSCTParsingError } from "../../helper/logger";

const IGNORED_TYPES = ["low-airway", "high-airway"];

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

export const cliParseSCT = async (spinner: Ora, sctFilePath: string, eseFilePath: string, isGNG: boolean, outputPath: string) => {
  // Implementation for parsing SCT files

  spinner.text = `Reading file: ${sctFilePath}`;
  const sctFileContent = await fs.promises.readFile(sctFilePath, "utf-8");
  if (!sctFileContent) {
    spinner.fail("SCT file is empty or not found.");
  }
  const eseFileContent = await fs.promises.readFile(eseFilePath, "utf-8");
  if (!eseFileContent) {
    spinner.fail("ESE file is empty or not found.");
    return;
  }
  try {
    spinner.text = "Running GeoTools parser on SCT file...";
    const parsedSCT = parseSct(sctFileContent);
    if (!parsedSCT) {
      spinner.fail("Failed to parse SCT file.");
      return;
    }
    const parsedESE = parseEse(parsedSCT, eseFileContent);
    if (!parsedESE) {
      spinner.fail("Failed to parse ESE file.");
      return;
    }

    const geoJsonData = toGeoJson(parsedSCT, parsedESE, null, true);

    if (!geoJsonData || !geoJsonData.features) {
      spinner.fail("Failed to convert SCT to GeoJSON, no features found.");
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
        f.properties = convertColorFeaturePropertyToGeojsonProperties(f, (f.properties?.type ?? "") === "region").properties;
      }
    });

    const allTypes: Set<string> = new Set();
    features.forEach((feature) => {
      if (feature.properties && feature.properties.type) {
        allTypes.add(feature.properties.type);
      }
    });

    const datasetsToWrite: string[] = Array.from(allTypes.keys()).filter((type) => !IGNORED_TYPES.includes(type));

    spinner.info(`Found ${datasetsToWrite.length} datasets to write: ${Array.from(allTypes).join(", ")}`);

    uuidManager.registerTypes(datasetsToWrite);

    spinner.text = `Writing GeoJSON files for types: ${datasetsToWrite.join(", ")}`;
    datasetsToWrite.forEach(async (type) => {
      await generateGeoJsonFilesForType(
        outputPath,
        type,
        features.filter((f) => f.properties?.type === type)
      );
    });
  } catch (error) {
    logSCTParsingError(`Failed to parse SCT file: ${sctFilePath}`, error instanceof Error ? error.message : "Unknown error");
    spinner.fail(`Failed to parse SCT file: ${error instanceof Error ? error.message : "Unknown error"}`);
    throw error;
  }
};
