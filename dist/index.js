#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const figlet_1 = __importDefault(require("figlet"));
const commander_1 = require("commander");
const version_json_1 = __importDefault(require("./version.json"));
const init_package_1 = require("./commands/init-package");
const convert_1 = require("./commands/convert");
const indexer_1 = require("./commands/indexer");
const distribute_1 = require("./commands/distribute");
const convert_topsky_1 = require("./commands/convert-topsky");
const path_1 = __importDefault(require("path"));
console.log(figlet_1.default.textSync("NeoRadar CLI", { font: "Colossal" }));
const program = new commander_1.Command();
program
    .version(`${version_json_1.default.version} built at ${version_json_1.default.buildTime}`)
    .description("CLI Tool for neoradar for packaging and releasing sector files");
program
    .command("init")
    .description("Initializes a new package environment in the given folder and output directory")
    .argument("<string>", "Path/folder in which to initialize the package")
    .option("-n, --name <string>", "Name of the package, defaults to the directory name")
    .option("--lat, --latitude <number>", "Reference latitude for the package")
    .option("--lon, --longitude <number>", "Reference longitude for the package")
    .option("-s, --namespace <string>", "The namespace to use for the package, defaults to the name. Choose a string that is unique to your package and does not change with package versions, for example lfff or lirr.")
    .action((folder, options) => {
    const packageName = options.name || path_1.default.basename(path_1.default.resolve(folder));
    (0, init_package_1.initPackage)(folder, packageName, options.latitude, options.longitude, options.namespace);
});
program
    .command("convert")
    .description("Converts an SCT2 and ESE (if available) as well as EuroScope config files to the neoradar format")
    .argument("<string>", "Path to the package environment or built package, defaults to current directory")
    .action((packagePath) => {
    (0, convert_1.convert)(packagePath || process.cwd());
});
program
    .command("topsky-convert")
    .description("Converts TopSky map files to the neoradar format")
    .argument("<string>", "Path to the package environment or built package, defaults to current directory")
    .action((packagePath) => {
    (0, convert_topsky_1.convertTopsky)(packagePath || process.cwd());
});
program
    .command("index")
    .description("Indexes GeoJSON features names and IDs in the specified directory and writes them to nse.json if present as well as updating the manifest.json")
    .argument("<string>", "Directory of the package environment or built package, defaults to current directory")
    .option("-o, --output [string]", "Output file for the index, defaults to nse.json in the package/datasets directory")
    .action((packagePath, options) => {
    (0, indexer_1.indexer)(packagePath || process.cwd(), options.output);
});
program
    .command("distribute")
    .description("Prepares the package for distribution by creating a zip file")
    .argument("<string>", "Path to the package environment or built package, defaults to current directory")
    .option("-n, --name <string>", "New package name for the distribution, defaults to the current package name")
    .option("--nv, --new-version <string>", "New version for the distribution, defaults to the current package version")
    .option("--no-indexing", "Skips the indexing step, defaults to false")
    .option("-p, --publish", "Publishes the package using the publish configuration inside config.json", false)
    .option("--keep-deploy", "Keep the deploy directory after publishing (useful for debugging)", false)
    .action((packagePath, options) => {
    (0, distribute_1.distributeCommand)(packagePath || process.cwd(), options.name, options.newVersion, options.indexing ? false : true, options.publish, options.keepDeploy);
});
program.parse(process.argv);
if (!process.argv.slice(2).length) {
    program.outputHelp();
}
//# sourceMappingURL=index.js.map