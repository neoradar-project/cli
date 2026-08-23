import fs from "fs";

// Sections the client no longer reads (local route parser removed). Scrubbed on
// every write because updateNSE merges into pre-existing nse.json files.
const RETIRED_SECTIONS = ["vor", "ndb", "fix", "airport", "runway"];

export function updateNSE(datasetsPath: string, key: string, newData: any) {
  try {
    const nsePath = `${datasetsPath}/nse.json`;
    if (!fs.existsSync(nsePath)) {
      fs.writeFileSync(nsePath, JSON.stringify({}));
      console.log(`Created new NSE file at ${nsePath}`);
    }
    const nseData = fs.readFileSync(nsePath, "utf-8");
    const nseJson = JSON.parse(nseData);
    nseJson[key] = newData;
    RETIRED_SECTIONS.forEach((section) => delete nseJson[section]);
    fs.writeFileSync(nsePath, JSON.stringify(nseJson));
  } catch (e) {
    throw e;
  }
}
