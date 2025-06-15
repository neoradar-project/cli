import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { PackageConfigFile } from '../definitions/package-config';

export function parseConfig(folderPath: string): PackageConfigFile | null {
    const configPath = join(folderPath, 'config.json');
    
    if (!existsSync(configPath)) {
        return null;
    }
    
    try {
        const configContent = readFileSync(configPath, 'utf-8');
        return JSON.parse(configContent);
    } catch (error) {
        throw new Error(`Failed to parse config.json: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}