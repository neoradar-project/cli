import { Ora } from "ora";
import fs from "fs";
import { Position } from "sector-file-tools";
import { Navaid, Segment } from "sector-file-tools/dist/src/sct";
import { toWgs84 } from "@turf/projection";
import { NseNavaid } from "../../definitions/package-defs";
import { EseHelper, ParsedEseContent } from "../../helper/ese-helper";
import { getFeatureName } from "../../utils";
import { updateNSE } from "../../helper/nse";
import { logESEParsingError, logESEParsingWarning } from "../../helper/logger";

class ESEParser {
    private static readonly NAVAID_TYPES = ["vor", "ndb", "fix", "airport"] as const;
    
    private isGNG = false;
    private datasetOutputPath = "";
    private nsePath = "";

    public async start(
        spinner: Ora,
        eseFilePath: string,
        datasetOutputPath: string,
        isGNG: boolean
    ) {
        this.datasetOutputPath = datasetOutputPath;
        this.isGNG = isGNG;
        this.nsePath = `${datasetOutputPath}/nse.json`;

        spinner.info(`Parsing ESE file: ${eseFilePath}`);
        await this.generateNavdata(eseFilePath);
    }

    private async generateNavdata(eseFilePath: string): Promise<NseNavaid[]> {
        try {
            const allNavaids = await this.processNavaids();
            await this.processRunways();
            await this.processEseContent(eseFilePath, allNavaids);
            
            return allNavaids;
        } catch (error) {
            logESEParsingError(`Failed to generate navdata: ${error}`);
            throw error;
        }
    }

    private async processNavaids(): Promise<NseNavaid[]> {
        const allNavaids: NseNavaid[] = [];

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

                updateNSE(this.datasetOutputPath, type, processedData);
                allNavaids.push(...processedData);
            } catch (error) {
                logESEParsingError(`Failed to process ${type} navaid data from ${filePath}: ${error}`);
            }
        }

        return allNavaids;
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

    private async processRunways(): Promise<void> {
        const runwaysFilePath = `${this.datasetOutputPath}/runway.geojson`;
        
        if (!fs.existsSync(runwaysFilePath)) {
            logESEParsingWarning(`runway.geojson file not found at: ${runwaysFilePath}`);
            return;
        }

        try {
            const runwaysData = this.readGeoJsonFeatures(runwaysFilePath);
            const nseRunways = runwaysData
                .map(item => this.processRunwayItem(item))
                .filter((item): item is any => item !== null);

            updateNSE(this.datasetOutputPath, "runway", nseRunways);
        } catch (error) {
            logESEParsingError(`Failed to process runway data from ${runwaysFilePath}: ${error}`);
        }
    }

    private processRunwayItem(item: any): any | null {
        const itemSource = JSON.stringify(item);
        
        if (!item.properties?.uuid) {
            logESEParsingError(`Missing UUID for runway: ${item.properties?.name || 'unnamed'}. Source: ${itemSource}`);
            return null;
        }

        const featureName = getFeatureName(item);
        if (!featureName) {
            logESEParsingError(`No valid name found for runway: ${item.properties.name}. Source: ${itemSource}`);
            return null;
        }

        return {
            id: item.id,
            name: featureName,
            oppositeId: item.properties.oppositeId,
            type: item.properties.type,
            icao: item.properties.icao,
            uuid: item.properties.uuid,
        };
    }

    private async processEseContent(eseFilePath: string, allNavaids: NseNavaid[]): Promise<void> {
        try {
            const eseProcessedData = await EseHelper.parseEseContent(
                eseFilePath,
                allNavaids,
                this.isGNG
            );

            updateNSE(this.datasetOutputPath, "position", eseProcessedData.position);
            updateNSE(this.datasetOutputPath, "procedure", eseProcessedData.procedure);
        } catch (error) {
            logESEParsingError(`Failed to process ESE content from ${eseFilePath}: ${error}`);
        }
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
