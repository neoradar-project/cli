"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logTopSkyParsingWarning = exports.logATCDataParsingWarning = exports.logATCDataParsingError = exports.logSCTParsingWarning = exports.logSCTParsingError = exports.logESEParsingWarning = exports.logESEParsingError = exports.topSkyParsingErrorCount = exports.atcDataParsingErrorCount = exports.eseParsingErrorCount = exports.sctParsingErrorCount = void 0;
const winston_1 = __importDefault(require("winston"));
exports.sctParsingErrorCount = 0;
exports.eseParsingErrorCount = 0;
exports.atcDataParsingErrorCount = 0;
exports.topSkyParsingErrorCount = 0;
const transports = {
    console: new winston_1.default.transports.Console({ level: 'warn' }),
    file: new winston_1.default.transports.File({ filename: 'neoradar-cli.log' })
};
const logger = winston_1.default.createLogger({
    level: 'info',
    format: winston_1.default.format.cli(),
    defaultMeta: { service: 'user-service' },
    transports: [
        transports.console,
        transports.file
    ],
});
exports.default = logger;
const logESEParsingError = (message, ...meta) => {
    exports.eseParsingErrorCount++;
    logger.error(`ESE Parsing error #${exports.eseParsingErrorCount}: ${message}`, ...meta);
};
exports.logESEParsingError = logESEParsingError;
const logESEParsingWarning = (message, ...meta) => {
    exports.eseParsingErrorCount++;
    logger.warn(`ESE Parsing warning #${exports.eseParsingErrorCount}: ${message}`, ...meta);
};
exports.logESEParsingWarning = logESEParsingWarning;
const logSCTParsingError = (message, ...meta) => {
    exports.sctParsingErrorCount++;
    logger.error(`SCT Parsing error #${exports.sctParsingErrorCount}: ${message}`, ...meta);
};
exports.logSCTParsingError = logSCTParsingError;
const logSCTParsingWarning = (message, ...meta) => {
    exports.sctParsingErrorCount++;
    logger.warn(`SCT Parsing warning #${exports.sctParsingErrorCount}: ${message}`, ...meta);
};
exports.logSCTParsingWarning = logSCTParsingWarning;
const logATCDataParsingError = (message, ...meta) => {
    exports.atcDataParsingErrorCount++;
    logger.error(`ATC Data Parsing error #${exports.atcDataParsingErrorCount}: ${message}`, ...meta);
};
exports.logATCDataParsingError = logATCDataParsingError;
const logATCDataParsingWarning = (message, ...meta) => {
    exports.atcDataParsingErrorCount++;
    logger.warn(`ATC Data Parsing warning #${exports.atcDataParsingErrorCount}: ${message}`, ...meta);
};
exports.logATCDataParsingWarning = logATCDataParsingWarning;
// Every TopSky data file warning goes through here with its file, its line number and the line
// itself, so a run summary can count them and nothing is dropped silently.
const logTopSkyParsingWarning = (file, lineNumber, line, message) => {
    exports.topSkyParsingErrorCount++;
    logger.warn(`TopSky parsing warning #${exports.topSkyParsingErrorCount}: ${file}:${lineNumber}: ${message} | "${line}"`);
};
exports.logTopSkyParsingWarning = logTopSkyParsingWarning;
//# sourceMappingURL=logger.js.map