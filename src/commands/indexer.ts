import ora from "ora";
import fs from "fs";
import { fileFilesWithExtension, getFeatureName } from "../utils";

interface IndexItem {
  type: string;
  name: string;
  uuid: string;
}

export const indexer = async (packagePath: string, outputFile: string) => {
  const datasetPath = `${packagePath}/package/datasets`;
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
          spinner.warn(
            `Feature in file ${file} has no valid name property. Skipping.`
          );
          return;
        }

        const uuid = feature.properties?.uuid;
        if (!uuid) {
          spinner.warn(
            `Feature in file ${file} with name "${name}" has no UUID. Skipping.`
          );
          return;
        }

        indexItems.push({
          type: feature.properties?.type || "unknown",
          name: name,
          uuid: uuid,
        });
      });
    } catch (error) {
      spinner.warn(
        `Failed to parse GeoJSON file: ${file}. Error: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
      return;
    }
  });

  // Now group by type, then remove duplicates by name
  const groupedIndex: Record<string, IndexItem[]> = {};
  indexItems.forEach((item) => {
    if (!groupedIndex[item.type]) {
      groupedIndex[item.type] = [];
    }
    if (
      !groupedIndex[item.type].some(
        (existingItem) => existingItem.name === item.name
      )
    ) {
      groupedIndex[item.type].push(item);
    }
  });

  console.log("Indexing complete. Summary:");
  Object.keys(groupedIndex).forEach((type) => {
    console.log(`Type: ${type} - Indexed ${groupedIndex[type].length} items`);
  });

  spinner.text = `Writing index to: ${outputFile}`;
  // Write the index to the output file
  // We first read the file if it exists to merge with existing data, and write the JSON object mapIndex: Record<string, IndexItem[]>
  if (fs.existsSync(nsePath)) {
    try {
      const existingData = fs.readFileSync(nsePath, "utf-8");
      const nse = JSON.parse(existingData);

      // Format is mapItemsIndex: Record<type, IndexItem[]>
      nse.mapItemsIndex = {};
      Object.keys(groupedIndex).forEach((type) => {
        if (!nse.mapItemsIndex[type]) {
          nse.mapItemsIndex[type] = [];
        }
        nse.mapItemsIndex[type].push(
          ...groupedIndex[type].flatMap((item) => ({
            name: item.name,
            uuid: item.uuid,
          }))
        );
      });

      fs.writeFileSync(nsePath, JSON.stringify(nse));

      spinner.text = `Merged index with existing data in: ${nsePath}`;
    } catch (error) {
      spinner.fail(
        `Failed to read or parse existing nse.json file: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
      return;
    }
  } else {
    const nse = {
      mapItemsIndex: groupedIndex,
    };

    try {
      fs.writeFileSync(outputFile, JSON.stringify(nse, null, 2));
    } catch (error) {
      spinner.fail(
        `Failed to write index to file: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
      return;
    }
  }
  spinner.text = `Index written to: ${outputFile}`;
  spinner.succeed("Indexing completed successfully.");
};
