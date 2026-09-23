import { ActivationRule, foldSchedules, parseActive } from "./topsky-active";
import {
  coordinateFrom,
  densifyCircle,
  LatLon,
  parseSpacedLatLon,
  ringToPolygon,
  toMercator,
} from "./topsky-coords";
import { blocks, lex, numberField, TopSkyBlock, TopSkyLine, warn } from "./topsky-lexer";

export const AREAS_DATASET_FILE = "areas.geojson";

const AREAS_SCHEMA =
  "https://raw.githubusercontent.com/neoradar-project/schemas/refs/heads/main/datasets/areas.schema.json";

// The area's job. The digit on an AREA line is a border colour and F means filled, both display
// only, so every one of them is a TSA area the proximity nets probe.
export type AreaKind = "tsa" | "stcaInhibit" | "mtcdInhibit" | "clamRamInhibit";

// The nets an area switches off inside itself while it is active.
export type AreaInhibit = "msaw" | "aiw" | "apw" | "sap" | "clamRam";

const INHIBIT_KEYWORDS: Record<string, AreaInhibit> = {
  NOMSAW: "msaw",
  NOAIW: "aiw",
  NOAPW: "apw",
  NOSAP: "sap",
  NOCLAMRAM: "clamRam",
};

// LIMITS is in HUNDREDS of feet; absent means the whole column while the area is active.
const HUNDREDS = 100;
const DEFAULT_LOWER_FT = 0;
const DEFAULT_UPPER_FT = 999999;

const CIRCLE_SPACING_DEGREES = 5;
const METRES_PER_NM = 1852;

export interface AreasResult {
  features: GeoJSON.Feature[];
  counts: {
    areas: number;
    circles: number;
    withSchedules: number;
    withAup: number;
    foldedSchedules: number;
    partialSchedules: number;
  };
}

export interface AreasDataset extends GeoJSON.FeatureCollection {
  $schema: string;
  name: string;
}

function kindOf(line: TopSkyLine): AreaKind | null {
  const type = (line.fields[1] ?? "").trim().toUpperCase();
  if (type === "M") return "mtcdInhibit";
  if (type === "S") return "stcaInhibit";
  if (type === "DD") return "clamRamInhibit";
  if (type === "T" || /^[1-5]F?$/.test(type)) return "tsa";
  warn(line, `AREA type "${line.fields[1]}" is not one of T, 1 to 5, 1F to 5F, M, S or DD`);
  return null;
}

// A COORD line is either COORD:<lat>:<lon> or the sector file's REGIONS shape, one field holding
// "lat lon". Both appear in the wild, so both are read.
function coordOf(line: TopSkyLine): LatLon | null {
  if (line.fields.length >= 3) return coordinateFrom(line, 1, 2, "vertex");
  const spaced = parseSpacedLatLon(line.fields[1] ?? "");
  if (!spaced) {
    warn(line, `vertex "${line.fields[1] ?? ""}" is not a coordinate`);
    return null;
  }
  return spaced;
}

function bufferTriple(line: TopSkyLine): [number, number, number] | undefined {
  const above = numberField(line, 1, "buffer above the separation level");
  const belowIfr = numberField(line, 2, "buffer below it for IFR");
  const belowVfr = numberField(line, 3, "buffer below it for VFR");
  if (above === undefined || belowIfr === undefined || belowVfr === undefined) return undefined;
  return [above, belowIfr, belowVfr];
}

function area(block: TopSkyBlock, zone: string, result: AreasResult): void {
  const kind = kindOf(block.header);
  if (!kind) return;

  const name = (block.header.fields[2] ?? "").trim();
  if (!name) {
    warn(block.header, "AREA has no name, so nothing could reference it");
    return;
  }

  const properties: Record<string, unknown> = { name, kind };
  const activation: ActivationRule[] = [];
  const inhibits: AreaInhibit[] = [];
  const ring: LatLon[] = [];
  let circleRing: LatLon[] | null = null;
  let boundCircle: { x: number; y: number; radiusM: number } | null = null;
  let lowerFt = DEFAULT_LOWER_FT;
  let upperFt = DEFAULT_UPPER_FT;

  for (const line of block.lines) {
    if (INHIBIT_KEYWORDS[line.keyword]) {
      inhibits.push(INHIBIT_KEYWORDS[line.keyword]);
      continue;
    }

    switch (line.keyword) {
      case "CATEGORY":
        properties.category = (line.fields[1] ?? "").trim();
        break;
      case "GROUP":
        // Plugin type A only; nothing in a dataset reads it.
        break;
      case "USERTEXT":
        properties.userText = line.fields.slice(1).join(":").trim();
        break;
      case "LABEL": {
        const at = coordinateFrom(line, 1, 2, "label position");
        const text = line.fields.slice(3).join(":").trim();
        if (at) {
          const mercator = toMercator(at);
          if (mercator) properties.label = { x: mercator[0], y: mercator[1], text };
        }
        break;
      }
      case "LIMITS": {
        const lower = numberField(line, 1, "lower limit");
        const upper = numberField(line, 2, "upper limit");
        if (lower !== undefined) lowerFt = lower * HUNDREDS;
        if (upper !== undefined) upperFt = upper * HUNDREDS;
        break;
      }
      case "ELEVATION": {
        const min = numberField(line, 1, "minimum ground elevation");
        const max = numberField(line, 2, "maximum ground elevation");
        if (min !== undefined) properties.elevationMinFt = min * HUNDREDS;
        if (max !== undefined) properties.elevationMaxFt = max * HUNDREDS;
        break;
      }
      case "BOUND": {
        // BOUND:C:<lat>:<lon>:<radiusNm>: the containment test the client runs, where the COORD
        // lines beside it only draw.
        if ((line.fields[1] ?? "").trim().toUpperCase() !== "C") {
          warn(line, "only BOUND:C is defined");
          break;
        }
        const centre = coordinateFrom(line, 2, 3, "bound centre");
        const radiusNm = numberField(line, 4, "bound radius");
        if (centre && radiusNm !== undefined && radiusNm > 0) {
          const mercator = toMercator(centre);
          if (mercator) boundCircle = { x: mercator[0], y: mercator[1], radiusM: radiusNm * METRES_PER_NM };
        }
        break;
      }
      case "CIRCLE": {
        const centre = coordinateFrom(line, 1, 2, "circle centre");
        const radiusNm = numberField(line, 3, "circle radius");
        const spacing = line.fields[4] ? Number(line.fields[4]) : CIRCLE_SPACING_DEGREES;
        if (!centre || radiusNm === undefined || radiusNm <= 0) break;
        if (ring.length > 0) {
          warn(line, "CIRCLE and COORD never appear on the same area; the COORD ring is dropped");
          ring.length = 0;
        }
        circleRing = densifyCircle(centre, radiusNm, Number.isFinite(spacing) ? spacing : CIRCLE_SPACING_DEGREES);
        const mercator = toMercator(centre);
        if (mercator && !boundCircle) {
          boundCircle = { x: mercator[0], y: mercator[1], radiusM: radiusNm * METRES_PER_NM };
        }
        result.counts.circles++;
        break;
      }
      case "COORD": {
        if (circleRing) {
          warn(line, "COORD after a CIRCLE on the same area is dropped");
          break;
        }
        const point = coordOf(line);
        if (point) ring.push(point);
        break;
      }
      case "ACTIVE": {
        const rule = parseActive(line);
        if (rule) activation.push(rule);
        break;
      }
      case "APW_BUFFER_LAT":
        properties.apwBufferLatNm = bufferTriple(line);
        break;
      case "APW_BUFFER_VERT":
        properties.apwBufferVertFt = bufferTriple(line);
        break;
      case "SAP_BUFFER_LAT":
        properties.sapBufferLatNm = bufferTriple(line);
        break;
      case "SAP_BUFFER_VERT":
        properties.sapBufferVertFt = bufferTriple(line);
        break;
      default:
        warn(line, `unknown AREA property "${line.keyword}"`);
        break;
    }
  }

  const polygon = ringToPolygon(circleRing ?? ring);
  if (!polygon) {
    warn(block.header, `area "${name}" has no usable geometry and is dropped`);
    return;
  }

  const folded = foldSchedules(activation, zone);
  result.counts.foldedSchedules += folded.folded;
  result.counts.partialSchedules += folded.partial;
  if (folded.partial > 0) {
    warn(
      block.header,
      `area "${name}" has ${folded.partial} schedule range(s) that do not match across the periods once converted to ${zone}, so they are kept as the UTC the file wrote and will need the yearly edit`
    );
  }

  properties.lowerFt = lowerFt;
  properties.upperFt = upperFt;
  if (inhibits.length > 0) properties.inhibits = inhibits;
  if (boundCircle) properties.circle = boundCircle;
  properties.activation = folded.rules;

  if (folded.rules.some((rule) => rule.kind === "schedule")) result.counts.withSchedules++;
  if (folded.rules.some((rule) => rule.kind === "aup")) result.counts.withAup++;
  if (folded.rules.length === 0) {
    warn(block.header, `area "${name}" has no ACTIVE rule, so it is inactive until a controller activates it`);
  }

  for (const key of Object.keys(properties)) {
    if (properties[key] === undefined) delete properties[key];
  }

  result.features.push({ type: "Feature", geometry: polygon, properties });
  result.counts.areas++;
}

export function parseAreas(file: string, content: string, zone: string): AreasResult {
  const result: AreasResult = {
    features: [],
    counts: { areas: 0, circles: 0, withSchedules: 0, withAup: 0, foldedSchedules: 0, partialSchedules: 0 },
  };

  const lines = lex(file, content);
  const grouped = blocks(lines, ["AREA"]);
  for (const line of grouped.preamble) {
    // CATEGORYDEF is colours, patterns and label switches; the package's map style owns those and
    // keys them on areaActive instead.
    if (line.keyword !== "CATEGORYDEF") {
      warn(line, `line before the first AREA block is dropped ("${line.keyword}")`);
    }
  }
  for (const block of grouped.blocks) area(block, zone, result);
  return result;
}

export function buildAreasDataset(result: AreasResult): AreasDataset {
  return {
    $schema: AREAS_SCHEMA,
    name: "Segregated and restricted areas converted from TopSkyAreas.txt",
    type: "FeatureCollection",
    features: result.features,
  };
}
