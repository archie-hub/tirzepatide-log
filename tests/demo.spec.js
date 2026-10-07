// The public demo (https://tirzepatide.phoe.be/demo): the whole app filled with made-up data, open to anyone, nothing stored.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const { backend, APP } = require('./fake-cloud');

const DEMO = APP + 'demo';
const HEADER = 'Date,Dosage (mg),Weight (lbs),Comments,Calories,Food Notes,Blood Sugar (mg/dL),Injection Site,Systolic (mmHg),Diastolic (mmHg),Waist (in),Body Fat (%),Muscle Mass (lbs)';

test('the demo opens with no sign-in, shows the full app and the demo banner, and never calls the API', async ({ page }) => {
  const b = backend(); await b.install(page);
  const calls = [];
  page.on('request', (r) => { if (/execute-api|amazoncognito/.test(r.url())) calls.push(r.url()); });
  await page.goto(DEMO);
  await expect(page.locator('html')).not.toHaveClass(/landing/);
  await expect(page.locator('#landing')).toBeHidden();
  await expect(page.locator('#demoBar')).toBeVisible();
  await expect(page.locator('#demoBar')).toContainText('made-up data');
  await expect(page.locator('#demoBar a[href="/"]')).toBeVisible();
  await expect(page.locator('header.hero h1')).toHaveText('Tirzepatide Log (demo)');
  await expect(page.locator('#subtitle')).toContainText('entries');
  await expect(page.locator('#stats')).toBeVisible();
  await expect(page.locator('#chart svg').first()).toBeVisible();
  await expect(page.locator('#foot')).toContainText('Demo with made-up data');
  for (const sel of ['#shareOpen', '#heroOut', '#installBtn', '#backupNote', '#openImport', '#resetBtn']) await expect(page.locator(sel)).toBeHidden();
  await expect(page.locator('#settingsOpen')).toBeVisible();
  await expect(page.locator('#exportBtn')).toBeVisible();
  expect(calls).toEqual([]);                                             // no sync, no login: nothing leaves the browser
  expect(b.authHeaders).toEqual([]);
});

test('the demo fills every field and has the shapes the app shows off', async ({ page }) => {
  const b = backend(); await b.install(page);
  await page.goto(DEMO);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#exportBtn').click()]);
  const csv = fs.readFileSync(await dl.path(), 'utf8').split('\r\n').filter(Boolean);
  expect(csv[0]).toBe(HEADER);
  const rows = csv.slice(1).map((l) => { const out = []; let cur = '', q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out; });
  expect(rows.length).toBeGreaterThan(180); expect(rows.length).toBeLessThan(290);
  const col = (i) => rows.map((r) => r[i]).filter((v) => v !== '');
  for (let i = 0; i < 13; i++) expect(col(i).length, HEADER.split(',')[i]).toBeGreaterThan(8);          // every one of the 13 fields is used
  const dates = rows.map((r) => r[0]);
  expect([...dates].sort()).toEqual(dates);                                                                 // oldest first, no repeats
  expect(new Set(dates).size).toBe(dates.length);
  expect(dates.at(-1)).toBe(new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10));   // ends today
  const doses = [...new Set(col(1).map(Number))].sort((a, c) => a - c);
  expect(doses).toEqual([2.5, 5, 7.5, 10, 12.5, 15]);                                                       // every dose step
  const w = col(2).map(Number);
  expect(w[0]).toBeGreaterThan(205); expect(w.at(-1)).toBeLessThan(200); expect(w.at(-1)).toBeGreaterThan(180);   // a believable loss
  expect(new Set(col(7)).size).toBe(6);                                                                     // all six injection sites
  const gaps = dates.slice(1).map((d, i) => (new Date(d) - new Date(dates[i])) / 86400000);
  expect(Math.max(...gaps)).toBeLessThan(10);                                                               // no long silence: the chart line is unbroken
  expect(col(8).every((v) => +v >= 105 && +v <= 140)).toBe(true);
  expect(col(6).every((v) => +v >= 84 && +v <= 118)).toBe(true);
  expect(col(3).some((c) => /Dose increased/.test(c))).toBe(true);
});

test('every chart and insight has data to show', async ({ page }) => {
  const b = backend(); await b.install(page);
  await page.goto(DEMO);
  await page.locator('#range button[data-days="365"]').click();
  for (const tab of ['weight', 'bmi', 'sugar', 'rate', 'waist', 'bp', 'cal', 'compare']) {
    await page.locator('#tab-' + tab).click();
    await expect(page.locator('#chart svg[role="img"]').first(), tab).toBeVisible();
  }
  await page.locator('#tab-weight').click();
  const path = page.locator('#chart svg path[stroke-width="3.2"]');
  expect(((await path.getAttribute('d')) || '').match(/M/g).length).toBe(1);                                // one unbroken line, no gap
  await page.locator('#insightsPanel > summary').click();
  await expect(page.locator('#insights')).toContainText('Milestones');
  await expect(page.locator('#insights')).toContainText('Best week');
  await expect(page.locator('#stats')).toContainText('Goal: 175');
  await expect(page.locator('#plan')).toContainText('Current dose');
  await expect(page.locator('#plan')).toContainText('15 mg');
  await expect(page.locator('#plan .bmi')).toContainText("5'9\"");
});

test('nothing is stored in the visitor\'s browser, and their own log is left alone', async ({ page }) => {
  const b = backend(); await b.install(page);
  const mine = [{ date: '2025-01-01', dose: 2.5, weight: 150, comments: '', cal: null, food: '', sugar: null, site: '', sys: null, dia: null, waist: null, fat: null, muscle: null }];
  await page.addInitScript((m) => { if (!localStorage.getItem('seeded')) { localStorage.setItem('seeded', '1'); localStorage.setItem('tirzepatide-log-v1', JSON.stringify(m)); localStorage.setItem('tirzepatide-settings', JSON.stringify({ goal: 120 })); } }, mine);
  await page.goto(DEMO);
  await expect(page.locator('#stats')).toContainText('Goal: 175');                                          // the demo's own settings, not theirs
  await page.locator('#range button[data-days="1095"]').click();
  await page.locator('#formPanel > summary').click();
  await page.locator('#fDate').fill('2026-01-01'); await page.locator('#fWeight').fill('199'); await page.locator('#saveBtn').click();
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('tirzepatide-log-v1')))).toEqual(mine);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('tirzepatide-settings')))).toEqual({ goal: 120 });
  expect(await page.evaluate(() => Object.keys(localStorage).sort())).toEqual(['seeded', 'tirzepatide-log-v1', 'tirzepatide-settings']);   // no sync state, no chart range
});

test('edits in the demo live in memory only: an added entry shows, then vanishes on reload', async ({ page }) => {
  const b = backend(); await b.install(page);
  await page.goto(DEMO);
  const before = await page.locator('#subtitle').textContent();
  await page.locator('#formPanel > summary').click();
  await page.locator('#fDate').fill('2020-01-01'); await page.locator('#fWeight').fill('250'); await page.locator('#saveBtn').click();
  await expect(page.locator('#subtitle')).not.toHaveText(before);
  await page.reload();
  await expect(page.locator('#subtitle')).toHaveText(before);
});

test('the landing page has a demo panel above the doctor-link panel that opens the demo', async ({ page }) => {
  const b = backend(); await b.install(page);
  await page.goto(APP);
  const panel = page.locator('#landing .lp-split', { hasText: 'Try it first, no sign-in needed' });
  await expect(panel).toBeVisible();
  const order = await page.locator('#landing .lp-split h2').allTextContents();
  expect(order.indexOf('Try it first, no sign-in needed')).toBe(order.indexOf('Share with your doctor in one click') - 1);   // directly above it
  await expect(panel.locator('a.lp-demo-btn')).toHaveAttribute('href', '/demo');
  await panel.locator('a.lp-demo-btn').click();
  await expect(page).toHaveURL(DEMO);
  await expect(page.locator('#demoBar')).toBeVisible();
  await page.locator('#demoBar a[href="/"]').click();
  await expect(page.locator('#landing')).toBeVisible();
});

test('the demo panel puts the picture on the left on a wide screen and the words first on a phone', async ({ page }) => {
  const b = backend(); await b.install(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(APP);
  const x = async (sel) => (await page.locator('#landing .lp-demo ' + sel).first().boundingBox()).x;
  expect(await x('img')).toBeLessThan(await x('h2'));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  const y = async (sel) => (await page.locator('#landing .lp-demo ' + sel).first().boundingBox()).y;
  expect(await y('h2')).toBeLessThan(await y('img'));
});

test('the demo works on the hosted build under the strict policy, with no violations', async ({ page }) => {
  const b = backend({ dist: true }); await b.install(page);
  await page.addInitScript(() => { document.addEventListener('securitypolicyviolation', (e) => { (window.__csp = window.__csp || []).push(e.violatedDirective + ' ' + e.blockedURI); }); });
  const resp = await page.goto(DEMO);
  expect(resp.headers()['content-security-policy']).toContain("script-src 'self'");
  await expect(page.locator('#demoBar')).toBeVisible();
  for (const tab of ['weight', 'sugar', 'bp', 'compare']) await page.locator('#tab-' + tab).click();
  await page.locator('#settingsOpen').click();
  await page.evaluate(() => document.getElementById('setDlg').close());
  expect(await page.evaluate(() => window.__csp || [])).toEqual([]);
});

test('every page asks search engines not to index it', async ({ page }) => {
  for (const f of ['index.html', 'dist/index.html', 'dist/demo.html', 'dist/404.html']) {
    if (!fs.existsSync(require('path').join(__dirname, '..', f))) continue;
    const html = fs.readFileSync(require('path').join(__dirname, '..', f), 'utf8');
    expect(html, f).toMatch(/<meta name="robots" content="noindex, nofollow">|<meta name="robots" content="noindex">/);
  }
});
