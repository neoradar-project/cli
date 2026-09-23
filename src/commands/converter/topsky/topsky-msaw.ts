import {
  coordinateFrom,
  densifyCircle,
  densifyWedge,
  LatLon,
  parseLatLon,
  ringToPolygon,
} from "./topsky-coords";
import { lex, numberField, TopSkyLine, warn } from "./topsky-lexer";

export const MSAW_DATASET_FILE = "msaw.geojson";

const MSAW_SCHEMA =
  "https://raw.githubusercontent.com/neoradar-project/schemas/refs/heads/main/datasets/msaw.schema.json";

// Where the record came from. The client resolves an overlap HIGHEST WINS rather than by read
// order, so this is description, not precedence; `order` keeps what TopSky would have chosen.
export type MsaSource = "smaa" | "grid" | "floor";

// A dropped trailing zero is what this looks for: the UK file has a 3.2 NM circle at Gatwick
// reading 210 where every neighbour reads 2100. Low values that ARE a round hundred are real
// (the UK has two dozen coastal areas at 100 and 200 ft), so only a low value that is not one
// is worth an author's eye, which keeps the warning from crying wolf 29 times a run.
const SUSPICIOUS_MSA_FT = 300;
const ROUND_HUNDRED = 100;

// A polygon whose bounding box spans a whole degree or more is a FIR floor rather than a
// per-airport surveillance minimum area.
const FLOOR_SPAN_DEGREES = 1;

const CIRCLE_SPACING_DEGREES = 5;

export interface MsawResult {
  features: GeoJSON.Feature[];
  counts: { polygons: number; circles: number; wedges: number; boxes: number; gridCells: number };
}

export interface MsawDataset extends GeoJSON.FeatureCollection {
  $schema: string;
  name: string;
}

function feature(
  polygon: GeoJSON.Polygon,
  msaFt: number,
  source: MsaSource,
  order: number,
  label: string
): GeoJSON.Feature {
  return {
    type: "Feature",
    geometry: polygon,
    properties: { msaFt, source, order, label },
  };
}

function spanOf(ring: LatLon[]): number {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const point of ring) {
    minLat = Math.min(minLat, point.lat);
    maxLat = Math.max(maxLat, point.lat);
    minLon = Math.min(minLon, point.lon);
    maxLon = Math.max(maxLon, point.lon);
  }
  return Math.max(maxLat - minLat, maxLon - minLon);
}

function checkMsa(line: TopSkyLine, msaFt: number): void {
  if (msaFt < SUSPICIOUS_MSA_FT && msaFt % ROUND_HUNDRED !== 0) {
    warn(
      line,
      `minimum safe altitude ${msaFt} ft is under ${SUSPICIOUS_MSA_FT} and is not a round hundred; a dropped trailing zero looks exactly like this`
    );
  }
}

function push(
  result: MsawResult,
  line: TopSkyLine,
  ring: LatLon[],
  msaFt: number,
  source: MsaSource,
  order: number
): boolean {
  const polygon = ringToPolygon(ring);
  if (!polygon) {
    warn(line, "record has fewer than three distinct vertices and is not an area");
    return false;
  }
  checkMsa(line, msaFt);
  result.features.push(feature(polygon, msaFt, source, order, line.comment));
  return true;
}

// P:<n>:<lat>:<lon> x n:<msaFt>. The vertex count is authoritative, so a line carrying more or
// fewer pairs than it declares is a malformed record rather than a silent truncation.
function polygon(result: MsawResult, line: TopSkyLine, order: number): void {
  const count = numberField(line, 1, "vertex count");
  if (count === undefined || count < 3) {
    warn(line, `P record declares ${line.fields[1]} vertices, which is not an area`);
    return;
  }

  const expected = 2 + count * 2 + 1;
  if (line.fields.length !== expected) {
    warn(line, `P record declares ${count} vertices but carries ${line.fields.length - 3} coordinate fields`);
    return;
  }

  const ring: LatLon[] = [];
  for (let i = 0; i < count; i++) {
    const point = parseLatLon(line.fields[2 + i * 2], line.fields[3 + i * 2]);
    if (!point) {
      warn(line, `vertex ${i + 1} "${line.fields[2 + i * 2]}:${line.fields[3 + i * 2]}" is not a coordinate`);
      return;
    }
    ring.push(point);
  }

  const msaFt = Number(line.fields[expected - 1]);
  if (!Number.isFinite(msaFt)) {
    warn(line, `minimum safe altitude "${line.fields[expected - 1]}" is not a number`);
    return;
  }

  const source: MsaSource = spanOf(ring) >= FLOOR_SPAN_DEGREES ? "floor" : "smaa";
  if (push(result, line, ring, msaFt, source, order)) result.counts.polygons++;
}

// C:<lat>:<lon>:<radiusNm>:<msaFt>
function circle(result: MsawResult, line: TopSkyLine, order: number): void {
  const centre = coordinateFrom(line, 1, 2, "circle centre");
  if (!centre) return;
  const radiusNm = numberField(line, 3, "circle radius");
  const msaFt = numberField(line, 4, "minimum safe altitude");
  if (radiusNm === undefined || msaFt === undefined) return;
  if (radiusNm <= 0) {
    warn(line, `circle radius ${radiusNm} is not positive`);
    return;
  }
  if (push(result, line, densifyCircle(centre, radiusNm, CIRCLE_SPACING_DEGREES), msaFt, "smaa", order)) {
    result.counts.circles++;
  }
}

// S:<lat>:<lon>:<bearing1>:<bearing2>:<rMinNm>:<rMaxNm>:<msaFt>, clockwise from bearing 1, true.
// No UK record uses one; the Developer Guide still defines it, so it is read.
function wedge(result: MsawResult, line: TopSkyLine, order: number): void {
  const centre = coordinateFrom(line, 1, 2, "sector centre");
  if (!centre) return;
  const bearing1 = numberField(line, 3, "first bearing");
  const bearing2 = numberField(line, 4, "second bearing");
  const innerNm = numberField(line, 5, "inner radius");
  const outerNm = numberField(line, 6, "outer radius");
  const msaFt = numberField(line, 7, "minimum safe altitude");
  if (bearing1 === undefined || bearing2 === undefined) return;
  if (innerNm === undefined || outerNm === undefined || msaFt === undefined) return;
  if (outerNm <= innerNm) {
    warn(line, `sector outer radius ${outerNm} is not beyond its inner radius ${innerNm}`);
    return;
  }
  const ring = densifyWedge(centre, bearing1, bearing2, innerNm, outerNm, CIRCLE_SPACING_DEGREES);
  if (push(result, line, ring, msaFt, "smaa", order)) result.counts.wedges++;
}

// A:<latMin>:<latMax>:<lonMin>:<lonMax>:<msaFt>. Commented out in the UK file, kept because the
// grammar allows it and another vAcc may use it.
function box(result: MsawResult, line: TopSkyLine, order: number): void {
  const latMin = numberField(line, 1, "minimum latitude");
  const latMax = numberField(line, 2, "maximum latitude");
  const lonMin = numberField(line, 3, "minimum longitude");
  const lonMax = numberField(line, 4, "maximum longitude");
  const msaFt = numberField(line, 5, "minimum safe altitude");
  if (latMin === undefined || latMax === undefined) return;
  if (lonMin === undefined || lonMax === undefined || msaFt === undefined) return;

  const ring: LatLon[] = [
    { lat: latMin, lon: lonMin },
    { lat: latMax, lon: lonMin },
    { lat: latMax, lon: lonMax },
    { lat: latMin, lon: lonMax },
  ];
  const source: MsaSource = spanOf(ring) >= FLOOR_SPAN_DEGREES ? "floor" : "smaa";
  if (push(result, line, ring, msaFt, source, order)) result.counts.boxes++;
}

// L:<latMin>:<lonMin>:<dLat>:<dLon>:<n>:<msa1>:...:<msaN>. One row of the AIP ENR 6-81 Area
// Minimum Altitude grid: n cells running WEST to EAST from the row's own south-west corner.
function gridRow(result: MsawResult, line: TopSkyLine, order: number): void {
  const latMin = numberField(line, 1, "row south edge");
  const lonMin = numberField(line, 2, "row west edge");
  const dLat = numberField(line, 3, "cell height");
  const dLon = numberField(line, 4, "cell width");
  const count = numberField(line, 5, "cell count");
  if (latMin === undefined || lonMin === undefined) return;
  if (dLat === undefined || dLon === undefined || count === undefined) return;
  if (dLat <= 0 || dLon <= 0 || count < 1) {
    warn(line, "L row has a non-positive cell size or no cells");
    return;
  }
  if (line.fields.length !== 6 + count) {
    warn(line, `L row declares ${count} cells but carries ${line.fields.length - 6} altitudes`);
    return;
  }

  for (let i = 0; i < count; i++) {
    const msaFt = Number(line.fields[6 + i]);
    if (!Number.isFinite(msaFt)) {
      warn(line, `cell ${i + 1} altitude "${line.fields[6 + i]}" is not a number`);
      continue;
    }
    const west = lonMin + i * dLon;
    const ring: LatLon[] = [
      { lat: latMin, lon: west },
      { lat: latMin + dLat, lon: west },
      { lat: latMin + dLat, lon: west + dLon },
      { lat: latMin, lon: west + dLon },
    ];
    if (push(result, line, ring, msaFt, "grid", order)) result.counts.gridCells++;
  }
}

export function parseMsaw(file: string, content: string): MsawResult {
  const result: MsawResult = {
    features: [],
    counts: { polygons: 0, circles: 0, wedges: 0, boxes: 0, gridCells: 0 },
  };

  const lines = lex(file, content);
  for (let order = 0; order < lines.length; order++) {
    const line = lines[order];
    switch (line.keyword) {
      case "P":
        polygon(result, line, order);
        break;
      case "C":
        circle(result, line, order);
        break;
      case "S":
        wedge(result, line, order);
        break;
      case "A":
        box(result, line, order);
        break;
      case "L":
        gridRow(result, line, order);
        break;
      default:
        warn(line, `unknown MSAW record "${line.keyword}"`);
        break;
    }
  }
  return result;
}

export function buildMsawDataset(result: MsawResult): MsawDataset {
  return {
    $schema: MSAW_SCHEMA,
    name: "Minimum safe altitude surface converted from TopSkyMSAW.txt",
    type: "FeatureCollection",
    features: result.features,
  };
}
