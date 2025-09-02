"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateNSE = updateNSE;
const fs_1 = __importDefault(require("fs"));
function updateNSE(datasetsPath, key, newData) {
    try {
        const nsePath = `${datasetsPath}/nse.json`;
        if (!fs_1.default.existsSync(nsePath)) {
            fs_1.default.writeFileSync(nsePath, JSON.stringify({}));
            console.log(`Created new NSE file at ${nsePath}`);
        }
        const nseData = fs_1.default.readFileSync(nsePath, "utf-8");
        const nseJson = JSON.parse(nseData);
        nseJson[key] = newData;
        fs_1.default.writeFileSync(nsePath, JSON.stringify(nseJson));
    }
    catch (e) {
        throw e;
    }
}
//# sourceMappingURL=nse.js.map