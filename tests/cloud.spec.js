// Cloud sync tests. The page is served at http://localhost:8080/ (a registered callback URL) from the local
// index.html, and Cognito plus the sync API are replaced by an in-memory fake that follows the same contract as
// tirzepatide-cloud/lambda_src/handler.py (last write wins on updatedAt, tombstones, `since` cursor on syncedAt).
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const APP = 'http://localhost:8080/';
const COGNITO = 'https://tirzlog-sxsz5z.auth.us-east-1.amazoncognito.com';
const API = 'https://53bw70yjmk.execute-api.us-east-1.amazonaws.com';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,PUT,OPTIONS' };

function backend({ invited = true } = {}) {
  const s = { entries: new Map(), settings: null, clock: 1000, puts: [], tokenCalls: [], authHeaders: [] };
  s.put = (e) => {   // what the Lambda does
    const cur = s.entries.get(e.date);
    if (cur && cur.updatedAt >= e.updatedAt) return false;
    s.entries.set(e.date, { ...e, syncedAt: ++s.clock });
    return true;
  };
  s.install = async (page) => {
    await page.route(/^http:\/\/localhost:8080\//, (r) => {
      const u = new URL(r.request().url());
      if (u.pathname === '/') return r.fulfill({ status: 200, contentType: 'text/html', body: HTML });
      return r.fulfill({ status: 404, body: '' });
    });
    await page.route(COGNITO + '/oauth2/authorize*', (r) => {
      const u = new URL(r.request().url());
      s.authorizeUrl = u;
      const to = u.searchParams.get('redirect_uri') + '?code=abc123&state=' + u.searchParams.get('state');   // what the hosted login does after a successful sign-in
      r.fulfill({ status: 200, contentType: 'text/html', body: '<script>location.replace(' + JSON.stringify(to) + ')</script>' });
    });
    await page.route(COGNITO + '/oauth2/token', (r) => {
      s.tokenCalls.push(r.request().postData());
      r.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ access_token: 'access-' + s.tokenCalls.length, refresh_token: 'refresh-1', expires_in: 3600 }) });
    });
    await page.route(COGNITO + '/oauth2/revoke', (r) => r.fulfill({ status: 200, headers: CORS, body: '' }));
    await page.route(API + '/**', (r) => {
      const req = r.request(), u = new URL(req.url());
      if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
      s.authHeaders.push(req.headers()['authorization']);
      const send = (status, body) => r.fulfill({ status, contentType: 'application/json', headers: CORS, body: JSON.stringify(body) });
      if (!invited) return send(403, { error: 'not invited' });
      if (u.pathname === '/me') return send(200, { allowed: true });
      if (u.pathname === '/sync') {
        const since = +(u.searchParams.get('since') || 0);
        const entries = [...s.entries.values()].filter((e) => e.syncedAt >= since).sort((a, b) => a.syncedAt - b.syncedAt);
        const settings = s.settings && s.settings.syncedAt >= since ? s.settings : null;
        const cursor = Math.max(since, ...entries.map((e) => e.syncedAt), settings ? settings.syncedAt : 0);
        return send(200, { entries, settings, cursor, hasMore: false });
      }
      const body = JSON.parse(req.postData() || '{}');
      if (u.pathname === '/entries') {
        s.puts.push(body.entries);
        const stale = [];
        let applied = 0;
        const rejected = [];
        body.entries.forEach((e) => {
          if (e.waist > 200) return rejected.push({ date: e.date, error: 'waist out of range' });
          if (s.put(e)) applied++; else stale.push(e.date);
        });
        return send(200, { applied, stale, rejected });
      }
      if (u.pathname === '/settings') {
        const cur = s.settings;
        if (cur && cur.updatedAt >= body.settings.updatedAt) return send(200, { applied: 0 });
        s.settings = { ...body.settings, syncedAt: ++s.clock };
        return send(200, { applied: 1 });
      }
      return send(404, { error: 'not found' });
    });
  };
  return s;
}

const local = (rows) => ({ key: 'tirzepatide-log-v1', rows });
async function seedLocal(page, rows) {
  await page.addInitScript((r) => { if (!localStorage.getItem('tirzepatide-log-v1')) localStorage.setItem('tirzepatide-log-v1', JSON.stringify(r)); }, rows);
}
const row = (date, weight, extra = {}) => ({ date, dose: 2.5, weight, comments: '', cal: null, food: '', sugar: null, site: '', sys: null, dia: null, waist: null, fat: null, muscle: null, ...extra });
const remote = (date, weight, updatedAt, extra = {}) => ({ date, dose: 2.5, weight, updatedAt, ...extra });
async function openSettings(page) { await page.evaluate(() => { const d = document.getElementById('setDlg'); if (!d.open) d.showModal(); }); }
async function closeSettings(page) { await page.evaluate(() => document.getElementById('setDlg').close()); }
async function pressSync(page) { await openSettings(page); await page.locator('#cloudSyncBtn').click(); await closeSettings(page); }
async function signIn(page) {
  await openSettings(page);
  await page.locator('#cloudIn').click();
  await expect(page.locator('#cloudStatus')).toContainText('Last synced');
}
async function storedEntries(page) { return page.evaluate(() => JSON.parse(localStorage.getItem('tirzepatide-log-v1') || '[]')); }

test('the cloud box is hidden unless the page is opened with #cloud, and never exists on file://', async ({ page }) => {
  const b = backend(); await b.install(page);
  await page.goto(APP);
  await openSettings(page);
  await expect(page.locator('#cloudBox')).toBeHidden();
  await page.goto('file://' + path.join(__dirname, '..', 'index.html') + '#cloud');
  await openSettings(page);
  await expect(page.locator('#cloudBox')).toBeHidden();
});

test('sign in with PKCE, pull what another device saved, and push local days up', async ({ page }) => {
  const b = backend(); await b.install(page);
  b.put(remote('2026-03-01', 200, 5000));
  b.put(remote('2026-03-08', 198.6, 5000, { glucose: 99, comments: 'from the phone' }));
  await seedLocal(page, [row('2026-03-15', 197)]);
  await page.goto(APP + '#cloud');
  await signIn(page);

  const u = b.authorizeUrl;
  expect(u.searchParams.get('code_challenge_method')).toBe('S256');
  expect(u.searchParams.get('code_challenge')).toMatch(/^[\w-]{43}$/);
  expect(u.searchParams.get('client_id')).toBe('7bhnc1e4on4g01h0topme3tipl');
  expect(u.searchParams.get('redirect_uri')).toBe(APP);
  const form = new URLSearchParams(b.tokenCalls[0]);
  expect(form.get('grant_type')).toBe('authorization_code');
  expect(form.get('code_verifier')).toMatch(/^[\w-]{64}$/);
  expect(page.url()).not.toContain('code=');                       // the code is removed from the address bar

  await expect(page.locator('#subtitle')).toContainText('3 entries');
  const mine = await storedEntries(page);
  expect(mine.map((e) => e.date)).toEqual(expect.arrayContaining(['2026-03-01', '2026-03-08', '2026-03-15']));
  expect(mine.find((e) => e.date === '2026-03-08')).toMatchObject({ sugar: 99, comments: 'from the phone', weight: 198.6 });
  expect([...b.entries.keys()].sort()).toEqual(['2026-03-01', '2026-03-08', '2026-03-15']);
  expect(b.entries.get('2026-03-15')).toMatchObject({ weight: 197, dose: 2.5 });
  expect(b.authHeaders.every((h) => /^Bearer access-/.test(h))).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem('tirzepatide-log-v1-before-sync'))).toContain('2026-03-15');
});

test('edits and deletes made later reach the server, and a newer server copy wins a conflict', async ({ page }) => {
  const b = backend(); await b.install(page);
  b.put(remote('2026-03-01', 200, 5000));
  await seedLocal(page, [row('2026-03-01', 150), row('2026-03-08', 199)]);   // 03-01 differs from the server; the server's is newer
  await page.goto(APP + '#cloud');
  await signIn(page);
  expect((await storedEntries(page)).find((e) => e.date === '2026-03-01').weight).toBe(200);   // first sync: cloud wins a tie
  expect(b.entries.get('2026-03-08').weight).toBe(199);

  // edit a day through the form
  await page.locator('#formPanel > summary').click();
  await page.locator('#fDate').fill('2026-03-08');
  await page.locator('#fWeight').fill('197.5');
  await page.locator('#saveBtn').click();
  await expect.poll(() => b.entries.get('2026-03-08').weight, { timeout: 8000 }).toBe(197.5);

  // delete a day: the server keeps a tombstone with no health data
  await page.locator('#entriesPanel > summary').click();
  await page.locator('#rows tr', { hasText: 'Mar 8' }).getByRole('button', { name: /Delete/ }).click();
  await expect.poll(() => b.entries.get('2026-03-08').deleted, { timeout: 8000 }).toBe(true);
  expect(b.entries.get('2026-03-08').weight).toBeUndefined();

  // another device edits 03-01 later; Sync now brings it in
  b.put(remote('2026-03-01', 190, Date.now() + 100000));
  await pressSync(page);
  await expect.poll(async () => (await storedEntries(page)).find((e) => e.date === '2026-03-01').weight).toBe(190);
});

test('settings sync: goal, units and injection day travel; the report name does not', async ({ page }) => {
  const b = backend(); await b.install(page);
  await seedLocal(page, [row('2026-03-01', 200)]);
  await page.addInitScript(() => { if (!localStorage.getItem('tirzepatide-settings')) localStorage.setItem('tirzepatide-settings', JSON.stringify({ goal: 180, units: 'uk', doseDay: 2 })); localStorage.setItem('tirzepatide-report-name', 'Jane Doe'); });
  await page.goto(APP + '#cloud');
  await signIn(page);
  expect(b.settings).toMatchObject({ goal: 180, units: 'uk', doseDay: 2 });
  expect(JSON.stringify([...b.puts, b.settings])).not.toContain('Jane');
  b.settings = { goal: 170, units: 'metric', updatedAt: Date.now() + 100000, syncedAt: ++b.clock };
  await pressSync(page);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('tirzepatide-settings')).goal)).toBe(170);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('tirzepatide-settings')).units)).toBe('metric');
});

test('a user who has not been invited sees a clear message and nothing is stored on the server', async ({ page }) => {
  const b = backend({ invited: false }); await b.install(page);
  await seedLocal(page, [row('2026-03-01', 200)]);
  await page.goto(APP + '#cloud');
  await openSettings(page);
  await page.locator('#cloudIn').click();
  await expect(page.locator('#cloudStatus')).toContainText('not been invited');
  expect(b.entries.size).toBe(0);
  expect((await storedEntries(page)).length).toBe(1);   // local data untouched
});

test('Clear all data signs out and leaves the cloud copy alone; signing out keeps local data', async ({ page }) => {
  const b = backend(); await b.install(page);
  await seedLocal(page, [row('2026-03-01', 200), row('2026-03-08', 199)]);
  await page.goto(APP + '#cloud');
  await signIn(page);
  await expect.poll(() => b.entries.size).toBe(2);
  page.once('dialog', (d) => d.accept());
  await page.locator('#resetBtn').click();
  await openSettings(page);
  await expect(page.locator('#cloudIn')).toBeVisible();
  await closeSettings(page);
  await page.waitForTimeout(2200);                          // longer than the sync debounce
  expect(b.entries.size).toBe(2);
  expect([...b.entries.values()].every((e) => !e.deleted)).toBe(true);
  expect((await storedEntries(page)).length).toBe(0);
  // signing in again brings everything back
  await openSettings(page);
  await page.locator('#cloudIn').click();
  await expect(page.locator('#subtitle')).toContainText('2 entries');
  // sign out keeps what is on the device
  await openSettings(page);
  await page.locator('#cloudOut').click();
  await expect(page.locator('#cloudIn')).toBeVisible();
  expect((await storedEntries(page)).length).toBe(2);
});

test('the tokens survive a reload and a long-expired access token is refreshed', async ({ page }) => {
  const b = backend(); await b.install(page);
  await seedLocal(page, [row('2026-03-01', 200)]);
  await page.goto(APP + '#cloud');
  await signIn(page);
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('tirzepatide-sync')); s.auth.exp = Date.now() - 1000; localStorage.setItem('tirzepatide-sync', JSON.stringify(s)); });
  await page.reload();
  await expect.poll(() => b.tokenCalls.length).toBe(2);
  expect(new URLSearchParams(b.tokenCalls[1]).get('grant_type')).toBe('refresh_token');
  await expect(page.locator('#cloudStatus')).toContainText('Last synced');
});

test('one day the server refuses does not block the rest; it is reported and retried only after an edit', async ({ page }) => {
  const b = backend(); await b.install(page);
  await seedLocal(page, [row('2026-03-01', 200), row('2026-03-08', 199, { waist: 555 }), row('2026-03-15', 198)]);
  await page.goto(APP + '#cloud');
  await openSettings(page);
  await page.locator('#cloudIn').click();
  await expect(page.locator('#cloudStatus')).toContainText('1 day was not synced');
  await expect(page.locator('#cloudStatus')).toContainText('2026-03-08');
  expect([...b.entries.keys()].sort()).toEqual(['2026-03-01', '2026-03-15']);
  const sentBefore = b.puts.flat().filter((e) => e.date === '2026-03-08').length;
  await pressSync(page);
  await page.waitForTimeout(500);
  expect(b.puts.flat().filter((e) => e.date === '2026-03-08').length).toBe(sentBefore);   // not resent until edited
  await page.locator('#formPanel > summary').click();
  await page.locator('#fDate').fill('2026-03-08');
  await page.locator('#fWaist').fill('40');
  await page.locator('#saveBtn').click();
  await expect.poll(() => b.entries.has('2026-03-08'), { timeout: 8000 }).toBe(true);
});

test('a log pre-loaded from the site data file is not uploaded unless the visitor says so', async ({ page }) => {
  const b = backend(); await b.install(page);
  await seedLocal(page, [row('2026-03-01', 200)]);
  await page.addInitScript(() => { if (!localStorage.getItem('tirzepatide-settings')) localStorage.setItem('tirzepatide-settings', JSON.stringify({ hostedLoaded: true })); });
  await page.goto(APP + '#cloud');
  await openSettings(page);
  let asked = '';
  page.once('dialog', (d) => { asked = d.message(); d.dismiss(); });
  await page.locator('#cloudIn').click();
  await expect(page.locator('#cloudStatus')).toContainText('Last synced');
  expect(asked).toContain('AJC_DATA.csv');
  expect(b.entries.size).toBe(0);
  expect((await storedEntries(page)).length).toBe(0);
});

test('adding #cloud to a tab that is already open reveals the section without a reload', async ({ page }) => {
  const b = backend(); await b.install(page);
  await page.goto(APP);
  await openSettings(page);
  await expect(page.locator('#cloudBox')).toBeHidden();
  await page.evaluate(() => { location.hash = '#cloud'; });
  await expect(page.locator('#cloudBox')).toBeVisible();
});
