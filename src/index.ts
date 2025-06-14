import figlet from 'figlet';
import { Command } from 'commander';
import versionInfo from './version.json';

import { initPackage } from './commands/init-package';

console.log(
  figlet.textSync('NeoRadar CLI'),
);

const program = new Command();
program
  .version(versionInfo.version)
  .description("CLI Tool for neoradar for packaging and releasing sector files");
  
program.command("init").description("Initializes a new package environment in the given folder and output directory")
  .argument("<string>", "Folder in which to initialize the package")
  .option("-o, --out <string>", "Output directory for the package")
  .option("-n, --name [string]", "Name of the package, defaults to the directory name")
  .option("-s, --namespace [string]", "The namespace to use for the package, defaults to the name. Choose a string that is unique to your package and does not change with package versions.")
  .action((folder, options) => {
    initPackage(folder, options.out, options.namespace, options.name);
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