"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseConfig = parseConfig;
const fs_1 = require("fs");
const path_1 = require("path");
function parseConfig(folderPath) {
    const configPath = (0, path_1.join)(folderPath, 'config.json');
    if (!(0, fs_1.existsSync)(configPath)) {
        return null;
    }
    try {
        const configContent = (0, fs_1.readFileSync)(configPath, 'utf-8');
        return JSON.parse(configContent);
    }
    catch (error) {
        throw new Error(`Failed to parse config.json: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}
//# sourceMappingURL=config.js.map