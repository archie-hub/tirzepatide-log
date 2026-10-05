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

test('BMI card prompts for height once, then calculates automatically', async ({ page }) => {
  await importSample(page);
  const card = page.locator('#plan .card.bmi');
  await expect(card).toContainText('Not set');

  await page.fill('#bmiHeight', "5'9\"");
  await page.press('#bmiHeight', 'Enter');
  await expect(page.locator('#bmiHeight')).toHaveCount(0);
  const bmi = parseFloat(await card.locator('.big').innerText());
  expect(bmi).toBeGreaterThan(15);
  expect(bmi).toBeLessThan(60);
  await expect(card.locator('.bmi-stages div')).toHaveCount(6);
  await expect(card.locator('.bmi-stages div.cur')).toHaveCount(1);

  await page.reload();
  await expect(page.locator('#plan .card.bmi .big')).toContainText(String(bmi.toFixed(1)));
  await expect(page.locator('#bmiHeight')).toHaveCount(0);
});

test('BMI card predicts the next stage down', async ({ page }) => {
  await importSample(page);
  await page.fill('#bmiHeight', "5'9\"");
  await page.press('#bmiHeight', 'Enter');
  await expect(page.locator('#plan .bmi-next')).toContainText('Next stage: Normal (below 25)');
});

test('BMI height can be edited from the card', async ({ page }) => {
  await importSample(page);
  await page.fill('#bmiHeight', '175 cm');
  await page.press('#bmiHeight', 'Enter');
  await page.locator('#plan .card.bmi [data-settings]').click();
  await expect(page.locator('#sHeight')).toHaveValue("5'8.9\"");
});

test('top row is weight, goal, change, glucose; no backup card; report shows BMI', async ({ page }) => {
  await importSample(page);
  const labels = await page.locator('#stats .stat .l').allInnerTexts();
  expect(labels.map((l) => l.split(/[:(]|Since|since/)[0].trim().replace(/\s*Edit$/, ''))).toEqual(
    ['Latest weight', 'Goal weight', 'Change', 'Latest fasting glucose']);
  await expect(page.locator('#plan')).not.toContainText('Backup');
  await expect(page.locator('[data-export]')).toHaveCount(0);

  await page.locator('#openReport').click();
  await expect(page.locator('#reportPreview .rep-box', { hasText: 'BMI' })).toHaveCount(0);   // no height yet
  await expect(page.locator('#rcBmi')).toBeDisabled();
  await expect(page.locator('#rcBmiText')).toContainText('set your height');
  await page.keyboard.press('Escape');
  await page.fill('#bmiHeight', "5'9\"");
  await page.press('#bmiHeight', 'Enter');
  await page.locator('#openReport').click();
  const box = page.locator('#reportPreview .rep-box', { hasText: "height 5'9\"" });
  await expect(box).toHaveCount(1);
  await expect(box).toContainText('BMI');

  // Everything on the dashboard is also in the report
  await expect(page.locator('#rcBmi')).toBeEnabled();
  await expect(page.locator('#reportPreview svg').filter({ hasText: 'BMI,' })).toHaveCount(1);
  const boxLabels = await page.locator('#reportPreview .rep-box .l').allInnerTexts();
  for (const want of ['Dose', 'Weight', 'Change', 'BMI', 'BMI next stage', 'Next dose', 'Latest fasting glucose', 'Entries logged']) {
    expect(boxLabels, want).toContain(want);
  }
  await expect(page.locator('#reportPreview h2', { hasText: 'BMI stages' })).toHaveCount(1);
  await expect(page.locator('#reportPreview', { hasText: 'days covered' })).toHaveCount(1);
});

test('BMI chart tab appears once height is set', async ({ page }) => {
  await importSample(page);
  await expect(page.locator('#tab-bmi')).toBeHidden();
  await page.fill('#bmiHeight', "5'9\"");
  await page.press('#bmiHeight', 'Enter');
  await expect(page.locator('#tab-bmi')).toBeVisible();
  await page.locator('#tab-bmi').click();
  await expect(page.locator('#tab-bmi')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#chart svg[role="img"]')).toBeVisible();
  await page.locator('#chart svg').scrollIntoViewIfNeeded();
  const box = await page.locator('#chart svg').boundingBox();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2, { steps: 10 });
  await expect(page.locator('#tip')).toContainText('BMI');
  await expect(page.locator('#legend')).toContainText('Obesity III');
  // Clearing the height (via settings) drops the tab and falls back to weight
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('tirzepatide-settings')); delete s.heightIn; localStorage.setItem('tirzepatide-settings', JSON.stringify(s)); });
  await page.reload();
  await expect(page.locator('#tab-bmi')).toBeHidden();
});

test('entries table shows 5 per page with a pager', async ({ page }) => {
  await importSample(page);
  await expect(page.locator('#rows tr')).toHaveCount(5);
  await expect(page.locator('#pager')).toBeVisible();
  const first = await page.locator('#rows tr').first().innerText();
  await expect(page.locator('#pager [data-page]').filter({ hasText: 'Previous' })).toBeDisabled();
  await page.locator('#pager button', { hasText: 'Next' }).click();
  await expect(page.locator('#rows tr')).toHaveCount(5);
  expect(await page.locator('#rows tr').first().innerText()).not.toBe(first);
  await expect(page.locator('#pager [aria-current="page"]')).toHaveText('2');
  await page.locator('#pager button[aria-label^="Page "]').last().click();
  await expect(page.locator('#pager button', { hasText: 'Next' })).toBeDisabled();
  expect(await page.locator('#rows tr').count()).toBeLessThanOrEqual(5);
});

test('backup note, undo delete and keyboard chart reading', async ({ page }) => {
  await importSample(page);
  // Import counts as backed up; changing data makes the note say so
  await expect(page.locator('#backupNote')).toContainText('Backed up');
  const first = await page.locator('#rows tr').first().locator('td').first().innerText();
  await page.locator('#rows tr').first().locator('[data-del]').click();   // no confirm dialog
  await expect(page.locator('#toast')).toBeVisible();
  await expect(page.locator('#toastText')).toContainText(first);
  await expect(page.locator('#backupNote')).toContainText('changes since');
  await expect(page.locator('#rows tr').first().locator('td').first()).not.toHaveText(first);
  await page.locator('#toastUndo').click();
  await expect(page.locator('#rows tr').first().locator('td').first()).toHaveText(first);
  await expect(page.locator('#toast')).toBeHidden();

  // Old backups turn amber
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('tirzepatide-settings'));
    s.lastExport = Date.now() - 20 * 86400000; s.lastChange = Date.now();
    localStorage.setItem('tirzepatide-settings', JSON.stringify(s));
  });
  await page.reload();
  await expect(page.locator('#backupNote')).toHaveClass(/warn/);
  await page.locator('#backupExport').click().catch(() => {});

  // Arrow keys step through chart points and read them out in the tooltip
  const svg = page.locator('#chart svg[role="img"]');
  await svg.focus();
  await expect(page.locator('#tip')).not.toBeEmpty();
  const last = await page.locator('#tip').innerText();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#tip')).not.toHaveText(last);
  await page.keyboard.press('Home');
  const home = await page.locator('#tip').innerText();
  await page.keyboard.press('End');
  expect(await page.locator('#tip').innerText()).toBe(last);
  expect(home).not.toBe(last);
});

test('metric units: kg and cm everywhere, storage and export stay in lbs', async ({ page }) => {
  await importSample(page);
  await page.fill('#bmiHeight', "5'9\"");
  await page.press('#bmiHeight', 'Enter');
  const lbs = parseFloat((await page.locator('#stats .stat').first().locator('.v').innerText()));

  await page.locator('#plan [data-settings]').first().click();
  await page.selectOption('#sUnits', 'metric');
  await page.locator('#setSave').click();

  await expect(page.locator('#stats .stat .l').first()).toContainText('(kg)');
  await expect(page.locator('#plan .bmi .l')).toContainText('175 cm');
  await expect(page.locator('#fWeight').locator('xpath=..')).toContainText('(kg)');
  await expect(page.locator('#plan .bmi-stages')).toContainText('kg');
  await page.waitForTimeout(1100);   // count-up animation
  const kg = parseFloat(await page.locator('#stats .stat').first().locator('.v').innerText());
  expect(Math.abs(kg - lbs * 0.45359237)).toBeLessThan(0.15);
  await page.locator('#tab-weight').click();
  await expect(page.locator('#chart svg')).toHaveAttribute('aria-label', /Weight \(kg\)/);

  // Editing an entry without touching the weight must not alter the stored lbs value
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('tirzepatide-log-v1')).map((e) => e.weight));
  const before = await stored();
  await page.locator('#rows tr').first().locator('[data-edit]').click();
  await page.locator('#saveBtn').click();
  expect(await stored()).toEqual(before);

  // A new weight typed in kg is stored as lbs
  await page.fill('#fDate', '2030-01-01');
  await page.fill('#fWeight', '80');
  await page.locator('#saveBtn').click();
  const after = await stored();
  expect(after.some((w) => Math.abs(w - 176.37) < 0.02)).toBe(true);

  // Report follows the unit; the CSV export is still lbs
  await page.locator('#openReport').click();
  await expect(page.locator('#reportPreview')).toContainText('kg');
  await expect(page.locator('#reportPreview')).not.toContainText(' lbs');
  await page.keyboard.press('Escape');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#exportBtn').click()]);
  expect(await dl.suggestedFilename()).toMatch(/\.csv$/);
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
