export interface LoginProfiles {
  callsign: string;
  range: number;
  atisLine1: string;
  atisLine2: string;
  atisLine3: string;
  atisLine4: string;
}

export interface Position {
  callsign: string;
  facility: number;
  sectors: string[]; // First element is primary sector, others are sectors to activate when owned
  anchor: string;
}

export interface IcaoAircraft {
  icao: string;
  engines: string;
  builder: string;
  wakeCat: string;
  recatCat: string;
  name: string;
}

export interface IcaoAirline {
  icao: string;
  name: string;
  callsign: string;
  country: string;
}

export interface BorderLine {
  id: number;
  lines: Array<Array<number>>;
}

export interface Volume {
  id: string;
  definition: number[];
  floor: number;
  ceiling: number;
  activationCondition: any[];
}

export interface Sector {
  id: number; // Internal
  volumes: Volume[];
  owners: string[]; // Array of position identifiers in priority order (first = highest)
  identifier: string; // "LLN" "LS"
  frequency: number;
  activeAirports: string[];
  facility: number;
  anchor: string; // "EGLL" "LFFF"
}

// Updated interface to ONLY support arrays of LoginProfiles as values
export interface NestedLoginProfiles {
  [key: string]: LoginProfiles[];
}

// Updated ATCData interface to include the nested login profiles
export interface ATCData {
  loginProfiles: NestedLoginProfiles;
  positions: Record<string, Position>;
  icaoAircraft: Record<string, IcaoAircraft>;
  icaoAirlines: Record<string, IcaoAirline>;
  alias: Record<string, string>;
  borderLines: Record<number, BorderLine>;
  sectors: Record<string, Sector>;
}

// Enum for facility types (used for mapping from callsign suffix)
export enum AtcPositionType {
  OBS = 0,
  FSS = 1,
  DEL = 2,
  GND = 3,
  TWR = 4,
  APP = 5,
  CTR = 6,
  ATIS = 7,
}

export interface RecatDefinition {
    icao: string;
    categoryLabel: string;
}