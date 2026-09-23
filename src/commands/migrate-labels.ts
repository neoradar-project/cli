import fs from "fs";
import path from "path";
import ora from "ora";
import { askForConfirmation } from "../utils";

// The six attention states that were folded into the old "concerned" row set.
const CONCERNED_ATTENTION_STATES = ["kNotified", "kIncomingTransfer", "kAssumed", "kOutgoingTransfer", "kIntruder", "kConcerned"];

type JsonObject = Record<string, any>;

export type LabelsFileOutcome = "migrated" | "already-migrated" | "failed";

export interface LabelsFileResult {
  filePath: string;
  outcome: LabelsFileOutcome;
  message?: string;
}

export interface LabelsMigrationResult {
  config: JsonObject;
  changed: boolean;
}

const isObject = (value: unknown): value is JsonObject => typeof value === "object" && value !== null && !Array.isArray(value);

const isNewShape = (section: unknown): boolean => isObject(section) && Array.isArray(section.labels);

const isGroundReference = (section: unknown): boolean => typeof section === "string";

const asRows = (value: unknown): any[] => (Array.isArray(value) ? value : []);

const migrateAirborne = (airborne: JsonObject): JsonObject => {
  const labels: JsonObject[] = [
    {
      description: "Unconcerned",
      applyToAttentionStates: ["kUnconcerned"],
      rows: asRows(airborne.unconcerned),
    },
    {
      description: "Concerned",
      applyToAttentionStates: CONCERNED_ATTENTION_STATES,
      rows: asRows(airborne.concerned),
    },
    {
      description: "Detailed",
      detailed: true,
      rows: asRows(airborne.detailed),
    },
  ];

  const migrated: JsonObject = { labels };
  if (airborne.styleVariants !== undefined) {
    migrated.styleVariants = airborne.styleVariants;
  }
  return migrated;
};

// Detailed row sets first, then the flight-phase ones, then the catch-all: the client takes the
// first variant whose selectors pass, so a narrower row set has to sit ahead of a wider one.
const GROUND_ORDER: { key: string; variant: (rows: any[]) => JsonObject }[] = [
  { key: "arrivalDetailed", variant: (rows) => ({ description: "Arrival detailed", detailed: true, applyToIsArrival: true, rows }) },
  { key: "departureDetailed", variant: (rows) => ({ description: "Departure detailed", detailed: true, applyToIsDeparture: true, rows }) },
  { key: "detailed", variant: (rows) => ({ description: "Detailed", detailed: true, rows }) },
  { key: "arrival", variant: (rows) => ({ description: "Arrival", applyToIsArrival: true, rows }) },
  { key: "departure", variant: (rows) => ({ description: "Departure", applyToIsDeparture: true, rows }) },
  { key: "default", variant: (rows) => ({ description: "Default", rows }) },
];

const migrateGround = (ground: JsonObject): JsonObject => {
  const labels: JsonObject[] = [];
  for (const entry of GROUND_ORDER) {
    if (ground[entry.key] === undefined) {
      continue;
    }
    labels.push(entry.variant(asRows(ground[entry.key])));
  }

  const migrated: JsonObject = { labels };
  if (ground.styleVariants !== undefined) {
    migrated.styleVariants = ground.styleVariants;
  }
  return migrated;
};

/**
 * Converts one parsed labels config from the fixed row-set shape to the labels-array shape.
 * Root keys other than ground and airborne are copied through in their original order.
 */
export const migrateLabelsConfig = (config: JsonObject): LabelsMigrationResult => {
  if (!isObject(config)) {
    throw new Error("labels config is not an object");
  }

  const airborne = config.airborne;
  const ground = config.ground;

  if (airborne !== undefined && !isObject(airborne)) {
    throw new Error("airborne is present but is not an object");
  }
  if (ground !== undefined && !isObject(ground) && !isGroundReference(ground)) {
    throw new Error('ground is present but is neither an object nor a "#systemId" reference');
  }

  const airborneIsNew = airborne === undefined || isNewShape(airborne);
  const groundIsNew = ground === undefined || isGroundReference(ground) || isNewShape(ground);
  if (airborneIsNew && groundIsNew) {
    return { config, changed: false };
  }

  const migrated: JsonObject = {};
  for (const key of Object.keys(config)) {
    if (key === "airborne" && isObject(airborne) && !isNewShape(airborne)) {
      migrated.airborne = migrateAirborne(airborne);
    } else if (key === "ground" && isObject(ground) && !isNewShape(ground)) {
      migrated.ground = migrateGround(ground);
    } else {
      migrated[key] = config[key];
    }
  }

  return { config: migrated, changed: true };
};

/** Every labels.json under systemsPath, at any depth. */
export const findLabelsFiles = (systemsPath: string): string[] => {
  const found: string[] = [];
  const walk = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(entryPath);
      } else if (entry.isFile() && entry.name === "labels.json") {
        found.push(entryPath);
      }
    }
  };

  walk(systemsPath);
  return found.sort();
};

/** Accepts a package environment (with a package/ subfolder) or a built package directory. */
export const resolveSystemsPath = (packagePath: string): string | null => {
  const candidates = [path.join(packagePath, "package", "systems"), path.join(packagePath, "systems")];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
};

export const migrateLabelsFile = (filePath: string): LabelsFileResult => {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as JsonObject;
    const { config, changed } = migrateLabelsConfig(parsed);
    if (!changed) {
      return { filePath, outcome: "already-migrated" };
    }

    fs.writeFileSync(filePath, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
    return { filePath, outcome: "migrated" };
  } catch (error) {
    return { filePath, outcome: "failed", message: error instanceof Error ? error.message : String(error) };
  }
};

export const migrateLabels = async (packagePath: string, skipConfirmation: boolean = false) => {
  const systemsPath = resolveSystemsPath(packagePath);
  if (!systemsPath) {
    console.error(`No systems directory found under ${packagePath}. Please provide a package environment or a built package.`);
    process.exitCode = 1;
    return;
  }

  if (!skipConfirmation) {
    const confirm = await askForConfirmation(
      `\n⚠️  CAUTION: This rewrites every labels.json under ${systemsPath} in place, converting the fixed row sets (unconcerned/concerned/detailed, default/arrival/departure) into the new labels array. Files already in the new shape are left untouched.`
    );

    if (!confirm) {
      console.log("Migration aborted by user.");
      return;
    }
  }

  const spinner = ora(`Migrating labels configs in: ${systemsPath}`).start();

  const files = findLabelsFiles(systemsPath);
  if (files.length === 0) {
    spinner.warn(`No labels.json files found under ${systemsPath}.`);
    return;
  }

  const results = files.map((filePath) => migrateLabelsFile(filePath));
  for (const result of results) {
    const relative = path.relative(systemsPath, result.filePath);
    if (result.outcome === "migrated") {
      spinner.info(`Migrated: ${relative}`);
    } else if (result.outcome === "already-migrated") {
      spinner.info(`Already in the new shape, left untouched: ${relative}`);
    } else {
      spinner.fail(`Failed: ${relative} - ${result.message}`);
    }
  }

  const migrated = results.filter((result) => result.outcome === "migrated").length;
  const untouched = results.filter((result) => result.outcome === "already-migrated").length;
  const failed = results.filter((result) => result.outcome === "failed").length;

  if (failed > 0) {
    process.exitCode = 1;
    spinner.fail(`Migrated ${migrated}, left untouched ${untouched}, failed ${failed}.`);
    return;
  }

  spinner.succeed(`Migrated ${migrated}, left untouched ${untouched}.`);
};
