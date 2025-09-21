export interface LatLon {
  lat: number;
  lon: number;
}

interface SectorLineDisplay {
  ownedVolume: string;
  compareVolumes: string[];
}

export interface Sector {
  name: string;
  actives: Array<any>;
  owners: string[];
  borders: number[];
  depApts: string[];
  arrApts: string[];
  floor: number;
  ceiling: number;
  displaySectorLines: SectorLineDisplay[];
}

export type CartesianPoint = number[];

export interface SectorLine {
  id: number;
  points: CartesianPoint[];
}

export interface NseNavaid {
  name: string;
  freq: number;
  type: string;
  lat: number;
  lon: number;
  x: number;
  y: number;
  uuid: string;
}

export interface PackageAtcPosition {
  callsign: string;
  name: string;
  frequency: string;
  identifier: string;
  sector: string;
  subSector: string;
  facility: string;
  squawkStart: string;
  squawkEnd: string;
  visibilityPoints: [number, number][];
}

export interface PackageProcedure {
  type: string;
  icao: string;
  name: string;
  runway: string;
  points: string[];
}

export interface PackageMapLayer {
  name: string;
  type: "geojson";
  source?: string;
  defaultStyle?: any;
  hasLabels?: boolean;
  isLabelLayer?: boolean;
}

export interface PackageManifest {
  name: string;
  id: string;
  createdAt: string;
  version: string;
  namespace: string;
  description: string;
  fonts: { alias: string; src: string }[];
  lastActiveProfile: string;
  devDisableAntialiasing: boolean;
  centerPoint: number[];
  mapLayers: PackageMapLayer[];
}
