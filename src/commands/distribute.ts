import ora from "ora";
import fs from "fs";
import { PackageManifest } from "../definitions/package-defs";
import { zip } from "zip-a-folder";
import { indexer } from "./indexer";

export const distributeCommand = async (
  packageEnvironmentPath: string,
  newPackageName: string | undefined,
  newVersion: string | undefined,
  skipIndexing: boolean | undefined
) => {
  const spinner = ora("Preparing package for distribution...").start();
  // First we update the manifest with the new package name
  const manifestPath = `${packageEnvironmentPath}/package/manifest.json`;
  if (!fs.existsSync(manifestPath)) {
    return spinner.fail(
      `Manifest file not found at ${manifestPath}. Please ensure the package environment is set up correctly.`
    );
  }

  try {
    if (!skipIndexing) {
      spinner.text = `Running the indexer...`;
      // Call the indexer function here
      await indexer(packageEnvironmentPath, undefined, true);
      spinner.info(`Indexer completed successfully.`);
    }

    spinner.text = `Updating manifest general information...`;
    const manifest = JSON.parse(
      fs.readFileSync(manifestPath, "utf-8")
    ) as PackageManifest;
    if (newPackageName) {
      manifest.name = newPackageName;
    }

    if (newVersion) {
      manifest.version = newVersion;
    }

    const newPackageID = newPackageName
      ? newPackageName.toLocaleUpperCase().replaceAll(" ", "_") +
        "_" +
        manifest.version
      : manifest.id;
    manifest.id = newPackageID;
    manifest.createdAt = new Date().toISOString();

    spinner.text = `Installing fonts in the manifest...`;

    // Run through the fonts folder and add them to the manifest if they are not already present
    const fontsPath = `${packageEnvironmentPath}/package/fonts`;

    if (fs.existsSync(fontsPath)) {
      const fontFiles = fs
        .readdirSync(fontsPath)
        .filter(
          (file) =>
            file.endsWith(".ttf") ||
            file.endsWith(".otf") ||
            file.endsWith(".sdf") ||
            file.endsWith(".fnt")
        );
      manifest.fonts = manifest.fonts || [];
      let fontsAdded = 0;
      fontFiles.forEach((fontFile) => {
        const fontName = fontFile.replace(/\.(ttf|otf|sdf|fnt)$/, "");
        if (!manifest.fonts.find((f) => f.alias === fontName)) {
          manifest.fonts.push({ alias: fontName, src: `${fontFile}` });
          fontsAdded++;
        }
      });

      if (fontsAdded > 0) {
        spinner.info(`Added ${fontsAdded} new fonts to the manifest.`);
      } else {
        spinner.info("No new fonts to add to the manifest.");
      }
    } else {
      spinner.warn(
        `Fonts directory not found at ${fontsPath}. Skipping font installation.`
      );
    }

    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    spinner.info(`Manifest updated with new package name: ${newPackageName}`);

    spinner.text = `Preparing package files...`;
    // Copy the package to a temperary directory for distribution and cleanup of files
    const tempPackagePath = `${packageEnvironmentPath}/temp_package`;
    if (fs.existsSync(tempPackagePath)) {
      fs.rmSync(tempPackagePath, { recursive: true, force: true });
    }

    fs.mkdirSync(tempPackagePath, { recursive: true });
    const packageFiles = fs.readdirSync(`${packageEnvironmentPath}/package`);
    packageFiles.forEach((file) => {
      const sourcePath = `${packageEnvironmentPath}/package/${file}`;
      const destPath = `${tempPackagePath}/${file}`;
      if (fs.lstatSync(sourcePath).isDirectory()) {
        fs.cpSync(sourcePath, destPath, { recursive: true });
      } else {
        fs.copyFileSync(sourcePath, destPath);
      }
    });

    // Here we clean up some files that are not needed for distribution present in any folders or subfolders
    const filesToRemove = [".DS_Store", ".gitkeep"];

    spinner.text = `Cleaning up unnecessary files...`;

    let filesRemovedCounter = 0;
    const removeFilesRecursively = (dir: string) => {
      const files = fs.readdirSync(dir);
      files.forEach((file) => {
        const filePath = `${dir}/${file}`;
        if (fs.lstatSync(filePath).isDirectory()) {
          removeFilesRecursively(filePath);
        } else if (filesToRemove.includes(file)) {
          fs.unlinkSync(filePath);
          spinner.info(`Removed file: ${filePath}`);
          filesRemovedCounter++;
        }
      });
    };
    removeFilesRecursively(tempPackagePath);

    spinner.info(
      `Package files prepared for distribution. Removed ${filesRemovedCounter} unnecessary files.`
    );

    spinner.text = `Creating zip file for distribution...`;
    if (!fs.existsSync(tempPackagePath)) {
      spinner.fail(
        `Temporary package path does not exist: ${tempPackagePath}. Please ensure the package environment is set up correctly.`
      );
      return;
    }

    if (!fs.existsSync(`${packageEnvironmentPath}/dist`)) {
      fs.mkdirSync(`${packageEnvironmentPath}/dist`, { recursive: true });
      spinner.info(`Created dist directory at ${packageEnvironmentPath}/dist`);
    }
    // Use yauzl to create a zip file of the package
    const zipFilePath = `${packageEnvironmentPath}/dist/${newPackageID}.zip`;
    await zip(tempPackagePath, zipFilePath);

    // Clean up the temporary package directory
    fs.rmSync(tempPackagePath, { recursive: true, force: true });
    spinner.info(`Temporary package directory cleaned up: ${tempPackagePath}`);

    spinner.succeed(
      `Package prepared for distribution successfully! Zip file created at: ${zipFilePath}`
    );
  } catch (error) {
    spinner.fail(
      `Failed to prepare package for distribution: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return;
  }
};
