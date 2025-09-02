"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseESEProcedure = void 0;
const logger_1 = require("../../../helper/logger");
const utils_1 = require("../../../utils");
const parseESEProcedure = (line) => {
    try {
        const data = line
            .split(":")
            .filter((item) => item !== "")
            .map(utils_1.cleanEndLines);
        if (data.length < 5) {
            (0, logger_1.logESEParsingError)(`Invalid procedure format: expected at least 5 fields, got ${data.length} - line: ${line}`);
            return null;
        }
        const points = data[4]
            .split(" ")
            .filter((item) => item !== "")
            .map(utils_1.cleanEndLines);
        return {
            type: data[0],
            icao: data[1],
            runway: data[2],
            name: data[3],
            points,
        };
    }
    catch (error) {
        (0, logger_1.logESEParsingError)(`Failed to parse procedure: ${error} - line: ${line}`);
        return null;
    }
};
exports.parseESEProcedure = parseESEProcedure;
//# sourceMappingURL=procedure-parser.js.map