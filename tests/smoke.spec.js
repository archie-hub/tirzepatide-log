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

test('short date ranges do not repeat x-axis labels', async ({ page }) => {
  await page.locator('#emptyImport').click();
  await page.locator('#importDlg summary').click();
  await page.locator('#pasteBox').fill('Date,Dosage (mg),Weight (lbs)\n2026-10-01,2.5,208\n2026-10-03,2.5,205');
  await page.locator('#pasteBtn').click();
  await page.locator('#doImport').click();
  await expect(page.locator('#importDlg')).toBeHidden();

  // Date labels sit on the bottom row of the chart; y-axis and dose labels are elsewhere.
  const labels = await page.locator('#chart svg[role="img"]').evaluate((svg) => {
    const texts = [...svg.querySelectorAll('text')];
    const bottom = Math.max(...texts.map((t) => +t.getAttribute('y')));
    return texts.filter((t) => +t.getAttribute('y') === bottom).map((t) => t.textContent);
  });
  expect(labels.length).toBe(3);
  expect(new Set(labels).size).toBe(labels.length);
});

test('fasting blood sugar is coloured green, amber and red by range', async ({ page }) => {
  const GREEN = '#16a34a', AMBER = '#d97706', RED = '#dc2626';
  await page.locator('#emptyImport').click();
  await page.locator('#importDlg summary').click();
  await page.locator('#pasteBox').fill('Date,Blood Sugar (mg/dL)\n2026-10-01,95\n2026-10-02,110\n2026-10-03,130\n2026-10-04,125.6');
  await page.locator('#pasteBtn').click();
  await page.locator('#doImport').click();
  await expect(page.locator('#importDlg')).toBeHidden();

  // Entries table (newest first). 125.6 shows as 126, so it must be red too.
  const tableColors = await page.locator('#rows tr').evaluateAll((rows) =>
    rows.map((r) => r.querySelector('td:nth-child(8) .chip').style.getPropertyValue('--c')));
  expect(tableColors).toEqual([RED, RED, AMBER, GREEN]);

  // Latest-reading stat card.
  await expect(page.locator('#stats .stat', { hasText: 'fasting blood sugar' })).toHaveAttribute('style', new RegExp(RED));

  // Chart dots and the two threshold lines.
  await page.locator('#tab-sugar').click();
  const dots = await page.locator('#chart svg[role="img"] circle:not(#xc)').evaluateAll((c) => c.map((x) => x.getAttribute('fill')));
  expect(dots).toEqual([GREEN, AMBER, RED, RED]);
  await expect(page.locator('#chart svg text', { hasText: '100 prediabetes' })).toHaveCount(1);
  await expect(page.locator('#chart svg text', { hasText: '126 diabetes range' })).toHaveCount(1);
});

test('doctor report shows fasting blood sugar ranges', async ({ page }) => {
  await page.locator('#emptyImport').click();
  await page.locator('#importDlg summary').click();
  await page.locator('#pasteBox').fill('Date,Blood Sugar (mg/dL)\n2026-10-01,95\n2026-10-02,97\n2026-10-03,110\n2026-10-04,130');
  await page.locator('#pasteBtn').click();
  await page.locator('#doImport').click();
  await page.locator('#openReport').click();

  const ranges = page.locator('#reportPreview h2', { hasText: 'Fasting blood sugar ranges' });
  await expect(ranges).toHaveCount(1);
  const rows = await ranges.locator('xpath=following-sibling::table[1]//tbody/tr').evaluateAll((trs) =>
    trs.map((tr) => [...tr.cells].map((td) => td.textContent)));
  expect(rows).toEqual([
    ['Normal', 'Below 100', '2', '50%'],
    ['Prediabetes', '100 to 125', '1', '25%'],
    ['Diabetes range', '126 and above', '1', '25%'],
  ]);

  // Still shown when the blood sugar chart is left out of the report.
  await page.locator('#rcSugar').uncheck();
  await expect(page.locator('#reportPreview h2', { hasText: 'Fasting blood sugar ranges' })).toHaveCount(1);
});

test('dose bands have no solid strip along the top of the chart', async ({ page }) => {
  await importSample(page);
  const strips = await page.locator('#chart svg[role="img"] rect[height="3"]').count();
  expect(strips).toBe(0);
  // The dose label above each band stays.
  const labels = await page.locator('#chart svg[role="img"] text').allTextContents();
  expect(labels).toContain('2.5 mg');
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
