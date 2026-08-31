import { Ora } from "ora";
import fs from "fs";
import { toWgs84 } from "@turf/projection";
import { NseNavaid } from "../../definitions/package-defs";
import { EseHelper, ParsedEseContent } from "../../helper/ese-helper";
import { getFeatureName } from "../../utils";
import { updateNSE } from "../../helper/nse";
import { logESEParsingError, logESEParsingWarning } from "../../helper/logger";

export type NavaidType = "vor" | "ndb" | "fix" | "airport";

export interface EseParseResult {
    parsedEse: ParsedEseContent;
    // Package-dead but artifact-alive: not written to nse.json, embedded in server-dataset.json.
    navaidsByType: Record<NavaidType, NseNavaid[]>;
}

class ESEParser {
    private static readonly NAVAID_TYPES: readonly NavaidType[] = ["vor", "ndb", "fix", "airport"];

    private isGNG = false;
    private datasetOutputPath = "";
    private nsePath = "";

    public async start(
        spinner: Ora,
        eseFilePath: string,
        datasetOutputPath: string,
        isGNG: boolean
    ): Promise<EseParseResult | undefined> {
        this.datasetOutputPath = datasetOutputPath;
        this.isGNG = isGNG;
        this.nsePath = `${datasetOutputPath}/nse.json`;

        spinner.info(`Parsing ESE file: ${eseFilePath}`);
        const parsedEseData = await this.generateNavdata(eseFilePath);

        return parsedEseData;
    }

    private async generateNavdata(eseFilePath: string): Promise<EseParseResult | undefined> {
        try {
            const navaidsByType = await this.processNavaids();
            const allNavaids = ESEParser.NAVAID_TYPES.flatMap((type) => navaidsByType[type]);
            const parsedEse = await this.processEseContent(eseFilePath, allNavaids);

            return parsedEse ? { parsedEse, navaidsByType } : undefined;
        } catch (error) {
            logESEParsingError(`Failed to generate navdata: ${error}`);
            throw error;
        }
    }

    // Navaids feed position/procedure derivation and the server-dataset artifact;
    // the client no longer reads vor/ndb/fix/airport/runway NSE sections so none are emitted.
    private async processNavaids(): Promise<Record<NavaidType, NseNavaid[]>> {
        const navaidsByType: Record<NavaidType, NseNavaid[]> = { vor: [], ndb: [], fix: [], airport: [] };

        for (const type of ESEParser.NAVAID_TYPES) {
            const filePath = `${this.datasetOutputPath}/${type}.geojson`;
            
            if (!fs.existsSync(filePath)) {
                logESEParsingWarning(`${type}.geojson file not found at: ${filePath}`);
                continue;
            }

            try {
                const typeData = this.readGeoJsonFeatures(filePath);
                const processedData = typeData
                    .map(item => this.processNavaidItem(item, type))
                    .filter((item): item is NseNavaid => item !== null);

                navaidsByType[type].push(...processedData);
            } catch (error) {
                logESEParsingError(`Failed to process ${type} navaid data from ${filePath}: ${error}`);
            }
        }

        return navaidsByType;
    }

    private processNavaidItem(item: any, type: string): NseNavaid | null {
        const itemSource = JSON.stringify(item);
        
        if (!item.properties?.uuid) {
            logESEParsingError(`Missing UUID for ${type} navaid: ${item.properties?.name || 'unnamed'}. Source: ${itemSource}`);
            return null;
        }

        if (!item.geometry?.coordinates || !Array.isArray(item.geometry.coordinates)) {
            logESEParsingError(`Invalid geometry coordinates for ${type} navaid: ${item.properties.name}. Source: ${itemSource}`);
            return null;
        }

        const [lon, lat] = item.geometry.coordinates;
        
        if (typeof lon !== 'number' || typeof lat !== 'number') {
            logESEParsingError(`Invalid coordinate values for ${type} navaid ${item.properties.name}: lon=${lon}, lat=${lat}. Source: ${itemSource}`);
            return null;
        }

        try {
            const [wgsLon, wgsLat] = toWgs84([lon, lat]);
            
            const featureName = getFeatureName(item);
            if (!featureName) {
                logESEParsingError(`No valid name found for ${type} navaid: ${item.properties.name}. Source: ${itemSource}`);
                return null;
            }
            
            return {
                name: featureName,
                freq: item.properties.freq,
                type: item.properties.type,
                x: lat,
                y: lon,
                lat: wgsLat,
                lon: wgsLon,
                uuid: item.properties.uuid,
            };
        } catch (error) {
            logESEParsingError(`Failed to transform coordinates for ${type} navaid ${item.properties.name}: ${error}. Source: ${itemSource}`);
            return null;
        }
    }

    private async processEseContent(eseFilePath: string, allNavaids: NseNavaid[]): Promise<ParsedEseContent | undefined> {
        try {
            const eseProcessedData = await EseHelper.parseEseContent(
                eseFilePath,
                allNavaids,
                this.isGNG
            );

            updateNSE(this.datasetOutputPath, "position", eseProcessedData.position);
            // procedure is deliberately NOT written into the packaged nse: the client receives
            // the catalog on the config channel (configSnapshot/configDelta), so a SID/STAR
            // change reaches a connected picker on the vAcc's next publish instead of waiting
            // for a package release. eseProcessedData.procedure still feeds emitServerDataset,
            // which is where the server gets it.

            return eseProcessedData;
        } catch (error) {
            logESEParsingError(`Failed to process ESE content from ${eseFilePath}: ${error}`);
        }
        return undefined;
    }

    private readGeoJsonFeatures(filePath: string): any[] {
        try {
            const content = fs.readFileSync(filePath, "utf-8");
            const parsed = JSON.parse(content);
            
            if (!parsed.features || !Array.isArray(parsed.features)) {
                logESEParsingError(`Invalid GeoJSON format in ${filePath}: missing or invalid features array. File content: ${content.substring(0, 500)}...`);
                return [];
            }
            
            return parsed.features;
        } catch (error) {
            let fileContent = "";
            try {
                fileContent = fs.readFileSync(filePath, "utf-8").substring(0, 500);
            } catch {
                fileContent = "Unable to read file content";
            }
            logESEParsingError(`Failed to read or parse GeoJSON file ${filePath}: ${error}. File content: ${fileContent}...`);
            return [];
        }
    }
}

export const eseParser = new ESEParser();
