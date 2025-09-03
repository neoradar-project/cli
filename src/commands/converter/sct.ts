import fs from "fs";
import { parseSct, parseEse, SCT, toGeoJson, ESE } from "sector-file-tools";
import { Ora } from "ora";
import { uuidManager } from "../../helper/uuids";
import { multiLineString } from "@turf/helpers";
import {
  convertColorFeaturePropertyToGeojsonProperties,
  extractAirwaySegment,
  generateGeoJsonFilesForType,
} from "../../utils";
import { logSCTParsingError } from "../../helper/logger";
import { FeatureCollection, Geometry, GeoJsonProperties } from "geojson";
import path from "path";

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

export const cliParseSCTESE = async (
  spinner: Ora,
  sctFilePath: string,
  eseFilePath: string,
  isGNG: boolean,
  outputPath: string
) => {
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

    const datasetsToWrite: string[] = Array.from(allTypes.keys()).filter(
      (type) => !IGNORED_TYPES.includes(type)
    );

    spinner.info(
      `Found ${datasetsToWrite.length} datasets to write: ${Array.from(
        allTypes
      ).join(", ")}`
    );

    uuidManager.registerTypes(datasetsToWrite);

    spinner.text = `Writing GeoJSON files for types: ${datasetsToWrite.join(
      ", "
    )}`;
    datasetsToWrite.forEach(async (type) => {
      await generateGeoJsonFilesForType(
        outputPath,
        type,
        features.filter((f) => f.properties?.type === type)
      );
    });
  } catch (error) {
    logSCTParsingError(
      `Failed to parse SCT file: ${sctFilePath}`,
      error instanceof Error ? error.message : "Unknown error"
    );
    spinner.fail(
      `Failed to parse SCT file: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
    throw error;
  }
};

export const cliParseSingleSCT = async (
  spinner: Ora,
  sctFilePath: string,
  layerName: string
) => {
  spinner.text = `Finding SCT file...`;

  if (!fs.existsSync(sctFilePath)) {
    spinner.fail("SCT file not found at path " + sctFilePath);
    return;
  }

  spinner.text = "Reading SCT file...";
  const sctFileContent = fs.readFileSync(sctFilePath, "utf-8");
  if (!sctFileContent) {
    spinner.fail("Unable to read SCT file");
    return;
  }

  let sctParsed: SCT | null = null;
  try {
    spinner.text = "Parsing SCT file...";
    sctParsed = parseSct(sctFileContent);
    if (!sctParsed) {
      throw new Error(
        "Failed to parse SCT file: no parsed data returned (Unknown error)."
      );
    }
    spinner.text = "SCT file parsed successfully.";
  } catch (error) {
    spinner.fail(
      `Error during SCT parsing: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
    return;
  }

  if (!sctParsed) {
    spinner.fail("Failed to parse SCT file.");
    return;
  }

  let geoJsonData: FeatureCollection<Geometry, GeoJsonProperties>;
  try {
    spinner.text = "Converting SCT to GeoJSON...";
    geoJsonData = toGeoJson(
      sctParsed,
      {
        freetext: {},
        positions: [],
      } as ESE,
      null,
      true
    );
    spinner.text = "SCT to GeoJSON conversion successful.";
  } catch (error) {
    spinner.fail(
      `Error during GeoJSON conversion: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
    return;
  }

  if (!geoJsonData) {
    spinner.fail("Failed to convert SCT to GeoJSON.");
    return;
  }

  if (!geoJsonData.features || geoJsonData.features.length === 0) {
    spinner.warn("Failed to convert SCT to GeoJSON, no features found.");
    return;
  }

  let features: GeoJSON.Feature[] = [];
  try {
    features = geoJsonData.features as GeoJSON.Feature[];
    features.forEach((feature) => {
      uuidManager.addUUIDToFeature(feature);
    });
  } catch (error) {
    spinner.fail(
      `Error during UUID assignment: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
    return;
  }

  handleAirwaysUUID(sctParsed, features);

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

  const datasetsToWrite: string[] = Array.from(allTypes.keys()).filter(
    (type) => !IGNORED_TYPES.includes(type)
  );

  // // Unify the feature types
  // features.forEach((feature) => {
  //   if (feature.properties && feature.properties.type) {
  //     feature.properties.type = layerName;
  //   }
  // });

  spinner.info(
    `Found ${datasetsToWrite.length} datasets to write: ${Array.from(
      allTypes
    ).join(", ")}`
  );

  spinner.text = "Merging all features...";

  // Get directory where we found the SCT
  const sctDirectory = path.dirname(sctFilePath);

  spinner.text = `Writing all datasets to layer file ${layerName}`;
  await generateGeoJsonFilesForType(
    sctDirectory || process.cwd(),
    layerName,
    features
  );

  spinner.succeed("SCT file parsed successfully.");
};
