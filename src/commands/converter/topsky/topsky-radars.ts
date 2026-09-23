import { LatLon, parseLatLon } from "./topsky-coords";
import { blocks, lex, numberField, TopSkyBlock, TopSkyLine, warn } from "./topsky-lexer";
import { RadarSection, RadarStation, RawVideoStation } from "../../../helper/radars";

// The Developer Guide's defaults for an omitted line.
const DEFAULT_BEAMWIDTH_DEG = 1.5;
const DEFAULT_PULSEWIDTH_US = 1.0;
const DEFAULT_MAXANGLE_DEG = 90;

// Two stations closer than this are the same antenna under two spellings, which is how the UK
// file's "Alanshill" meets the ESE's "Allanshill".
const MATCH_DISTANCE_M = 500;

const EARTH_RADIUS_M = 6378137;

export interface TopSkyRadar {
  name: string;
  location: LatLon;
  rawVideo: RawVideoStation;
  // The RADAR line, so the merge can warn against the station's own place in the file.
  at: TopSkyLine;
}

export interface RadarsMergeResult {
  parsed: TopSkyRadar[];
  matchedByName: number;
  matchedByLocation: number;
  added: number;
  terrainLinesDropped: number;
}

function metresBetween(a: LatLon, b: LatLon): number {
  const meanLat = ((a.lat + b.lat) / 2) * (Math.PI / 180);
  const north = (b.lat - a.lat) * (Math.PI / 180) * EARTH_RADIUS_M;
  const east = (b.lon - a.lon) * (Math.PI / 180) * EARTH_RADIUS_M * Math.cos(meanLat);
  return Math.hypot(north, east);
}

function radar(block: TopSkyBlock, result: RadarsMergeResult): TopSkyRadar | null {
  const name = (block.header.fields[1] ?? "").trim();
  if (!name) {
    warn(block.header, "RADAR block has no station name");
    return null;
  }

  let location: LatLon | null = null;
  const rawVideo: RawVideoStation = {
    beamwidthDeg: DEFAULT_BEAMWIDTH_DEG,
    pulseWidthUs: DEFAULT_PULSEWIDTH_US,
    maxAngleDeg: DEFAULT_MAXANGLE_DEG,
    positions: [],
  };

  for (const line of block.lines) {
    switch (line.keyword) {
      case "POSITIONS":
        rawVideo.positions = line.fields
          .slice(1)
          .map((prefix) => prefix.trim())
          .filter((prefix) => prefix.length > 0);
        break;
      case "LOCATION":
        location = parseLatLon(line.fields[1], line.fields[2]);
        if (!location) warn(line, `station "${name}" has an unreadable LOCATION`);
        break;
      case "ALTITUDE": {
        const altitude = numberField(line, 1, "antenna altitude");
        if (altitude !== undefined) rawVideo.antennaAltitudeFt = altitude;
        break;
      }
      case "BEAMWIDTH": {
        const beamwidth = numberField(line, 1, "beamwidth");
        if (beamwidth !== undefined && beamwidth > 0) rawVideo.beamwidthDeg = beamwidth;
        break;
      }
      case "PULSEWIDTH": {
        const pulse = numberField(line, 1, "pulse width");
        if (pulse !== undefined && pulse > 0) rawVideo.pulseWidthUs = pulse;
        break;
      }
      case "MAXANGLE": {
        const angle = numberField(line, 1, "maximum elevation angle");
        if (angle !== undefined && angle > 0) rawVideo.maxAngleDeg = angle;
        break;
      }
      case "RANGE": {
        const min = numberField(line, 1, "minimum range");
        const max = numberField(line, 2, "maximum range");
        if (min !== undefined && min > 0) rawVideo.minRangeNm = min;
        if (max !== undefined && max > 0) rawVideo.maxRangeNm = max;
        break;
      }
      case "CEILING": {
        const ceiling = numberField(line, 1, "detection ceiling");
        if (ceiling !== undefined && ceiling > 0) rawVideo.ceilingFt = ceiling;
        break;
      }
      case "NOTERRAIN":
      case "TERRAIN":
        // Terrain masking stays the ESE HOLE polygons' job; radars.json already carries them and
        // RadarCoverageIndex already gates on them. Counted so the run says how many were dropped.
        result.terrainLinesDropped++;
        break;
      default:
        warn(line, `unknown RADAR property "${line.keyword}"`);
        break;
    }
  }

  if (!location) {
    warn(block.header, `station "${name}" has no LOCATION and cannot be matched to a radars.json station`);
    return null;
  }
  if (rawVideo.positions.length === 0) {
    warn(block.header, `station "${name}" has no POSITIONS, so no login callsign will ever select it`);
  }
  return { name, location, rawVideo, at: block.header };
}

export function parseTopSkyRadars(file: string, content: string): RadarsMergeResult {
  const result: RadarsMergeResult = {
    parsed: [],
    matchedByName: 0,
    matchedByLocation: 0,
    added: 0,
    terrainLinesDropped: 0,
  };

  const lines = lex(file, content);
  const grouped = blocks(lines, ["RADAR"]);
  for (const line of grouped.preamble) {
    warn(line, `line before the first RADAR block is dropped ("${line.keyword}")`);
  }

  const seen: TopSkyRadar[] = [];
  for (const block of grouped.blocks) {
    const parsed = radar(block, result);
    if (!parsed) continue;

    // The UK file has one copy-paste error, Pease Pottage at Perwinnes' coordinates, and it would
    // otherwise merge the second station's raw video onto the first.
    const twin = seen.find((other) => metresBetween(other.location, parsed.location) < MATCH_DISTANCE_M);
    if (twin) {
      warn(
        block.header,
        `station "${parsed.name}" shares a LOCATION with "${twin.name}"; one of the two coordinates is wrong`
      );
    }
    seen.push(parsed);
    result.parsed.push(parsed);
  }
  return result;
}

/**
 * Merges the parsed raw video blocks onto the ESE stations already in the section, by NAME first
 * and then by location within 500 m, which is what pairs the UK file's "Alanshill" with the ESE's
 * "Allanshill". A TopSky station matching nothing is added with no coverage sensors and a warning:
 * it can size a return but it cannot decide whether one is seen at all.
 */
export function mergeRawVideo(section: RadarSection, parsed: RadarsMergeResult): RadarsMergeResult {
  for (const station of parsed.parsed) {
    const byName = section.stations.find(
      (other) => other.name.trim().toLowerCase() === station.name.trim().toLowerCase()
    );
    if (byName) {
      byName.rawVideo = station.rawVideo;
      parsed.matchedByName++;
      continue;
    }

    const byLocation = section.stations.find(
      (other) =>
        metresBetween({ lat: other.latitude, lon: other.longitude }, station.location) < MATCH_DISTANCE_M
    );
    if (byLocation) {
      byLocation.rawVideo = station.rawVideo;
      parsed.matchedByLocation++;
      continue;
    }

    // Loud, because this is usually a typo rather than a station the ESE lacks: it will size the
    // raw video of every login its prefixes match, from wherever the coordinates put it.
    warn(
      station.at,
      `station "${station.name}" matches no radars.json station by name or within ${MATCH_DISTANCE_M} m of ` +
        `${station.location.lat.toFixed(4)}, ${station.location.lon.toFixed(4)}; added with NO coverage sensors. ` +
        `Check the LOCATION against the ESE [RADAR] section before trusting it`
    );
    const added: RadarStation = {
      name: station.name,
      latitude: station.location.lat,
      longitude: station.location.lon,
      rawVideo: station.rawVideo,
    };
    section.stations.push(added);
    parsed.added++;
  }
  return parsed;
}
