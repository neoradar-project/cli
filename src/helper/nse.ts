import fs from "fs";

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
    fs.writeFileSync(nsePath, JSON.stringify(nseJson));
  } catch (e) {
    throw e;
  }
}
