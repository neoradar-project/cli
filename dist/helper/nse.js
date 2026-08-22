"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateNSE = updateNSE;
const fs_1 = __importDefault(require("fs"));
// Sections the client no longer reads (local route parser removed). Scrubbed on
// every write because updateNSE merges into pre-existing nse.json files.
const RETIRED_SECTIONS = ["vor", "ndb", "fix", "airport", "runway"];
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
        RETIRED_SECTIONS.forEach((section) => delete nseJson[section]);
        fs_1.default.writeFileSync(nsePath, JSON.stringify(nseJson));
    }
    catch (e) {
        throw e;
    }
}
//# sourceMappingURL=nse.js.map