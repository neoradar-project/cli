import { PackageProcedure } from "../../../definitions/package-defs";
import { logESEParsingError } from "../../../helper/logger";
import { cleanEndLines } from "../../../utils";

export const parseESEProcedure = (line: string): PackageProcedure | null => {
  try {
    const data = line
      .split(":")
      .filter((item) => item !== "")
      .map(cleanEndLines);

    if (data.length < 5) {
      logESEParsingError(
        `Invalid procedure format: expected at least 5 fields, got ${data.length} - line: ${line}`
      );
      return null;
    }

    const points = data[4]
      .split(" ")
      .filter((item) => item !== "")
      .map(cleanEndLines);

    return {
      type: data[0],
      icao: data[1],
      runway: data[2],
      name: data[3],
      points,
    } as PackageProcedure;
  } catch (error) {
    logESEParsingError(`Failed to parse procedure: ${error} - line: ${line}`);
    return null;
  }
};
