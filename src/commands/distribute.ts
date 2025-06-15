import ora from "ora";
import fs from "fs";
import path from "path";
import yaml from "yaml";
import { PackageManifest } from "../definitions/package-defs";
import { ProviderManifest, PublishConfig } from "../definitions/provider-defs";
import { zip } from "zip-a-folder";
import { indexer } from "./indexer";
import { calculateZipHash } from "../helper/publish/checksum";
import { processAllFiles } from "../helper/publish//file-scanner";
import { uploadToS3 } from "../helper/publish//s3-uploader";

export const distributeCommand = async (
  packageEnvironmentPath: string,
  newPackageName: string | undefined,
  newVersion: string | undefined,
  skipIndexing: boolean | undefined,
  publishConfig?: boolean,
  keepDeploy?: boolean
) => {
  const spinner = ora("Preparing package for distribution...").start();

  const manifestPath = `${packageEnvironmentPath}/package/manifest.json`;
  if (!fs.existsSync(manifestPath)) {
    return spinner.fail(`Manifest file not found at ${manifestPath}. Please ensure the package environment is set up correctly.`);
  }

  try {
    if (!skipIndexing) {
      spinner.text = `Running the indexer...`;
      await indexer(packageEnvironmentPath, undefined, true);
      spinner.info(`Indexer completed successfully.`);
    }

    spinner.text = `Updating manifest general information...`;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as PackageManifest;

    if (newPackageName) {
      manifest.name = newPackageName;
    }

    if (newVersion) {
      manifest.version = newVersion;
    }

    const newPackageID = newPackageName ? newPackageName.toLocaleUpperCase().replaceAll(" ", "_") + "_" + manifest.version : manifest.id;
    manifest.id = newPackageID;
    manifest.createdAt = new Date().toISOString();

    spinner.text = `Installing fonts in the manifest...`;

    const fontsPath = `${packageEnvironmentPath}/package/fonts`;

    if (fs.existsSync(fontsPath)) {
      const fontFiles = fs
        .readdirSync(fontsPath)
        .filter((file) => file.endsWith(".ttf") || file.endsWith(".otf") || file.endsWith(".sdf") || file.endsWith(".fnt"));
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
      spinner.warn(`Fonts directory not found at ${fontsPath}. Skipping font installation.`);
    }

    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    spinner.info(`Manifest updated with new package name: ${newPackageName || manifest.name}`);

    spinner.text = `Preparing package files...`;
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

    spinner.info(`Package files prepared for distribution. Removed ${filesRemovedCounter} unnecessary files.`);

    spinner.text = `Creating zip file for distribution...`;
    if (!fs.existsSync(tempPackagePath)) {
      spinner.fail(`Temporary package path does not exist: ${tempPackagePath}. Please ensure the package environment is set up correctly.`);
      return;
    }

    if (!fs.existsSync(`${packageEnvironmentPath}/dist`)) {
      fs.mkdirSync(`${packageEnvironmentPath}/dist`, { recursive: true });
      spinner.info(`Created dist directory at ${packageEnvironmentPath}/dist`);
    }

    const zipFilePath = `${packageEnvironmentPath}/dist/${newPackageID}.zip`;
    await zip(tempPackagePath, zipFilePath);

    fs.rmSync(tempPackagePath, { recursive: true, force: true });
    spinner.info(`Temporary package directory cleaned up: ${tempPackagePath}`);

    spinner.succeed(`Package prepared for distribution successfully! Zip file created at: ${zipFilePath}`);

    if (publishConfig) {
      await handlePublishing(packageEnvironmentPath, newPackageID, manifest, zipFilePath, spinner, keepDeploy);
    }
  } catch (error) {
    spinner.fail(`Failed to prepare package for distribution: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
};

async function handlePublishing(
  packageEnvironmentPath: string,
  packageId: string,
  manifest: PackageManifest,
  zipFilePath: string,
  spinner: any,
  keepDeploy?: boolean
) {
  spinner.text = "Reading publish configuration...";

  const publishConfigPath = path.join(packageEnvironmentPath, "publish.yml");
  if (!fs.existsSync(publishConfigPath)) {
    spinner.fail(`publish.yml not found at ${publishConfigPath}. Please create a publish configuration file.`);
    return;
  }

  let config: PublishConfig;
  try {
    const configContent = fs.readFileSync(publishConfigPath, "utf-8");
    config = yaml.parse(configContent) as PublishConfig;
  } catch (error) {
    spinner.fail(`Failed to parse publish.yml: ${error instanceof Error ? error.message : "Unknown error"}`);
    return;
  }

  if (!config.bucketName || !config.region) {
    spinner.fail("publish.yml must contain bucketName and region");
    return;
  }

  if (config.envVariableAccessKeyId && config.envVariableSecretAccessKey) {
    if (process.env[config.envVariableAccessKeyId]) {
      process.env.AWS_ACCESS_KEY_ID = process.env[config.envVariableAccessKeyId];
    }
    if (process.env[config.envVariableSecretAccessKey]) {
      process.env.AWS_SECRET_ACCESS_KEY = process.env[config.envVariableSecretAccessKey];
    }
    spinner.info("Using custom environment variables for AWS credentials");
  } else {
    spinner.info("Using default AWS credential chain (~/.aws/credentials, IAM roles, etc.)");
  }

  spinner.text = "Setting up deployment structure...";

  const deployDir = path.join(packageEnvironmentPath, "deploy");
  const distDir = path.join(deployDir, "dist");
  const filesDir = path.join(deployDir, "files");

  if (fs.existsSync(deployDir)) {
    fs.rmSync(deployDir, { recursive: true, force: true });
  }
  fs.mkdirSync(distDir, { recursive: true });
  fs.mkdirSync(filesDir, { recursive: true });

  const deployZipPath = path.join(distDir, path.basename(zipFilePath));
  fs.copyFileSync(zipFilePath, deployZipPath);

  spinner.text = "Calculating package checksums...";

  const zipSize = fs.statSync(deployZipPath).size;
  const zipChecksum = await calculateZipHash(deployZipPath);

  spinner.text = "Processing package files for delta updates...";

  const packageDir = path.join(packageEnvironmentPath, "package");
  const packageFiles = await processAllFiles(packageDir, [], true);

  for (const file of packageFiles) {
    const sourcePath = path.join(packageDir, file.path);
    const targetPath = path.join(filesDir, file.path);

    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(sourcePath, targetPath);
  }

  spinner.text = "Generating provider manifest...";

  const s3Path = config.s3Path || packageId;
  const baseUrl = config.baseUrl || `https://${config.bucketName}.s3.${config.region}.amazonaws.com/${s3Path}`;
  const downloadUrl = config.downloadUrl || `${baseUrl}/dist/${path.basename(zipFilePath)}`;

  const providerManifest: ProviderManifest = {
    schemaVersion: "1.0.0",
    updatedAt: new Date().toISOString(),
    packageInfo: {
      id: manifest.id,
      name: manifest.name,
      description: manifest.description || "",
      version: manifest.version,
      namespace: manifest.namespace,
      createdAt: manifest.createdAt,
      downloadUrl: downloadUrl,
      deltaFilesBaseUrl: `${baseUrl}/files`,
      size: zipSize,
      checksums: {
        sha256: zipChecksum,
      },
      files: packageFiles,
    },
  };

  const manifestOutputPath = path.join(deployDir, "manifest.json");
  fs.writeFileSync(manifestOutputPath, JSON.stringify(providerManifest, null, 2));

  spinner.info(`Provider manifest generated: ${manifestOutputPath}`);
  spinner.info(`Delta files set up in: ${filesDir}`);
  spinner.info(`Total files: ${packageFiles.length}`);

  spinner.text = "Uploading to S3...";

  try {
    await uploadToS3(deployDir, {
      region: config.region,
      bucket: config.bucketName,
      path: s3Path,
      makePublic: config.makePublic !== false,
    });

    spinner.succeed("Package published successfully!");
    spinner.info(`Package available at: ${baseUrl}`);
    spinner.info(`Manifest URL: ${baseUrl}/manifest.json`);
    spinner.info(`Download URL: ${downloadUrl}`);

    const shouldKeepDeploy = keepDeploy || config.keepDeploy;
    if (shouldKeepDeploy) {
      spinner.info(`Deploy directory preserved at: ${deployDir}`);
    } else {
      fs.rmSync(deployDir, { recursive: true, force: true });
      spinner.info("Deploy directory cleaned up");
    }
  } catch (error) {
    spinner.fail(`Failed to upload to S3: ${error instanceof Error ? error.message : "Unknown error"}`);
    throw error;
  }
}
