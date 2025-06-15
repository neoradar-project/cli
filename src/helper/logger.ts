import winston from 'winston';

export let sctParsingErrorCount = 0;
export let eseParsingErrorCount = 0;
export let atcDataParsingErrorCount = 0;

const transports = {
  console: new winston.transports.Console({ level: 'warn' }),
  file: new winston.transports.File({ filename: 'neoradar-cli.log' })
};

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.cli(),
  defaultMeta: { service: 'user-service' },
  transports: [
    transports.console,
    transports.file
  ],
});

export default logger;

export const logESEParsingError = (message: string, ...meta: any[]) => {
  eseParsingErrorCount++;
  logger.error(`ESE Parsing error #${eseParsingErrorCount}: ${message}`, ...meta);
};

export const logESEParsingWarning = (message: string, ...meta: any[]) => {
  eseParsingErrorCount++;
  logger.warn(`ESE Parsing warning #${eseParsingErrorCount}: ${message}`, ...meta);
};

export const logSCTParsingError = (message: string, ...meta: any[]) => {
  sctParsingErrorCount++;
  logger.error(`SCT Parsing error #${sctParsingErrorCount}: ${message}`, ...meta);
};

export const logSCTParsingWarning = (message: string, ...meta: any[]) => {
  sctParsingErrorCount++;
  logger.warn(`SCT Parsing warning #${sctParsingErrorCount}: ${message}`, ...meta);
};

export const logATCDataParsingError = (message: string, ...meta: any[]) => {
  atcDataParsingErrorCount++;
  logger.error(`ATC Data Parsing error #${atcDataParsingErrorCount}: ${message}`, ...meta);
};

export const logATCDataParsingWarning = (message: string, ...meta: any[]) => {
  atcDataParsingErrorCount++;
  logger.warn(`ATC Data Parsing warning #${atcDataParsingErrorCount}: ${message}`, ...meta);
};