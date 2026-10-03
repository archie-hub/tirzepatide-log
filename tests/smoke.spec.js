// Smoke test for index.html, a single-file, no-build web app.
// Run from the repo root with: npm test
// Mirrors the manual check described in CLAUDE.md under "How it was tested".
const { test, expect } = require('@playwright/test');
const path = require('path');

const APP_URL = 'file://' + path.join(__dirname, '..', 'index.html');
const SAMPLE_CSV = path.join(__dirname, '..', 'sample-data', 'TirzepatideLog-sample-year.csv');

test.beforeEach(async ({ page }) => {
  await page.goto(APP_URL);
});

async function importSample(page) {
  await page.locator('#emptyImport').click();
  await expect(page.locator('#importDlg')).toBeVisible();
  await page.setInputFiles('#importFile', SAMPLE_CSV);
  await expect(page.locator('#step2')).toBeVisible();
  await expect(page.locator('#doImport')).toBeEnabled();
  await page.locator('#doImport').click();
  await expect(page.locator('#importDlg')).toBeHidden();
}

test('imports sample data and renders stats and charts', async ({ page }) => {
  await importSample(page);

  await expect(page.locator('#stats .stat').first()).toBeVisible();
  await expect(page.locator('#rows tr').first()).toBeVisible();

  // Chart tabs: each metric should render an accessible SVG chart.
  for (const tabId of ['#tab-weight', '#tab-sugar', '#tab-cal']) {
    await page.locator(tabId).click();
    await expect(page.locator(tabId)).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#chart svg[role="img"]')).toBeVisible();
  }
});

test('hovering the chart shows a tooltip', async ({ page }) => {
  await importSample(page);
  await page.locator('#tab-weight').click();

  const chart = page.locator('#chart svg[role="img"]');
  await expect(chart).toBeVisible();
  const box = await chart.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 10 });
  await expect(page.locator('#tip')).not.toBeEmpty();
});

test('doctor report preview renders and CSV/image export trigger downloads', async ({ page }) => {
  await importSample(page);

  await page.locator('#openReport').click();
  await expect(page.locator('#reportDlg')).toBeVisible();
  await expect(page.locator('#reportPreview')).not.toBeEmpty();

  const [csvDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#rCsv').click(),
  ]);
  expect(csvDownload.suggestedFilename()).toMatch(/^TirzepatideLog-.*\.csv$/);

  const [pngDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#rPng').click(),
  ]);
  expect(pngDownload.suggestedFilename()).toMatch(/\.png$/);
});

test('print report builds print-safe markup without crashing', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));

  await importSample(page);
  await page.locator('#openReport').click();
  await page.locator('#rPrint').click();
  await page.waitForTimeout(200);

  expect(errors).toEqual([]);
});

test('renders without errors at 390px in dark mode', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(APP_URL);
  await importSample(page);

  // No horizontal overflow at phone width.
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);

  await page.screenshot({ path: 'test-results/dark-390.png', fullPage: true });
});
