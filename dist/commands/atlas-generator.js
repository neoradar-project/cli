"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateAtlas = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const ora_1 = __importDefault(require("ora"));
const texturePacker = require("free-tex-packer-core");
const findPngFiles = (dir, baseDir = dir, relativePath = "") => {
    const files = [];
    const items = fs_1.default.readdirSync(dir);
    for (const item of items) {
        const fullPath = path_1.default.join(dir, item);
        const stat = fs_1.default.statSync(fullPath);
        if (stat.isDirectory()) {
            // Recursively search subdirectories
            const newRelativePath = relativePath ? path_1.default.join(relativePath, item) : item;
            files.push(...findPngFiles(fullPath, baseDir, newRelativePath));
        }
        else if (path_1.default.extname(item).toLowerCase() === ".png") {
            const relativePngPath = relativePath ? path_1.default.join(relativePath, item) : item;
            files.push({
                path: relativePngPath,
                fullPath: fullPath,
            });
        }
    }
    return files;
};
const generateAtlas = async (inputFolder, outputFolder) => {
    const resolvedInputPath = path_1.default.resolve(inputFolder);
    const resolvedOutputPath = outputFolder ? path_1.default.resolve(outputFolder) : path_1.default.resolve(inputFolder, "atlas");
    if (!fs_1.default.existsSync(resolvedInputPath)) {
        console.error(`Error: Input folder does not exist: ${resolvedInputPath}`);
        return;
    }
    if (!fs_1.default.statSync(resolvedInputPath).isDirectory()) {
        console.error(`Error: Input path is not a directory: ${resolvedInputPath}`);
        return;
    }
    const spinner = (0, ora_1.default)("Scanning for PNG files...").start();
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
            contents: fs_1.default.readFileSync(fullPath),
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
        texturePacker(images, options, (files, error) => {
            if (error) {
                spinner.fail("Atlas generation failed");
                console.error("Packaging failed:", error);
                return;
            }
            // Create output directory if it doesn't exist
            fs_1.default.mkdirSync(resolvedOutputPath, { recursive: true });
            spinner.text = "Writing atlas files...";
            let filesWritten = 0;
            for (const file of files) {
                const outputPath = path_1.default.resolve(resolvedOutputPath, file.name);
                console.log(`Writing ${outputPath}`);
                fs_1.default.writeFileSync(outputPath, file.buffer);
                filesWritten++;
            }
            spinner.succeed(`Atlas generation completed! ${filesWritten} files written to ${resolvedOutputPath}`);
            console.log(`\n✅ Successfully generated texture atlas from ${images.length} PNG files`);
            console.log(`📁 Input folder: ${resolvedInputPath}`);
            console.log(`📁 Output folder: ${resolvedOutputPath}`);
        });
    }
    catch (error) {
        spinner.fail("Atlas generation failed");
        console.error("Error:", error instanceof Error ? error.message : "Unknown error");
    }
};
exports.generateAtlas = generateAtlas;
//# sourceMappingURL=atlas-generator.js.map