"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AtcPositionType = void 0;
// Enum for facility types (used for mapping from callsign suffix)
var AtcPositionType;
(function (AtcPositionType) {
    AtcPositionType[AtcPositionType["OBS"] = 0] = "OBS";
    AtcPositionType[AtcPositionType["FSS"] = 1] = "FSS";
    AtcPositionType[AtcPositionType["DEL"] = 2] = "DEL";
    AtcPositionType[AtcPositionType["GND"] = 3] = "GND";
    AtcPositionType[AtcPositionType["TWR"] = 4] = "TWR";
    AtcPositionType[AtcPositionType["APP"] = 5] = "APP";
    AtcPositionType[AtcPositionType["CTR"] = 6] = "CTR";
    AtcPositionType[AtcPositionType["ATIS"] = 7] = "ATIS";
})(AtcPositionType || (exports.AtcPositionType = AtcPositionType = {}));
//# sourceMappingURL=package-atc-data.js.map