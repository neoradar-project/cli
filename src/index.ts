#!/usr/bin/env node
import figlet from "figlet";
import { Command } from "commander";
import versionInfo from "./version.json";

import { initPackage } from "./commands/init-package";
import { convert } from "./commands/convert";
import { indexer } from "./commands/indexer";
import { distributeCommand } from "./commands/distribute";
import { convertTopsky } from "./commands/convert-topsky";
import path from "path";
import { createPluginArchives } from "./commands/create-plugin-archives";

console.log(figlet.textSync("NeoRadar CLI"));

const program = new Command();
program.version(versionInfo.version).description("CLI Tool for neoradar for packaging and releasing sector files");

program
  .command("version")
  .description("Displays the current version of the NeoRadar CLI")
  .action(() => {
    console.log(`NeoRadar CLI version: ${versionInfo.version}`);
  });

program
  .command("init")
  .description("Initializes a new package environment in the given folder and output directory")
  .argument("<string>", "Path/folder in which to initialize the package")
  .option("-n, --name <string>", "Name of the package, defaults to the directory name")
  .option("--lat, --latitude <number>", "Reference latitude for the package")
  .option("--lon, --longitude <number>", "Reference longitude for the package")
  .option(
    "-s, --namespace <string>",
    "The namespace to use for the package, defaults to the name. Choose a string that is unique to your package and does not change with package versions, for example lfff or lirr."
  )
  .action((folder, options) => {
    const packageName = options.name || path.basename(path.resolve(folder));
    initPackage(folder, packageName, options.latitude, options.longitude, options.namespace);
  });

program
  .command("convert")
  .description("Converts an SCT2 and ESE (if available) as well as EuroScope config files to the neoradar format")
  .argument("<string>", "Path to the package environment or built package, defaults to current directory")
  .action((packagePath) => {
    convert(packagePath || process.cwd());
  });

program
  .command("topsky-convert")
  .description("Converts TopSky map files to the neoradar format")
  .argument("<string>", "Path to the package environment or built package, defaults to current directory")
  .action((packagePath) => {
    convertTopsky(packagePath || process.cwd());
  });

program
  .command("index")
  .description("Indexes GeoJSON features names and IDs in the specified directory and writes them to nse.json if present as well as updating the manifest.json")
  .argument("<string>", "Directory of the package environment or built package, defaults to current directory")
  .option("-o, --output [string]", "Output file for the index, defaults to nse.json in the package/datasets directory")
  .action((packagePath, options) => {
    indexer(packagePath || process.cwd(), options.output);
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
    distributeCommand(packagePath || process.cwd(), options.name, options.newVersion, options.indexing ? false : true, options.publish, options.keepDeploy);
  });

program
  .command("create-plugin-archives <buildDir>")
  .description("Create .plugin archive files from plugin build output")
  .option("-o, --output <dir>", "Output directory for .plugin files")
  .option("-v, --verbose", "Enable verbose output")
  .option("--no-confirmation", "Skip confirmation prompt")
  .action((buildDir: string, options: { output?: string; verbose?: boolean; confirmation?: boolean }) => {
    createPluginArchives(buildDir, options.confirmation !== false, options.output, options.verbose || false);
  });

program.parse(process.argv);

if (!process.argv.slice(2).length) {
  program.outputHelp();
}
