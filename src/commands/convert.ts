import fs from "fs";
import path from "path";
import { askForConfirmation, fileFilesWithExtension } from "../utils";
import ora from "ora";
import { cliParseSCT } from "./converter/sct";
import { indexer } from "./indexer";
import { eseParser } from "./converter/ese";
import { parseConfig } from "../helper/config";
import { eseParsingErrorCount, sctParsingErrorCount } from "../helper/logger";
import readline from "readline";
import { atcData } from "./converter/atc-data-parser";
import AsrFolderConverter from "./converter/asr";

const convertSCT2File = async (sectorFilesPath: string, datasetsOutputPath: string) => {
  const spinner = ora("Finding SCT2...").start();

  const sctFiles = fileFilesWithExtension(sectorFilesPath, [".sct", ".sct2"]);
  if (sctFiles.length === 0) {
    spinner.fail("No SCT2 files found, skipping conversion.");
  } else {
    // Perform conversion for the first SCT2 file found
    const sctFilePath = path.join(sectorFilesPath, sctFiles[0]);
    await cliParseSCT(spinner, sctFilePath, false, datasetsOutputPath);

    if (sctParsingErrorCount > 0) {
      spinner.warn(`SCT2 parsing completed with ${sctParsingErrorCount} errors. Check logs for details.`);
    } else {
      spinner.succeed("SCT2 parsing completed successfully.");
    }
  }
};

const convertESEFile = async (sectorFilesPath: string, datasetsOutputPath: string) => {
  const spinner = ora("Finding ESE...").start();

  const eseFiles = fileFilesWithExtension(sectorFilesPath, [".ese"]);
  if (eseFiles.length === 0) {
    spinner.fail("No ESE files found, skipping conversion.");
  } else {
    // Perform conversion for the first ESE file found
    const config = parseConfig(`${sectorFilesPath}/../config.json`);
    const eseFilePath = path.join(sectorFilesPath, eseFiles[0]);
    try {
      const parsedEse = await eseParser.start(spinner, eseFilePath, datasetsOutputPath, config?.sectorFileFromGNG || false);

      if (eseParsingErrorCount > 0) {
        spinner.warn(`ESE parsing completed with ${eseParsingErrorCount} errors. Check logs for details.`);
      } else {
        spinner.succeed("ESE parsing completed successfully.");
      }

      return parsedEse;
    } catch (error) {
      spinner.fail(`Error during ESE conversion: ${error instanceof Error ? error.message : "Unknown error"}`);
      return;
    }
  }
};

const convertASRFolder = async (packagePath: string) => {
  const spinner = ora("Finding ASR files...").start();

  const asrFolderPath = path.join(packagePath, "ASRs");
  const profilesOutputPath = path.join(packagePath, "package", "profiles");

  if (!fs.existsSync(asrFolderPath)) {
    spinner.info("No ASRs directory found, skipping ASR conversion.");
    return;
  }

  const hasAsrFiles = (dirPath: string): boolean => {
    try {
      const items = fs.readdirSync(dirPath);
      for (const item of items) {
        const fullPath = path.join(dirPath, item);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
          if (hasAsrFiles(fullPath)) return true;
        } else if (stat.isFile() && item.toLowerCase().endsWith(".asr")) {
          return true;
        }
      }
      return false;
    } catch (error) {
      return false;
    }
  };

  if (!hasAsrFiles(asrFolderPath)) {
    spinner.info("No ASR files found in ASRs directory, skipping conversion.");
    return;
  }

  try {
    spinner.text = "Converting ASR files to STP profiles...";

    if (!fs.existsSync(profilesOutputPath)) {
      fs.mkdirSync(profilesOutputPath, { recursive: true });
    }

    if (fs.existsSync(profilesOutputPath)) {
      const existingFiles = fs.readdirSync(profilesOutputPath);
      for (const file of existingFiles) {
        const filePath = path.join(profilesOutputPath, file);
        const stat = fs.statSync(filePath);
        if (stat.isFile() && file.endsWith(".stp")) {
          fs.unlinkSync(filePath);
        }
      }
    }

    AsrFolderConverter.convertFolder(asrFolderPath, profilesOutputPath);

    spinner.succeed("ASR conversion completed successfully.");

    const countStpFiles = (dirPath: string): number => {
      let count = 0;
      try {
        const items = fs.readdirSync(dirPath);
        for (const item of items) {
          const fullPath = path.join(dirPath, item);
          const stat = fs.statSync(fullPath);

          if (stat.isDirectory()) {
            count += countStpFiles(fullPath);
          } else if (stat.isFile() && item.endsWith(".stp")) {
            count++;
          }
        }
      } catch (error) {
        // Ignore errors when counting
      }
      return count;
    };

    const convertedFilesCount = countStpFiles(profilesOutputPath);

    if (convertedFilesCount > 0) {
      spinner.info(`Converted ${convertedFilesCount} ASR file(s) to STP profiles.`);
    }
  } catch (error) {
    spinner.fail(`Error during ASR conversion: ${error instanceof Error ? error.message : "Unknown error"}`);
    console.error("ASR conversion failed:", error);
  }
};

export const convert = async (packagePath: string) => {
  console.log(`Starting conversion for package environment at path: ${packagePath}`);

  const confirm = await askForConfirmation(
    "\n⚠️  CAUTION: This operation will:\n" +
      "   • Override existing geojson datasets with the same names\n" +
      "   • Override fields that require update in the NSE\n" +
      "   • Override the atc-data file\n" +
      "   • Override existing STP profiles\n" +
      "   • Add missing layers to the manifest\n" +
      "   • Index all elements overriding the index in the NSE\n" +
      "IT WILL NOT:\n" +
      "   • Remove or edit existing layers in your manifest\n" +
      "   • Remove custom geojson datasets\n" +
      "   • Remove custom STP profiles\n" +
      "   • Change any systems, images or fonts\n"
  );

  if (!confirm) {
    console.log("Conversion aborted by user.");
    return;
  }

  // We first look for the SCT2 file in the package path
  const sectorFilesPath = `${packagePath}/sector_files`;
  const datasetsOutputPath = `${packagePath}/package/datasets`;

  await convertSCT2File(sectorFilesPath, datasetsOutputPath);
  const parsedESE = await convertESEFile(sectorFilesPath, datasetsOutputPath);
  await convertASRFolder(packagePath);
  await atcData.parseAtcdata(packagePath, parsedESE);

  // Running the indexer after conversion
  await indexer(packagePath, `${datasetsOutputPath}/nse.json`, true);

  console.log(`Conversion completed for package environment at path: ${packagePath}`);
};
