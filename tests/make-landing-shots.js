// Regenerates landing/dashboard.jpg and landing/report.jpg from the fake sample year (never real data).
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
  await page.screenshot({ path: path.join(root, 'landing', 'dashboard.jpg'), type: 'jpeg', quality: 84, clip: { x: 20, y: 10, width: 1060, height: 760 } });
  await page.locator('#openReport').click();
  await page.waitForSelector('#reportPreview *');
  await page.waitForTimeout(800);
  const box = await page.locator('#reportPreview').boundingBox();
  await page.screenshot({ path: path.join(root, 'landing', 'report.jpg'), type: 'jpeg', quality: 84, clip: { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, 700) } });
  await browser.close();
})();
