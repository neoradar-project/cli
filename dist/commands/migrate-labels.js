"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.migrateLabels = exports.migrateLabelsFile = exports.resolveSystemsPath = exports.findLabelsFiles = exports.migrateLabelsConfig = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const ora_1 = __importDefault(require("ora"));
const utils_1 = require("../utils");
// The six attention states that were folded into the old "concerned" row set.
const CONCERNED_ATTENTION_STATES = ["kNotified", "kIncomingTransfer", "kAssumed", "kOutgoingTransfer", "kIntruder", "kConcerned"];
const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const isNewShape = (section) => isObject(section) && Array.isArray(section.labels);
const isGroundReference = (section) => typeof section === "string";
const asRows = (value) => (Array.isArray(value) ? value : []);
const migrateAirborne = (airborne) => {
    const labels = [
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
    const migrated = { labels };
    if (airborne.styleVariants !== undefined) {
        migrated.styleVariants = airborne.styleVariants;
    }
    return migrated;
};
// Detailed row sets first, then the flight-phase ones, then the catch-all: the client takes the
// first variant whose selectors pass, so a narrower row set has to sit ahead of a wider one.
const GROUND_ORDER = [
    { key: "arrivalDetailed", variant: (rows) => ({ description: "Arrival detailed", detailed: true, applyToIsArrival: true, rows }) },
    { key: "departureDetailed", variant: (rows) => ({ description: "Departure detailed", detailed: true, applyToIsDeparture: true, rows }) },
    { key: "detailed", variant: (rows) => ({ description: "Detailed", detailed: true, rows }) },
    { key: "arrival", variant: (rows) => ({ description: "Arrival", applyToIsArrival: true, rows }) },
    { key: "departure", variant: (rows) => ({ description: "Departure", applyToIsDeparture: true, rows }) },
    { key: "default", variant: (rows) => ({ description: "Default", rows }) },
];
const migrateGround = (ground) => {
    const labels = [];
    for (const entry of GROUND_ORDER) {
        if (ground[entry.key] === undefined) {
            continue;
        }
        labels.push(entry.variant(asRows(ground[entry.key])));
    }
    const migrated = { labels };
    if (ground.styleVariants !== undefined) {
        migrated.styleVariants = ground.styleVariants;
    }
    return migrated;
};
/**
 * Converts one parsed labels config from the fixed row-set shape to the labels-array shape.
 * Root keys other than ground and airborne are copied through in their original order.
 */
const migrateLabelsConfig = (config) => {
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
    const migrated = {};
    for (const key of Object.keys(config)) {
        if (key === "airborne" && isObject(airborne) && !isNewShape(airborne)) {
            migrated.airborne = migrateAirborne(airborne);
        }
        else if (key === "ground" && isObject(ground) && !isNewShape(ground)) {
            migrated.ground = migrateGround(ground);
        }
        else {
            migrated[key] = config[key];
        }
    }
    return { config: migrated, changed: true };
};
exports.migrateLabelsConfig = migrateLabelsConfig;
/** Every labels.json under systemsPath, at any depth. */
const findLabelsFiles = (systemsPath) => {
    const found = [];
    const walk = (directory) => {
        for (const entry of fs_1.default.readdirSync(directory, { withFileTypes: true })) {
            const entryPath = path_1.default.join(directory, entry.name);
            if (entry.isDirectory()) {
                walk(entryPath);
            }
            else if (entry.isFile() && entry.name === "labels.json") {
                found.push(entryPath);
            }
        }
    };
    walk(systemsPath);
    return found.sort();
};
exports.findLabelsFiles = findLabelsFiles;
/** Accepts a package environment (with a package/ subfolder) or a built package directory. */
const resolveSystemsPath = (packagePath) => {
    const candidates = [path_1.default.join(packagePath, "package", "systems"), path_1.default.join(packagePath, "systems")];
    return candidates.find((candidate) => fs_1.default.existsSync(candidate)) ?? null;
};
exports.resolveSystemsPath = resolveSystemsPath;
const migrateLabelsFile = (filePath) => {
    try {
        const parsed = JSON.parse(fs_1.default.readFileSync(filePath, "utf-8"));
        const { config, changed } = (0, exports.migrateLabelsConfig)(parsed);
        if (!changed) {
            return { filePath, outcome: "already-migrated" };
        }
        fs_1.default.writeFileSync(filePath, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
        return { filePath, outcome: "migrated" };
    }
    catch (error) {
        return { filePath, outcome: "failed", message: error instanceof Error ? error.message : String(error) };
    }
};
exports.migrateLabelsFile = migrateLabelsFile;
const migrateLabels = async (packagePath, skipConfirmation = false) => {
    const systemsPath = (0, exports.resolveSystemsPath)(packagePath);
    if (!systemsPath) {
        console.error(`No systems directory found under ${packagePath}. Please provide a package environment or a built package.`);
        process.exitCode = 1;
        return;
    }
    if (!skipConfirmation) {
        const confirm = await (0, utils_1.askForConfirmation)(`\n⚠️  CAUTION: This rewrites every labels.json under ${systemsPath} in place, converting the fixed row sets (unconcerned/concerned/detailed, default/arrival/departure) into the new labels array. Files already in the new shape are left untouched.`);
        if (!confirm) {
            console.log("Migration aborted by user.");
            return;
        }
    }
    const spinner = (0, ora_1.default)(`Migrating labels configs in: ${systemsPath}`).start();
    const files = (0, exports.findLabelsFiles)(systemsPath);
    if (files.length === 0) {
        spinner.warn(`No labels.json files found under ${systemsPath}.`);
        return;
    }
    const results = files.map((filePath) => (0, exports.migrateLabelsFile)(filePath));
    for (const result of results) {
        const relative = path_1.default.relative(systemsPath, result.filePath);
        if (result.outcome === "migrated") {
            spinner.info(`Migrated: ${relative}`);
        }
        else if (result.outcome === "already-migrated") {
            spinner.info(`Already in the new shape, left untouched: ${relative}`);
        }
        else {
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
exports.migrateLabels = migrateLabels;
//# sourceMappingURL=migrate-labels.js.map