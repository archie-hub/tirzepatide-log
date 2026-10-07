// Cloud sync tests. The page is served at http://localhost:8080/ (a registered callback URL) from the local
// index.html, and Cognito plus the sync API are replaced by an in-memory fake that follows the same contract as
// tirzepatide-cloud/lambda_src/handler.py (last write wins on updatedAt, tombstones, `since` cursor on syncedAt).
const { test, expect } = require('@playwright/test');
const path = require('path');
const { backend, APP, COGNITO, API, CORS } = require('./fake-cloud');


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
  await page.locator('#landingSignIn').click();
  await expect(page.locator('#cloudStatus')).toContainText('Last synced');
}
async function storedEntries(page) { return page.evaluate(() => JSON.parse(localStorage.getItem('tirzepatide-log-v1') || '[]')); }

test('hosted and signed out: only the landing page shows, even with a log on this device, and nothing is fetched', async ({ page }) => {
  const b = backend(); await b.install(page);
  const seen = [];
  page.on('request', (r) => seen.push(r.url()));
  await seedLocal(page, [row('2026-03-01', 200)]);
  await page.goto(APP);
  await expect(page.locator('html')).toHaveClass(/landing/);
  await expect(page.locator('#landing')).toBeVisible();
  await expect(page.locator('#landing h1')).toHaveText('Tirzepatide Log');
  await expect(page.locator('#landing a[href="https://www.phoe.be/#contact"]')).toBeVisible();
  for (const sel of ['header.hero', '#stats', '#plan', '#chartPanel', '#entriesPanel', '#formPanel', '#shareOpen', '#settingsOpen', '#resetBtn', '#foot']) await expect(page.locator(sel)).toBeHidden();
  expect(await page.evaluate(() => document.body.innerText)).not.toMatch(/\d+ entries|Latest weight|Export CSV|Clear all data|Add entry|lbs/);   // what a visitor can read
  expect(seen.filter((u) => /execute-api/.test(u))).toEqual([]);   // no API call before sign-in
  expect(b.authHeaders).toEqual([]);
});

test('landing: Sign in brings the app in, Sign out brings the landing page back and keeps the log on the device', async ({ page }) => {
  const b = backend(); await b.install(page);
  await seedLocal(page, [row('2026-03-01', 200)]);
  await page.goto(APP);
  await page.locator('#landingSignIn').click();
  await expect(page.locator('#subtitle')).toContainText('1 entries');
  await expect(page.locator('#landing')).toBeHidden();
  await expect(page.locator('html')).not.toHaveClass(/landing/);
  await expect(page.locator('#stats')).toBeVisible();
  await expect(page.locator('#settingsOpen')).toBeVisible();
  await expect(page.locator('#shareOpen')).toBeVisible();
  await page.locator('#settingsOpen').click();
  await expect(page.locator('#cloudBox')).toBeVisible();
  await page.locator('#cloudOut').click();
  await page.evaluate(() => { const d = document.getElementById('setDlg'); if (d.open) d.close(); });
  await expect(page.locator('#landing')).toBeVisible();
  await expect(page.locator('#stats')).toBeHidden();
  expect((await storedEntries(page)).length).toBe(1);
  await page.reload();                                                   // still the landing page after a reload
  await expect(page.locator('#landing')).toBeVisible();
});

test('landing: a failed sign-in stays on the landing page with a message, and shows progress while signing in', async ({ page }) => {
  const b = backend(); await b.install(page);
  await page.route('https://tirzlog-sxsz5z.auth.us-east-1.amazoncognito.com/oauth2/token', async (r) => {
    await new Promise((res) => setTimeout(res, 600));
    r.fulfill({ status: 400, contentType: 'application/json', headers: CORS, body: '{"error":"invalid_grant"}' });
  });
  await page.goto(APP);
  await page.locator('#landingSignIn').click();
  await expect(page.locator('#landingSignIn')).toHaveText('Signing you in...');
  await expect(page.locator('#landingSignIn')).toBeDisabled();
  await expect(page.locator('#msg')).toContainText('Sign-in failed');
  await expect(page.locator('#landingSignIn')).toHaveText('Sign in');
  await expect(page.locator('#landing')).toBeVisible();
});

test('opened from disk the app is not gated: no landing page, no cloud section', async ({ page }) => {
  await page.goto('file://' + path.join(__dirname, '..', 'index.html'));
  await expect(page.locator('html')).not.toHaveClass(/landing/);
  await expect(page.locator('#landing')).toBeHidden();
  await expect(page.locator('#emptyPanel')).toBeVisible();
  await page.evaluate(() => document.getElementById('setDlg').showModal());
  await expect(page.locator('#cloudBox')).toBeHidden();
});

test('sign in with PKCE, pull what another device saved, and push local days up', async ({ page }) => {
  const b = backend(); await b.install(page);
  b.put(remote('2026-03-01', 200, 5000));
  b.put(remote('2026-03-08', 198.6, 5000, { glucose: 99, comments: 'from the phone' }));
  await seedLocal(page, [row('2026-03-15', 197)]);
  await page.goto(APP);
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
  await page.goto(APP);
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
  await page.goto(APP);
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
  await page.goto(APP);
  await page.locator('#landingSignIn').click();
  await expect(page.locator('#cloudStatus')).toContainText('not been invited');
  expect(b.entries.size).toBe(0);
  expect((await storedEntries(page)).length).toBe(1);   // local data untouched
});

test('Clear all data signs out and leaves the cloud copy alone; signing out keeps local data', async ({ page }) => {
  const b = backend(); await b.install(page);
  await seedLocal(page, [row('2026-03-01', 200), row('2026-03-08', 199)]);
  await page.goto(APP);
  await signIn(page);
  await expect.poll(() => b.entries.size).toBe(2);
  page.once('dialog', (d) => d.accept());
  await page.locator('#resetBtn').click();
  await expect(page.locator('#landing')).toBeVisible();                  // signed out, so the landing page
  await page.waitForTimeout(2200);                          // longer than the sync debounce
  expect(b.entries.size).toBe(2);
  expect([...b.entries.values()].every((e) => !e.deleted)).toBe(true);
  expect((await storedEntries(page)).length).toBe(0);
  // signing in again brings everything back
  await page.locator('#landingSignIn').click();
  await expect(page.locator('#subtitle')).toContainText('2 entries');
  // sign out keeps what is on the device
  await openSettings(page);
  await page.locator('#cloudOut').click();
  await expect(page.locator('#landing')).toBeVisible();
  expect((await storedEntries(page)).length).toBe(2);
});

test('the tokens survive a reload and a long-expired access token is refreshed', async ({ page }) => {
  const b = backend(); await b.install(page);
  await seedLocal(page, [row('2026-03-01', 200)]);
  await page.goto(APP);
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
  await page.goto(APP);
  await page.locator('#landingSignIn').click();
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

const SHARE_TOKEN = 'T01' + 'x'.repeat(40);
const sampleLog = (b) => {
  b.put({ date: '2026-03-01', updatedAt: 1, dose: 2.5, weight: 200, glucose: 98, comments: 'felt sick', foodNotes: 'soup' });
  b.put({ date: '2026-03-08', updatedAt: 1, dose: 2.5, weight: 198.6 });
  b.put({ date: '2026-03-15', updatedAt: 1, deleted: true });
  b.settings = { goal: 180, units: 'uk', compare: ['weight'], updatedAt: 1, syncedAt: 5 };
};

test('owner: create a doctor link (copied), see it listed, revoke it', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const b = backend(); await b.install(page);
  await seedLocal(page, [row('2026-03-01', 200)]);
  await page.goto(APP);
  await signIn(page);
  await page.locator('#shareOpen').click();
  await expect(page.locator('#shareDlg')).toBeVisible();
  await page.locator('#shCreate').click();
  await expect(page.locator('#shMsg')).toContainText('created');
  await expect(page.locator('#shList li')).toHaveCount(1);
  await expect(page.locator('#shList li')).toContainText('without notes');
  await expect(page.locator('#shList code')).toHaveText(APP + '#share=' + SHARE_TOKEN);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(APP + '#share=' + SHARE_TOKEN);
  await page.locator('#shNotes').check();
  await page.locator('#shCreate').click();
  await expect(page.locator('#shList li')).toHaveCount(2);
  await expect(page.locator('#shList li').nth(1)).toContainText('with notes');
  page.once('dialog', (d) => d.accept());
  await page.locator('#shList li').first().getByRole('button', { name: 'Revoke' }).click();
  await expect(page.locator('#shList li')).toHaveCount(1);
  expect(b.shares.has(SHARE_TOKEN)).toBe(false);
});

test('a signed-out visitor never sees the doctor link controls', async ({ page }) => {
  const b = backend(); await b.install(page);
  await page.goto(APP);
  await expect(page.locator('#landing')).toBeVisible();
  await expect(page.locator('#shareOpen')).toBeHidden();
  await expect(page.locator('#shareDlg')).toBeHidden();
});
test('doctor: a link opens a read-only view of the log, without notes unless the patient chose them', async ({ page }) => {
  const b = backend(); await b.install(page);
  sampleLog(b);
  b.shares.set(SHARE_TOKEN, { createdAt: 1, notes: false });
  await page.goto(APP + '#share=' + SHARE_TOKEN);
  await expect(page.locator('#subtitle')).toContainText('2 entries');
  await expect(page.locator('header.hero h1')).toHaveText('Shared tirzepatide log');
  await expect(page.locator('#foot')).toContainText('Read-only view shared by the patient');
  // nothing to edit
  for (const sel of ['#formPanel', '#openImport', '#resetBtn', '#shareOpen', '#settingsOpen', '#backupNote', '#emptyPanel']) await expect(page.locator(sel)).toBeHidden();
  await page.locator('#entriesPanel > summary').click();
  await expect(page.locator('#rows tr')).toHaveCount(2);
  await expect(page.locator('[data-edit]:visible, [data-del]:visible, [data-settings]:visible')).toHaveCount(0);
  await expect(page.locator('#rows')).not.toContainText('felt sick');
  // the patient's units came with the link
  await expect(page.locator('#stats')).toContainText('st');
  // nothing was stored in this browser, and nothing was sent to the server except the one public read
  const keys = await page.evaluate(() => Object.keys(localStorage));
  expect(keys).toEqual([]);
  expect(b.authHeaders).toEqual([]);
  expect(b.puts).toEqual([]);
});

test('doctor: notes appear when the patient chose to include them', async ({ page }) => {
  const b = backend(); await b.install(page);
  sampleLog(b);
  b.shares.set(SHARE_TOKEN, { createdAt: 1, notes: true });
  await page.goto(APP + '#share=' + SHARE_TOKEN);
  await page.locator('#entriesPanel > summary').click();
  await expect(page.locator('#rows')).toContainText('felt sick');
});

test('doctor: a doctor who also uses the app keeps their own log untouched', async ({ page }) => {
  const b = backend(); await b.install(page);
  sampleLog(b);
  b.shares.set(SHARE_TOKEN, { createdAt: 1, notes: false });
  const mine = [row('2025-01-01', 150)];
  await seedLocal(page, mine);
  await page.goto(APP + '#share=' + SHARE_TOKEN);
  await expect(page.locator('#subtitle')).toContainText('2 entries');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('tirzepatide-log-v1')))).toEqual(mine);
  await page.goto(APP);                                                  // back to their own app
  await expect(page.locator('#subtitle')).toContainText('1 entries');
});

test('doctor: a revoked or unknown link says so and shows nothing', async ({ page }) => {
  const b = backend(); await b.install(page);
  sampleLog(b);
  await page.goto(APP + '#share=' + SHARE_TOKEN);                        // never created, like a revoked one
  await expect(page.locator('#msg')).toContainText('no longer available');
  await expect(page.locator('#subtitle')).not.toContainText('entries,');
  await expect(page.locator('#stats')).toBeHidden();
});

test('doctor: the link also works from the phoe.be page that embeds the app', async ({ page }) => {
  const b = backend(); await b.install(page);
  sampleLog(b);
  b.shares.set(SHARE_TOKEN, { createdAt: 1, notes: false });
  await page.route('http://localhost:8080/wrapper', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<iframe id="f" src="/" style="width:900px;height:700px"></iframe>' }));
  await page.goto('http://localhost:8080/wrapper#share=' + SHARE_TOKEN);
  await expect(page.frameLocator('#f').locator('#subtitle')).toContainText('2 entries');
});

test('a malformed share fragment is not a doctor link: the landing page shows and nothing of the log', async ({ page }) => {
  const b = backend(); await b.install(page);
  await seedLocal(page, [row('2026-03-01', 200)]);
  await page.goto(APP + '#share=short');
  await expect(page.locator('#landing')).toBeVisible();
  await expect(page.locator('#stats')).toBeHidden();
  expect(b.authHeaders).toEqual([]);
});

test('auto sync: a saved entry reaches the server by itself, and leaving the tab pushes at once', async ({ page }) => {
  const b = backend(); await b.install(page);
  await seedLocal(page, [row('2026-03-01', 200)]);
  await page.goto(APP);
  await signIn(page);
  await page.locator('#formPanel > summary').click();
  await page.locator('#fDate').fill('2026-03-08');
  await page.locator('#fWeight').fill('199.5');
  await page.locator('#saveBtn').click();
  await expect.poll(() => b.entries.get('2026-03-08')?.weight, { timeout: 5000 }).toBe(199.5);   // no Sync now click
  // another edit, then the tab is hidden before the 1.5 s debounce: it is sent straight away
  await page.locator('#fDate').fill('2026-03-15');
  await page.locator('#fWeight').fill('198.1');
  await page.locator('#saveBtn').click();
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect.poll(() => b.entries.get('2026-03-15')?.weight, { timeout: 1200 }).toBe(198.1);
  // coming back to the tab catches up with what another device saved
  b.put({ date: '2026-03-22', updatedAt: Date.now() + 50000, dose: 2.5, weight: 197 });
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('tirzepatide-sync')); s.last = Date.now() - 60000; localStorage.setItem('tirzepatide-sync', JSON.stringify(s)); });
  await page.reload();
  await expect.poll(async () => (await storedEntries(page)).some((e) => e.date === '2026-03-22'), { timeout: 5000 }).toBe(true);
});

test('a Sign out button sits at the top of the page when signed in, and it signs out', async ({ page }) => {
  const b = backend(); await b.install(page);
  await seedLocal(page, [row('2026-03-01', 200)]);
  await page.goto(APP);
  await expect(page.locator('#heroOut')).toBeHidden();                   // landing page: nothing to sign out of
  await signIn(page);
  await expect(page.locator('#heroOut')).toBeVisible();
  await expect(page.locator('#heroOut')).toHaveText('Sign out');
  await page.locator('#heroOut').click();
  await expect(page.locator('#landing')).toBeVisible();
  await expect(page.locator('#heroOut')).toBeHidden();
  expect((await storedEntries(page)).length).toBe(1);                    // the log stays on this device
  expect(await page.evaluate(() => localStorage.getItem('tirzepatide-sync'))).toBeNull();
});

test('doctor view has no Sign out button', async ({ page }) => {
  const b = backend(); await b.install(page);
  sampleLog(b);
  b.shares.set(SHARE_TOKEN, { createdAt: 1, notes: false });
  await page.goto(APP + '#share=' + SHARE_TOKEN);
  await expect(page.locator('#subtitle')).toContainText('2 entries');
  await expect(page.locator('#heroOut')).toBeHidden();
});

test('the not-synced note names the day as a button that opens it for editing, and fixing it syncs it', async ({ page }) => {
  const b = backend(); await b.install(page);
  await seedLocal(page, [row('2026-03-01', 200), row('2026-03-08', 199, { waist: 555 }), row('2026-03-15', 198)]);
  await page.goto(APP);
  await signIn(page);
  const fix = page.locator('#backupNote button[data-fix]');
  await expect(fix).toHaveText('2026-03-08');
  await expect(page.locator('#backupNote')).toContainText('Click the date to fix it');
  await fix.click();
  await expect(page.locator('#fDate')).toHaveValue('2026-03-08');
  await expect(page.locator('#fWaist')).toHaveValue('555');
  await page.locator('#fWaist').fill('40');
  await page.locator('#saveBtn').click();
  await expect.poll(() => b.entries.has('2026-03-08'), { timeout: 8000 }).toBe(true);
  await expect(page.locator('#backupNote button[data-fix]')).toHaveCount(0);
});

test('pull down from the top of the page to sync (touch screens)', async ({ page }) => {
  const b = backend(); await b.install(page);
  await seedLocal(page, [row('2026-03-01', 200)]);
  await page.goto(APP);
  await signIn(page);
  await page.waitForTimeout(300);
  b.put({ date: '2026-03-22', updatedAt: Date.now() + 50000, dose: 2.5, weight: 197 });   // saved on another device
  const pull = (from, to) => page.evaluate(([a, z]) => {
    const t = (y) => new Touch({ identifier: 1, target: document.body, clientX: 100, clientY: y });
    document.dispatchEvent(new TouchEvent('touchstart', { touches: [t(a)], changedTouches: [t(a)], bubbles: true }));
    document.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [t(z)], bubbles: true }));
  }, [from, to]);
  await pull(300, 340);                                                                      // a short drag does nothing
  await page.waitForTimeout(400);
  expect((await storedEntries(page)).some((e) => e.date === '2026-03-22')).toBe(false);
  await pull(100, 300);                                                                      // a long pull from the top syncs
  await expect.poll(async () => (await storedEntries(page)).some((e) => e.date === '2026-03-22'), { timeout: 5000 }).toBe(true);
});

// ---- security: the text a user types must never run as code, in their own view or in a doctor's ----
const EVIL = '"><img src=x onerror="window.__xss=(window.__xss||0)+1"><svg onload="window.__xss=(window.__xss||0)+1"><script>window.__xss=(window.__xss||0)+1</script>';
async function xssCount(page) { return page.evaluate(() => window.__xss || 0); }

test('security: hostile text in comments, food notes and site does not run as code in the owner view', async ({ page }) => {
  const b = backend(); await b.install(page);
  await seedLocal(page, [row('2026-03-01', 200, { comments: EVIL, food: EVIL, site: EVIL, sugar: 100 }), row('2026-03-08', 199, { comments: EVIL })]);
  await page.goto(APP);
  await signIn(page);
  await page.locator('#entriesPanel > summary').click();
  await expect(page.locator('#rows')).toContainText('window.__xss');                    // shown as plain text
  expect(await page.locator('#rows img, #rows svg[onload], #rows script').count()).toBe(0);
  for (const tab of ['Glucose', 'Combined', 'Weight']) {
    await page.getByRole('tab', { name: tab }).click().catch(() => {});
    await page.locator('#chart svg').first().hover({ position: { x: 300, y: 100 } }).catch(() => {});
  }
  expect(await xssCount(page)).toBe(0);
});

test('security: a hostile patient cannot run code in a doctor\'s browser through a shared link', async ({ page }) => {
  const b = backend(); await b.install(page);
  b.put({ date: '2026-03-01', updatedAt: 1, dose: 2.5, weight: 200, comments: EVIL, foodNotes: EVIL, site: EVIL });
  b.put({ date: '2026-03-08', updatedAt: 1, dose: 2.5, weight: 199, comments: EVIL, foodNotes: EVIL });
  b.shares.set(SHARE_TOKEN, { createdAt: 1, notes: true });                            // notes included, the worst case
  await page.goto(APP + '#share=' + SHARE_TOKEN);
  await expect(page.locator('#subtitle')).toContainText('2 entries');
  await page.locator('#entriesPanel > summary').click();
  await expect(page.locator('#rows')).toContainText('window.__xss');
  expect(await page.locator('#rows img, #rows script').count()).toBe(0);
  await page.locator('#chart svg').first().hover({ position: { x: 300, y: 100 } }).catch(() => {});
  expect(await xssCount(page)).toBe(0);
});

test('security: hostile settings values from the server (units, compare) cannot inject markup', async ({ page }) => {
  const b = backend(); await b.install(page);
  b.put({ date: '2026-03-01', updatedAt: 1, dose: 2.5, weight: 200 });
  b.settings = { goal: 180, units: '<img src=x onerror="window.__xss=1">', compare: ['<img src=x onerror="window.__xss=1">', 'weight'], doseDay: 2, updatedAt: 1, syncedAt: 5 };
  b.shares.set(SHARE_TOKEN, { createdAt: 1, notes: false });
  await page.goto(APP + '#share=' + SHARE_TOKEN);
  await expect(page.locator('#subtitle')).toContainText('1 entries');
  await page.getByRole('tab', { name: 'Combined' }).click().catch(() => {});
  await page.waitForTimeout(500);
  expect(await xssCount(page)).toBe(0);
});

test('security: a doctor cannot export the patient\'s log as a CSV (spreadsheet formulas in notes could attack them)', async ({ page }) => {
  const b = backend(); await b.install(page);
  b.put({ date: '2026-03-01', updatedAt: 1, dose: 2.5, weight: 200, comments: '=HYPERLINK("http://evil.example","click")' });
  b.shares.set(SHARE_TOKEN, { createdAt: 1, notes: true });
  await page.goto(APP + '#share=' + SHARE_TOKEN);
  await expect(page.locator('#subtitle')).toContainText('1 entries');
  await expect(page.locator('#exportBtn')).toBeHidden();
  await expect(page.locator('#backupExport')).toBeHidden();
});

// ---- the app lives at its own host; the old addresses only forward ----
for (const old of ['https://www.phoe.be/tirzepatide-log/', 'https://archie-hub.github.io/tirzepatide-log/']) {
  test(`old address ${old} forwards to the new host, keeps a doctor link's token, and drops the old sign-in`, async ({ page }) => {
    const html = require('fs').readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    const origin = new URL(old).origin;
    const beacons = [];
    await page.route(old + '**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: html }));
    await page.route(origin + '/probe', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<p>probe</p>' }));
    await page.route('https://tirzepatide.phoe.be/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<p id="new-home">new home</p>' }));
    await page.route(COGNITO + '/oauth2/revoke', (r) => { beacons.push(r.request().postData()); r.fulfill({ status: 200, headers: CORS, body: '' }); });
    await page.addInitScript(() => {
      if (location.hostname !== 'tirzepatide.phoe.be' && !localStorage.getItem('seeded-by-test')) {
        localStorage.setItem('seeded-by-test', '1');
        localStorage.setItem('tirzepatide-sync', JSON.stringify({ auth: { access: 'a', refresh: 'old-refresh-token', exp: Date.now() + 1e6 }, init: true }));
        localStorage.setItem('tirzepatide-log-v1', JSON.stringify([{ date: '2026-03-01', dose: 2.5, weight: 200 }]));
      }
    });
    const token = 'T01' + 'x'.repeat(40);
    await page.goto(old + '#share=' + token);
    await expect(page.locator('#new-home')).toBeVisible();
    expect(page.url()).toBe('https://tirzepatide.phoe.be/#share=' + token);
    await expect.poll(() => beacons.length).toBe(1);
    const form = new URLSearchParams(beacons[0]);
    expect(form.get('token')).toBe('old-refresh-token');
    expect(form.get('client_id')).toBe('7bhnc1e4on4g01h0topme3tipl');
    await page.goto(origin + '/probe');
    expect(await page.evaluate(() => localStorage.getItem('tirzepatide-sync'))).toBeNull();            // the sign-in no longer sits where other sites can read it
    expect(await page.evaluate(() => localStorage.getItem('tirzepatide-log-v1'))).not.toBeNull();      // the log itself is left alone for the owner to move
  });
}
