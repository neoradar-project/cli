import DmsCoordinates from "dms-conversion";
import Coordinates from "coordinate-parser";
import { toMercator } from "@turf/projection";
import { logESEParsingError } from "./logger";

export class GeoHelper {
  /**
   * Converts ESE geo coordinates to Cartesian coordinates using Mercator projection
   */
  public convertESEGeoCoordinatesToCartesian(
    latStr: string,
    lonStr: string
  ): [number, number] | null {
    if (!this.isValidInput(latStr, lonStr)) {
      return null;
    }

    try {
      const reformattedLat = this.reformatCoordinates(latStr);
      const reformattedLon = this.reformatCoordinates(lonStr);
      const coordinates = new Coordinates(`${reformattedLat} ${reformattedLon}`);
      
      return toMercator([coordinates.getLongitude(), coordinates.getLatitude()]);
    } catch (error) {
      logESEParsingError(
        'Failed to convert ESE coordinates to Cartesian',
        `Lat: ${latStr}, Lon: ${lonStr}`,
        error instanceof Error ? error.message : 'Unknown error'
      );
      return null;
    }
  }

  /**
   * Converts ESE geo coordinates to decimal degrees
   */
  public convertESEGeoCoordinates(
    latStr: string,
    lonStr: string
  ): { lat: number; lon: number } | null {
    if (!this.isValidInput(latStr, lonStr)) {
      return null;
    }

    try {
      const reformattedLat = this.reformatCoordinates(latStr);
      const reformattedLon = this.reformatCoordinates(lonStr);
      const coordinates = new Coordinates(`${reformattedLat} ${reformattedLon}`);
      
      return { 
        lat: coordinates.getLatitude(), 
        lon: coordinates.getLongitude() 
      };
    } catch (error) {
      logESEParsingError(
        'Failed to convert ESE coordinates to decimal degrees',
        `Lat: ${latStr}, Lon: ${lonStr}`,
        error instanceof Error ? error.message : 'Unknown error'
      );
      return null;
    }
  }

  /**
   * Converts decimal geo coordinates to ESE format
   */
  public convertGeoCoordinatesToESE(latStr: string, lonStr: string): string | null {
    const lat = Number(latStr);
    const lon = Number(lonStr);

    if (!this.isValidDecimalCoordinates(lat, lon)) {
      return null;
    }

    try {
      const dmsConverter = new DmsCoordinates(lat, lon);
      const { longitude, latitude } = dmsConverter.dmsArrays;
      
      const [lonDeg, lonMin, lonSec, lonDir] = longitude;
      const [latDeg, latMin, latSec, latDir] = latitude;
      
      const formattedLon = `${lonDir}${this.formatESEDegrees(lonDeg)}.${this.formatESEMin(lonMin)}.${this.formatESESec(lonSec)}`;
      const formattedLat = `${latDir}${this.formatESEDegrees(latDeg)}.${this.formatESEMin(latMin)}.${this.formatESESec(latSec)}`;
      
      return `${formattedLat}:${formattedLon}`;
    } catch (error) {
      logESEParsingError(
        'Failed to convert decimal coordinates to ESE format',
        `Lat: ${latStr}, Lon: ${lonStr}`,
        error instanceof Error ? error.message : 'Unknown error'
      );
      return null;
    }
  }

  /**
   * Validates input strings are not null, undefined, or empty
   */
  private isValidInput(latStr: string, lonStr: string): boolean {
    return Boolean(latStr?.trim()) && Boolean(lonStr?.trim());
  }

  /**
   * Validates decimal coordinates are within valid ranges
   */
  private isValidDecimalCoordinates(lat: number, lon: number): boolean {
    return !isNaN(lat) && 
           !isNaN(lon) && 
           lat >= -90 && 
           lat <= 90 && 
           lon >= -180 && 
           lon <= 180;
  }

  /**
   * Reformats ESE coordinate string to standard DMS format
   * Expected input format: [N/S/E/W]DDD.MM.SS.SSS
   */
  private reformatCoordinates(coord: string): string {
    if (!coord || typeof coord !== 'string') {
      throw new Error('Invalid coordinate string');
    }

    const parts = coord.split(".");
    if (parts.length !== 4) {
      throw new Error('Invalid ESE coordinate format, expected 4 parts');
    }

    const [degreesPart, minutes, seconds, milliseconds] = parts;
    
    if (degreesPart.length < 4) {
      throw new Error('Invalid degrees part in ESE coordinate');
    }

    const direction = degreesPart.substring(0, 1);
    const degrees = degreesPart.substring(1, 4);

    return `${Number(degrees)}:${minutes}:${seconds}.${milliseconds}${direction}`;
  }

  /**
   * Formats degrees for ESE output (3 digits, zero-padded)
   */
  private formatESEDegrees(degrees: number): string {
    return degrees.toString().padStart(3, '0');
  }

  /**
   * Formats minutes for ESE output (2 digits, zero-padded)
   */
  private formatESEMin(minutes: number): string {
    return minutes.toString().padStart(2, '0');
  }

  /**
   * Formats seconds for ESE output (3 decimal places)
   */
  private formatESESec(seconds: number): string {
    return seconds.toFixed(3);
  }
}

export const geoHelper = new GeoHelper();
