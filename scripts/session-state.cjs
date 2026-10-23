const fs = require('fs/promises');
const path = require('path');

function isNoonHost(host) { return host === 'noon.com' || host.endsWith('.noon.com'); }
function filterNoonState(state) {
  return {
    cookies: state.cookies.filter(cookie => isNoonHost(cookie.domain.replace(/^\./, ''))),
    origins: state.origins.filter(origin => {
      try { const url = new URL(origin.origin); return url.protocol === 'https:' && isNoonHost(url.hostname); }
      catch { return false; }
    }),
  };
}
async function verifyNoonSession(page) {
  await page.goto('https://account.noon.com/egypt-ar/profile/', { waitUntil: 'domcontentloaded' });
  await page.locator('input[name="firstName"]').waitFor({ state: 'visible', timeout: 30_000 });
  const url = new URL(page.url());
  if (url.origin !== 'https://account.noon.com' || url.pathname !== '/egypt-ar/profile/') throw new Error('Protected account origin was not verified.');
  await page.getByRole('button', { name: /تسجيل الخروج/ }).first().waitFor({ state: 'visible', timeout: 20_000 });
}
async function saveNoonSession(context, destination = '.auth/state.json') {
  const file = path.resolve(destination);
  const state = filterNoonState(await context.storageState());
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = file + '.tmp';
  await fs.writeFile(temporary, JSON.stringify(state));
  await fs.rename(temporary, file);
}
module.exports = { filterNoonState, verifyNoonSession, saveNoonSession };
