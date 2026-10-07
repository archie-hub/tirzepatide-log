// Regenerates landing/dashboard.jpg and landing/insights.jpg from the fake sample year (never real data).
// Run: node tests/make-landing-shots.js
const { chromium } = require('@playwright/test');
const path = require('path');

(async () => {
  const root = path.join(__dirname, '..');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 1000 }, deviceScaleFactor: 1.5, colorScheme: 'light' });
  await page.addInitScript(() => localStorage.setItem('tirzepatide-settings', JSON.stringify({ goal: 165, heightIn: 69, doseDay: 3 })));
  await page.goto('file://' + path.join(root, 'index.html'));
  await page.locator('#emptyImport').click();
  await page.setInputFiles('#importFile', path.join(root, 'sample-data', 'TirzepatideLog-sample-year.csv'));
  await page.locator('#doImport').click();
  await page.waitForSelector('#stats .stat');
  await page.evaluate(() => { document.querySelector('.hero h1').textContent = 'Tirzepatide Log'; document.getElementById('msg').textContent = ''; document.getElementById('backupNote').hidden = true; });
  await page.waitForTimeout(800);
  // the dashboard picture comes from the demo data (steady entries, no gaps) so the chart line is unbroken, and shows the whole chart
  const dash = await browser.newPage({ viewport: { width: 1100, height: 1300 }, deviceScaleFactor: 1.5, colorScheme: 'light' });
  await dash.route('http://localhost:8080/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: require('fs').readFileSync(path.join(root, 'index.html'), 'utf8') }));
  await dash.goto('http://localhost:8080/demo');
  await dash.evaluate(() => { document.querySelector('header.hero h1').textContent = 'Tirzepatide Log'; const m = document.getElementById('msg'); if (m) m.textContent = ''; const d = document.getElementById('demoBar'); if (d) d.hidden = true; const n = document.getElementById('backupNote'); if (n) n.hidden = true; });
  await dash.locator('#range button[data-days="365"]').click();
  await dash.waitForTimeout(1200);
  await dash.evaluate(() => { document.querySelector('header.hero h1').textContent = 'Tirzepatide Log'; });
  const cb = await dash.locator('#chart').boundingBox();
  await dash.screenshot({ path: path.join(root, 'landing', 'dashboard.jpg'), type: 'jpeg', quality: 84, clip: { x: 20, y: 10, width: 1060, height: Math.round(cb.y + cb.height + 40 - 10) } });
  await dash.close();
  await page.locator('#insightsPanel > summary').click();
  await page.waitForTimeout(600);
  await page.setViewportSize({ width: 1100, height: 2600 });
  await page.waitForTimeout(400);
  const box = await page.locator('#insightsPanel').boundingBox();
  await page.screenshot({ path: path.join(root, 'landing', 'insights.jpg'), type: 'jpeg', quality: 84, clip: { x: box.x, y: box.y, width: box.width, height: 640 } });
  // the demo page itself (served at /demo like the hosted site) for the landing page's demo panel
  const demo = await browser.newPage({ viewport: { width: 1100, height: 1000 }, deviceScaleFactor: 1.5, colorScheme: 'light' });
  await demo.route('http://localhost:8080/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: require('fs').readFileSync(path.join(root, 'index.html'), 'utf8') }));
  await demo.goto('http://localhost:8080/demo');
  await demo.locator('#range button[data-days="365"]').click();
  await demo.locator('#tab-compare').click();   // a different chart from the hero picture: weight, glucose and blood pressure on one plot
  await demo.waitForTimeout(900);
  const dbox = await demo.locator('#chartPanel').boundingBox();
  await demo.screenshot({ path: path.join(root, 'landing', 'demo.jpg'), type: 'jpeg', quality: 84, clip: { x: dbox.x, y: dbox.y, width: dbox.width, height: Math.min(dbox.height, 700) } });
  await browser.close();
})();
