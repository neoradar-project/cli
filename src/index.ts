import figlet from "figlet";
import { Command } from "commander";
import versionInfo from "./version.json";

import { initPackage } from "./commands/init-package";
import { convert } from "./commands/convert";
import { indexer } from "./commands/indexer";
import { distributeCommand } from "./commands/distribute";

console.log(figlet.textSync("NeoRadar CLI"));

const program = new Command();
program
  .version(versionInfo.version)
  .description(
    "CLI Tool for neoradar for packaging and releasing sector files"
  );

program
  .command("version")
  .description("Displays the current version of the NeoRadar CLI")
  .action(() => {
    console.log(`NeoRadar CLI version: ${versionInfo.version}`);
  });

program
  .command("init")
  .description(
    "Initializes a new package environment in the given folder and output directory"
  )
  .argument("<string>", "Path/folder in which to initialize the package")
  .option(
    "-n, --name <string>",
    "Name of the package, defaults to the directory name"
  )
  .option("--lat, --latitude <number>", "Reference latitude for the package")
  .option("--lon, --longitude <number>", "Reference longitude for the package")
  .option(
    "-s, --namespace <string>",
    "The namespace to use for the package, defaults to the name. Choose a string that is unique to your package and does not change with package versions, for example lfff or lirr."
  )
  .action((folder, options) => {
    initPackage(
      folder,
      options.name,
      options.latitude,
      options.longitude,
      options.namespace
    );
  });

program
  .command("convert")
  .description(
    "Converts an SCT2 and ESE (if available) as well as EuroScope config files to the neoradar format"
  )
  .argument(
    "<string>",
    "Path to the package environment or built package, defaults to current directory"
  )
  .action((packagePath) => {
    convert(packagePath || process.cwd());
  });

program
  .command("index")
  .description(
    "Indexes GeoJSON features names and IDs in the specified directory and writes them to nse.json if present as well as updating the manifest.json"
  )
  .argument(
    "<string>",
    "Directory of the package environment or built package, defaults to current directory"
  )
  .option(
    "-o, --output [string]",
    "Output file for the index, defaults to nse.json in the package/datasets directory"
  )
  .action((packagePath, options) => {
    indexer(packagePath || process.cwd(), options.output);
  });

program
  .command("distribute")
  .description("Prepares the package for distribution by creating a zip file")
  .argument(
    "<string>",
    "Path to the package environment or built package, defaults to current directory"
  )
  .option(
    "-n, --name <string>",
    "New package name for the distribution, defaults to the current package name"
  )
  .option(
    "--nv, --new-version <string>",
    "New version for the distribution, defaults to the current package version"
  )
  .option("--no-indexing", "Skips the indexing step, defaults to false")
  .action((packagePath, options) => {
    distributeCommand(
      packagePath || process.cwd(),
      options.name,
      options.newVersion,
      options.indexing ? false : true
    );
  });

/*
  .option("-u, --update <package_path>", "Checks for updates in the given package path against base package")
  .option("-v, --validate <package_path>", "Runs a schema validation on the sector file in the given path")
  .option("-b, --build <package_path>", "Starts the build process for the sector file at the given path")
  .option("-d, --distribute <package_path>", "Prepares the sector file for distribution by creating a zip file in the given path")
  .option("-p, --publish <path>", "Publishes a sector file to the specify endpoint with the given publish.yml config")
  */

program.parse(process.argv);

if (!process.argv.slice(2).length) {
  program.outputHelp();
}
