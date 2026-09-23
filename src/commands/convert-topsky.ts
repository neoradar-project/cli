import ora from "ora";
import {
  defaultTimezone,
  runTopSkyPipeline,
  TOPSKY_FOLDER,
  TOPSKY_STAGES,
  TopSkyStage,
} from "./converter/topsky";

export interface ConvertTopSkyOptions {
  only?: string;
  timezone?: string;
}

// Parses --only into stages, refusing a name that is not one rather than silently running the
// lot: a typo would otherwise overwrite datasets the author asked not to touch.
export function parseStages(only: string | undefined): TopSkyStage[] | undefined {
  if (!only) return undefined;
  const asked = only
    .split(",")
    .map((stage) => stage.trim().toLowerCase())
    .filter((stage) => stage.length > 0);
  if (asked.length === 0) return undefined;

  const unknown = asked.filter((stage) => !TOPSKY_STAGES.includes(stage as TopSkyStage));
  if (unknown.length > 0) {
    throw new Error(
      `--only names ${unknown.join(", ")}, which is not a TopSky stage. Known: ${TOPSKY_STAGES.join(", ")}.`
    );
  }
  return asked as TopSkyStage[];
}

/**
 * Runs the TopSky pipeline on its own, for a vAcc iterating on its TopSky files. The same
 * pipeline runs as part of `convert`, so this command exists for the shorter loop, not for a
 * different result.
 */
export const convertTopsky = async (
  packageEnvironmentPath: string,
  options: ConvertTopSkyOptions = {}
) => {
  const spinner = ora("Converting TopSky data...").start();

  let only: TopSkyStage[] | undefined;
  try {
    only = parseStages(options.only);
  } catch (error) {
    spinner.fail(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }

  const timezone = options.timezone || defaultTimezone();
  const result = await runTopSkyPipeline(packageEnvironmentPath, { timezone, only, spinner });

  if (result.refused) {
    process.exitCode = 1;
    return;
  }
  if (!result.ran) {
    spinner.fail(`No ${TOPSKY_FOLDER}/ folder at ${packageEnvironmentPath}.`);
    return;
  }

  for (const file of result.files) {
    if (file.stage === "skipped") continue;
    spinner.info(`${file.file}: ${file.parsed} parsed, ${file.written} written (${file.stage}).`);
  }

  if (result.warnings > 0) {
    spinner.warn(`TopSky conversion completed with ${result.warnings} warnings. Check neoradar-cli.log for details.`);
  }
  spinner.succeed(
    result.written.length > 0
      ? `TopSky data converted: ${result.written.length} dataset files written.`
      : "TopSky data converted: nothing to write."
  );
  return result;
};
