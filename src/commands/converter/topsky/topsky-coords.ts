import { toMercator as turfToMercator } from "@turf/projection";
import { geoHelper } from "../../../helper/geo-helper";
import { TopSkyLine, warn } from "./topsky-lexer";

export interface LatLon {
  lat: number;
  lon: number;
}

// EPSG:3857 metres, the frame every package dataset is in.
export type Mercator = [number, number];

const SEXAGESIMAL = /^[NSEW]\d/i;
const NM_TO_DEGREES_LATITUDE = 1 / 60;

// A TopSky coordinate is either sexagesimal (N051.18.18.000) or plain decimal degrees; the UK MSAW
// file uses both, 117 records one way and 171 the other. Returns null without warning; the caller
// names the record.
export function parseLatLon(latText: string, lonText: string): LatLon | null {
  const lat = (latText ?? "").trim();
  const lon = (lonText ?? "").trim();
  if (!lat || !lon) return null;

  if (SEXAGESIMAL.test(lat) || SEXAGESIMAL.test(lon)) {
    const parsed = geoHelper.convertESEGeoCoordinates(lat, lon);
    if (!parsed) return null;
    return { lat: parsed.lat, lon: parsed.lon };
  }

  const latitude = Number(lat);
  const longitude = Number(lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { lat: latitude, lon: longitude };
}

// The sector file's REGIONS shape: one field holding "lat lon" separated by spaces.
export function parseSpacedLatLon(text: string): LatLon | null {
  const parts = (text ?? "").trim().split(/\s+/);
  if (parts.length !== 2) return null;
  return parseLatLon(parts[0], parts[1]);
}

// The projection is done here rather than through geoHelper, whose Cartesian converter only reads
// the ESE sexagesimal form; by this point every coordinate is already decimal degrees.
export function toMercator(point: LatLon): Mercator | null {
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lon)) return null;
  if (Math.abs(point.lat) > 89.9 || Math.abs(point.lon) > 180) return null;
  const projected = turfToMercator([point.lon, point.lat]) as [number, number];
  if (!Number.isFinite(projected[0]) || !Number.isFinite(projected[1])) return null;
  return [projected[0], projected[1]];
}

// A coordinate pair from two fields of a line, warning on the line when it cannot be read.
export function coordinateFrom(
  line: TopSkyLine,
  latIndex: number,
  lonIndex: number,
  what: string
): LatLon | null {
  const point = parseLatLon(line.fields[latIndex], line.fields[lonIndex]);
  if (!point) {
    warn(line, `${what} "${line.fields[latIndex]}:${line.fields[lonIndex]}" is not a coordinate`);
    return null;
  }
  return point;
}

// Longitude degrees per nautical mile at this latitude, so a radius in miles becomes a ring that
// is round on the ground rather than round in degrees.
function longitudeScale(latitudeDeg: number): number {
  const cos = Math.cos((latitudeDeg * Math.PI) / 180);
  return NM_TO_DEGREES_LATITUDE / Math.max(cos, 1e-6);
}

// A circle as TopSky draws it: a vertex every `spacingDeg` degrees of bearing, closed. The client
// tests the circle itself where the block gave one, so this ring is the drawing.
export function densifyCircle(
  centre: LatLon,
  radiusNm: number,
  spacingDeg: number
): LatLon[] {
  const step = spacingDeg > 0 && spacingDeg <= 120 ? spacingDeg : 5;
  const lonPerNm = longitudeScale(centre.lat);
  const ring: LatLon[] = [];
  for (let bearing = 0; bearing < 360; bearing += step) {
    const radians = (bearing * Math.PI) / 180;
    ring.push({
      lat: centre.lat + radiusNm * NM_TO_DEGREES_LATITUDE * Math.cos(radians),
      lon: centre.lon + radiusNm * lonPerNm * Math.sin(radians),
    });
  }
  return ring;
}

// The MSAW `S:` record: the wedge between two true bearings, clockwise from the first, between an
// inner and an outer radius. No UK record uses one, and the Developer Guide still defines it.
export function densifyWedge(
  centre: LatLon,
  bearing1Deg: number,
  bearing2Deg: number,
  innerNm: number,
  outerNm: number,
  spacingDeg = 5
): LatLon[] {
  const lonPerNm = longitudeScale(centre.lat);
  const sweep = ((bearing2Deg - bearing1Deg + 360) % 360) || 360;
  const steps = Math.max(1, Math.ceil(sweep / spacingDeg));
  const at = (bearingDeg: number, radiusNm: number): LatLon => {
    const radians = (bearingDeg * Math.PI) / 180;
    return {
      lat: centre.lat + radiusNm * NM_TO_DEGREES_LATITUDE * Math.cos(radians),
      lon: centre.lon + radiusNm * lonPerNm * Math.sin(radians),
    };
  };

  const ring: LatLon[] = [];
  for (let i = 0; i <= steps; i++) {
    ring.push(at(bearing1Deg + (sweep * i) / steps, outerNm));
  }
  if (innerNm > 0) {
    for (let i = steps; i >= 0; i--) {
      ring.push(at(bearing1Deg + (sweep * i) / steps, innerNm));
    }
  } else {
    ring.push(centre);
  }
  return ring;
}

// A ring of WGS84 points to a closed GeoJSON polygon in EPSG:3857. Returns null when fewer than
// three distinct vertices survive, which is not an area.
export function ringToPolygon(ring: LatLon[]): GeoJSON.Polygon | null {
  const projected: Mercator[] = [];
  for (const point of ring) {
    const mercator = toMercator(point);
    if (!mercator) return null;
    const last = projected[projected.length - 1];
    if (last && last[0] === mercator[0] && last[1] === mercator[1]) continue;
    projected.push(mercator);
  }
  if (projected.length < 3) return null;

  const first = projected[0];
  const last = projected[projected.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) projected.push([first[0], first[1]]);
  if (projected.length < 4) return null;

  return { type: "Polygon", coordinates: [projected] };
}
