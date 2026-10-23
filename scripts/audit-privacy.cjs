// Checks source and decoded HTML reports without ever printing matched values.
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const { yauzl } = require('../node_modules/playwright-core/lib/utilsBundle.js');
const credentials = [process.env.NOON_EMAIL, process.env.NOON_EMAIL?.trim(), process.env.NOON_PASSWORD, process.env.NOON_TEST_PHONE].filter(Boolean);
const secrets = [...new Set(credentials.flatMap(value => [value, JSON.stringify(value).slice(1, -1), encodeURIComponent(value)]))];
if (!process.env.NOON_EMAIL || !process.env.NOON_PASSWORD) {
  console.error('Credential audit requires both local credential variables; nothing was verified.');
  process.exit(1);
}
let failures = 0;
function inspect(text, label) {
  if (secrets.some(secret => text.includes(secret))) {
    console.error('Private credential found in:', label);
    failures++;
  }
}
function files(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]);
}
async function inspectZip(buffer) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (error, zip) => {
      if (error) return reject(error);
      zip.on('error', reject);
      zip.on('end', resolve);
      zip.on('entry', entry => {
        if (!/\.(json|txt|md|html)$/.test(entry.fileName)) return zip.readEntry();
        zip.openReadStream(entry, (error, stream) => {
          if (error) return reject(error);
          let text = '';
          stream.on('data', chunk => { text += chunk; });
          stream.on('error', reject);
          stream.on('end', () => { inspect(text, 'decoded report/' + entry.fileName); zip.readEntry(); });
        });
      });
      zip.readEntry();
    });
  });
}
(async () => {
  const results = fs.readdirSync('.').filter(name => name.startsWith('test-results')).flatMap(files);
  const reports = fs.readdirSync('.').filter(name => name.startsWith('playwright-report')).flatMap(files);
  for (const file of [...files('tests'), ...files('scripts'), ...files('docs'), ...results, ...reports, 'README.md', 'package.json', 'package-lock.json', 'tsconfig.json', 'playwright.config.ts', '.env.example']) {
    if (!/\.(ts|js|cjs|json|md|html|txt)$/.test(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    inspect(text, file);
    if (file.endsWith('.html')) {
      const zip = text.match(/data:application\/zip;base64,([A-Za-z0-9+/=]+)/);
      if (zip) await inspectZip(Buffer.from(zip[1], 'base64'));
    }
  }
  console.log(`Credential audit: ${failures ? 'FAILED' : 'passed'} (source and decoded current reports; images/video are not inspected).`);
  process.exitCode = failures ? 1 : 0;
})().catch(() => { console.error('Credential audit could not complete.'); process.exitCode = 1; });
