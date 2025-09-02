"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.uuidManager = void 0;
const utils_1 = require("../utils");
class UUIDManager {
    constructor() {
        this.uuidMap = new Map();
        this.typeMap = new Set();
    }
    getSharedUUID(type, name) {
        const formatted = `${type}-${name}`
            .toLowerCase()
            .replace(/[^a-z0-9-]/g, "-");
        return formatted
            .replace(/-+/g, "-") // Replace multiple dashes with single dash
            .replace(/-$/g, ""); // Remove trailing dash
    }
    addUUIDToFeature(feature) {
        if (!feature.properties?.type) {
            console.warn("Feature without type:", feature);
            return;
        }
        const type = feature.properties.type;
        const featureName = (0, utils_1.getFeatureName)(feature);
        if (featureName) {
            // All named features get a consistent ID based on type and name
            let uuid = this.uuidMap.get(`${type}-${featureName}`);
            feature.properties.uuid = uuid ? uuid : this.getSharedUUID(type, featureName);
        }
        else {
            // Features without names get a fallback ID
            console.warn(`Feature ${JSON.stringify(feature)} has no name, assigning fallback UUID.`);
            feature.properties.uuid = `${type}-unnamed-${Date.now()}`;
        }
    }
    getUUIDsForType(type) {
        const uuids = [];
        this.uuidMap.forEach((uuid, key) => {
            if (key.startsWith(type + "-")) {
                const name = key.substring(type.length + 1);
                uuids.push({ name, uuid });
            }
        });
        return uuids;
    }
    registerType(type) {
        this.typeMap.add(type);
    }
    registerTypes(types) {
        types.forEach((type) => this.registerType(type));
    }
    getAllTypes() {
        return Array.from(this.typeMap);
    }
}
exports.uuidManager = new UUIDManager();
//# sourceMappingURL=uuids.js.map