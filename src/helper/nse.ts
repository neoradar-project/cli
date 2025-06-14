import fs from "fs";

export function updateNSE(packagePath: string, key: string, newData: any) {
  try {
    const nsePath = `${packagePath}/package/datasets/nse.json`;
    const nseData = fs.readFileSync(nsePath, "utf-8");
    const nseJson = JSON.parse(nseData);
    nseJson[key] = newData;
    fs.writeFileSync(nsePath, JSON.stringify(nseJson, null, 2));
  } catch (e) {
    throw e;
  }
}
