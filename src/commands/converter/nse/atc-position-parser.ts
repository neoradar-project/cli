import { PackageAtcPosition } from "../../../definitions/package-defs";
import { geoHelper } from "../../../helper/geo-helper";
import logger, {
  logESEParsingError,
  logESEParsingWarning,
} from "../../../helper/logger";
import { cleanEndLines } from "../../../utils";

export const parseAtcPositionLine = (
  line: string,
  isGNG: boolean
): PackageAtcPosition | null => {
  const data = line.split(":");

  if (data.length < 4) {
    logESEParsingWarning(
      "Invalid ATC position line format: insufficient data fields (minimum fields needed is 4)",
      line
    );
    return null;
  }

  try {
    const visibilityPoints = parseVisibilityPoints(data);
    const cleanedData = data.map(cleanEndLines);
    const callsign = generateCallsign(cleanedData, isGNG);

    return {
      callsign,
      name: cleanedData[1],
      frequency: cleanedData[2],
      identifier: cleanedData[3],
      subSector: cleanedData[4],
      sector: cleanedData[5],
      facility: cleanedData[6],
      squawkStart: cleanedData[9],
      squawkEnd: cleanedData[10],
      visibilityPoints,
    } as PackageAtcPosition;
  } catch (error) {
    logESEParsingError(
      "ATC position line",
      `Failed to parse ATC position line: ${line}`,
      error instanceof Error ? error.message : "Unknown error"
    );
    return null;
  }
};

const parseVisibilityPoints = (data: string[]): [number, number][] => {
  const points: [number, number][] = [];

  for (let i = 11; i < data.length; i += 2) {
    if (i + 1 >= data.length) break;

    try {
      const geo = geoHelper.convertESEGeoCoordinates(data[i], data[i + 1]);
      if (geo) {
        points.push([geo.lat, geo.lon]);
      }
    } catch (error) {
      logESEParsingWarning(
        `Invalid geo coordinates at index ${i}: ${data[i]}, ${data[i + 1]}`,
        error instanceof Error ? error.message : "Unknown error"
      );
    }
  }

  return points;
};

const generateCallsign = (cleanedData: string[], isGNG: boolean): string => {
  if (!isGNG) {
    return cleanedData[0];
  }

  const sector = cleanedData[5];
  const subSector = cleanedData[4].replace("-", ""); // Remove - which should be null per RFC
  const facility = cleanedData[6];

  let callsign = `${sector}_`;
  if (subSector.length > 0) {
    callsign += `${subSector}_`;
  }
  callsign += facility;

  return callsign;
};
