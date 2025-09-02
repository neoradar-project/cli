"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.indexer = void 0;
const ora_1 = __importDefault(require("ora"));
const fs_1 = __importDefault(require("fs"));
const utils_1 = require("../utils");
const nse_1 = require("../helper/nse");
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
const indexer = async (packagePath, outputFile, skipConfirmation = false) => {
    // Auto detect if we are directly in the package directory or in a package environment
    let datasetPath = `${packagePath}/package/datasets`;
    if (!skipConfirmation) {
        const confirm = await (0, utils_1.askForConfirmation)("\n⚠️  CAUTION: This operation will override the map index field in an existing NSE (if found), it will NOT remove or modify existing layers in your manifest, but only add missing layers");
        if (!confirm) {
            console.log("Conversion aborted by user.");
            return;
        }
    }
    if (!fs_1.default.existsSync(`${packagePath}/package`) && fs_1.default.existsSync(`${packagePath}/datasets`)) {
        datasetPath = `${packagePath}/datasets`;
    }
    else {
        // If the packagePath does not contain a package directory, we assume it's a direct dataset path
        if (!fs_1.default.existsSync(datasetPath)) {
            console.error(`Dataset path does not exist: ${datasetPath}. Please provide a valid package path.`);
            return;
        }
    }
    const nsePath = `${datasetPath}/nse.json`;
    const spinner = (0, ora_1.default)(`Indexing GeoJSON features from: ${datasetPath}`).start();
    // Get all GeoJSON files in the datasets directory
    const geojsonFiles = (0, utils_1.fileFilesWithExtension)(datasetPath, [".geojson"]);
    if (geojsonFiles.length === 0) {
        spinner.fail("No GeoJSON files found in the datasets directory.");
        return;
    }
    spinner.text = `Found ${geojsonFiles.length} GeoJSON files.`;
    const indexItems = [];
    geojsonFiles.forEach((file) => {
        spinner.text = `Processing file: ${file}`;
        const filePath = `${datasetPath}/${file}`;
        // Read the GeoJSON file
        const geojsonData = fs_1.default.readFileSync(filePath, "utf-8");
        try {
            const geojson = JSON.parse(geojsonData);
            geojson.features.forEach((feature) => {
                const name = (0, utils_1.getFeatureName)(feature);
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
        }
        catch (error) {
            spinner.warn(`Failed to parse GeoJSON file: ${file}. Error: ${error instanceof Error ? error.message : "Unknown error"}`);
            return;
        }
    });
    // Now group by type, then remove duplicates by name
    const groupedIndex = {};
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
    if (fs_1.default.existsSync(nsePath)) {
        spinner.text = `Writing index to existing nse.json file: ${nsePath}`;
        try {
            // Format is mapItemsIndex: Record<type, IndexItem[]>
            const newData = {};
            Object.keys(groupedIndex).forEach((type) => {
                if (!newData[type]) {
                    newData[type] = [];
                }
                newData[type].push(...groupedIndex[type].flatMap((item) => ({
                    name: item.name,
                    uuid: item.uuid,
                })));
            });
            (0, nse_1.updateNSE)(datasetPath, "mapItemsIndex", newData);
            spinner.info(`Merged index into existing NSE: ${nsePath}`);
        }
        catch (error) {
            spinner.fail(`Failed to read or parse existing nse.json file: ${error instanceof Error ? error.message : "Unknown error"}`);
            return;
        }
    }
    else {
        spinner.text = `Writing new index to file: ${outputFile}`;
        const nse = {
            mapItemsIndex: groupedIndex,
        };
        if (!outputFile) {
            outputFile = `${packagePath}/nse.json`;
        }
        try {
            fs_1.default.writeFileSync(outputFile, JSON.stringify(nse, null, 2));
            spinner.info(`Index written to file: ${outputFile}`);
        }
        catch (error) {
            spinner.fail(`Failed to write index to file: ${error instanceof Error ? error.message : "Unknown error"}`);
            return;
        }
    }
    // Checking if manifest needs to be updated
    const manifestPath = `${datasetPath}/../manifest.json`;
    if (fs_1.default.existsSync(manifestPath)) {
        spinner.text = `Updating manifest at: ${manifestPath}`;
        const strippedGeoJSONFileNames = geojsonFiles.map((file) => file
            .split("/")
            .pop()
            ?.replace(/\.geojson$/, "") || "");
        const sortedLayerNames = sortLayersByPreferredOrder(strippedGeoJSONFileNames);
        const manifestData = JSON.parse(fs_1.default.readFileSync(manifestPath, "utf-8"));
        const mapLayers = manifestData.mapLayers || [];
        const existingLayerNames = mapLayers.map((layer) => layer.source);
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
            fs_1.default.writeFileSync(manifestPath, JSON.stringify(manifestData, null, 2));
            spinner.info(`Manifest updated with ${updateCount} new layers.`);
        }
        else {
            spinner.info("No new layers to add to the manifest.");
        }
    }
    else {
        spinner.warn(`Manifest file not found at: ${manifestPath}. Skipping manifest update.`);
    }
    spinner.succeed("Indexing completed successfully.");
};
exports.indexer = indexer;
const sortLayersByPreferredOrder = (layerNames) => {
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
//# sourceMappingURL=indexer.js.map