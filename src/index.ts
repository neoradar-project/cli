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
  
program.command("init").description("Initializes a new package environment with the given name and optional output directory")
  .argument("<string>", "Name of the package to initialize")
  .option("-o, --out [string]", "Optional output directory for the package, defaults to current directory")
  .action((name, options) => {
    initPackage(name, options.out || process.cwd());
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

const options = program.opts(); 