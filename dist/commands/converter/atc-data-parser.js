"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.atcData = void 0;
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const ora_1 = __importDefault(require("ora"));
const logger_1 = require("../../helper/logger");
class AtcDataManager {
    nestedProfilesRef = {};
    positionsRef = {};
    callsignToFacilityMap = {};
    positionToIdentifierMap = {};
    FACILITY_TYPE_MAP = {
        OBS: 0,
        FSS: 1,
        DEL: 2,
        GND: 3,
        TWR: 4,
        APP: 5,
        CTR: 6,
        ATIS: 7,
    };
    PATHS = {
        loginProfiles: "euroscope_data/LoginProfiles.txt",
        loginProfilesDir: "euroscope_data/LoginProfiles",
        recatDefinition: "icao_data/recat.json",
        icaoAircraft: "icao_data/ICAO_Aircraft.txt",
        icaoAirlines: "icao_data/ICAO_Airlines.txt",
        alias: "euroscope_data/Alias.txt",
        output: "package/datasets/atc-data.json",
    };
    async parseAtcdata(packageEnvironmentPath, eseProcessedData) {
        const spinner = (0, ora_1.default)("Parsing ATC data...").start();
        try {
            const atcData = this.initializeAtcData();
            await this.parseLoginProfilesData(packageEnvironmentPath, spinner);
            await this.parseSectorData(eseProcessedData, atcData, spinner);
            await this.parseIcaoData(packageEnvironmentPath, atcData, spinner);
            await this.parseAliasData(packageEnvironmentPath, atcData, spinner);
            this.updateFinalReferences(atcData);
            await this.writeAtcData(packageEnvironmentPath, atcData, spinner);
            if (logger_1.atcDataParsingErrorCount > 0) {
                spinner.warn(`ATC data parsing completed with ${logger_1.atcDataParsingErrorCount} errors. Check logs for details.`);
            }
            else {
                spinner.succeed("ATC data parsing completed successfully.");
            }
        }
        catch (error) {
            spinner.fail("ATC data parsing failed.");
            throw error;
        }
    }
    initializeAtcData() {
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
    async parseLoginProfilesData(packageEnvironmentPath, spinner) {
        const loginProfilesFilePath = path_1.default.resolve(packageEnvironmentPath, this.PATHS.loginProfiles);
        const potentialLoginProfilesDir = path_1.default.resolve(packageEnvironmentPath, this.PATHS.loginProfilesDir);
        if (this.isDirectoryExists(potentialLoginProfilesDir)) {
            this.nestedProfilesRef = await this.parseLoginProfilesFromDirectory(potentialLoginProfilesDir);
            if (Object.keys(this.nestedProfilesRef).length === 0) {
                spinner.warn(`Failed to parse login profiles or login profiles empty.`);
            }
            else {
                spinner.info(`Parsed login profiles from directory: ${potentialLoginProfilesDir}`);
            }
        }
        else if (this.isFileExists(loginProfilesFilePath)) {
            const parsedProfiles = await this.parseLoginProfiles(loginProfilesFilePath);
            this.nestedProfilesRef = this.organizeProfilesByCallsignPrefix(parsedProfiles);
            if (Object.keys(this.nestedProfilesRef).length === 0) {
                spinner.warn(`Failed to parse login profiles or login profiles empty.`);
            }
            else {
                spinner.info(`Parsed login profiles from file: ${loginProfilesFilePath}`);
            }
        }
        else {
            spinner.warn(`No valid login profiles found, skipping login profiles parsing.`);
            (0, logger_1.logATCDataParsingWarning)(`No valid login profiles found at ${potentialLoginProfilesDir} or ${loginProfilesFilePath}, skipping login profiles parsing.`);
            this.nestedProfilesRef = {};
        }
    }
    async parseSectorData(eseProcessedData, atcData, spinner) {
        if (!eseProcessedData)
            return;
        spinner.text = "Parsing sector data from ESE...";
        this.buildPositionToIdentifierMap(eseProcessedData);
        const { sectors, borderLines, positions } = this.transformSectorsAndBorderLines(eseProcessedData);
        atcData.sectors = sectors;
        atcData.borderLines = borderLines;
        atcData.positions = positions;
        this.positionsRef = positions;
        spinner.info(`Parsed ${Object.keys(sectors).length} sectors and ${Object.keys(borderLines).length} border lines.`);
    }
    async parseIcaoData(packageEnvironmentPath, atcData, spinner) {
        const recatDefinitionPath = path_1.default.resolve(packageEnvironmentPath, this.PATHS.recatDefinition);
        const recatDefAvailable = this.isFileExists(recatDefinitionPath);
        if (!recatDefAvailable) {
            (0, logger_1.logATCDataParsingWarning)(`RECAT definition file not found at ${recatDefinitionPath}, will not use recat definition for ICAO Aircraft.`);
        }
        else {
            spinner.info(`RECAT definition file found at ${recatDefinitionPath}, will use it for ICAO Aircraft parsing.`);
        }
        await this.parseIcaoAircraftData(packageEnvironmentPath, atcData, spinner, recatDefAvailable ? recatDefinitionPath : undefined);
        if (Object.keys(atcData.icaoAircraft).length === 0) {
            spinner.warn(`No ICAO Aircraft data found or parsed`);
        }
        else {
            spinner.info(`Parsed ${Object.keys(atcData.icaoAircraft).length} ICAO Aircraft entries.`);
        }
        await this.parseIcaoAirlinesData(packageEnvironmentPath, atcData, spinner);
        if (Object.keys(atcData.icaoAirlines).length === 0) {
            spinner.warn(`No ICAO Airlines data found or parsed`);
        }
        else {
            spinner.info(`Parsed ${Object.keys(atcData.icaoAirlines).length} ICAO Airlines entries.`);
        }
    }
    async parseIcaoAircraftData(packageEnvironmentPath, atcData, spinner, recatDefinitionPath) {
        const icaoAircraftPath = path_1.default.resolve(packageEnvironmentPath, this.PATHS.icaoAircraft);
        if (!this.isFileExists(icaoAircraftPath)) {
            (0, logger_1.logATCDataParsingWarning)(`ICAO Aircraft file not found at ${icaoAircraftPath}, skipping...`);
            return;
        }
        spinner.text = "Parsing ICAO Aircraft data...";
        atcData.icaoAircraft = await this.parseIcaoAircraft(icaoAircraftPath, recatDefinitionPath);
    }
    async parseIcaoAirlinesData(packageEnvironmentPath, atcData, spinner) {
        const icaoAirlinesPath = path_1.default.resolve(packageEnvironmentPath, this.PATHS.icaoAirlines);
        if (!this.isFileExists(icaoAirlinesPath)) {
            (0, logger_1.logATCDataParsingWarning)(`ICAO Airlines file not found at ${icaoAirlinesPath}, skipping...`);
            return;
        }
        spinner.text = "Parsing ICAO Airlines data...";
        atcData.icaoAirlines = await this.parseIcaoAirline(icaoAirlinesPath);
    }
    async parseAliasData(packageEnvironmentPath, atcData, spinner) {
        const aliasPath = path_1.default.resolve(packageEnvironmentPath, this.PATHS.alias);
        if (!this.isFileExists(aliasPath)) {
            (0, logger_1.logATCDataParsingWarning)(`Alias file not found at ${aliasPath}, skipping...`);
            return;
        }
        spinner.text = "Parsing Alias data...";
        atcData.alias = await this.parseAlias(aliasPath);
        if (Object.keys(atcData.alias).length === 0) {
            spinner.warn(`No Alias data found or parsed`);
        }
        else {
            spinner.info(`Parsed ${Object.keys(atcData.alias).length} Alias entries.`);
        }
    }
    updateFinalReferences(atcData) {
        atcData.loginProfiles = this.nestedProfilesRef;
        atcData.positions = this.positionsRef;
    }
    async writeAtcData(packageEnvironmentPath, atcData, spinner) {
        spinner.text = "Writing ATC data...";
        const outputFilePath = path_1.default.resolve(packageEnvironmentPath, this.PATHS.output);
        try {
            await fs_1.default.promises.writeFile(outputFilePath, JSON.stringify(atcData), "utf-8");
        }
        catch (error) {
            (0, logger_1.logATCDataParsingError)(`Failed to write ATC data to ${outputFilePath}: ${error}`);
            throw new Error(`Failed to write ATC data to ${outputFilePath}: ${error}`);
        }
    }
    isFileExists(filePath) {
        try {
            return fs_1.default.existsSync(filePath) && fs_1.default.statSync(filePath).isFile();
        }
        catch {
            return false;
        }
    }
    isDirectoryExists(dirPath) {
        try {
            return fs_1.default.existsSync(dirPath) && fs_1.default.statSync(dirPath).isDirectory();
        }
        catch {
            return false;
        }
    }
    buildPositionToIdentifierMap(parsedEseContent) {
        this.positionToIdentifierMap = {};
        for (const pos of parsedEseContent.position) {
            this.positionToIdentifierMap[pos.callsign] = pos.identifier;
        }
    }
    async parseLoginProfilesFromDirectory(directoryPath) {
        const nestedProfiles = {};
        const globalCallsigns = new Set();
        try {
            const subdirs = await fs_1.default.promises.readdir(directoryPath, {
                withFileTypes: true,
            });
            for (const subdir of subdirs.filter((d) => d.isDirectory())) {
                await this.processLoginProfileSubdirectory(directoryPath, subdir.name, nestedProfiles, globalCallsigns);
            }
        }
        catch (error) {
            (0, logger_1.logATCDataParsingError)(`Failed to read login profiles directory: ${error}`);
        }
        return nestedProfiles;
    }
    async processLoginProfileSubdirectory(directoryPath, folderName, nestedProfiles, globalCallsigns) {
        const folderPath = path_1.default.join(directoryPath, folderName);
        const profileFiles = await this.findProfileFiles(folderPath);
        if (profileFiles.length === 0)
            return;
        const sortedFiles = this.sortProfileFilesByPriority(profileFiles);
        for (const profileFile of sortedFiles) {
            const fileName = path_1.default.basename(profileFile, ".txt");
            if (!fileName.includes("Profiles"))
                continue;
            try {
                const parsedProfiles = await this.parseLoginProfiles(profileFile);
                const groupKey = this.createGroupKey(fileName, folderName);
                this.addProfilesToGroup(parsedProfiles, groupKey, nestedProfiles, globalCallsigns);
            }
            catch (error) {
                (0, logger_1.logATCDataParsingError)(`Failed to parse profile file ${profileFile}: ${error}`);
            }
        }
    }
    sortProfileFilesByPriority(profileFiles) {
        return profileFiles.sort((a, b) => {
            const aBasename = path_1.default.basename(a);
            const bBasename = path_1.default.basename(b);
            if (aBasename === "Profiles.txt")
                return -1;
            if (bBasename === "Profiles.txt")
                return 1;
            const aComplexity = (aBasename.match(/[_\-]/g) || []).length;
            const bComplexity = (bBasename.match(/[_\-]/g) || []).length;
            return aComplexity - bComplexity;
        });
    }
    createGroupKey(fileName, folderName) {
        let groupSuffix = fileName === "Profiles" ? "" : fileName.replace("Profiles", "");
        groupSuffix = groupSuffix.replace(/[_\-]/g, " ").trim();
        return groupSuffix ? `${folderName} ${groupSuffix}` : folderName;
    }
    addProfilesToGroup(parsedProfiles, groupKey, nestedProfiles, globalCallsigns) {
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
    async findProfileFiles(directoryPath) {
        try {
            const files = await fs_1.default.promises.readdir(directoryPath);
            return files.filter((file) => file.includes("Profiles") && file.endsWith(".txt")).map((file) => path_1.default.join(directoryPath, file));
        }
        catch (error) {
            (0, logger_1.logATCDataParsingError)(`Failed to read directory ${directoryPath}: ${error}`);
            return [];
        }
    }
    organizeProfilesByCallsignPrefix(profiles) {
        const organized = {};
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
    async parseLoginProfiles(loginProfilesFile) {
        try {
            const profiles = await fs_1.default.promises.readFile(loginProfilesFile, "utf-8");
            const lines = profiles.split("\n");
            const data = {};
            let currentProfile = "";
            this.callsignToFacilityMap = {};
            for (const line of lines) {
                const trimmedLine = line.trim();
                if (this.isProfileLine(trimmedLine)) {
                    currentProfile = this.parseProfileLine(trimmedLine, data);
                }
                else if (this.isAtisLine(trimmedLine) && currentProfile) {
                    this.parseAtisLine(trimmedLine, data[currentProfile]);
                }
            }
            return data;
        }
        catch (error) {
            (0, logger_1.logATCDataParsingError)(`Failed to parse login profiles from ${loginProfilesFile}: ${error}`);
            return {};
        }
    }
    isProfileLine(line) {
        return line.startsWith("PROFILE:");
    }
    isAtisLine(line) {
        return line.startsWith("ATIS");
    }
    parseProfileLine(line, data) {
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
    parseAtisLine(line, profile) {
        const elements = line.split(":");
        const atisLineNum = Number(elements[0]?.substring(4));
        if (atisLineNum >= 1 && atisLineNum <= 4) {
            profile[`atisLine${atisLineNum}`] = elements[1] || "";
        }
    }
    transformSectorsAndBorderLines(parsedEseContent) {
        const sectors = {};
        const borderLines = {};
        const positions = {};
        this.createBorderLines(parsedEseContent, borderLines);
        this.createPositions(parsedEseContent, positions);
        this.createSectors(parsedEseContent, sectors, positions);
        this.assignSectorsToPositions(parsedEseContent, sectors, positions);
        return { sectors, borderLines, positions };
    }
    createBorderLines(parsedEseContent, borderLines) {
        parsedEseContent.sectorLines.forEach((sectorLine) => {
            borderLines[sectorLine.id] = {
                id: sectorLine.id,
                lines: sectorLine.points,
            };
        });
    }
    createPositions(parsedEseContent, positions) {
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
    determineFacility(pos, callsign) {
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
    createSectors(parsedEseContent, sectors, positions) {
        const completedIdentifiers = new Set();
        let sectorIdCounter = 1000;
        // Process sectors with volumes
        for (const oldSector of parsedEseContent.sectors) {
            if (!oldSector.owners || oldSector.owners.length === 0)
                continue;
            const identifier = oldSector.owners[0];
            if (completedIdentifiers.has(identifier))
                continue;
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
    createSectorFromEseData(parsedEseContent, identifier, sectorId, positions) {
        const relatedSectors = parsedEseContent.sectors.filter((s) => s.owners && s.owners.length > 0 && s.owners[0] === identifier);
        const position = parsedEseContent.position.find((p) => p.identifier === identifier);
        if (!position) {
            (0, logger_1.logATCDataParsingWarning)(`No position found for identifier ${identifier}`);
            return null;
        }
        const callsign = position.callsign;
        const anchor = callsign.split(/[\*_]/)[0];
        const facility = positions[callsign]?.facility || 0;
        const frequency = this.parseFrequency(position.frequency);
        const sector = {
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
    parseFrequency(frequency) {
        try {
            return parseInt(frequency.replace(".", "")) * 1000 || 0;
        }
        catch {
            return 0;
        }
    }
    addVolumesToSector(relatedSectors, sector) {
        const activeAirports = new Set();
        for (const relatedSector of relatedSectors) {
            const volume = {
                id: relatedSector.name,
                definition: relatedSector.borders || [],
                floor: relatedSector.floor,
                ceiling: relatedSector.ceiling,
                activationCondition: relatedSector.actives,
                displaySectorLines: relatedSector.displaySectorLines || [],
            };
            // Collect active airports
            if (relatedSector.depApts?.length > 0) {
                relatedSector.depApts.forEach((apt) => activeAirports.add(apt));
            }
            if (relatedSector.arrApts?.length > 0) {
                relatedSector.arrApts.forEach((apt) => activeAirports.add(apt));
            }
            sector.volumes.push(volume);
        }
        sector.activeAirports = Array.from(activeAirports);
    }
    createEmptySectorsForRemainingPositions(parsedEseContent, sectors, positions, completedIdentifiers, sectorIdCounter) {
        parsedEseContent.position.forEach((pos) => {
            const identifier = pos.identifier;
            if (completedIdentifiers.has(identifier))
                return;
            const callsign = pos.callsign;
            const anchor = callsign.split(/[\*_]/)[0];
            const facility = positions[callsign]?.facility || 0;
            const frequency = this.parseFrequency(pos.frequency);
            const emptySector = {
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
    populateSectorOwners(parsedEseContent, sectors) {
        for (const oldSector of parsedEseContent.sectors) {
            if (!oldSector.owners || oldSector.owners.length === 0)
                continue;
            const primaryIdentifier = oldSector.owners[0];
            if (!sectors[primaryIdentifier])
                continue;
            const sectorOwners = [...new Set(oldSector.owners.slice(1))];
            for (const owner of sectorOwners) {
                if (!sectors[primaryIdentifier].owners.includes(owner)) {
                    sectors[primaryIdentifier].owners.push(owner);
                }
            }
        }
    }
    assignSectorsToPositions(parsedEseContent, sectors, positions) {
        const ownedSectors = this.buildOwnedSectorsMap(parsedEseContent, sectors);
        const controllableSectors = this.buildControllableSectorsMap(parsedEseContent);
        for (const [callsign, position] of Object.entries(positions)) {
            const ownedSectorsForPosition = ownedSectors[callsign] || [];
            const controllableSectorsForPosition = this.filterControllableSectors(controllableSectors[callsign] || new Set(), position.facility, sectors);
            position.sectors = [...ownedSectorsForPosition, ...controllableSectorsForPosition.filter((sector) => !ownedSectorsForPosition.includes(sector))];
        }
    }
    buildOwnedSectorsMap(parsedEseContent, sectors) {
        const ownedSectors = {};
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
    buildControllableSectorsMap(parsedEseContent) {
        const controllableSectors = {};
        for (const oldSector of parsedEseContent.sectors) {
            if (!oldSector.owners || oldSector.owners.length === 0)
                continue;
            const primaryIdentifier = oldSector.owners[0];
            for (const ownerIdentifier of oldSector.owners) {
                const matchingPositions = parsedEseContent.position.filter((p) => p.identifier === ownerIdentifier);
                for (const pos of matchingPositions) {
                    if (!controllableSectors[pos.callsign]) {
                        controllableSectors[pos.callsign] = new Set();
                    }
                    controllableSectors[pos.callsign].add(primaryIdentifier);
                }
            }
        }
        return controllableSectors;
    }
    filterControllableSectors(controllableSectors, positionFacility, sectors) {
        const controllableSectorsArray = Array.from(controllableSectors);
        if (positionFacility > 4) {
            return controllableSectorsArray.filter((sectorId) => {
                const sector = sectors[sectorId];
                return sector && sector.facility === positionFacility;
            });
        }
        return controllableSectorsArray;
    }
    async parseIcaoAirline(icaoAirlinesPath) {
        try {
            const content = await fs_1.default.promises.readFile(icaoAirlinesPath, "utf-8");
            const lines = content.split("\n");
            const data = {};
            for (const line of lines) {
                if (line.startsWith(";") || line.trim().length === 0)
                    continue;
                const parts = line.split("\t");
                if (parts.length < 4)
                    continue;
                const airline = {
                    icao: parts[0],
                    name: parts[1],
                    callsign: parts[2],
                    country: parts[3].replace(/\r?\n/g, ""),
                };
                data[airline.icao] = airline;
            }
            return data;
        }
        catch (error) {
            (0, logger_1.logATCDataParsingError)(`Failed to parse ICAO airlines: ${error}`);
            return {};
        }
    }
    async parseIcaoAircraft(icaoAircraftPath, recatDefinitionPath) {
        try {
            const content = await fs_1.default.promises.readFile(icaoAircraftPath, "utf-8");
            const recatDef = await this.loadRecatDefinition(recatDefinitionPath);
            const lines = content.split("\n");
            const data = {};
            for (const line of lines) {
                if (line.startsWith(";") || line.trim().length === 0)
                    continue;
                const parts = line.split("\t");
                if (parts.length < 4)
                    continue;
                const icao = parts[0];
                const engines = parts[1].slice(1);
                const wakeCat = parts[1].charAt(0);
                const recat = recatDef?.find((rd) => rd.icao === icao)?.categoryLabel || "";
                const aircraft = {
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
        }
        catch (error) {
            `Failed to parse ICAO aircraft: ${error}`;
            return {};
        }
    }
    async loadRecatDefinition(recatDefinitionPath) {
        if (!recatDefinitionPath)
            return undefined;
        try {
            const recatData = await fs_1.default.promises.readFile(recatDefinitionPath, "utf-8");
            return JSON.parse(recatData);
        }
        catch (error) {
            (0, logger_1.logATCDataParsingWarning)(`Failed to load RECAT definition: ${error}`);
            return undefined;
        }
    }
    async parseAlias(aliasPath) {
        try {
            const content = await fs_1.default.promises.readFile(aliasPath, "utf-8");
            const lines = content.split("\n");
            const data = {};
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
        }
        catch (error) {
            (0, logger_1.logATCDataParsingError)(`Failed to parse alias data: ${error}`);
            return {};
        }
    }
}
exports.atcData = new AtcDataManager();
//# sourceMappingURL=atc-data-parser.js.map