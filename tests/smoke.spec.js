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
  for (const tabId of ['#tab-weight', '#tab-sugar', '#tab-bp', '#tab-cal']) {
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
  await chart.scrollIntoViewIfNeeded();
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

const BP_CSV = 'Date,Systolic (mmHg),Diastolic (mmHg)\n2026-10-01,118,76\n2026-10-02,125,78\n2026-10-03,128,84\n2026-10-04,134,79\n2026-10-05,126,92';

async function pasteBp(page) {
  await page.locator('#emptyImport').click();
  await page.locator('#importDlg summary').click();
  await page.locator('#pasteBox').fill(BP_CSV);
  await page.locator('#pasteBtn').click();
  await page.locator('#doImport').click();
  await expect(page.locator('#importDlg')).toBeHidden();
}

test('blood pressure is coloured by AHA category in the table, card and chart', async ({ page }) => {
  const GREEN = '#16a34a', AMBER = '#d4a106', ORANGE = '#f97316', RED = '#dc2626';
  await pasteBp(page);

  // Newest first: 126/92 stage 2 (diastolic decides), 134/79 stage 1, 128/84 stage 1 (diastolic decides), 125/78 elevated, 118/76 normal.
  const rows = await page.locator('#rows tr').evaluateAll((trs) =>
    trs.map((r) => { const c = r.querySelector('.bp-cell .chip, td:nth-child(9) .chip'); return [c.textContent, c.style.getPropertyValue('--c')]; }));
  expect(rows).toEqual([['126/92', RED], ['134/79', ORANGE], ['128/84', ORANGE], ['125/78', AMBER], ['118/76', GREEN]]);

  const card = page.locator('#stats .stat', { hasText: 'blood pressure' });
  await expect(card).toContainText('126/92');
  await expect(card).toHaveAttribute('style', new RegExp(RED));

  await page.locator('#tab-bp').click();
  await expect(page.locator('#tab-bp')).toHaveAttribute('aria-selected', 'true');
  const solid = await page.locator('#chart svg[role="img"] circle[opacity="0.95"]:not(#xc)').evaluateAll((c) => c.map((x) => x.getAttribute('fill')));
  expect(solid).toEqual([GREEN, AMBER, ORANGE, ORANGE, RED]);
  await expect(page.locator('#chart svg text', { hasText: 'top 140 stage 2' })).toHaveCount(1);
  await expect(page.locator('#chart svg text', { hasText: 'bottom 90 stage 2' })).toHaveCount(1);
});

test('blood pressure round-trips through the form, CSV export and the report', async ({ page }) => {
  await pasteBp(page);
  await page.locator('[data-edit="2026-10-01"]').click();
  await expect(page.locator('#fBp')).toHaveValue('118/76');
  await page.locator('#fBp').fill('145 / 76');
  await page.locator('#saveBtn').click();
  await expect(page.locator('#rows tr', { hasText: '145/76' })).toHaveCount(1);

  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#exportBtn').click()]);
  const csv = require('fs').readFileSync(await dl.path(), 'utf8').split('\r\n');
  expect(csv[0]).toBe('Date,Dosage (mg),Weight (lbs),Comments,Calories,Food Notes,Blood Sugar (mg/dL),Injection Site,Systolic (mmHg),Diastolic (mmHg)');
  expect(csv[1]).toBe('2026-10-01,,,,,,,,145,76');

  await page.locator('#openReport').click();
  await expect(page.locator('#reportPreview .rep-box', { hasText: 'Latest blood pressure' })).toContainText('126/92');
  const cats = page.locator('#reportPreview h2', { hasText: 'Blood pressure categories' });
  const table = await cats.locator('xpath=following-sibling::table[1]//tbody/tr').evaluateAll((trs) =>
    trs.map((tr) => [tr.cells[0].textContent, tr.cells[2].textContent]));
  expect(table).toEqual([['Normal', '0'], ['Elevated', '1'], ['Hypertension stage 1', '2'], ['Hypertension stage 2', '2']]);
  await page.locator('#rcBp').uncheck();
  await expect(page.locator('#reportPreview h2', { hasText: 'Blood pressure categories' })).toHaveCount(1);
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
  await expect(card.locator('.bmi-seg')).toHaveCount(6);
  await expect(card.locator('.bmi-seg.cur')).toHaveCount(1);
  await card.locator('.bmi-seg').first().focus();
  await expect(card.locator('#bmiDetail')).toContainText('Underweight');
  await expect(card.locator('#bmiDetail')).toContainText(' lbs');
  await card.locator('.bmi-seg').first().blur();
  await expect(card.locator('#bmiDetail')).not.toContainText('Underweight');

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
    ['Latest weight', 'Goal weight', 'Change', 'Latest fasting glucose', 'Latest blood pressure']);
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
  await expect(page.locator('#plan #bmiDetail')).toContainText('kg');
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

test('plateau notice appears for 3 flat weeks and in the report', async ({ page }) => {
  const rows = ['Date,Weight (lbs)'];
  const base = new Date(); base.setDate(base.getDate() - 24);
  for (let i = 0; i <= 24; i += 3) {
    const d = new Date(base); d.setDate(base.getDate() + i);
    rows.push(d.toISOString().slice(0, 10) + ',' + (180 + (i % 2 ? 0.4 : -0.3)));
  }
  await page.locator('#emptyImport').click();
  await page.locator('#importDlg summary').click();
  await page.locator('#pasteBox').fill(rows.join('\n'));
  await page.locator('#pasteBtn').click();
  await page.locator('#doImport').click();
  await expect(page.locator('#plateau')).toBeVisible();
  await expect(page.locator('#plateau')).toContainText('steady for about');
  await page.locator('#openReport').click();
  await expect(page.locator('#reportPreview .rep-box', { hasText: 'Weight trend' })).toHaveCount(1);

  // A steady loss is not a plateau
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    const e = JSON.parse(localStorage.getItem('tirzepatide-log-v1')).map((x, i) => Object.assign(x, { weight: 190 - i * 2 }));
    localStorage.setItem('tirzepatide-log-v1', JSON.stringify(e));
  });
  await page.reload();
  await expect(page.locator('#plateau')).toBeHidden();
});

test('weight label stays on one line in the entry form and settings', async ({ page }) => {
  await importSample(page);
  const h = (sel) => page.locator(sel).locator('xpath=..').evaluate((el) => el.firstElementChild.getBoundingClientRect().height);
  expect(await h('#fWeight')).toBeLessThan(24);
  await page.locator('#plan [data-settings]').first().click();
  expect(await h('#sGoal')).toBeLessThan(24);
});

test('form fields use the same 15px text as the rest of the page', async ({ page }) => {
  await importSample(page);
  const size = (sel) => page.locator(sel).evaluate((el) => getComputedStyle(el).fontSize);
  for (const id of ['#fDate', '#fDose', '#fWeight', '#fCal', '#fSugar', '#fSite', '#fFood', '#fComments']) {
    expect(await size(id), id).toBe('15px');
  }
  expect(await size('body')).toBe('15px');
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

test('blood pressure is one field like 119/79; bad input is rejected; combined CSV column imports', async ({ page }) => {
  await page.locator('#emptyImport').click();
  await page.locator('#importDlg summary').click();
  await page.locator('#pasteBox').fill('Date,Blood Pressure\n2026-10-01,119/79\n2026-10-02,"141/91"');
  await page.locator('#pasteBtn').click();
  await page.locator('#doImport').click();
  await expect(page.locator('#rows tr').first().locator('td:nth-child(9) .chip')).toHaveText('141/91');

  await page.locator('#fDate').fill('2026-10-03');
  await page.locator('#fBp').fill('abc');
  await page.locator('#saveBtn').click();
  await expect(page.locator('#rows tr')).toHaveCount(2);
  expect(await page.locator('#fBp').evaluate((el) => el.validationMessage)).toContain('119/79');
  await page.locator('#fBp').fill('119/79');
  await page.locator('#saveBtn').click();
  await expect(page.locator('#rows tr').first().locator('td:nth-child(9) .chip')).toHaveText('119/79');
});

test('combined chart: pick which values to plot, hover shows real values, choice is remembered, report can include it', async ({ page }) => {
  await importSample(page);
  await page.locator('#tab-compare').click();
  await expect(page.locator('#tab-compare')).toHaveAttribute('aria-selected', 'true');
  const chart = page.locator('#chart svg[role="img"]');
  await expect(chart).toBeVisible();
  const lines = () => chart.locator('path[stroke-width="2.6"]');
  const chip = (k) => page.locator('#cmpPick [data-cmp="' + k + '"]');

  // Defaults: weight, glucose, systolic. BMI is unavailable until a height is saved.
  await expect(lines()).toHaveCount(3);
  await expect(chip('bmi')).toBeDisabled();
  await chip('cal').click();
  await chip('dia').click();
  await expect(chip('cal')).toHaveAttribute('aria-pressed', 'true');
  await expect(lines()).toHaveCount(5);
  await chip('weight').click();
  await chip('sugar').click();
  await expect(lines()).toHaveCount(3);

  await chart.scrollIntoViewIfNeeded();
  const box = await chart.boundingBox();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2);
  const tip = page.locator('#tip');
  await expect(tip).toHaveClass(/on/);
  await expect(tip).toContainText('Systolic');
  await expect(tip).toContainText('Diastolic');
  await expect(tip).toContainText('Calories');
  await expect(tip).not.toContainText('Weight');

  // Remembered across a reload, and available in the doctor report.
  await page.reload();
  await page.locator('#tab-compare').click();
  await expect(chip('cal')).toHaveAttribute('aria-pressed', 'true');
  await expect(chip('weight')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#openReport').click();
  await page.locator('#rcCompare').check();
  await expect(page.locator('#reportPreview svg[aria-label^="Combined chart"]')).toHaveCount(1);
  await expect(page.locator('#reportPreview svg[aria-label^="Combined chart"] text', { hasText: 'Systolic' })).toHaveCount(1);
});
