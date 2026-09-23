import fs from "fs";
import path from "path";
import { geoHelper } from "./geo-helper";
import { logESEParsingWarning } from "./logger";

// One sensor of an ESE RADAR2 station. Ranges are nautical miles, altitudes feet and the cone
// slope feet per nautical mile, exactly as EuroScope reads them.
export interface RadarSensor {
  rangeNm: number;
  antennaAltitudeFt: number;
  coneSlopeFtPerNm?: number;
}

export interface RadarStation {
  name: string;
  latitude: number;
  longitude: number;
  primary?: RadarSensor;
  secondary?: RadarSensor;
  modeS?: RadarSensor;
}

// An ESE HOLE block: inside the polygon a sensor kind has no coverage below its floor. A kind
// with no floor is not affected. Vertices are [latitude, longitude] in WGS84 degrees.
export interface RadarHole {
  primaryBelowFt?: number;
  secondaryBelowFt?: number;
  modeSBelowFt?: number;
  polygon: [number, number][];
}

export interface RadarSection {
  stations: RadarStation[];
  holes: RadarHole[];
}

export interface RadarsDataset extends RadarSection {
  $schema: string;
  name: string;
}

export const RADARS_DATASET_FILE = "radars.json";

const RADARS_SCHEMA = "https://raw.githubusercontent.com/neoradar-project/schemas/refs/heads/main/datasets/radars.schema.json";

// RADAR2:<name>:<lat>:<lon>:<P range>:<P antenna>:<P cone>:<S range>:<S antenna>:<S cone>:<C range>:<C antenna>:<C cone>
const RADAR2_FIELD_COUNT = 13;
const SENSOR_OFFSETS: ReadonlyArray<[keyof Pick<RadarStation, "primary" | "secondary" | "modeS">, number]> = [
  ["primary", 4],
  ["secondary", 7],
  ["modeS", 10],
];

// HOLE:<primary floor>:<secondary floor>:<Mode S floor>, each optional, followed by COORD lines.
const HOLE_FLOORS: ReadonlyArray<[keyof Omit<RadarHole, "polygon">, number]> = [
  ["primaryBelowFt", 1],
  ["secondaryBelowFt", 2],
  ["modeSBelowFt", 3],
];

const MIN_HOLE_VERTICES = 3;

function isSkippable(line: string): boolean {
  return line.startsWith(";") || !line.trim();
}

// A RADAR2 line becomes a station; an empty range leaves that sensor out. Returns null, with a
// warning naming the line, for anything the client could not use.
export function parseRadarLine(line: string): RadarStation | null {
  if (isSkippable(line)) return null;

  const parts = line.split(":").map((part) => part.trim());
  if (parts[0] !== "RADAR2") {
    logESEParsingWarning(`Unsupported [RADAR] line dropped, only RADAR2 carries the per-sensor ranges: "${line}"`);
    return null;
  }
  while (parts.length < RADAR2_FIELD_COUNT) parts.push("");

  const name = parts[1];
  if (!name) {
    logESEParsingWarning(`RADAR2 line has no station name: "${line}"`);
    return null;
  }

  const coords = geoHelper.convertESEGeoCoordinates(parts[2], parts[3]);
  if (!coords || (coords.lat === 0 && coords.lon === 0)) {
    logESEParsingWarning(`RADAR2 station "${name}" has an unparseable position ${parts[2]}:${parts[3]}`);
    return null;
  }

  const station: RadarStation = { name, latitude: coords.lat, longitude: coords.lon };
  for (const [key, offset] of SENSOR_OFFSETS) {
    const sensor = parseSensor(parts[offset], parts[offset + 1], parts[offset + 2], name, key);
    if (sensor) station[key] = sensor;
  }

  if (!station.primary && !station.secondary && !station.modeS) {
    logESEParsingWarning(`RADAR2 station "${name}" has no usable sensor and is dropped`);
    return null;
  }
  return station;
}

function parseSensor(range: string, antenna: string, cone: string, station: string, kind: string): RadarSensor | undefined {
  if (!range) return undefined;

  const rangeNm = Number(range);
  if (!Number.isFinite(rangeNm) || rangeNm <= 0) {
    logESEParsingWarning(`RADAR2 station "${station}" ${kind} range "${range}" is not a positive number; sensor dropped`);
    return undefined;
  }

  const antennaAltitudeFt = antenna ? Number(antenna) : 0;
  if (!Number.isFinite(antennaAltitudeFt)) {
    logESEParsingWarning(`RADAR2 station "${station}" ${kind} antenna altitude "${antenna}" is not a number; sensor dropped`);
    return undefined;
  }

  const sensor: RadarSensor = { rangeNm, antennaAltitudeFt };
  if (cone) {
    const coneSlopeFtPerNm = Number(cone);
    if (!Number.isFinite(coneSlopeFtPerNm) || coneSlopeFtPerNm < 0) {
      logESEParsingWarning(`RADAR2 station "${station}" ${kind} cone slope "${cone}" is not a non-negative number; sensor dropped`);
      return undefined;
    }
    sensor.coneSlopeFtPerNm = coneSlopeFtPerNm;
  }
  return sensor;
}

// A HOLE header with no floor at all hides nothing and is dropped with its COORD lines.
export function parseHoleHeader(line: string): RadarHole | null {
  const parts = line.split(":").map((part) => part.trim());
  const hole: RadarHole = { polygon: [] };
  let floors = 0;
  for (const [key, index] of HOLE_FLOORS) {
    const text = parts[index] ?? "";
    if (!text) continue;
    const floor = Number(text);
    if (!Number.isFinite(floor)) {
      logESEParsingWarning(`HOLE floor "${text}" is not a number: "${line}"`);
      return null;
    }
    hole[key] = floor;
    floors++;
  }
  if (floors === 0) {
    logESEParsingWarning(`HOLE with no floor for any sensor is dropped: "${line}"`);
    return null;
  }
  return hole;
}

// The [RADAR] section is stateful: a HOLE header owns the COORD lines after it until the next
// header or station. One parser per ESE file.
export class RadarSectionParser {
  private readonly stations: RadarStation[] = [];
  private readonly holes: RadarHole[] = [];
  private current: RadarHole | null = null;
  // True while the COORD lines of a dropped HOLE are being consumed without a warning each.
  private discardingHole = false;

  public handleLine(line: string): void {
    if (isSkippable(line)) return;

    const key = line.split(":", 1)[0].trim();
    switch (key) {
      case "RADAR2": {
        this.closeHole();
        const station = parseRadarLine(line);
        if (station) this.stations.push(station);
        break;
      }
      case "HOLE":
        this.closeHole();
        this.current = parseHoleHeader(line);
        this.discardingHole = this.current === null;
        break;
      case "COORD":
        this.handleCoord(line);
        break;
      default:
        logESEParsingWarning(`Unsupported [RADAR] line dropped: "${line}"`);
        break;
    }
  }

  public finish(): RadarSection {
    this.closeHole();
    return { stations: this.stations, holes: this.holes };
  }

  private handleCoord(line: string): void {
    if (this.discardingHole) return;
    if (!this.current) {
      logESEParsingWarning(`COORD outside a HOLE block in [RADAR] is dropped: "${line}"`);
      return;
    }

    const parts = line.split(":").map((part) => part.trim());
    const coords = geoHelper.convertESEGeoCoordinates(parts[1] ?? "", parts[2] ?? "");
    if (!coords) {
      logESEParsingWarning(`HOLE vertex is unparseable and the hole is dropped: "${line}"`);
      this.current = null;
      this.discardingHole = true;
      return;
    }
    this.current.polygon.push([coords.lat, coords.lon]);
  }

  private closeHole(): void {
    if (this.current) {
      if (this.current.polygon.length < MIN_HOLE_VERTICES) {
        logESEParsingWarning(`HOLE with ${this.current.polygon.length} vertices is not an area and is dropped`);
      } else {
        this.holes.push(this.current);
      }
    }
    this.current = null;
    this.discardingHole = false;
  }
}

export function buildRadarsDataset(section: RadarSection): RadarsDataset {
  return {
    $schema: RADARS_SCHEMA,
    name: "Radar stations and holes from the ESE [RADAR] section",
    stations: section.stations,
    holes: section.holes,
  };
}

// Writes datasets/radars.json when the ESE carried at least one station, because the file's
// presence is what turns the client's coverage simulation on for the package. With no station
// nothing is written, and a file left by an earlier convert is reported rather than removed.
export function writeRadarsDataset(datasetsOutputPath: string, section: RadarSection): string | undefined {
  const filePath = path.join(datasetsOutputPath, RADARS_DATASET_FILE);
  if (section.stations.length === 0) {
    if (section.holes.length > 0) {
      logESEParsingWarning(`[RADAR] has ${section.holes.length} holes but no station; nothing written, holes need a station to punch through`);
    }
    if (fs.existsSync(filePath)) {
      logESEParsingWarning(`ESE has no [RADAR] stations but ${filePath} exists; delete it to turn coverage simulation off`);
    }
    return undefined;
  }

  fs.mkdirSync(datasetsOutputPath, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(buildRadarsDataset(section), null, 2) + "\n", "utf8");
  return filePath;
}
