import path from "path";
import fs from "fs";
import { Sector as ParsedEseContentSector } from "../../definitions/package-defs";

import { ParsedEseContent } from "../../helper/ese-helper";
import { ATCData, BorderLine, IcaoAircraft, IcaoAirline, LoginProfiles, Position, RecatDefinition, Sector, Volume } from "../../definitions/package-atc-data";
import ora, { Ora } from "ora";
import { atcDataParsingErrorCount, logATCDataParsingError, logATCDataParsingWarning } from "../../helper/logger";
import { log } from "console";

export interface NestedLoginProfiles {
  [key: string]: LoginProfiles[];
}

class AtcDataManager {
  private nestedProfilesRef: NestedLoginProfiles = {};
  private positionsRef: Record<string, Position> = {};
  private callsignToFacilityMap: Record<string, number> = {};
  private positionToIdentifierMap: Record<string, string> = {};

  private readonly FACILITY_TYPE_MAP: Record<string, number> = {
    OBS: 0,
    FSS: 1,
    DEL: 2,
    GND: 3,
    TWR: 4,
    APP: 5,
    CTR: 6,
    ATIS: 7,
  };

  private readonly PATHS = {
    loginProfiles: "euroscope_data/LoginProfiles.txt",
    loginProfilesDir: "euroscope_data/LoginProfiles",
    recatDefinition: "icao_data/recat.json",
    icaoAircraft: "icao_data/ICAO_Aircraft.txt",
    icaoAirlines: "icao_data/ICAO_Airlines.txt",
    alias: "euroscope_data/Alias.txt",
    output: "package/datasets/atc-data.json",
  } as const;

  public async parseAtcdata(packageEnvironmentPath: string, eseProcessedData?: ParsedEseContent | undefined): Promise<void> {
    const spinner = ora("Parsing ATC data...").start();

    try {
      const atcData = this.initializeAtcData();

      await this.parseLoginProfilesData(packageEnvironmentPath, spinner);
      await this.parseSectorData(eseProcessedData, atcData, spinner);
      await this.parseIcaoData(packageEnvironmentPath, atcData, spinner);
      await this.parseAliasData(packageEnvironmentPath, atcData, spinner);

      this.updateFinalReferences(atcData);
      await this.writeAtcData(packageEnvironmentPath, atcData, spinner);

      if (atcDataParsingErrorCount > 0) {
        spinner.warn(`ATC data parsing completed with ${atcDataParsingErrorCount} errors. Check logs for details.`);
      } else {
        spinner.succeed("ATC data parsing completed successfully.");
      }
    } catch (error) {
      spinner.fail("ATC data parsing failed.");
      throw error;
    }
  }

  private initializeAtcData(): ATCData {
    return {
      loginProfiles: {},
      positions: {},
      icaoAircraft: {},
      icaoAirlines: {},
      alias: {},
      borderLines: {},
      sectors: {},
    };
  }

  private async parseLoginProfilesData(packageEnvironmentPath: string, spinner: Ora): Promise<void> {
    const loginProfilesFilePath = path.resolve(packageEnvironmentPath, this.PATHS.loginProfiles);
    const potentialLoginProfilesDir = path.resolve(packageEnvironmentPath, this.PATHS.loginProfilesDir);

    if (this.isDirectoryExists(potentialLoginProfilesDir)) {
      this.nestedProfilesRef = await this.parseLoginProfilesFromDirectory(potentialLoginProfilesDir);
      if (Object.keys(this.nestedProfilesRef).length === 0) {
        spinner.warn(`Failed to parse login profiles or login profiles empty.`);
      } else {
        spinner.info(`Parsed login profiles from directory: ${potentialLoginProfilesDir}`);
      }
    } else if (this.isFileExists(loginProfilesFilePath)) {
      const parsedProfiles = await this.parseLoginProfiles(loginProfilesFilePath);
      this.nestedProfilesRef = this.organizeProfilesByCallsignPrefix(parsedProfiles);
      if (Object.keys(this.nestedProfilesRef).length === 0) {
        spinner.warn(`Failed to parse login profiles or login profiles empty.`);
      } else {
        spinner.info(`Parsed login profiles from file: ${loginProfilesFilePath}`);
      }
    } else {
      spinner.warn(`No valid login profiles found, skipping login profiles parsing.`);
      logATCDataParsingWarning(`No valid login profiles found at ${potentialLoginProfilesDir} or ${loginProfilesFilePath}, skipping login profiles parsing.`);
      this.nestedProfilesRef = {};
    }
  }

  private async parseSectorData(eseProcessedData: ParsedEseContent | undefined, atcData: ATCData, spinner: Ora): Promise<void> {
    if (!eseProcessedData) return;

    spinner.text = "Parsing sector data from ESE...";
    this.buildPositionToIdentifierMap(eseProcessedData);
    const { sectors, borderLines, positions } = this.transformSectorsAndBorderLines(eseProcessedData);

    atcData.sectors = sectors;
    atcData.borderLines = borderLines;
    atcData.positions = positions;
    this.positionsRef = positions;
    spinner.info(`Parsed ${Object.keys(sectors).length} sectors and ${Object.keys(borderLines).length} border lines.`);
  }

  private async parseIcaoData(packageEnvironmentPath: string, atcData: ATCData, spinner: Ora): Promise<void> {
    const recatDefinitionPath = path.resolve(packageEnvironmentPath, this.PATHS.recatDefinition);
    const recatDefAvailable = this.isFileExists(recatDefinitionPath);

    if (!recatDefAvailable) {
      logATCDataParsingWarning(`RECAT definition file not found at ${recatDefinitionPath}, will not use recat definition for ICAO Aircraft.`);
    } else {
      spinner.info(`RECAT definition file found at ${recatDefinitionPath}, will use it for ICAO Aircraft parsing.`);
    }

    await this.parseIcaoAircraftData(packageEnvironmentPath, atcData, spinner, recatDefAvailable ? recatDefinitionPath : undefined);
    if (Object.keys(atcData.icaoAircraft).length === 0) {
      spinner.warn(`No ICAO Aircraft data found or parsed`);
    } else {
      spinner.info(`Parsed ${Object.keys(atcData.icaoAircraft).length} ICAO Aircraft entries.`);
    }
    await this.parseIcaoAirlinesData(packageEnvironmentPath, atcData, spinner);
    if (Object.keys(atcData.icaoAirlines).length === 0) {
      spinner.warn(`No ICAO Airlines data found or parsed`);
    } else {
      spinner.info(`Parsed ${Object.keys(atcData.icaoAirlines).length} ICAO Airlines entries.`);
    }
  }

  private async parseIcaoAircraftData(packageEnvironmentPath: string, atcData: ATCData, spinner: Ora, recatDefinitionPath?: string): Promise<void> {
    const icaoAircraftPath = path.resolve(packageEnvironmentPath, this.PATHS.icaoAircraft);

    if (!this.isFileExists(icaoAircraftPath)) {
      logATCDataParsingWarning(`ICAO Aircraft file not found at ${icaoAircraftPath}, skipping...`);
      return;
    }

    spinner.text = "Parsing ICAO Aircraft data...";
    atcData.icaoAircraft = await this.parseIcaoAircraft(icaoAircraftPath, recatDefinitionPath);
  }

  private async parseIcaoAirlinesData(packageEnvironmentPath: string, atcData: ATCData, spinner: Ora): Promise<void> {
    const icaoAirlinesPath = path.resolve(packageEnvironmentPath, this.PATHS.icaoAirlines);

    if (!this.isFileExists(icaoAirlinesPath)) {
      logATCDataParsingWarning(`ICAO Airlines file not found at ${icaoAirlinesPath}, skipping...`);
      return;
    }

    spinner.text = "Parsing ICAO Airlines data...";
    atcData.icaoAirlines = await this.parseIcaoAirline(icaoAirlinesPath);
  }

  private async parseAliasData(packageEnvironmentPath: string, atcData: ATCData, spinner: Ora): Promise<void> {
    const aliasPath = path.resolve(packageEnvironmentPath, this.PATHS.alias);

    if (!this.isFileExists(aliasPath)) {
      logATCDataParsingWarning(`Alias file not found at ${aliasPath}, skipping...`);
      return;
    }

    spinner.text = "Parsing Alias data...";
    atcData.alias = await this.parseAlias(aliasPath);
    if (Object.keys(atcData.alias).length === 0) {
      spinner.warn(`No Alias data found or parsed`);
    } else {
      spinner.info(`Parsed ${Object.keys(atcData.alias).length} Alias entries.`);
    }
  }

  private updateFinalReferences(atcData: ATCData): void {
    atcData.loginProfiles = this.nestedProfilesRef;
    atcData.positions = this.positionsRef;
  }

  private async writeAtcData(packageEnvironmentPath: string, atcData: ATCData, spinner: Ora): Promise<void> {
    spinner.text = "Writing ATC data...";
    const outputFilePath = path.resolve(packageEnvironmentPath, this.PATHS.output);

    try {
      await fs.promises.writeFile(outputFilePath, JSON.stringify(atcData), "utf-8");
    } catch (error) {
      logATCDataParsingError(`Failed to write ATC data to ${outputFilePath}: ${error}`);
      throw new Error(`Failed to write ATC data to ${outputFilePath}: ${error}`);
    }
  }

  private isFileExists(filePath: string): boolean {
    try {
      return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
    } catch {
      return false;
    }
  }

  private isDirectoryExists(dirPath: string): boolean {
    try {
      return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
    } catch {
      return false;
    }
  }

  private buildPositionToIdentifierMap(parsedEseContent: ParsedEseContent): void {
    this.positionToIdentifierMap = {};

    for (const pos of parsedEseContent.position) {
      this.positionToIdentifierMap[pos.callsign] = pos.identifier;
    }
  }

  private async parseLoginProfilesFromDirectory(directoryPath: string): Promise<NestedLoginProfiles> {
    const nestedProfiles: NestedLoginProfiles = {};
    const globalCallsigns = new Set<string>();

    try {
      const subdirs = await fs.promises.readdir(directoryPath, {
        withFileTypes: true,
      });

      for (const subdir of subdirs.filter((d) => d.isDirectory())) {
        await this.processLoginProfileSubdirectory(directoryPath, subdir.name, nestedProfiles, globalCallsigns);
      }
    } catch (error) {
      logATCDataParsingError(`Failed to read login profiles directory: ${error}`);
    }

    return nestedProfiles;
  }

  private async processLoginProfileSubdirectory(
    directoryPath: string,
    folderName: string,
    nestedProfiles: NestedLoginProfiles,
    globalCallsigns: Set<string>
  ): Promise<void> {
    const folderPath = path.join(directoryPath, folderName);
    const profileFiles = await this.findProfileFiles(folderPath);

    if (profileFiles.length === 0) return;

    const sortedFiles = this.sortProfileFilesByPriority(profileFiles);

    for (const profileFile of sortedFiles) {
      const fileName = path.basename(profileFile, ".txt");

      if (!fileName.includes("Profiles")) continue;

      try {
        const parsedProfiles = await this.parseLoginProfiles(profileFile);
        const groupKey = this.createGroupKey(fileName, folderName);

        this.addProfilesToGroup(parsedProfiles, groupKey, nestedProfiles, globalCallsigns);
      } catch (error) {
        logATCDataParsingError(`Failed to parse profile file ${profileFile}: ${error}`);
      }
    }
  }

  private sortProfileFilesByPriority(profileFiles: string[]): string[] {
    return profileFiles.sort((a, b) => {
      const aBasename = path.basename(a);
      const bBasename = path.basename(b);

      if (aBasename === "Profiles.txt") return -1;
      if (bBasename === "Profiles.txt") return 1;

      const aComplexity = (aBasename.match(/[_\-]/g) || []).length;
      const bComplexity = (bBasename.match(/[_\-]/g) || []).length;

      return aComplexity - bComplexity;
    });
  }

  private createGroupKey(fileName: string, folderName: string): string {
    let groupSuffix = fileName === "Profiles" ? "" : fileName.replace("Profiles", "");
    groupSuffix = groupSuffix.replace(/[_\-]/g, " ").trim();

    return groupSuffix ? `${folderName} ${groupSuffix}` : folderName;
  }

  private addProfilesToGroup(
    parsedProfiles: Record<string, LoginProfiles>,
    groupKey: string,
    nestedProfiles: NestedLoginProfiles,
    globalCallsigns: Set<string>
  ): void {
    if (!nestedProfiles[groupKey]) {
      nestedProfiles[groupKey] = [];
    }

    Object.values(parsedProfiles).forEach((profile) => {
      if (!globalCallsigns.has(profile.callsign)) {
        nestedProfiles[groupKey].push(profile);
        globalCallsigns.add(profile.callsign);
      }
    });
  }

  private async findProfileFiles(directoryPath: string): Promise<string[]> {
    try {
      const files = await fs.promises.readdir(directoryPath);
      return files.filter((file) => file.includes("Profiles") && file.endsWith(".txt")).map((file) => path.join(directoryPath, file));
    } catch (error) {
      logATCDataParsingError(`Failed to read directory ${directoryPath}: ${error}`);
      return [];
    }
  }

  private organizeProfilesByCallsignPrefix(profiles: Record<string, LoginProfiles>): NestedLoginProfiles {
    const organized: NestedLoginProfiles = {};

    for (const [, profile] of Object.entries(profiles)) {
      const callsignParts = profile.callsign.split("_");
      const prefix = callsignParts[0];

      if (!organized[prefix]) {
        organized[prefix] = [];
      }

      organized[prefix].push(profile);
    }

    return organized;
  }

  private async parseLoginProfiles(loginProfilesFile: string): Promise<Record<string, LoginProfiles>> {
    try {
      const profiles = await fs.promises.readFile(loginProfilesFile, "utf-8");
      const lines = profiles.split("\n");
      const data: Record<string, LoginProfiles> = {};
      let currentProfile = "";

      this.callsignToFacilityMap = {};

      for (const line of lines) {
        const trimmedLine = line.trim();

        if (this.isProfileLine(trimmedLine)) {
          currentProfile = this.parseProfileLine(trimmedLine, data);
        } else if (this.isAtisLine(trimmedLine) && currentProfile) {
          this.parseAtisLine(trimmedLine, data[currentProfile]);
        }
      }

      return data;
    } catch (error) {
      logATCDataParsingError(`Failed to parse login profiles from ${loginProfilesFile}: ${error}`);
      return {};
    }
  }

  private isProfileLine(line: string): boolean {
    return line.startsWith("PROFILE:");
  }

  private isAtisLine(line: string): boolean {
    return line.startsWith("ATIS");
  }

  private parseProfileLine(line: string, data: Record<string, LoginProfiles>): string {
    const elements = line.split(":");
    const callsign = elements[1];
    const range = Number(elements[2]) || 0;
    const facility = Number(elements[3]) || 0;

    this.callsignToFacilityMap[callsign] = facility;

    data[callsign] = {
      callsign,
      range,
      atisLine1: "",
      atisLine2: "",
      atisLine3: "",
      atisLine4: "",
    };

    return callsign;
  }

  private parseAtisLine(line: string, profile: LoginProfiles): void {
    const elements = line.split(":");
    const atisLineNum = Number(elements[0]?.substring(4));

    if (atisLineNum >= 1 && atisLineNum <= 4) {
      (profile as any)[`atisLine${atisLineNum}`] = elements[1] || "";
    }
  }

  private transformSectorsAndBorderLines(parsedEseContent: ParsedEseContent): {
    sectors: Record<string, Sector>;
    borderLines: Record<number, BorderLine>;
    positions: Record<string, Position>;
  } {
    const sectors: Record<string, Sector> = {};
    const borderLines: Record<number, BorderLine> = {};
    const positions: Record<string, Position> = {};

    this.createBorderLines(parsedEseContent, borderLines);
    this.createPositions(parsedEseContent, positions);
    this.createSectors(parsedEseContent, sectors, positions);
    this.assignSectorsToPositions(parsedEseContent, sectors, positions);

    return { sectors, borderLines, positions };
  }

  private createBorderLines(parsedEseContent: ParsedEseContent, borderLines: Record<number, BorderLine>): void {
    parsedEseContent.sectorLines.forEach((sectorLine) => {
      borderLines[sectorLine.id] = {
        id: sectorLine.id,
        lines: sectorLine.points,
      };
    });
  }

  private createPositions(parsedEseContent: ParsedEseContent, positions: Record<string, Position>): void {
    parsedEseContent.position.forEach((pos) => {
      const callsign = pos.callsign;
      const anchor = callsign.split(/[\*_]/)[0];
      const facility = this.determineFacility(pos, callsign);

      positions[callsign] = {
        callsign,
        facility,
        sectors: [],
        anchor,
      };
    });
  }

  private determineFacility(pos: any, callsign: string): number {
    // Method 1: Use value from parsed ESE position
    if (pos.facility && !isNaN(Number(pos.facility))) {
      return Number(pos.facility);
    }

    // Method 2: Look up in facility map
    if (this.callsignToFacilityMap[callsign] !== undefined) {
      return this.callsignToFacilityMap[callsign];
    }

    // Method 3: Extract from callsign suffix
    const lastPart = callsign.split("_").pop()?.toUpperCase();
    if (lastPart && this.FACILITY_TYPE_MAP[lastPart] !== undefined) {
      return this.FACILITY_TYPE_MAP[lastPart];
    }

    return 0; // Default value
  }

  private createSectors(parsedEseContent: ParsedEseContent, sectors: Record<string, Sector>, positions: Record<string, Position>): void {
    const completedIdentifiers = new Set<string>();
    let sectorIdCounter = 1000;

    // Process sectors with volumes
    for (const oldSector of parsedEseContent.sectors) {
      if (!oldSector.owners || oldSector.owners.length === 0) continue;

      const identifier = oldSector.owners[0];
      if (completedIdentifiers.has(identifier)) continue;

      const sector = this.createSectorFromEseData(parsedEseContent, identifier, sectorIdCounter++, positions);

      if (sector) {
        sectors[identifier] = sector;
        completedIdentifiers.add(identifier);
      }
    }

    // Create empty sectors for remaining positions
    this.createEmptySectorsForRemainingPositions(parsedEseContent, sectors, positions, completedIdentifiers, sectorIdCounter);

    this.populateSectorOwners(parsedEseContent, sectors);
  }

  private createSectorFromEseData(
    parsedEseContent: ParsedEseContent,
    identifier: string,
    sectorId: number,
    positions: Record<string, Position>
  ): Sector | null {
    const relatedSectors = parsedEseContent.sectors.filter((s) => s.owners && s.owners.length > 0 && s.owners[0] === identifier);

    const position = parsedEseContent.position.find((p) => p.identifier === identifier);

    if (!position) {
      logATCDataParsingWarning(`No position found for identifier ${identifier}`);
      return null;
    }

    const callsign = position.callsign;
    const anchor = callsign.split(/[\*_]/)[0];
    const facility = positions[callsign]?.facility || 0;
    const frequency = this.parseFrequency(position.frequency);

    const sector: Sector = {
      id: sectorId,
      volumes: [],
      owners: [],
      identifier,
      frequency,
      activeAirports: [],
      facility,
      anchor,
    };

    this.addVolumesToSector(relatedSectors, sector);

    return sector;
  }

  private parseFrequency(frequency: string): number {
    try {
      return parseInt(frequency.replace(".", "")) * 1000 || 0;
    } catch {
      return 0;
    }
  }

  private addVolumesToSector(relatedSectors: ParsedEseContentSector[], sector: Sector): void {
    const activeAirports = new Set<string>();

    for (const relatedSector of relatedSectors) {
      const volume: Volume = {
        id: relatedSector.name,
        definition: relatedSector.borders || [],
        floor: relatedSector.floor,
        ceiling: relatedSector.ceiling,
        activationCondition: relatedSector.actives,
        displaySectorLines: relatedSector.displaySectorLines || [],
      };

      // Collect active airports
      if (relatedSector.depApts?.length > 0) {
        relatedSector.depApts.forEach((apt: string) => activeAirports.add(apt));
      }
      if (relatedSector.arrApts?.length > 0) {
        relatedSector.arrApts.forEach((apt: string) => activeAirports.add(apt));
      }

      sector.volumes.push(volume);
    }

    sector.activeAirports = Array.from(activeAirports);
  }

  private createEmptySectorsForRemainingPositions(
    parsedEseContent: ParsedEseContent,
    sectors: Record<string, Sector>,
    positions: Record<string, Position>,
    completedIdentifiers: Set<string>,
    sectorIdCounter: number
  ): void {
    parsedEseContent.position.forEach((pos) => {
      const identifier = pos.identifier;

      if (completedIdentifiers.has(identifier)) return;

      const callsign = pos.callsign;
      const anchor = callsign.split(/[\*_]/)[0];
      const facility = positions[callsign]?.facility || 0;
      const frequency = this.parseFrequency(pos.frequency);

      const emptySector: Sector = {
        id: sectorIdCounter++,
        volumes: [],
        owners: [],
        identifier,
        frequency,
        activeAirports: [],
        facility,
        anchor,
      };

      sectors[identifier] = emptySector;
      completedIdentifiers.add(identifier);
    });
  }

  private populateSectorOwners(parsedEseContent: ParsedEseContent, sectors: Record<string, Sector>): void {
    for (const oldSector of parsedEseContent.sectors) {
      if (!oldSector.owners || oldSector.owners.length === 0) continue;

      const primaryIdentifier = oldSector.owners[0];
      if (!sectors[primaryIdentifier]) continue;

      const sectorOwners = [...new Set(oldSector.owners.slice(1))];

      for (const owner of sectorOwners) {
        if (!sectors[primaryIdentifier].owners.includes(owner)) {
          sectors[primaryIdentifier].owners.push(owner);
        }
      }
    }
  }

  private assignSectorsToPositions(parsedEseContent: ParsedEseContent, sectors: Record<string, Sector>, positions: Record<string, Position>): void {
    const ownedSectors = this.buildOwnedSectorsMap(parsedEseContent, sectors);
    const controllableSectors = this.buildControllableSectorsMap(parsedEseContent);

    for (const [callsign, position] of Object.entries(positions)) {
      const ownedSectorsForPosition = ownedSectors[callsign] || [];
      const controllableSectorsForPosition = this.filterControllableSectors(controllableSectors[callsign] || new Set(), position.facility, sectors);

      position.sectors = [...ownedSectorsForPosition, ...controllableSectorsForPosition.filter((sector) => !ownedSectorsForPosition.includes(sector))];
    }
  }

  private buildOwnedSectorsMap(parsedEseContent: ParsedEseContent, sectors: Record<string, Sector>): Record<string, string[]> {
    const ownedSectors: Record<string, string[]> = {};

    for (const [sectorId] of Object.entries(sectors)) {
      for (const pos of parsedEseContent.position) {
        if (pos.identifier === sectorId) {
          if (!ownedSectors[pos.callsign]) {
            ownedSectors[pos.callsign] = [];
          }
          ownedSectors[pos.callsign].push(sectorId);
          break;
        }
      }
    }

    return ownedSectors;
  }

  private buildControllableSectorsMap(parsedEseContent: ParsedEseContent): Record<string, Set<string>> {
    const controllableSectors: Record<string, Set<string>> = {};

    for (const oldSector of parsedEseContent.sectors) {
      if (!oldSector.owners || oldSector.owners.length === 0) continue;

      const primaryIdentifier = oldSector.owners[0];

      for (const ownerIdentifier of oldSector.owners) {
        const matchingPositions = parsedEseContent.position.filter((p) => p.identifier === ownerIdentifier);

        for (const pos of matchingPositions) {
          if (!controllableSectors[pos.callsign]) {
            controllableSectors[pos.callsign] = new Set<string>();
          }
          controllableSectors[pos.callsign].add(primaryIdentifier);
        }
      }
    }

    return controllableSectors;
  }

  private filterControllableSectors(controllableSectors: Set<string>, positionFacility: number, sectors: Record<string, Sector>): string[] {
    const controllableSectorsArray = Array.from(controllableSectors);

    if (positionFacility > 4) {
      return controllableSectorsArray.filter((sectorId) => {
        const sector = sectors[sectorId];
        return sector && sector.facility === positionFacility;
      });
    }

    return controllableSectorsArray;
  }

  private async parseIcaoAirline(icaoAirlinesPath: string): Promise<Record<string, IcaoAirline>> {
    try {
      const content = await fs.promises.readFile(icaoAirlinesPath, "utf-8");
      const lines = content.split("\n");
      const data: Record<string, IcaoAirline> = {};

      for (const line of lines) {
        if (line.startsWith(";") || line.trim().length === 0) continue;

        const parts = line.split("\t");
        if (parts.length < 4) continue;

        const airline: IcaoAirline = {
          icao: parts[0],
          name: parts[1],
          callsign: parts[2],
          country: parts[3].replace(/\r?\n/g, ""),
        };

        data[airline.icao] = airline;
      }

      return data;
    } catch (error) {
      logATCDataParsingError(`Failed to parse ICAO airlines: ${error}`);
      return {};
    }
  }

  private async parseIcaoAircraft(icaoAircraftPath: string, recatDefinitionPath?: string): Promise<Record<string, IcaoAircraft>> {
    try {
      const content = await fs.promises.readFile(icaoAircraftPath, "utf-8");
      const recatDef = await this.loadRecatDefinition(recatDefinitionPath);
      const lines = content.split("\n");
      const data: Record<string, IcaoAircraft> = {};

      for (const line of lines) {
        if (line.startsWith(";") || line.trim().length === 0) continue;

        const parts = line.split("\t");
        if (parts.length < 4) continue;

        const icao = parts[0];
        const engines = parts[1].slice(1);
        const wakeCat = parts[1].charAt(0);
        const recat = recatDef?.find((rd) => rd.icao === icao)?.categoryLabel || "";

        const aircraft: IcaoAircraft = {
          icao,
          engines,
          builder: parts[2],
          wakeCat,
          recatCat: recat,
          name: parts[3].replace(/\r?\n/g, ""),
        };

        data[aircraft.icao] = aircraft;
      }

      return data;
    } catch (error) {
      `Failed to parse ICAO aircraft: ${error}`;
      return {};
    }
  }

  private async loadRecatDefinition(recatDefinitionPath?: string): Promise<RecatDefinition[] | undefined> {
    if (!recatDefinitionPath) return undefined;

    try {
      const recatData = await fs.promises.readFile(recatDefinitionPath, "utf-8");
      return JSON.parse(recatData) as RecatDefinition[];
    } catch (error) {
      logATCDataParsingWarning(`Failed to load RECAT definition: ${error}`);
      return undefined;
    }
  }

  private async parseAlias(aliasPath: string): Promise<Record<string, string>> {
    try {
      const content = await fs.promises.readFile(aliasPath, "utf-8");
      const lines = content.split("\n");
      const data: Record<string, string> = {};

      for (const line of lines) {
        if (line.startsWith(";") || line.startsWith(" ") || line.trim().length === 0) {
          continue;
        }

        const parts = line.split(" ");
        if (parts.length > 0) {
          const ref = parts[0].trim().replace(".", "");
          const value = line.replace(parts[0], "").trim();
          if (ref && value) {
            data[ref] = value;
          }
        }
      }

      return data;
    } catch (error) {
      logATCDataParsingError(`Failed to parse alias data: ${error}`);
      return {};
    }
  }
}

export const atcData = new AtcDataManager();
