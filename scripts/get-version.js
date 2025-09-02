// scripts/generate-version.js
const fs = require('fs');
const packageJson = require('../package.json');

const versionInfo = {
  version: packageJson.version,
  buildTime: new Date().toISOString()
};

fs.writeFileSync(
  './src/version.json', 
  JSON.stringify(versionInfo, null, 2)
);