import { getFeatureName } from "../utils";

class UUIDManager {

  private uuidMap: Map<string, string> = new Map();
  private typeMap: Set<string> = new Set();

  public getSharedUUID(type: string, name: string): string {
    const formatted = `${type}-${name}`
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-");
    return formatted
      .replace(/-+/g, "-") // Replace multiple dashes with single dash
      .replace(/-$/g, ""); // Remove trailing dash
  }

  public addUUIDToFeature(feature: any): void {
    if (!feature.properties?.type) {
      console.warn("Feature without type:", feature);
      return;
    }
    const type = feature.properties.type;
    const featureName = getFeatureName(feature);
    if (featureName) {
      // All named features get a consistent ID based on type and name
      let uuid = this.uuidMap.get(`${type}-${featureName}`);
      feature.properties.uuid = uuid ? uuid : this.getSharedUUID(type, featureName);
    } else {
      // Features without names get a fallback ID
      console.warn(
        `Feature ${JSON.stringify(feature)} has no name, assigning fallback UUID.`
      );
      feature.properties.uuid = `${type}-unnamed-${Date.now()}`;
    }
  }

  public getUUIDsForType(type: string): Record<string, string>[] {
    const uuids: Record<string, string>[] = [];
    this.uuidMap.forEach((uuid, key) => {
      if (key.startsWith(type + "-")) {
        const name = key.substring(type.length + 1);
        uuids.push({ name, uuid });
      }
    });
    return uuids;
  }

  public registerType(type: string): void {
    this.typeMap.add(type);
  }

  public registerTypes(types: string[]): void {
    types.forEach((type) => this.registerType(type));
  }

  public getAllTypes(): string[] {
    return Array.from(this.typeMap);
  }
}

export const uuidManager = new UUIDManager();
