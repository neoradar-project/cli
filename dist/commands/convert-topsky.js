"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.convertTopsky = void 0;
exports.parseStages = parseStages;
const ora_1 = __importDefault(require("ora"));
const topsky_1 = require("./converter/topsky");
// Parses --only into stages, refusing a name that is not one rather than silently running the
// lot: a typo would otherwise overwrite datasets the author asked not to touch.
function parseStages(only) {
    if (!only)
        return undefined;
    const asked = only
        .split(",")
        .map((stage) => stage.trim().toLowerCase())
        .filter((stage) => stage.length > 0);
    if (asked.length === 0)
        return undefined;
    const unknown = asked.filter((stage) => !topsky_1.TOPSKY_STAGES.includes(stage));
    if (unknown.length > 0) {
        throw new Error(`--only names ${unknown.join(", ")}, which is not a TopSky stage. Known: ${topsky_1.TOPSKY_STAGES.join(", ")}.`);
    }
    return asked;
}
/**
 * Runs the TopSky pipeline on its own, for a vAcc iterating on its TopSky files. The same
 * pipeline runs as part of `convert`, so this command exists for the shorter loop, not for a
 * different result.
 */
const convertTopsky = async (packageEnvironmentPath, options = {}) => {
    const spinner = (0, ora_1.default)("Converting TopSky data...").start();
    let only;
    try {
        only = parseStages(options.only);
    }
    catch (error) {
        spinner.fail(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
        return;
    }
    const timezone = options.timezone || (0, topsky_1.defaultTimezone)();
    const result = await (0, topsky_1.runTopSkyPipeline)(packageEnvironmentPath, { timezone, only, spinner });
    if (result.refused) {
        process.exitCode = 1;
        return;
    }
    if (!result.ran) {
        spinner.fail(`No ${topsky_1.TOPSKY_FOLDER}/ folder at ${packageEnvironmentPath}.`);
        return;
    }
    for (const file of result.files) {
        if (file.stage === "skipped")
            continue;
        spinner.info(`${file.file}: ${file.parsed} parsed, ${file.written} written (${file.stage}).`);
    }
    if (result.warnings > 0) {
        spinner.warn(`TopSky conversion completed with ${result.warnings} warnings. Check neoradar-cli.log for details.`);
    }
    spinner.succeed(result.written.length > 0
        ? `TopSky data converted: ${result.written.length} dataset files written.`
        : "TopSky data converted: nothing to write.");
    return result;
};
exports.convertTopsky = convertTopsky;
//# sourceMappingURL=convert-topsky.js.map