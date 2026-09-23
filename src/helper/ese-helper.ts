import { geoHelper } from "./geo-helper";
import * as turf from "@turf/turf";
import { toMercator } from "@turf/projection";
import { NseNavaid, PackageAtcPosition, PackageProcedure, Sector, SectorLine } from "../definitions/package-defs";
import { Copx } from "../definitions/package-atc-data";
import fs from "fs";
import { parseAtcPositionLine } from "../commands/converter/nse/atc-position-parser";
import { parseESEProcedure } from "../commands/converter/nse/procedure-parser";
import { logESEParsingError, logESEParsingWarning } from "./logger";
import { RadarSection, RadarSectionParser } from "./radars";

// CIRCLE_SECTORLINE renders as a regular polygon. 10 sides under-covered a 2.5nm tower zone by
// about 3 percent of its area; 64 is visually round at every radius the sector files use.
const CIRCLE_STEPS = 64;

export interface ParsedEseContent {
  position: PackageAtcPosition[];
  procedure: PackageProcedure[];
  sectors: Sector[];
  sectorLines: SectorLine[];
  copx: Copx[];
  radars: RadarSection;
}

interface SectorHandlerContext {
  currentSector: Sector;
  currentSectorLine: SectorLine;
  // False while currentSectorLine is the scratch object a skipped "Only" block writes onto.
  currentSectorLinePublished: boolean;
  baseMatrixInt: number;
  numericIDReplacementMatrix: Record<string, number>;
  processingNewSector: boolean;
  pendingSectorLineDisplayData: Array<{
    borderId: number;
    ownedVolume: string;
    compareVolumes: string[];
  }>;
  radar: RadarSectionParser;
}

export class EseHelper {
  private static isGNG: boolean = false;

  private static createEmptySector(): Sector {
    return {
      name: "",
      actives: [],
      owners: [],
      borders: [],
      depApts: [],
      arrApts: [],
      guests: [],
      floor: 0,
      ceiling: 0,
    };
  }

  private static createEmptySectorLine(): SectorLine {
    return {
      id: 0,
      points: [],
      displaySectorLines: [],
    };
  }

  static async parseEseContent(eseFilePath: string, allNavaids: NseNavaid[], isGNG: boolean = false): Promise<ParsedEseContent> {
    const lines = fs.readFileSync(eseFilePath, "utf8").split("\n");
    this.isGNG = isGNG;

    const result: ParsedEseContent = {
      position: [],
      procedure: [],
      sectors: [],
      sectorLines: [],
      copx: [],
      radars: { stations: [], holes: [] },
    };

    const context: SectorHandlerContext = {
      currentSector: this.createEmptySector(),
      currentSectorLine: this.createEmptySectorLine(),
      currentSectorLinePublished: false,
      baseMatrixInt: 690,
      numericIDReplacementMatrix: {},
      processingNewSector: false,
      pendingSectorLineDisplayData: [],
      radar: new RadarSectionParser(),
    };
    let currentSection = "";

    for (const rawLine of lines) {
      const line = this.cleanLine(rawLine);
      if (!this.isValidLine(line)) continue;

      if (this.isSectionHeader(line)) {
        if (currentSection === "AIRSPACE" && context.processingNewSector) {
          this.finalizeSector(context);
        }
        currentSection = this.extractSectionName(line);
        continue;
      }

      this.handleLine(line, currentSection, result, context, allNavaids);
    }

    if (context.processingNewSector) {
      this.finalizeSector(context);
    }

    this.processPendingSectorLineDisplayData(context, result);
    result.radars = context.radar.finish();

    return result;
  }

  private static handleLine(line: string, section: string, result: ParsedEseContent, context: SectorHandlerContext, allNavaids: NseNavaid[]): void {
    switch (section) {
      case "FREETEXT":
        break;
      case "POSITIONS":
        this.handlePosition(line, result);
        break;
      case "AIRSPACE":
        this.handleAirspace(line, result, context, allNavaids);
        break;
      case "RADAR":
        context.radar.handleLine(line);
        break;
      default:
        this.handleDefault(line, result);
        break;
    }
  }

  private static finalizeSector(context: SectorHandlerContext): void {
    if (context.currentSector.borders.length === 0) {
      logESEParsingWarning(`Sector "${context.currentSector.name}" has no borders defined`);
    }
    context.processingNewSector = false;
  }

  private static cleanLine(line: string): string {
    return line.replace(/[�\r]/g, "").trim();
  }

  private static isValidLine(line: string): boolean {
    return Boolean(line && !line.startsWith(";="));
  }

  private static isSectionHeader(line: string): boolean {
    return line.startsWith("[") && line.endsWith("]");
  }

  private static extractSectionName(line: string): string {
    return line.slice(1, -1);
  }

  private static handlePosition(line: string, result: ParsedEseContent): void {
    if (line.startsWith(";") || !line.trim()) return;

    const position = parseAtcPositionLine(line, this.isGNG);
    if (position) {
      result.position.push(position);
    } else {
      logESEParsingWarning(`Failed to parse ATC position line: "${line}"`);
    }
  }

  private static handleDefault(line: string, result: ParsedEseContent): void {
    const data = line.split(":");
    if (data.length >= 3 && this.isProcedure(data[0])) {
      this.handleProcedure(line, result);
    }
  }

  private static isProcedure(value: string): boolean {
    return value.includes("STAR") || value.includes("SID");
  }

  private static handleProcedure(line: string, result: ParsedEseContent): void {
    const proc = parseESEProcedure(line);
    if (proc) {
      result.procedure.push(proc);
    }
  }

  private static handleAirspace(line: string, result: ParsedEseContent, context: SectorHandlerContext, allNavaids: NseNavaid[]): void {
    const handlers: Record<string, () => void> = {
      SECTORLINE: () => this.handleSectorLine(line, result, context, allNavaids),
      CIRCLE_SECTORLINE: () => this.handleSectorLine(line, result, context, allNavaids),
      DISPLAY: () => this.handleDisplay(line, context),
      COORD: () => this.handleCoord(line, context),
      SECTOR: () => this.handleNewSector(line, result, context),
      OWNER: () => this.handleOwner(line, context),
      BORDER: () => this.handleBorder(line, context),
      DEPAPT: () => this.handleDepApt(line, context),
      ARRAPT: () => this.handleArrApt(line, context),
      ACTIVE: () => this.handleActive(line, context),
      GUEST: () => this.handleGuest(line, context),
      DISPLAY_SECTORLINE: () => this.handleDisplaySectorLine(line, context, result),
      COPX: () => this.handleCopx(line, result),
      FIR_COPX: () => this.handleCopx(line, result),
    };

    const prefix = line.split(":")[0];
    const handler = handlers[prefix];
    if (handler) {
      handler();
    }
  }

  private static handleSectorLine(line: string, result: ParsedEseContent, context: SectorHandlerContext, allNavaids: NseNavaid[]): void {
    const id = line.split(":")[1];

    // Same trap as handleNewSector, and worse here: handleCoord PUSHES, so a skipped block's
    // COORD lines would extend the previous sectorline's ring rather than replace anything.
    if (id.startsWith("Only") && !this.isGNG) {
      context.currentSectorLine = this.createEmptySectorLine();
      context.currentSectorLinePublished = false;
      return;
    }

    const numericId = this.getNumericId(id, context);
    context.currentSectorLine = {
      id: numericId,
      points: [],
      displaySectorLines: [],
    };
    context.currentSectorLinePublished = true;

    result.sectorLines.push(context.currentSectorLine);

    if (line.startsWith("CIRCLE_SECTORLINE:")) {
      this.handleCircleSectorLine(line, context, allNavaids);
    }
  }

  private static getNumericId(id: string, context: SectorHandlerContext): number {
    if (/^\d+$/.test(id)) {
      return Number(id);
    }

    if (!context.numericIDReplacementMatrix[id]) {
      context.numericIDReplacementMatrix[id] = context.baseMatrixInt++;
    }
    return context.numericIDReplacementMatrix[id];
  }

  private static handleCircleSectorLine(line: string, context: SectorHandlerContext, allNavaids: NseNavaid[]): void {
    const parts = line.split(":");
    const geo = this.getCircleCenter(parts, allNavaids);

    if (!geo || !this.isValidGeoCoord(geo)) {
      logESEParsingError(`Invalid or missing coordinates for circle sectorline: "${line}"`);
      return;
    }

    try {
      const radius = Number(parts[parts.length === 5 ? 4 : 3]);
      if (isNaN(radius)) {
        logESEParsingError(`Invalid radius for circle sectorline: "${line}" - radius: "${parts[parts.length === 5 ? 4 : 3]}"`);
        return;
      }

      const circle = turf.circle(turf.point([geo.lon, geo.lat]), radius, {
        steps: CIRCLE_STEPS,
        units: "nauticalmiles",
      });

      // turf emits GeoJSON [lon, lat] and toMercator takes [lon, lat]; passing it reversed is what
      // every other call site in this repo already gets right (geo-helper, asr, init-package).
      const circlePoints = circle.geometry.coordinates[0].map((coord: number[]) => toMercator(coord));

      context.currentSectorLine.points = circlePoints;
    } catch (error) {
      logESEParsingError(`Failed to create circle for sectorline: "${line}" - center: lat=${geo.lat}, lon=${geo.lon} - error: ${error}`);
    }
  }

  private static getCircleCenter(parts: string[], navaids: NseNavaid[]): { lat: number; lon: number } | null {
    if (parts.length === 5) {
      const coords = geoHelper.convertESEGeoCoordinates(parts[2], parts[3]);
      if (!coords) {
        logESEParsingError(`Failed to convert coordinates from parts: lat="${parts[2]}", lon="${parts[3]}"`);
        return null;
      }
      return { lat: Number(coords.lat), lon: Number(coords.lon) };
    }

    const navaidName = parts[2].trim();
    const navaid = navaids.find((n) => n.name === navaidName);
    if (navaid?.lat === undefined || navaid?.lon === undefined) {
      logESEParsingError(`Navaid "${navaidName}" not found or missing coordinates`);
      return null;
    }

    // NseNavaid carries lat/lon in DEGREES alongside x/y in projected meters. Unprojecting the
    // degrees collapsed every circle centre onto (0, 0); see getCircleCenter's test.
    return { lat: Number(navaid.lat), lon: Number(navaid.lon) };
  }

  // A zero latitude or longitude is a real coordinate, so this checks range rather than truthiness.
  private static isValidGeoCoord(geo: { lat: number; lon: number } | null): boolean {
    if (geo === null || !Number.isFinite(geo.lat) || !Number.isFinite(geo.lon)) {
      return false;
    }
    return Math.abs(geo.lat) <= 90 && Math.abs(geo.lon) <= 180;
  }

  private static handleCoord(line: string, context: SectorHandlerContext): void {
    const [, lat, lon] = line.split(":");
    const geo = geoHelper.convertESEGeoCoordinatesToCartesian(lat, lon);
    if (geo) {
      context.currentSectorLine.points.push(geo);
    } else {
      logESEParsingError(`Failed to convert coordinates to cartesian: lat="${lat}", lon="${lon}"`);
    }
  }

  // DISPLAY:<owned>:<compareA>:<compareB> is scoped to the SECTORLINE block it sits in.
  private static handleDisplay(line: string, context: SectorHandlerContext): void {
    const [ownedVolume, compareA, compareB] = this.splitAndClean(line, "DISPLAY");

    if (!context.currentSectorLinePublished) {
      logESEParsingWarning(`DISPLAY line outside a published sectorline block, dropped: "${line}"`);
      return;
    }

    if (!ownedVolume || !compareA || !compareB) {
      logESEParsingError(`Invalid DISPLAY line, expected owned and two compared volumes: "${line}"`);
      return;
    }

    context.currentSectorLine.displaySectorLines.push({
      ownedVolume,
      compareVolumes: [compareA, compareB],
    });
  }

  private static processPendingSectorLineDisplayData(context: SectorHandlerContext, result: ParsedEseContent): void {
    for (const pending of context.pendingSectorLineDisplayData) {
      const sectorLine = result.sectorLines.find((sl) => sl.id === pending.borderId);
      if (sectorLine) {
        sectorLine.displaySectorLines.push({
          ownedVolume: pending.ownedVolume,
          compareVolumes: pending.compareVolumes,
        });
      }
    }

    // Clear the pending data after processing
    context.pendingSectorLineDisplayData = [];
  }

  private static handleNewSector(line: string, result: ParsedEseContent, context: SectorHandlerContext): void {
    const [, name, floor, ceiling] = line.split(":");

    // Dropping the block is not enough: its OWNER/BORDER/ARRAPT/DEPAPT/ACTIVE lines still follow,
    // and handleOwner and friends assign straight onto currentSector. Leaving that pointed at the
    // PREVIOUS sector let a skipped block overwrite it, which refiled 35 volumes of the UK file
    // under the wrong sector; LFAPP CTA-7 took "Only LLAPP"'s owner chain and became LLN's instead
    // of LFR's. Park the strays on a scratch sector that never reaches the result.
    if (name.startsWith("Only") && !this.isGNG) {
      if (context.processingNewSector) {
        this.finalizeSector(context);
      }
      context.currentSector = { ...this.createEmptySector(), name };
      return;
    }

    if (context.processingNewSector) {
      this.finalizeSector(context);
    }

    const floorNum = Number(floor);
    const ceilingNum = Number(ceiling);

    if (isNaN(floorNum) || isNaN(ceilingNum)) {
      logESEParsingWarning(`Invalid altitude values for sector "${name}": floor="${floor}", ceiling="${ceiling}"`);
    }

    context.currentSector = {
      ...this.createEmptySector(),
      name,
      floor: floorNum,
      ceiling: ceilingNum,
    };
    result.sectors.push(context.currentSector);
    context.processingNewSector = true;
  }

  private static splitAndClean(line: string, prefix: string): string[] {
    return line
      .replace(`${prefix}:`, "")
      .split(":")
      .map((item) => item.replace(/[\r�]/g, ""));
  }

  private static handleOwner(line: string, context: SectorHandlerContext): void {
    context.currentSector.owners = this.splitAndClean(line, "OWNER");
  }

  private static handleBorder(line: string, context: SectorHandlerContext): void {
    const parts = this.splitAndClean(line, "BORDER");
    const invalidBorders: string[] = [];

    context.currentSector.borders = parts
      .map((item) => {
        if (!item) return null;
        if (/^\d+$/.test(item)) {
          return Number(item);
        }
        const replacementId = context.numericIDReplacementMatrix[item];
        if (!replacementId) {
          invalidBorders.push(item);
          return null;
        }
        return replacementId;
      })
      .filter((item): item is number => item !== null);

    if (invalidBorders.length > 0) {
      logESEParsingWarning(`Sector "${context.currentSector.name}" references undefined border IDs: ${invalidBorders.join(", ")}`);
    }
  }

  private static handleDepApt(line: string, context: SectorHandlerContext): void {
    const data = this.splitAndClean(line, "DEPAPT");
    context.currentSector.depApts = data;

    // for (const icao of data) {
    //   if (!icao) continue;
    //   if (icao.length !== 4) {
    //     logESEParsingWarning(`Invalid ICAO code in DEPAPT line: "${line}"`);
    //     continue;
    //   }
    //   context.currentSector.actives.push({ type: "depApt", icao });
    // }
  }

  private static handleArrApt(line: string, context: SectorHandlerContext): void {
    const data = this.splitAndClean(line, "ARRAPT");
    context.currentSector.arrApts = data;

    // for (const icao of data) {
    //   if (!icao) continue;
    //   if (icao.length !== 4) {
    //     logESEParsingWarning(`Invalid ICAO code in ARRAPT line: "${line}"`);
    //     continue;
    //   }
    //   context.currentSector.actives.push({ type: "arrApt", icao });
    // }
  }

  private static handleActive(line: string, context: SectorHandlerContext): void {
    const [icao, runway] = this.splitAndClean(line, "ACTIVE");
    if (!icao || !runway) {
      logESEParsingWarning(`Invalid ACTIVE line format: "${line}" - expected ICAO and runway`);
      return;
    }
    context.currentSector.actives.push({ type: "runway", icao, runway });
  }

  // GUEST:<position>:<depApt|*>:<arrApt|*>; a wildcard becomes null.
  private static handleGuest(line: string, context: SectorHandlerContext): void {
    const [position, departure, arrival] = this.splitAndClean(line, "GUEST");
    if (!position || !departure || !arrival) {
      logESEParsingWarning(`Invalid GUEST line format: "${line}" - expected position, departure and arrival`);
      return;
    }

    context.currentSector.guests.push({
      position,
      departureAirport: departure === "*" ? null : departure,
      arrivalAirport: arrival === "*" ? null : arrival,
    });
  }

  private static handleCopx(line: string, result: ParsedEseContent): void {
    const copx = this.parseCopx(line);
    if (copx) {
      result.copx.push(copx);
    }
  }

  // TYPE:DEP|FIXBEFORE:DEP_RWY:FIX:ARR|FIXAFTER:ARR_RWY:FROM:TO:CLIMB:DESCEND:NAME
  private static parseCopx(line: string): Copx | null {
    const parts = line.split(":");
    if (parts.length < 11) {
      logESEParsingWarning(`Invalid COPX line: "${line}"`);
      return null;
    }

    const fix = this.cleanToken(parts[3]);
    if (!fix) {
      logESEParsingWarning(`COPX line missing fix: "${line}"`);
      return null;
    }

    return {
      type: parts[0] === "FIR_COPX" ? "firCopx" : "copx",
      fix,
      depBefore: this.copxWildcard(parts[1]),
      depRwy: this.copxWildcard(parts[2]),
      arrAfter: this.copxWildcard(parts[4]),
      arrRwy: this.copxWildcard(parts[5]),
      fromVolume: this.copxWildcard(parts[6]),
      toVolume: this.copxWildcard(parts[7]),
      climbFt: this.copxLevel(parts[8]),
      descendFt: this.copxLevel(parts[9]),
      name: this.cleanToken(parts.slice(10).join(":")).replace(/^[\^|]+/, ""),
    };
  }

  private static cleanToken(raw: string | undefined): string {
    return (raw ?? "").replace(/[\r�]/g, "").trim();
  }

  private static copxWildcard(raw: string | undefined): string | null {
    const v = this.cleanToken(raw);
    return v === "" || v === "*" ? null : v;
  }

  private static copxLevel(raw: string | undefined): number | null {
    const v = this.copxWildcard(raw);
    if (v === null) return null;
    const n = Number(v);
    return isNaN(n) ? null : n;
  }

  private static handleDisplaySectorLine(line: string, context: SectorHandlerContext, result: ParsedEseContent): void {
    const [borderId, ownedVolume, ...others] = this.splitAndClean(line, "DISPLAY_SECTORLINE");

    const borderIdNum = Number(borderId);
    if (isNaN(borderIdNum)) {
      logESEParsingError(`Invalid border ID in DISPLAY_SECTORLINE: "${borderId}" in line: "${line}"`);
      return;
    }
    const displayData = {
      ownedVolume,
      compareVolumes: others,
    };
    const borderExists = result.sectorLines.find((sl) => sl.id === borderIdNum);
    if (!borderExists) {
      context.pendingSectorLineDisplayData.push({ borderId: borderIdNum, ...displayData });
    } else {
      borderExists.displaySectorLines.push(displayData);
      console.log(`Added DISPLAY_SECTORLINE to existing border ID: ${borderIdNum}`);
    }
  }
}
