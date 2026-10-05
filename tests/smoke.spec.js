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

test('import reads month-name dates and skips ones without a year', async ({ page }) => {
  await page.locator('#emptyImport').click();
  await page.locator('#importDlg summary').click();
  await page.locator('#pasteBox').fill('Date,WEIGHT/lbs\n"October 9, 2024 at 10:38AM",193.6\n"October, 8 2024 at 10:30",194.6\n9 Nov 2024,190\nAugust 6,212');
  await page.locator('#pasteBtn').click();
  await expect(page.locator('#previewInfo')).toHaveText('3 entries ready; 1 rows skipped (date not readable, check Date format).');
});

test('fasting glucose is coloured green, amber and red by range', async ({ page }) => {
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
  await expect(page.locator('#stats .stat', { hasText: 'fasting glucose' })).toHaveAttribute('style', new RegExp(RED));

  // Chart dots and the two threshold lines.
  await page.locator('#tab-sugar').click();
  const dots = await page.locator('#chart svg[role="img"] circle:not(#xc)').evaluateAll((c) => c.map((x) => x.getAttribute('fill')));
  expect(dots).toEqual([GREEN, AMBER, RED, RED]);
  await expect(page.locator('#chart svg text', { hasText: '100 prediabetes' })).toHaveCount(1);
  await expect(page.locator('#chart svg text', { hasText: '126 diabetes range' })).toHaveCount(1);
});

test('doctor report shows fasting glucose ranges', async ({ page }) => {
  await page.locator('#emptyImport').click();
  await page.locator('#importDlg summary').click();
  await page.locator('#pasteBox').fill('Date,Blood Sugar (mg/dL)\n2026-10-01,95\n2026-10-02,97\n2026-10-03,110\n2026-10-04,130');
  await page.locator('#pasteBtn').click();
  await page.locator('#doImport').click();
  await page.locator('#openReport').click();

  const ranges = page.locator('#reportPreview h2', { hasText: 'Fasting glucose ranges' });
  await expect(ranges).toHaveCount(1);
  const rows = await ranges.locator('xpath=following-sibling::table[1]//tbody/tr').evaluateAll((trs) =>
    trs.map((tr) => [...tr.cells].map((td) => td.textContent)));
  expect(rows).toEqual([
    ['Normal', 'Below 100', '2', '50%'],
    ['Prediabetes', '100 to 125', '1', '25%'],
    ['Diabetes range', '126 and above', '1', '25%'],
  ]);

  // Still shown when the glucose chart is left out of the report.
  await page.locator('#rcSugar').uncheck();
  await expect(page.locator('#reportPreview h2', { hasText: 'Fasting glucose ranges' })).toHaveCount(1);
});

test('dose bands are a plain tint: no strip or dose text in the chart', async ({ page }) => {
  await importSample(page);
  const strips = await page.locator('#chart svg[role="img"] rect[height="3"]').count();
  expect(strips).toBe(0);
  const labels = await page.locator('#chart svg[role="img"] text').allTextContents();
  expect(labels.filter((t) => / mg$/.test(t))).toEqual([]);
  // The dose key under the chart stays.
  await expect(page.locator('#legend .chip', { hasText: /^2\.5 mg$/ })).toHaveCount(1);

  // Doctor report charts show neither dose text nor a dose key.
  await page.locator('#openReport').click();
  const reportLabels = await page.locator('#reportPreview svg.psvg text').allTextContents();
  expect(reportLabels.filter((t) => / mg$|Dose in effect/.test(t))).toEqual([]);
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

test('BMI panel asks for height, shows stage and persists it', async ({ page }) => {
  await importSample(page);
  await expect(page.locator('#bmiPanel')).toBeVisible();
  await expect(page.locator('#bmiOut')).toContainText('Enter your height');

  await page.fill('#bmiFt', '5');
  await page.fill('#bmiIn', '9');
  await page.locator('#bmiForm button[type=submit]').click();
  await expect(page.locator('.bmi-now .v')).toBeVisible();
  const bmi = parseFloat(await page.locator('.bmi-now .v').innerText());
  expect(bmi).toBeGreaterThan(15);
  expect(bmi).toBeLessThan(60);
  await expect(page.locator('.bmi-stage tr')).toHaveCount(7);   // header + 6 stages
  await expect(page.locator('.bmi-stage tr.cur')).toHaveCount(1);

  await page.reload();
  await expect(page.locator('.bmi-now .v')).toBeVisible();
  await expect(page.locator('#bmiFt')).toHaveValue('5');
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
