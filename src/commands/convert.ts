import fs from "fs";
import path from "path";
import { fileFilesWithExtension } from "../utils";
import ora from "ora";
import { cliParseSCT } from "./converter/sct";
import { indexer } from "./indexer";

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
    const eseFilePath = path.join(sectorFilesPath, eseFiles[0]);
    spinner.succeed(`Found ESE file: ${eseFilePath}`);
  }
};

export const convert = (packagePath: string) => {
  console.log(
    `Starting conversion for package environment at path: ${packagePath}`
  );

  // We first look for the SCT2 file in the package path
  const sectorFilesPath = `${packagePath}/sector_files`;
  const datasetsOutputPath = `${packagePath}/package/datasets`;

  Promise.allSettled([
    convertSCT2File(sectorFilesPath, datasetsOutputPath),
    convertESEFile(sectorFilesPath, datasetsOutputPath),
  ])
    .then(() => {
      console.log("Conversion completed successfully.");

      // Running the indexer after conversion
      indexer(packagePath, `${datasetsOutputPath}/nse.json`);
    })
    .catch((error) => {
      console.error(
        `Error during conversion: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    });
};
