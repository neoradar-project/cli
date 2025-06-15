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

const convertSCT2File = async (
  sectorFilesPath: string,
  datasetsOutputPath: string
) => {
  const spinner = ora("Finding SCT2...").start();

  const sctFiles = fileFilesWithExtension(sectorFilesPath, [".sct", ".sct2"]);
  if (sctFiles.length === 0) {
    spinner.fail("No SCT2 files found, skipping conversion.");
  } else {
    // Perform conversion for the first SCT2 file found
    const sctFilePath = path.join(sectorFilesPath, sctFiles[0]);
    await cliParseSCT(spinner, sctFilePath, false, datasetsOutputPath);

    if (sctParsingErrorCount > 0) {
      spinner.warn(
        `SCT2 parsing completed with ${sctParsingErrorCount} errors. Check logs for details.`
      );
    } else {
      spinner.succeed("SCT2 parsing completed successfully.");
    }
  }
};

const convertESEFile = async (
  sectorFilesPath: string,
  datasetsOutputPath: string
) => {
  const spinner = ora("Finding ESE...").start();

  const eseFiles = fileFilesWithExtension(sectorFilesPath, [".ese"]);
  if (eseFiles.length === 0) {
    spinner.fail("No ESE files found, skipping conversion.");
  } else {
    // Perform conversion for the first ESE file found
    const config = parseConfig(`${sectorFilesPath}/../config.json`);
    const eseFilePath = path.join(sectorFilesPath, eseFiles[0]);
    try {
      await eseParser.start(
        spinner,
        eseFilePath,
        datasetsOutputPath,
        config?.sectorFileFromGNG || false
      );

      if (eseParsingErrorCount > 0) {
        spinner.warn(
          `ESE parsing completed with ${eseParsingErrorCount} errors. Check logs for details.`
        );
      } else {
        spinner.succeed("ESE parsing completed successfully.");
      }
    } catch (error) {
      spinner.fail(
        `Error during ESE conversion: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
      return;
    }
  }
};

export const convert = async (packagePath: string) => {
  console.log(
    `Starting conversion for package environment at path: ${packagePath}`
  );

  const confirm = await askForConfirmation(
    "\n⚠️  CAUTION: This operation will:\n" +
      "   • Override existing datasets with the same names\n" +
      "   • Override fields that require update in the NSE\n"
  );

  if (!confirm) {
    console.log("Conversion aborted by user.");
    return;
  }

  // We first look for the SCT2 file in the package path
  const sectorFilesPath = `${packagePath}/sector_files`;
  const datasetsOutputPath = `${packagePath}/package/datasets`;

  await convertSCT2File(sectorFilesPath, datasetsOutputPath);
  await convertESEFile(sectorFilesPath, datasetsOutputPath);

  // Running the indexer after conversion
  await indexer(packagePath, `${datasetsOutputPath}/nse.json`);

  console.log(
    `Conversion completed for package environment at path: ${packagePath}`
  );
};
