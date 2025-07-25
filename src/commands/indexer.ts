import ora from "ora";
import fs from "fs";
import { askForConfirmation, fileFilesWithExtension, getFeatureName } from "../utils";
import { updateNSE } from "../helper/nse";
import { PackageManifest } from "../definitions/package-defs";

interface IndexItem {
  type: string;
  name: string;
  uuid: string;
}

const DEFAULT_LABEL_LAYERS = ["label"];

const DEFAULT_LAYERS_WITH_LABELS = ["fix", "vor", "ndb", "airport", "runway"];

const PREFERRED_LAYER_ORDER = [
  "region",
  "artcc",
  "artccHigh",
  "artccLow",
  "lowAirway",
  "highAirway",
  "sid",
  "star",
  "geo",
  "fix",
  "vor",
  "ndb",
  "airport",
  "runway",
  "label",
];

export const indexer = async (packagePath: string, outputFile: string | undefined, skipConfirmation: boolean = false) => {
  // Auto detect if we are directly in the package directory or in a package environment
  let datasetPath = `${packagePath}/package/datasets`;

  if (!skipConfirmation) {
    const confirm = await askForConfirmation(
      "\n⚠️  CAUTION: This operation will override the map index field in an existing NSE (if found), it will NOT remove or modify existing layers in your manifest, but only add missing layers"
    );

    if (!confirm) {
      console.log("Conversion aborted by user.");
      return;
    }
  }

  if (!fs.existsSync(`${packagePath}/package`) && fs.existsSync(`${packagePath}/datasets`)) {
    datasetPath = `${packagePath}/datasets`;
  } else {
    // If the packagePath does not contain a package directory, we assume it's a direct dataset path
    if (!fs.existsSync(datasetPath)) {
      console.error(`Dataset path does not exist: ${datasetPath}. Please provide a valid package path.`);
      return;
    }
  }

  const nsePath = `${datasetPath}/nse.json`;

  const spinner = ora(`Indexing GeoJSON features from: ${datasetPath}`).start();

  // Get all GeoJSON files in the datasets directory
  const geojsonFiles = fileFilesWithExtension(datasetPath, [".geojson"]);

  if (geojsonFiles.length === 0) {
    spinner.fail("No GeoJSON files found in the datasets directory.");
    return;
  }

  spinner.text = `Found ${geojsonFiles.length} GeoJSON files.`;

  const indexItems: IndexItem[] = [];

  geojsonFiles.forEach((file) => {
    spinner.text = `Processing file: ${file}`;
    const filePath = `${datasetPath}/${file}`;
    // Read the GeoJSON file
    const geojsonData = fs.readFileSync(filePath, "utf-8");
    try {
      const geojson = JSON.parse(geojsonData) as GeoJSON.FeatureCollection;
      geojson.features.forEach((feature: GeoJSON.Feature) => {
        const name = getFeatureName(feature);
        if (!name) {
          spinner.warn(`Feature in file ${file} has no valid name property. Skipping.`);
          return;
        }

        const uuid = feature.properties?.uuid;
        if (!uuid) {
          spinner.warn(`Feature in file ${file} with name "${name}" has no UUID. Skipping.`);
          return;
        }

        indexItems.push({
          type: feature.properties?.type || "unknown",
          name: name,
          uuid: uuid,
        });
      });
    } catch (error) {
      spinner.warn(`Failed to parse GeoJSON file: ${file}. Error: ${error instanceof Error ? error.message : "Unknown error"}`);
      return;
    }
  });

  // Now group by type, then remove duplicates by name
  const groupedIndex: Record<string, IndexItem[]> = {};
  indexItems.forEach((item) => {
    if (!groupedIndex[item.type]) {
      groupedIndex[item.type] = [];
    }
    if (!groupedIndex[item.type].some((existingItem) => existingItem.name === item.name)) {
      groupedIndex[item.type].push(item);
    }
  });

  spinner.info(`Indexed ${indexItems.length} items across ${Object.keys(groupedIndex).length} types.`);
  Object.keys(groupedIndex).forEach((type) => {
    spinner.info(`Type: ${type} - Indexed ${groupedIndex[type].length} items`);
  });

  if (fs.existsSync(nsePath)) {
    spinner.text = `Writing index to existing nse.json file: ${nsePath}`;
    try {
      // Format is mapItemsIndex: Record<type, IndexItem[]>
      const newData = {} as any;
      Object.keys(groupedIndex).forEach((type) => {
        if (!newData[type]) {
          newData[type] = [];
        }
        newData[type].push(
          ...groupedIndex[type].flatMap((item) => ({
            name: item.name,
            uuid: item.uuid,
          }))
        );
      });

      updateNSE(datasetPath, "mapItemsIndex", newData);

      spinner.info(`Merged index into existing NSE: ${nsePath}`);
    } catch (error) {
      spinner.fail(`Failed to read or parse existing nse.json file: ${error instanceof Error ? error.message : "Unknown error"}`);
      return;
    }
  } else {
    spinner.text = `Writing new index to file: ${outputFile}`;
    const nse = {
      mapItemsIndex: groupedIndex,
    };

    if (!outputFile) {
      outputFile = `${packagePath}/nse.json`;
    }
    try {
      fs.writeFileSync(outputFile, JSON.stringify(nse, null, 2));
      spinner.info(`Index written to file: ${outputFile}`);
    } catch (error) {
      spinner.fail(`Failed to write index to file: ${error instanceof Error ? error.message : "Unknown error"}`);
      return;
    }
  }

  // Checking if manifest needs to be updated
  const manifestPath = `${datasetPath}/../manifest.json`;
  if (fs.existsSync(manifestPath)) {
    spinner.text = `Updating manifest at: ${manifestPath}`;
    const strippedGeoJSONFileNames = geojsonFiles.map(
      (file) =>
        file
          .split("/")
          .pop()
          ?.replace(/\.geojson$/, "") || ""
    );

    const sortedLayerNames = sortLayersByPreferredOrder(strippedGeoJSONFileNames);

    const manifestData = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as PackageManifest;
    const mapLayers = manifestData.mapLayers || [];
    const existingLayerNames = mapLayers.map((layer: any) => layer.source);

    let updateCount = 0;
    sortedLayerNames.forEach((fileName) => {
      if (!existingLayerNames.includes(fileName)) {
        mapLayers.push({
          source: fileName,
          type: "geojson",
          name: fileName,
          hasLabels: DEFAULT_LAYERS_WITH_LABELS.includes(fileName.toLowerCase()),
          isLabelLayer: DEFAULT_LABEL_LAYERS.includes(fileName.toLowerCase()),
        });
        updateCount++;
      }
    });

    if (updateCount > 0) {
      manifestData.mapLayers = mapLayers;
      fs.writeFileSync(manifestPath, JSON.stringify(manifestData, null, 2));
      spinner.info(`Manifest updated with ${updateCount} new layers.`);
    } else {
      spinner.info("No new layers to add to the manifest.");
    }
  } else {
    spinner.warn(`Manifest file not found at: ${manifestPath}. Skipping manifest update.`);
  }

  spinner.succeed("Indexing completed successfully.");
};

const sortLayersByPreferredOrder = (layerNames: string[]): string[] => {
  return layerNames.sort((a, b) => {
    const indexA = PREFERRED_LAYER_ORDER.indexOf(a);
    const indexB = PREFERRED_LAYER_ORDER.indexOf(b);
    if (indexA !== -1 && indexB !== -1) {
      return indexA - indexB;
    }
    if (indexA !== -1 && indexB === -1) {
      return -1;
    }
    if (indexA === -1 && indexB !== -1) {
      return 1;
    }
    return 0;
  });
};
