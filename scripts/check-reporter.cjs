// An intentionally failing, entirely offline child run proves that reports,
// console output and error-context files do not retain synthetic credentials.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const dir = path.join(root, 'private-artifacts/audit-reporter-smoke');
fs.mkdirSync(dir, { recursive: true });
const syntheticEmail = 'reporter-check@example.invalid';
const syntheticPassword = 'Synthetic"Password&Only';
fs.writeFileSync(path.join(dir, 'leak.spec.ts'), `
import { test } from '@playwright/test';
test('synthetic reporter failure', async () => {
  const password = process.env.NOON_PASSWORD!;
  process.stdout.write(password.slice(0, 6));
  process.stdout.write(password.slice(6));
  process.stderr.write(process.env.NOON_EMAIL!);
  await test.step('secret step ' + password, async () => {
    throw new Error('synthetic error ' + password + ' ' + process.env.NOON_EMAIL);
  });
});
`);
fs.writeFileSync(path.join(dir, 'config.ts'), `
import base from '../../playwright.config';
export default { ...base, testDir: __dirname, testMatch: 'leak.spec.ts',
  reporter: [[${JSON.stringify(path.join(root, 'scripts/privacy-reporter.ts'))}]],
  outputDir: ${JSON.stringify(path.join(dir, 'results'))} };
`);
const cli = path.join(path.dirname(require.resolve('playwright/package.json')), 'cli.js');
const child = spawnSync(process.execPath, [cli, 'test', '-c', path.join(dir, 'config.ts')], {
  cwd: root, encoding: 'utf8', timeout: 60_000,
  env: { ...process.env, NOON_EMAIL: syntheticEmail, NOON_PASSWORD: syntheticPassword,
    NOON_DEMO_RUN_ID: '', PLAYWRIGHT_HTML_OUTPUT_DIR: path.join(dir, 'report') },
});
function files(folder) {
  return fs.existsSync(folder) ? fs.readdirSync(folder, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(path.join(folder, e.name)) : [path.join(folder, e.name)]) : [];
}
const output = [child.stdout || '', child.stderr || '', ...[...files(path.join(dir, 'results')), ...files(path.join(dir, 'report'))].map(file => fs.readFileSync(file, 'utf8'))].join('\n');
const variants = [syntheticEmail, syntheticPassword, JSON.stringify(syntheticPassword).slice(1, -1), encodeURIComponent(syntheticPassword)];
const reportFile = path.join(dir, 'report/report.json');
const report = fs.existsSync(reportFile) ? JSON.parse(fs.readFileSync(reportFile, 'utf8')) : undefined;
if (child.status !== 1 || report?.tests?.length !== 1 || report.tests[0].status !== 'failed' || variants.some(value => output.includes(value))) {
  console.error('Reporter privacy smoke check FAILED; synthetic evidence kept privately.'); process.exitCode = 1;
} else console.log('Reporter privacy smoke check passed (intentional child failure; zero synthetic credential leaks).');
