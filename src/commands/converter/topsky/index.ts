import fs from "fs";
import path from "path";
import { Ora } from "ora";

import {
  buildRadarsDataset,
  RADARS_DATASET_FILE,
  RadarSection,
  RadarsDataset,
} from "../../../helper/radars";
import { logTopSkyParsingWarning, topSkyParsingErrorCount } from "../../../helper/logger";
import { AREAS_DATASET_FILE, buildAreasDataset, parseAreas } from "./topsky-areas";
import { buildMsawDataset, MSAW_DATASET_FILE, parseMsaw } from "./topsky-msaw";
import { mergeMapsByFolder, parseMaps } from "./topsky-maps";
import { mergeRawVideo, parseTopSkyRadars } from "./topsky-radars";
import {
  buildStcaRunwaysDataset,
  parseStcaRunways,
  STCA_RUNWAYS_DATASET_FILE,
} from "./topsky-stca";

export const TOPSKY_FOLDER = "topsky";

// The pipeline stages, which are also the values --only takes.
export const TOPSKY_STAGES = ["maps", "msaw", "areas", "stca", "radars"] as const;
export type TopSkyStage = (typeof TOPSKY_STAGES)[number];

// A manual activation override file makes the plugin warn its user of a non-standard setup, so a
// package build that merged one silently would ship a picture no other controller sees. The same
// refusal posture assertNoLicensedArtifacts takes.
const REFUSED_FILE = "topskyareasmanualact.txt";

// Files the pipeline knows. Anything else in the folder is warned about once and left alone; the
// ones mapped to null are read by TopSky and carry nothing a dataset wants yet.
const KNOWN_FILES: Record<string, TopSkyStage | null> = {
  "topskymaps.txt": "maps",
  "topskymapslocal.txt": "maps",
  "topskymsaw.txt": "msaw",
  "topskyareas.txt": "areas",
  "topskystca.txt": "stca",
  "topskyradars.txt": "radars",
  "topskyairspace.txt": null,
  "topskysettings.txt": null,
  "topskysettingslocal.txt": null,
};

export interface TopSkyFileCount {
  file: string;
  stage: TopSkyStage | "skipped";
  parsed: number;
  written: number;
}

export interface TopSkyPipelineResult {
  ran: boolean;
  refused: boolean;
  files: TopSkyFileCount[];
  written: string[];
  warnings: number;
}

export interface TopSkyPipelineOptions {
  // The IANA zone the schedules fold into. The fold is self-checking, so a wrong zone folds
  // nothing and warns rather than moving an activation by an hour.
  timezone: string;
  only?: TopSkyStage[];
  spinner?: Ora;
}

export function defaultTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function wants(options: TopSkyPipelineOptions, stage: TopSkyStage): boolean {
  return !options.only || options.only.includes(stage);
}

// A FOLDER name becomes a file name and a manifest layer id, and the UK file has folders like
// "Release/Delegation Lines". A separator in there would write outside datasets/, so it is
// flattened and the run says which names were changed.
function layerFileName(folder: string): string {
  return folder.replace(/[\/:*?"<>|]+/g, " - ").replace(/\s+/g, " ").trim();
}

function write(filePath: string, body: unknown): string {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(body, null, 2) + "\n", "utf8");
  return filePath;
}

function readRadars(datasetsPath: string): RadarsDataset | null {
  const filePath = path.join(datasetsPath, RADARS_DATASET_FILE);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as RadarsDataset;
  } catch (error) {
    logTopSkyParsingWarning(
      RADARS_DATASET_FILE,
      0,
      "",
      `existing radars.json cannot be read (${error instanceof Error ? error.message : "unknown error"}), so no raw video was merged`
    );
    return null;
  }
}

/**
 * The one TopSky pipeline. `topsky-convert` runs it alone and `convert` runs it as part of the
 * normal package build, after the ESE step (which writes radars.json the raw video merges onto)
 * and before the indexer (which picks the new datasets up as map layers).
 *
 * Dispatch is by file NAME, because the folder now holds more than maps: the old command read
 * every .txt as a maps file and would write nothing useful from an MSAW or areas file.
 */
export async function runTopSkyPipeline(
  packageEnvironmentPath: string,
  options: TopSkyPipelineOptions
): Promise<TopSkyPipelineResult> {
  const spinner = options.spinner;
  const folder = path.join(packageEnvironmentPath, TOPSKY_FOLDER);
  const datasetsPath = path.join(packageEnvironmentPath, "package", "datasets");
  const result: TopSkyPipelineResult = { ran: false, refused: false, files: [], written: [], warnings: 0 };

  if (!fs.existsSync(folder)) {
    spinner?.info(`No ${TOPSKY_FOLDER}/ folder, skipping the TopSky data pipeline.`);
    return result;
  }

  const before = topSkyParsingErrorCount;
  const entries = fs
    .readdirSync(folder)
    .filter((entry) => fs.statSync(path.join(folder, entry)).isFile());

  const refused = entries.find((entry) => entry.toLowerCase() === REFUSED_FILE);
  if (refused) {
    spinner?.fail(
      `${TOPSKY_FOLDER}/${refused} is a manual activation override; the package build does not merge one. Remove it and fold the change into TopSkyAreas.txt.`
    );
    result.refused = true;
    return result;
  }

  result.ran = true;
  const maps: ReturnType<typeof parseMaps> = [];
  let radarSection: RadarSection | null = null;
  const radarsDataset = readRadars(datasetsPath);

  for (const entry of entries) {
    const lower = entry.toLowerCase();
    if (!(lower in KNOWN_FILES)) {
      if (lower.endsWith(".txt")) {
        spinner?.warn(`Unknown TopSky file ${entry}, skipped. Known: ${Object.keys(KNOWN_FILES).join(", ")}`);
      }
      result.files.push({ file: entry, stage: "skipped", parsed: 0, written: 0 });
      continue;
    }

    const stage = KNOWN_FILES[lower];
    if (stage === null) {
      // Read by TopSky, nothing here yet: TopSkyAirspace.txt's QNHTL and APPLINE and the
      // settings files belong to other plans.
      result.files.push({ file: entry, stage: "skipped", parsed: 0, written: 0 });
      continue;
    }
    if (!wants(options, stage)) {
      result.files.push({ file: entry, stage: "skipped", parsed: 0, written: 0 });
      continue;
    }

    const content = fs.readFileSync(path.join(folder, entry), "utf8");
    switch (stage) {
      case "maps": {
        const parsed = parseMaps(entry, content);
        maps.push(...parsed);
        result.files.push({ file: entry, stage, parsed: parsed.length, written: 0 });
        break;
      }
      case "msaw": {
        const parsed = parseMsaw(entry, content);
        const filePath = write(path.join(datasetsPath, MSAW_DATASET_FILE), buildMsawDataset(parsed));
        result.written.push(filePath);
        result.files.push({ file: entry, stage, parsed: parsed.features.length, written: parsed.features.length });
        spinner?.info(
          `MSAW: ${parsed.counts.polygons} polygons, ${parsed.counts.circles} circles, ${parsed.counts.wedges} sectors, ${parsed.counts.boxes} boxes, ${parsed.counts.gridCells} grid cells.`
        );
        break;
      }
      case "areas": {
        const parsed = parseAreas(entry, content, options.timezone);
        const filePath = write(path.join(datasetsPath, AREAS_DATASET_FILE), buildAreasDataset(parsed));
        result.written.push(filePath);
        result.files.push({ file: entry, stage, parsed: parsed.counts.areas, written: parsed.counts.areas });
        spinner?.info(
          `Areas: ${parsed.counts.areas} areas, ${parsed.counts.circles} circles, ${parsed.counts.withAup} on the AUP feed, ${parsed.counts.withSchedules} scheduled, ${parsed.counts.foldedSchedules} schedules folded into ${options.timezone}, ${parsed.counts.partialSchedules} left as UTC.`
        );
        break;
      }
      case "stca": {
        const parsed = parseStcaRunways(entry, content);
        const count = parsed.finalApproaches.length + parsed.parallelOperations.length;
        const filePath = write(
          path.join(datasetsPath, STCA_RUNWAYS_DATASET_FILE),
          buildStcaRunwaysDataset(parsed)
        );
        result.written.push(filePath);
        result.files.push({ file: entry, stage, parsed: count, written: count });
        spinner?.info(
          `STCA: ${parsed.finalApproaches.length} final approach corridors, ${parsed.parallelOperations.length} parallel operations.`
        );
        break;
      }
      case "radars": {
        const parsed = parseTopSkyRadars(entry, content);
        if (!radarsDataset) {
          spinner?.warn(
            `${entry} carries ${parsed.parsed.length} stations but there is no datasets/radars.json to merge them onto; run the ESE conversion first.`
          );
          result.files.push({ file: entry, stage, parsed: parsed.parsed.length, written: 0 });
          break;
        }
        radarSection = radarsDataset;
        const merged = mergeRawVideo(radarSection, parsed);
        spinner?.info(
          `Radars: ${merged.matchedByName} matched by name, ${merged.matchedByLocation} by location, ${merged.added} added, ${merged.terrainLinesDropped} terrain lines dropped (the ESE HOLE polygons already mask coverage).`
        );
        result.files.push({ file: entry, stage, parsed: parsed.parsed.length, written: merged.matchedByName + merged.matchedByLocation + merged.added });
        break;
      }
    }
  }

  if (radarSection) {
    const filePath = write(
      path.join(datasetsPath, RADARS_DATASET_FILE),
      buildRadarsDataset(radarSection)
    );
    result.written.push(filePath);
  }

  if (maps.length > 0) {
    const merged = mergeMapsByFolder(maps);
    for (const [folderName, collection] of Object.entries(merged)) {
      if (collection.features.length === 0) {
        spinner?.warn(`No features found for map folder "${folderName}", skipping.`);
        continue;
      }
      const layer = layerFileName(folderName);
      if (layer !== folderName) {
        spinner?.warn(`Map folder "${folderName}" holds a path separator; written as "${layer}.geojson".`);
      }
      const filePath = path.join(datasetsPath, `${layer}.geojson`);
      fs.mkdirSync(datasetsPath, { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(collection), "utf8");
      result.written.push(filePath);
    }
    spinner?.info(`Maps: ${maps.length} maps merged into ${Object.keys(merged).length} folders.`);
  }

  result.warnings = topSkyParsingErrorCount - before;
  return result;
}

// The dataset files a run may overwrite, named in convert's confirmation text so the contract for
// what it touches stays complete.
export function topSkyOutputNames(): string[] {
  return [
    `datasets/${MSAW_DATASET_FILE}`,
    `datasets/${AREAS_DATASET_FILE}`,
    `datasets/${STCA_RUNWAYS_DATASET_FILE}`,
    `the rawVideo blocks in datasets/${RADARS_DATASET_FILE}`,
    "one datasets/<folder>.geojson per TopSky map folder",
  ];
}
