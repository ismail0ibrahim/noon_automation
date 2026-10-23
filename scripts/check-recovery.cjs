// Child failures are intentional: verify the real Playwright fixture teardown,
// including a test timeout, rather than only testing the cleanup registry.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const dir = path.join(root, 'private-artifacts/audit-recovery-smoke');
const runId = String(Date.now());
fs.mkdirSync(dir, { recursive: true });
const marker = path.join(dir, `cleanup-${runId}.json`);
fs.writeFileSync(path.join(dir, 'recovery.spec.ts'), `
import { test } from '../../tests/fixtures';
import fs from 'fs/promises';
const marker = ${JSON.stringify(marker)};
for (const mode of ['failure', 'timeout']) {
  test('cleanup after ' + mode, async ({ cleanup }) => {
    cleanup.add('offline recovery marker', async () => {
      const records = await fs.readFile(marker, 'utf8').then(JSON.parse, () => []);
      records.push(mode);
      await fs.writeFile(marker, JSON.stringify(records));
    });
    if (mode === 'failure') throw new Error('Intentional offline failure');
    test.setTimeout(200);
    await new Promise(resolve => setTimeout(resolve, 2000));
  });
}
`);
fs.writeFileSync(path.join(dir, 'config.ts'), `
import base from '../../playwright.config';
export default { ...base, testDir: __dirname, testMatch: 'recovery.spec.ts',
 reporter: [[${JSON.stringify(path.join(root, 'scripts/privacy-reporter.ts'))}]],
 outputDir: ${JSON.stringify(path.join(dir, 'results'))} };
`);
const cli = path.join(path.dirname(require.resolve('playwright/package.json')), 'cli.js');
const child = spawnSync(process.execPath, [cli, 'test', '-c', path.join(dir, 'config.ts')], {
  cwd: root, encoding: 'utf8', timeout: 60_000,
  env: { ...process.env, NOON_DEMO_RUN_ID: '', PLAYWRIGHT_HTML_OUTPUT_DIR: path.join(dir, 'report') },
});
const records = fs.existsSync(marker) ? JSON.parse(fs.readFileSync(marker, 'utf8')) : [];
if (child.status !== 1 || records.join(',') !== 'failure,timeout') {
  console.error('Recovery smoke check FAILED; inspect private synthetic results.'); process.exitCode = 1;
} else console.log('Recovery smoke check passed: fixture cleanup ran after failure and timeout.');
