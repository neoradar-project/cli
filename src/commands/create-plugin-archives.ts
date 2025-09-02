import fs from "fs";
import path from "path";
import zlib from "zlib";
import { promisify } from "util";
import ora, { Ora } from "ora";
import { askForConfirmation } from "../utils";

const gzip = promisify(zlib.gzip);

interface PluginBinary {
  filename: string;
  platform: string;
  architecture: string;
  data: Buffer;
  originalSize: number;
  compressedSize: number;
}

interface PluginMetadata {
  name: string;
  version: string;
  author: string;
  description: string;
  license: string;
}

interface PluginArchiveData {
  version: number;
  metadata: PluginMetadata;
  binaries: Record<
    string,
    {
      originalSize: number;
      compressedSize: number;
      data: string;
      compressed: boolean;
    }
  >;
}

class PluginArchiver {
  private static readonly PLATFORM_EXTENSIONS = {
    ".dll": "windows",
    ".dylib": "mac",
    ".so": "linux",
  };

  private verbose: boolean = false;

  private hasPluginFiles(directory: string): boolean {
    try {
      const files = fs.readdirSync(directory);
      return files.some((file) => {
        const ext = path.extname(file).toLowerCase();
        return Object.keys(PluginArchiver.PLATFORM_EXTENSIONS).includes(ext);
      });
    } catch (error) {
      return false;
    }
  }

  private async scanBinaries(pluginDir: string): Promise<PluginBinary[]> {
    const binaries: PluginBinary[] = [];

    try {
      const files = fs.readdirSync(pluginDir);

      for (const file of files) {
        const filePath = path.join(pluginDir, file);
        const ext = path.extname(file).toLowerCase();

        // Skip non-plugin files
        if (!Object.keys(PluginArchiver.PLATFORM_EXTENSIONS).includes(ext)) {
          continue;
        }

        // Parse platform and architecture from filename
        const { platform, architecture } = this.parseFilename(file);
        if (!platform) {
          if (this.verbose) {
            console.warn(`Warning: Cannot parse platform/architecture from ${file}`);
          }
          continue;
        }

        // Read file data
        const data = fs.readFileSync(filePath);

        binaries.push({
          filename: file,
          platform,
          architecture,
          data,
          originalSize: data.length,
          compressedSize: 0,
        });
      }
    } catch (error) {
      throw new Error(`Failed to scan binaries in ${pluginDir}: ${error instanceof Error ? error.message : "Unknown error"}`);
    }

    return binaries;
  }

  private parseFilename(filename: string): { platform: string; architecture: string } {
    // Expected formats:
    // windows-x64.dll, mac-arm64.dylib, linux-x64.so
    // windows.dll, mac.dylib, linux.so (legacy)

    const ext = path.extname(filename);
    const nameWithoutExt = path.basename(filename, ext);

    // Determine platform from extension
    const platform = PluginArchiver.PLATFORM_EXTENSIONS[ext.toLowerCase() as keyof typeof PluginArchiver.PLATFORM_EXTENSIONS];
    if (!platform) {
      return { platform: "", architecture: "" };
    }

    // Parse architecture
    const dashIndex = nameWithoutExt.indexOf("-");
    const architecture = dashIndex !== -1 ? nameWithoutExt.substring(dashIndex + 1) : "universal"; // Legacy format

    return { platform, architecture };
  }

  private loadMetadata(pluginDir: string, pluginName: string): PluginMetadata {
    const metadataPath = path.join(pluginDir, "plugin.json");

    const defaultMetadata: PluginMetadata = {
      name: pluginName,
      version: "1.0.0",
      author: "Unknown",
      description: `${pluginName} plugin`,
      license: "Proprietary",
    };

    if (fs.existsSync(metadataPath)) {
      try {
        const content = fs.readFileSync(metadataPath, "utf-8");
        const metadata = JSON.parse(content);

        return {
          name: metadata.name || pluginName,
          version: metadata.version || defaultMetadata.version,
          author: metadata.author || defaultMetadata.author,
          description: metadata.description || defaultMetadata.description,
          license: metadata.license || defaultMetadata.license,
        };
      } catch (error) {
        if (this.verbose) {
          console.warn(`Warning: Failed to load metadata from ${metadataPath}: ${error instanceof Error ? error.message : "Unknown error"}`);
        }
      }
    }

    return defaultMetadata;
  }

  private async createSingleArchive(pluginName: string, pluginDir: string, outputDir: string, spinner: Ora): Promise<void> {
    if (this.verbose) {
      spinner.text = `Processing plugin: ${pluginName}`;
    }

    // Load metadata
    const metadata = this.loadMetadata(pluginDir, pluginName);

    // Scan for binary files
    const binaries = await this.scanBinaries(pluginDir);

    if (binaries.length === 0) {
      throw new Error(`No plugin binaries found in ${pluginDir}`);
    }

    // Create archive structure
    const archiveData: PluginArchiveData = {
      version: 1,
      metadata: {
        ...metadata,
        created: new Date().toISOString(),
      } as any,
      binaries: {},
    };

    // Process each binary
    let totalOriginal = 0;
    let totalCompressed = 0;

    for (const binary of binaries) {
      if (this.verbose) {
        spinner.text = `Compressing: ${binary.filename}`;
      }

      // Compress binary data
      const compressedData = await gzip(binary.data);
      binary.compressedSize = compressedData.length;

      // Encode as base64
      const base64Data = compressedData.toString("base64");

      // Add to archive
      archiveData.binaries[binary.filename] = {
        originalSize: binary.originalSize,
        compressedSize: binary.compressedSize,
        data: base64Data,
        compressed: true,
      };

      totalOriginal += binary.originalSize;
      totalCompressed += binary.compressedSize;

      if (this.verbose) {
        const ratio = (1 - binary.compressedSize / binary.originalSize) * 100;
        console.log(
          `  ${binary.filename}: ${binary.originalSize.toLocaleString()} → ${binary.compressedSize.toLocaleString()} bytes (${ratio.toFixed(1)}% smaller)`
        );
      }
    }

    // Write archive file
    const archivePath = path.join(outputDir, `${pluginName}.plugin`);
    fs.writeFileSync(archivePath, JSON.stringify(archiveData, null, 2));

    // Summary
    const overallRatio = totalOriginal > 0 ? (1 - totalCompressed / totalOriginal) * 100 : 0;

    if (this.verbose) {
      console.log(`Archive created: ${archivePath}`);
      console.log(`Overall compression: ${totalOriginal.toLocaleString()} → ${totalCompressed.toLocaleString()} bytes (${overallRatio.toFixed(1)}% smaller)`);
    }

    spinner.info(`Created ${pluginName}.plugin - ${binaries.length} binaries, ${overallRatio.toFixed(1)}% compression`);
  }

  async createArchives(buildDir: string, outputDir: string, verbose: boolean = false): Promise<number> {
    this.verbose = verbose;

    // Validate input directory
    if (!fs.existsSync(buildDir)) {
      throw new Error(`Build directory not found: ${buildDir}`);
    }

    // Create output directory
    fs.mkdirSync(outputDir, { recursive: true });

    let archivesCreated = 0;

    try {
      const entries = fs.readdirSync(buildDir, { withFileTypes: true });

      // Process each subdirectory as a potential plugin
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const pluginName = entry.name;
        const pluginDir = path.join(buildDir, pluginName);

        if (this.hasPluginFiles(pluginDir)) {
          const spinner = ora(`Processing ${pluginName}...`).start();

          try {
            await this.createSingleArchive(pluginName, pluginDir, outputDir, spinner);
            archivesCreated++;
            spinner.succeed(`${pluginName}.plugin created successfully`);
          } catch (error) {
            spinner.fail(`Failed to create archive for ${pluginName}: ${error instanceof Error ? error.message : "Unknown error"}`);
            if (this.verbose) {
              console.error(error);
            }
          }
        }
      }
    } catch (error) {
      throw new Error(`Failed to read build directory: ${error instanceof Error ? error.message : "Unknown error"}`);
    }

    return archivesCreated;
  }
}

export const createPluginArchives = async (buildDir: string, confirmationRequired: boolean = true, outputDir?: string, verbose: boolean = false) => {
  console.log(`Creating plugin archives from: ${buildDir}`);

  const resolvedOutputDir = outputDir || path.join(path.dirname(buildDir), "plugins");

  if (confirmationRequired) {
    const confirm = await askForConfirmation(
      `\n⚠️  CAUTION: This operation will:\n` +
        `   • Create .plugin archive files in: ${resolvedOutputDir}\n` +
        `   • Override existing .plugin files with the same names\n` +
        `   • Compress plugin binaries using gzip compression\n` +
        `\nInput directory: ${buildDir}\n` +
        `Output directory: ${resolvedOutputDir}\n`
    );

    if (!confirm) {
      console.log("Archive creation aborted by user.");
      return;
    }
  }

  const spinner = ora("Scanning for plugin directories...").start();

  try {
    const archiver = new PluginArchiver();
    const archivesCreated = await archiver.createArchives(buildDir, resolvedOutputDir, verbose);

    if (archivesCreated === 0) {
      spinner.fail("No plugin directories with binaries found.");
      return;
    }

    spinner.succeed(`Successfully created ${archivesCreated} plugin archive${archivesCreated !== 1 ? "s" : ""} in ${resolvedOutputDir}`);

    // Show summary of created files
    try {
      const archiveFiles = fs
        .readdirSync(resolvedOutputDir)
        .filter((file) => file.endsWith(".plugin"))
        .map((file) => {
          const filePath = path.join(resolvedOutputDir, file);
          const stats = fs.statSync(filePath);
          const sizeKB = (stats.size / 1024).toFixed(1);
          return `  ${file} (${sizeKB} KB)`;
        });

      if (archiveFiles.length > 0) {
        console.log("\nCreated archives:");
        archiveFiles.forEach((file) => console.log(file));
      }
    } catch (error) {
      // Ignore errors when listing files
    }

    console.log(`\nPlugin archives ready for distribution!`);
    console.log(`Place the .plugin files in your application's plugins directory.`);
  } catch (error) {
    spinner.fail(`Archive creation failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    if (verbose) {
      console.error(error);
    }
  }
};
