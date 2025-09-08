import fs from "fs";
import path from "path";
import ora from "ora";

const texturePacker = require("free-tex-packer-core");

const findPngFiles = (dir: string, baseDir: string = dir, relativePath: string = ""): Array<{ path: string; fullPath: string }> => {
  const files: Array<{ path: string; fullPath: string }> = [];
  const items = fs.readdirSync(dir);

  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      // Recursively search subdirectories
      const newRelativePath = relativePath ? path.join(relativePath, item) : item;
      files.push(...findPngFiles(fullPath, baseDir, newRelativePath));
    } else if (path.extname(item).toLowerCase() === ".png") {
      const relativePngPath = relativePath ? path.join(relativePath, item) : item;
      files.push({
        path: relativePngPath,
        fullPath: fullPath,
      });
    }
  }

  return files;
};

export const generateAtlas = async (inputFolder: string, outputFolder?: string) => {
  const resolvedInputPath = path.resolve(inputFolder);
  const resolvedOutputPath = outputFolder ? path.resolve(outputFolder) : path.resolve(inputFolder, "atlas");

  if (!fs.existsSync(resolvedInputPath)) {
    console.error(`Error: Input folder does not exist: ${resolvedInputPath}`);
    return;
  }

  if (!fs.statSync(resolvedInputPath).isDirectory()) {
    console.error(`Error: Input path is not a directory: ${resolvedInputPath}`);
    return;
  }

  const spinner = ora("Scanning for PNG files...").start();

  try {
    const pngFileData = findPngFiles(resolvedInputPath);

    if (pngFileData.length === 0) {
      spinner.fail("No PNG files found in the input folder");
      return;
    }

    spinner.text = `Found ${pngFileData.length} PNG files, preparing for packing...`;

    // Prepare images array for texture packer
    const images = pngFileData.map(({ path: relativePath, fullPath }) => ({
      path: relativePath, // This will be "img1.png", "subfolder/img2.png", etc.
      contents: fs.readFileSync(fullPath),
    }));

    spinner.text = "Generating texture atlas...";

    const options = {
      textureName: "symbols",
      width: 3012,
      height: 3012,
      fixedSize: false,
      removeFileExtension: true,
      prependFolderName: true,
      base64Export: false,
      tinify: false,
      scale: 1,
      exporter: "Pixi",
      powerOfTwo: false,
      padding: 0,
      extrude: 0,
      allowRotation: false,
      allowTrim: false,
      alphaThreshold: 0,
      detectIdentical: false,
      packer: "MaxRectsPacker",
      packerMethod: "Smart",
    };

    texturePacker(images, options, (files: any, error: any) => {
      if (error) {
        spinner.fail("Atlas generation failed");
        console.error("Packaging failed:", error);
        return;
      }

      // Create output directory if it doesn't exist
      fs.mkdirSync(resolvedOutputPath, { recursive: true });

      spinner.text = "Writing atlas files...";

      let filesWritten = 0;
      for (const file of files) {
        const outputPath = path.resolve(resolvedOutputPath, file.name);
        console.log(`Writing ${outputPath}`);
        fs.writeFileSync(outputPath, file.buffer);
        filesWritten++;
      }

      spinner.succeed(`Atlas generation completed! ${filesWritten} files written to ${resolvedOutputPath}`);

      console.log(`\n✅ Successfully generated texture atlas from ${images.length} PNG files`);
      console.log(`📁 Input folder: ${resolvedInputPath}`);
      console.log(`📁 Output folder: ${resolvedOutputPath}`);
    });
  } catch (error) {
    spinner.fail("Atlas generation failed");
    console.error("Error:", error instanceof Error ? error.message : "Unknown error");
  }
};
