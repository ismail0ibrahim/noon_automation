// Opt-in live journey launcher. No credential values are passed as arguments.
require('dotenv').config({ quiet: true });
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const demo = process.argv.includes('--demo');
const session = process.argv.includes('--session');
const runId = `journey-${Date.now()}`;
const lock = path.join(root, '.auth', 'journey.lock');
fs.mkdirSync(path.dirname(lock), { recursive: true });
let handle;
try { handle = fs.openSync(lock, 'wx'); }
catch { console.error('A journey lock already exists. Check for an active/interrupted run and its private recovery journal before removing .auth/journey.lock.'); process.exit(1); }
fs.writeFileSync(handle, JSON.stringify({ pid: process.pid, runId }));
const env = { ...process.env, NOON_RUN_LIVE: '1', NOON_HEADED: '1', NOON_REUSE_SESSION: session ? '1' : '0',
  NOON_LOGIN_MODE: process.env.NOON_LOGIN_MODE || 'automatic', NOON_DEMO_RUN_ID: runId };
let released = false;
function release() {
  if (released) return;
  released = true;
  fs.closeSync(handle);
  fs.unlinkSync(lock);
}
process.on('exit', release);
console.log(session ? 'Verifying a saved session; automated login is not tested.' : 'Running the live journey once; recording is disabled.');
const cli = path.join(path.dirname(require.resolve('playwright/package.json')), 'cli.js');
const child = spawn(process.execPath, [cli, 'test', 'tests/full-journey.spec.ts', '--headed', '--workers=1'], {
  cwd: root, env, stdio: 'inherit',
});
child.on('error', () => { console.error('Could not start the journey.'); process.exitCode = 1; release(); });
child.on('exit', code => {
  release();
  if (code !== 0) { process.exitCode = code || 1; return; }
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'private-artifacts/demo/manifest.json'), 'utf8'));
    const expected = session ? [2,3,4,5,6,7,8] : [1,2,3,4,5,6,7,8];
    if (manifest.runId !== runId || manifest.status !== 'passed' || !expected.every(flow => manifest.flows.some(f => f.flow === flow && f.status === 'passed')))
      throw new Error('incomplete');
    console.log(session ? 'Session journey passed; automatic sign-in was not tested.' : 'Journey passed in the configured sign-in mode.');
    if (demo) {
      const replay = spawn(process.execPath, [path.join(root, 'scripts/record-safe-demo.cjs')], { cwd: root, env, stdio: 'inherit' });
      replay.on('error', () => { console.error('Could not start sanitized replay.'); process.exitCode = 1; });
      replay.on('exit', status => { process.exitCode = status || 0; });
    }
  } catch { console.error('Current run is incomplete or skipped; no successful demo is claimed.'); process.exitCode = 1; }
});
