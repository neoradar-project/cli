import { geoHelper } from "./geo-helper";
import * as turf from "@turf/turf";
import { toMercator, toWgs84 } from "@turf/projection";
import { NseNavaid, PackageAtcPosition, PackageProcedure, Sector, SectorLine } from "../definitions/package-defs";
import fs from "fs";
import { parseAtcPositionLine } from "../commands/converter/nse/atc-position-parser";
import { parseESEProcedure } from "../commands/converter/nse/procedure-parser";
import { logESEParsingError, logESEParsingWarning } from "./logger";

export interface ParsedEseContent {
  position: PackageAtcPosition[];
  procedure: PackageProcedure[];
  sectors: Sector[];
  sectorLines: SectorLine[];
}

interface SectorHandlerContext {
  currentSector: Sector;
  currentSectorLine: SectorLine;
  baseMatrixInt: number;
  numericIDReplacementMatrix: Record<string, number>;
  processingNewSector: boolean;
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
      floor: 0,
      ceiling: 0,
      displaySectorLines: [],
    };
  }

  private static createEmptySectorLine(): SectorLine {
    return {
      id: 0,
      points: [],
      display: [],
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
    };

    const context: SectorHandlerContext = {
      currentSector: this.createEmptySector(),
      currentSectorLine: this.createEmptySectorLine(),
      baseMatrixInt: 690,
      numericIDReplacementMatrix: {},
      processingNewSector: false,
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
      COORD: () => this.handleCoord(line, context),
      SECTOR: () => this.handleNewSector(line, result, context),
      OWNER: () => this.handleOwner(line, context),
      BORDER: () => this.handleBorder(line, context),
      DEPAPT: () => this.handleDepApt(line, context),
      ARRAPT: () => this.handleArrApt(line, context),
      ACTIVE: () => this.handleActive(line, context),
      DISPLAY_SECTORLINE: () => this.handleDisplaySectorLine(line, context),
    };

    const prefix = line.split(":")[0];
    const handler = handlers[prefix];
    if (handler) {
      handler();
    }
  }

  private static handleSectorLine(line: string, result: ParsedEseContent, context: SectorHandlerContext, allNavaids: NseNavaid[]): void {
    const id = line.split(":")[1];
    if (id.startsWith("Only") && !this.isGNG) return;

    const numericId = this.getNumericId(id, context);
    context.currentSectorLine = {
      id: numericId,
      points: [],
      display: [],
    };

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
        steps: 10,
        units: "nauticalmiles",
      });

      const circlePoints = circle.geometry.coordinates[0]
        .map((coord: number[]) => toMercator([coord[1], coord[0]]))
        .filter((cartesian) => cartesian[0] && cartesian[1]);

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
    if (!navaid?.lat || !navaid?.lon) {
      logESEParsingError(`Navaid "${navaidName}" not found or missing coordinates`);
      return null;
    }

    const toCartesian = toWgs84([Number(navaid.lon), Number(navaid.lat)]);
    return { lat: toCartesian[1], lon: toCartesian[0] };
  }

  private static isValidGeoCoord(geo: { lat: number; lon: number } | null): boolean {
    return Boolean(geo?.lat && geo?.lon && !isNaN(geo.lat) && !isNaN(geo.lon));
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

  private static handleNewSector(line: string, result: ParsedEseContent, context: SectorHandlerContext): void {
    const [, name, floor, ceiling] = line.split(":");
    if (name.startsWith("Only") && !this.isGNG) return;

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
    context.currentSector.depApts = this.splitAndClean(line, "DEPAPT");
  }

  private static handleArrApt(line: string, context: SectorHandlerContext): void {
    context.currentSector.arrApts = this.splitAndClean(line, "ARRAPT");
  }

  private static handleActive(line: string, context: SectorHandlerContext): void {
    const [icao, runway] = this.splitAndClean(line, "ACTIVE");
    if (!icao || !runway) {
      logESEParsingWarning(`Invalid ACTIVE line format: "${line}" - expected ICAO and runway`);
      return;
    }
    context.currentSector.actives.push({ icao, runway });
  }

  private static handleDisplaySectorLine(line: string, context: SectorHandlerContext): void {
    const [borderId, mySector, ...others] = this.splitAndClean(line, "DISPLAY_SECTORLINE");

    const borderIdNum = Number(borderId);
    if (isNaN(borderIdNum)) {
      logESEParsingError(`Invalid border ID in DISPLAY_SECTORLINE: "${borderId}" in line: "${line}"`);
      return;
    }

    context.currentSector.displaySectorLines.push({
      borderId: borderIdNum,
      mySector,
      otherSectors: others.map((item) => item.replace(mySector, "")).filter((item) => item !== ""),
    });
  }
}
