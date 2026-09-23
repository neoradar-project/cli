import { coordinateFrom, LatLon, ringToPolygon, toMercator } from "./topsky-coords";
import { blocks, lex, numberField, TopSkyBlock, TopSkyLine, warn } from "./topsky-lexer";

export const STCA_RUNWAYS_DATASET_FILE = "stca-runways.json";

const STCA_RUNWAYS_SCHEMA =
  "https://raw.githubusercontent.com/neoradar-project/schemas/refs/heads/main/datasets/stca-runways.schema.json";

// The Developer Guide's defaults, in nautical miles.
const DEFAULT_FINAL_RANGE_NM = 10;
const DEFAULT_FINAL_XTE_NM = 0.5;
const DEFAULT_SOIR_RANGE_NM = 10;
const DEFAULT_NOZ_NM = 0.3;

// FINALAPP:ICAO:RWY[:range:xte:lat:lon:course]: the reduced-separation corridor on final, where an
// alert between two aircraft landing the same runway is inhibited under the wake rule.
export interface FinalApproach {
  icao: string;
  runway: string;
  rangeNm: number;
  xteNm: number;
  // The threshold in EPSG:3857 when the line gave one; the client falls back to the runway end
  // the strip resolver already knows.
  end?: { x: number; y: number };
  courseT?: number;
}

export interface ParallelRunway {
  runway: string;
  // The level assumed when the clearance is "cleared for approach" rather than a number.
  approachAltFt?: number;
  courseT?: number;
  noz?: GeoJSON.Polygon;
}

// SOIR:ICAO:RWY1[/alt]:RWY2[/alt][:range:widthIn:widthOut]: a simultaneous parallel operation,
// where one aircraft in each normal operating zone tracking its own course is not a conflict.
export interface ParallelOperation {
  icao: string;
  left: ParallelRunway;
  right: ParallelRunway;
  rangeNm: number;
  widthInNm: number;
  widthOutNm: number;
  departure: boolean;
  // The no transgression zone EXTENDS alerting below the normal lower limit, so it is the one
  // polygon here that turns the net on rather than off.
  ntz?: GeoJSON.Polygon;
}

export interface StcaRunwaysResult {
  finalApproaches: FinalApproach[];
  parallelOperations: ParallelOperation[];
}

export interface StcaRunwaysDataset extends StcaRunwaysResult {
  $schema: string;
  name: string;
}

// "27L/2000" is a runway with the level assumed under a "cleared for approach" clearance.
function runwayWithAlt(field: string | undefined): { runway: string; approachAltFt?: number } {
  const text = (field ?? "").trim();
  const slash = text.indexOf("/");
  if (slash < 0) return { runway: text };
  const altitude = Number(text.slice(slash + 1));
  return {
    runway: text.slice(0, slash),
    approachAltFt: Number.isFinite(altitude) ? altitude : undefined,
  };
}

function polygonFrom(lines: TopSkyLine[], keyword: string): GeoJSON.Polygon | undefined {
  const ring: LatLon[] = [];
  for (const line of lines) {
    if (line.keyword !== keyword) continue;
    const point = coordinateFrom(line, 1, 2, `${keyword} vertex`);
    if (point) ring.push(point);
  }
  if (ring.length === 0) return undefined;
  const polygon = ringToPolygon(ring);
  if (!polygon) return undefined;
  return polygon;
}

function finalApproach(block: TopSkyBlock): FinalApproach | null {
  const line = block.header;
  const icao = (line.fields[1] ?? "").trim().toUpperCase();
  const runway = (line.fields[2] ?? "").trim().toUpperCase();
  if (!icao || !runway) {
    warn(line, "FINALAPP needs an ICAO and a runway");
    return null;
  }

  const result: FinalApproach = {
    icao,
    runway,
    rangeNm: DEFAULT_FINAL_RANGE_NM,
    xteNm: DEFAULT_FINAL_XTE_NM,
  };

  if (line.fields[3]) {
    const rangeNm = numberField(line, 3, "corridor length");
    if (rangeNm !== undefined && rangeNm > 0) result.rangeNm = rangeNm;
  }
  if (line.fields[4]) {
    const xteNm = numberField(line, 4, "corridor half width");
    if (xteNm !== undefined && xteNm > 0) result.xteNm = xteNm;
  }
  if (line.fields[5] && line.fields[6]) {
    const end = coordinateFrom(line, 5, 6, "threshold");
    if (end) {
      const mercator = toMercator(end);
      if (mercator) result.end = { x: mercator[0], y: mercator[1] };
    }
  }
  if (line.fields[7]) {
    const courseT = numberField(line, 7, "approach course");
    if (courseT !== undefined) result.courseT = courseT;
  }
  return result;
}

function parallelOperation(block: TopSkyBlock): ParallelOperation | null {
  const line = block.header;
  const icao = (line.fields[1] ?? "").trim().toUpperCase();
  const first = runwayWithAlt(line.fields[2]);
  const second = runwayWithAlt(line.fields[3]);
  if (!icao || !first.runway || !second.runway) {
    warn(line, "SOIR needs an ICAO and two runways");
    return null;
  }

  const result: ParallelOperation = {
    icao,
    left: { runway: first.runway.toUpperCase(), approachAltFt: first.approachAltFt },
    right: { runway: second.runway.toUpperCase(), approachAltFt: second.approachAltFt },
    rangeNm: DEFAULT_SOIR_RANGE_NM,
    widthInNm: DEFAULT_NOZ_NM,
    widthOutNm: DEFAULT_NOZ_NM,
    departure: false,
  };

  if (line.fields[4]) {
    const rangeNm = numberField(line, 4, "zone length");
    if (rangeNm !== undefined && rangeNm > 0) result.rangeNm = rangeNm;
  }
  if (line.fields[5]) {
    const widthInNm = numberField(line, 5, "inner half width");
    if (widthInNm !== undefined && widthInNm > 0) result.widthInNm = widthInNm;
  }
  if (line.fields[6]) {
    const widthOutNm = numberField(line, 6, "outer half width");
    if (widthOutNm !== undefined && widthOutNm > 0) result.widthOutNm = widthOutNm;
  }

  for (const child of block.lines) {
    switch (child.keyword) {
      case "DEPARTURE":
        result.departure = true;
        break;
      case "CRS1": {
        const courseT = numberField(child, 1, "first approach course");
        if (courseT !== undefined) result.left.courseT = courseT;
        break;
      }
      case "CRS2": {
        const courseT = numberField(child, 1, "second approach course");
        if (courseT !== undefined) result.right.courseT = courseT;
        break;
      }
      case "NOZ1":
      case "NOZ2":
      case "NTZ":
        break;
      default:
        warn(child, `unknown SOIR property "${child.keyword}"`);
        break;
    }
  }

  result.left.noz = polygonFrom(block.lines, "NOZ1");
  result.right.noz = polygonFrom(block.lines, "NOZ2");
  result.ntz = polygonFrom(block.lines, "NTZ");
  return result;
}

export function parseStcaRunways(file: string, content: string): StcaRunwaysResult {
  const result: StcaRunwaysResult = { finalApproaches: [], parallelOperations: [] };

  const lines = lex(file, content);
  const grouped = blocks(lines, ["FINALAPP", "SOIR"]);
  for (const line of grouped.preamble) {
    warn(line, `line before the first FINALAPP or SOIR block is dropped ("${line.keyword}")`);
  }

  for (const block of grouped.blocks) {
    if (block.header.keyword === "FINALAPP") {
      const parsed = finalApproach(block);
      if (parsed) result.finalApproaches.push(parsed);
      for (const child of block.lines) {
        if (child.keyword !== "FINALAPP") {
          warn(child, `FINALAPP carries no properties; "${child.keyword}" is dropped`);
        }
      }
      continue;
    }
    const parsed = parallelOperation(block);
    if (parsed) result.parallelOperations.push(parsed);
  }
  return result;
}

export function buildStcaRunwaysDataset(result: StcaRunwaysResult): StcaRunwaysDataset {
  return {
    $schema: STCA_RUNWAYS_SCHEMA,
    name: "Runway-derived STCA regions converted from TopSkySTCA.txt",
    finalApproaches: result.finalApproaches,
    parallelOperations: result.parallelOperations,
  };
}
