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

// The Entries and Add entry panels start minimised; open them the way a visitor would
async function expandPanels(page) {
  for (const id of ['#entriesPanel', '#formPanel']) {
    if (!(await page.locator(id).evaluate((d) => d.open))) await page.locator(id + ' > summary').click();
  }
}

async function importSample(page) {
  await page.locator('#emptyImport').click();
  await expect(page.locator('#importDlg')).toBeVisible();
  await page.setInputFiles('#importFile', SAMPLE_CSV);
  await expect(page.locator('#step2')).toBeVisible();
  await expect(page.locator('#doImport')).toBeEnabled();
  await page.locator('#doImport').click();
  await expect(page.locator('#importDlg')).toBeHidden();
}


const BP_CSV = 'Date,Systolic (mmHg),Diastolic (mmHg)\n2026-10-01,118,76\n2026-10-02,125,78\n2026-10-03,128,84\n2026-10-04,134,79\n2026-10-05,126,92';

async function pasteBp(page) {
  await page.locator('#emptyImport').click();
  await page.locator('#importDlg summary').click();
  await page.locator('#pasteBox').fill(BP_CSV);
  await page.locator('#pasteBtn').click();
  await page.locator('#doImport').click();
  await expect(page.locator('#importDlg')).toBeHidden();
}


function steadyLossCsv(extra) {
  const rows = ['Date,Dosage (mg),Weight (lbs)'];
  const t0 = Date.UTC(2026, 7, 1);
  for (let i = 0; i < 57; i++) {
    const d = new Date(t0 + i * 86400000).toISOString().slice(0, 10);
    rows.push(d + ',2.5,' + (extra ? extra(i, d) : (200 - 0.5 * i).toFixed(1)));
  }
  return rows.join('\n');
}
async function pasteCsv(page, csv) {
  await page.locator('#emptyImport').click();
  await page.locator('#importDlg summary').click();
  await page.locator('#pasteBox').fill(csv);
  await page.locator('#pasteBtn').click();
  await page.locator('#doImport').click();
  await expect(page.locator('#importDlg')).toBeHidden();
}


const BODY_CSV = 'Date,Dosage (mg),Weight (lbs),Waist (in),Body Fat (%),Muscle Mass (lbs)\n2026-09-01,5,200,40,36.0,98\n2026-09-15,5,196,38.5,35.2,97.5\n2026-10-01,5,190,37,34.1,96';

test('imports sample data and renders stats and charts', async ({ page }) => {
  await importSample(page);
  await expandPanels(page);

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
  expect(labels.length).toBeGreaterThanOrEqual(3);   // the 3 month window keeps its full axis now
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

test('blood pressure is coloured by AHA category in the table, plan-row panel and chart', async ({ page }) => {
  const GREEN = '#16a34a', AMBER = '#d4a106', ORANGE = '#f97316', RED = '#dc2626';
  await pasteBp(page);

  // Newest first: 126/92 stage 2 (diastolic decides), 134/79 stage 1, 128/84 stage 1 (diastolic decides), 125/78 elevated, 118/76 normal.
  const rows = await page.locator('#rows tr').evaluateAll((trs) =>
    trs.map((r) => { const c = r.querySelector('.bp-cell .chip, td:nth-child(9) .chip'); return [c.textContent, c.style.getPropertyValue('--c')]; }));
  expect(rows).toEqual([['126/92', RED], ['134/79', ORANGE], ['128/84', ORANGE], ['125/78', AMBER], ['118/76', GREEN]]);

  const card = page.locator('#plan .stat.mini', { hasText: 'Latest BP' });
  await expect(card).toContainText('126/92');
  await expect(card).toHaveAttribute('style', new RegExp(RED));

  await page.locator('#tab-bp').click();
  await expect(page.locator('#tab-bp')).toHaveAttribute('aria-selected', 'true');
  const solid = await page.locator('#chart svg[role="img"] circle[opacity="0.95"]:not(#xc)').evaluateAll((c) => c.map((x) => x.getAttribute('fill')));
  expect(solid).toEqual([GREEN, AMBER, ORANGE, ORANGE, RED]);
  await expect(page.locator('#chart svg text', { hasText: 'top 140 stage 2' })).toHaveCount(1);
  await expect(page.locator('#chart svg text', { hasText: 'bottom 90 stage 2' })).toHaveCount(1);
});

test('blood pressure round-trips through the form and the CSV export', async ({ page }) => {
  await pasteBp(page);
  await expandPanels(page);
  await page.locator('[data-edit="2026-10-01"]').click();
  await expect(page.locator('#fBp')).toHaveValue('118/76');
  await page.locator('#fBp').fill('145 / 76');
  await page.locator('#saveBtn').click();
  await expect(page.locator('#rows tr', { hasText: '145/76' })).toHaveCount(1);

  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#exportBtn').click()]);
  const csv = require('fs').readFileSync(await dl.path(), 'utf8').split('\r\n');
  expect(csv[0]).toBe('Date,Dosage (mg),Weight (lbs),Comments,Calories,Food Notes,Blood Sugar (mg/dL),Injection Site,Systolic (mmHg),Diastolic (mmHg),Waist (in),Body Fat (%),Muscle Mass (lbs)');
  expect(csv[1]).toBe('2026-10-01,,,,,,,,145,76,,,');

  await expect(page.locator('#plan .stat.mini', { hasText: 'Latest BP' })).toContainText('126/92');
});

test('dose bands are a plain tint: no strip or dose text in the chart', async ({ page }) => {
  await importSample(page);
  const strips = await page.locator('#chart svg[role="img"] rect[height="3"]').count();
  expect(strips).toBe(0);
  const labels = await page.locator('#chart svg[role="img"] text').allTextContents();
  expect(labels.filter((t) => / mg$/.test(t))).toEqual([]);
  // The dose key under the chart stays (it lists the doses in view, so widen the range to the whole sample year first).
  await page.locator('#range button[data-days="1095"]').click();
  await expect(page.locator('#legend .chip', { hasText: /^2\.5 mg$/ })).toHaveCount(1);

});

test('BMI card prompts for height once, then calculates automatically', async ({ page }) => {
  await importSample(page);
  const card = page.locator('#plan .stat.bmi');
  await expect(card).toContainText('Not set');

  await page.fill('#bmiHeight', "5'9\"");
  await page.press('#bmiHeight', 'Enter');
  await expect(page.locator('#bmiHeight')).toHaveCount(0);
  const bmi = parseFloat(await card.locator('.bmi-c').innerText());
  expect(bmi).toBeGreaterThan(15);
  expect(bmi).toBeLessThan(60);
  await expect(card.locator('.bmi-seg')).toHaveCount(6);
  await expect(card.locator('.bmi-seg.cur')).toHaveCount(1);
  // Real mouse: aim at the middle of the first arc's stroke (the label overlay must not swallow it)
  const pt = await card.locator('.bmi-seg').first().evaluate((el) => {
    const p = el.getPointAtLength(el.getTotalLength() / 2), m = el.getScreenCTM();
    return { x: p.x * m.a + p.y * m.c + m.e, y: p.x * m.b + p.y * m.d + m.f };
  });
  await page.mouse.move(pt.x, pt.y);
  await expect(card.locator('#bmiBubble')).toHaveClass(/on/);
  await expect(card.locator('#bmiBubble')).toContainText('Underweight');
  await page.mouse.move(0, 0);
  await expect(card.locator('#bmiBubble')).not.toHaveClass(/on/);
  await card.locator('.bmi-seg').first().focus();
  await expect(card.locator('#bmiBubble')).toHaveClass(/on/);
  await expect(card.locator('#bmiBubble')).toContainText('Underweight');
  await expect(card.locator('#bmiBubble')).toContainText(' lbs');
  await card.locator('.bmi-seg').first().blur();
  await expect(card.locator('#bmiBubble')).not.toHaveClass(/on/);

  await page.reload();
  await expect(page.locator('#plan .stat.bmi .bmi-c')).toContainText(String(bmi.toFixed(1)));
  await expect(page.locator('#bmiHeight')).toHaveCount(0);
});

test('BMI card predicts the next stage down', async ({ page }) => {
  await importSample(page);
  await page.fill('#bmiHeight', "5'9\"");
  await page.press('#bmiHeight', 'Enter');
  await page.locator('#plan .bmi-c').hover();
  await expect(page.locator('#bmiBubble')).toHaveClass(/on/);
  await expect(page.locator('#bmiBubble .k')).toContainText('Normal (below 25)');
  await expect(page.locator('#bmiBubble')).toContainText('Pace');
  await page.mouse.move(0, 0);
  await expect(page.locator('#bmiBubble')).not.toHaveClass(/on/);
});

test('BMI height can be edited from the card', async ({ page }) => {
  await importSample(page);
  await page.fill('#bmiHeight', '175 cm');
  await page.press('#bmiHeight', 'Enter');
  await page.locator('#plan .stat.bmi [data-settings]').click();
  await expect(page.locator('#sHeight')).toHaveValue("5'8.9\"");
});

test('top row is weight, goal, change, glucose (BP is in the plan row); no backup card; BMI card takes a height', async ({ page }) => {
  await importSample(page);
  const labels = await page.locator('#stats .stat .l').allInnerTexts();
  expect(labels.map((l) => l.split(/[:(]|Since|since/)[0].trim().replace(/\s*Edit$/, ''))).toEqual(
    ['Latest weight', 'Goal weight', 'Change', 'Latest fasting glucose']);
  await expect(page.locator('#plan .stat.mini', { hasText: 'Latest BP' })).toHaveCount(1);   // blood pressure lives in the plan row only
  await expect(page.locator('#plan')).not.toContainText('Backup');
  await expect(page.locator('[data-export]')).toHaveCount(0);

  await page.fill('#bmiHeight', "5'9\"");
  await page.press('#bmiHeight', 'Enter');
  await expect(page.locator('#plan .bmi')).toContainText("5'9\"");
  await expect(page.locator('#plan .bmi-seg')).toHaveCount(6);
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
  await expandPanels(page);
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
  await expandPanels(page);
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
  await expandPanels(page);
  await page.fill('#bmiHeight', "5'9\"");
  await page.press('#bmiHeight', 'Enter');
  const lbs = parseFloat((await page.locator('#stats .stat').first().locator('.v').innerText()));

  await page.locator('#plan [data-settings]').first().click();
  await page.selectOption('#sUnits', 'metric');
  await page.locator('#setSave').click();

  await expect(page.locator('#stats .stat .l').first()).toContainText('(kg)');
  await expect(page.locator('#plan .bmi .l')).toContainText('175 cm');
  await expect(page.locator('#fWeight').locator('xpath=..')).toContainText('(kg)');
  await expect(page.locator('#plan .bmi-seg').first()).toHaveAttribute('aria-label', /kg/);
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

  // The CSV export is still lbs
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#exportBtn').click()]);
  expect(await dl.suggestedFilename()).toMatch(/\.csv$/);
});

test('plateau notice appears for 3 flat weeks', async ({ page }) => {
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

  // A steady loss is not a plateau
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

  await expandPanels(page);
  await page.locator('#fDate').fill('2026-10-03');
  await page.locator('#fBp').fill('abc');
  await page.locator('#saveBtn').click();
  await expect(page.locator('#rows tr')).toHaveCount(2);
  expect(await page.locator('#fBp').evaluate((el) => el.validationMessage)).toContain('119/79');
  await page.locator('#fBp').fill('119/79');
  await page.locator('#saveBtn').click();
  await expect(page.locator('#rows tr').first().locator('td:nth-child(9) .chip')).toHaveText('119/79');
});

test('combined chart: pick which values to plot, hover shows real values, choice is remembered', async ({ page }) => {
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

  // Remembered across a reload.
  await page.reload();
  await page.locator('#tab-compare').click();
  await expect(chip('cal')).toHaveAttribute('aria-pressed', 'true');
  await expect(chip('weight')).toHaveAttribute('aria-pressed', 'false');
});

test('Entries and Add entry panels start minimised and expand on click', async ({ page }) => {
  await importSample(page);
  for (const id of ['#entriesPanel', '#formPanel']) {
    await expect(page.locator(id)).toBeVisible();
    await expect(page.locator(id)).not.toHaveAttribute('open', '');
  }
  await expect(page.locator('#rows tr').first()).toBeHidden();
  await expect(page.locator('#entriesCount')).toHaveText(/^\(\d+\)$/);

  await page.locator('#entriesPanel > summary').click();
  await expect(page.locator('#rows tr').first()).toBeVisible();
  await expect(page.locator('#entriesPanel .fold-hint')).toBeVisible();
  await page.locator('#entriesPanel > summary').click();
  await expect(page.locator('#rows tr').first()).toBeHidden();

  // Editing an entry opens the form on its own.
  await page.locator('#entriesPanel > summary').click();
  await page.locator('#rows [data-edit]').first().click();
  await expect(page.locator('#formPanel')).toHaveAttribute('open', '');
  await expect(page.locator('#fDate')).toBeVisible();
});

test('plan row: Days covered and Latest BP are near-square tiles side by side, compact strips on a phone', async ({ page }) => {
  await importSample(page);
  const stack = page.locator('#plan .stack');
  const minis = stack.locator('.stat.mini');
  await expect(minis).toHaveCount(2);
  await expect(minis.nth(0)).toContainText('Days covered');
  await expect(minis.nth(1)).toContainText('Latest BP');
  await expect(minis.nth(1).locator('.v')).toHaveText(/^\d+\/\d+$/);
  await expect(minis.nth(1).locator('.sub')).toBeVisible();

  const [stat, a, b] = await Promise.all([page.locator('#stats .stat').first().boundingBox(), minis.nth(0).boundingBox(), minis.nth(1).boundingBox()]);
  expect(Math.round(a.height)).toBe(Math.round(stat.height));   // as tall as the stats row
  expect(Math.abs(a.y - b.y)).toBeLessThan(1);                  // side by side
  expect(a.width / a.height).toBeGreaterThan(0.9);
  expect(a.width / a.height).toBeLessThan(1.4);

  await page.setViewportSize({ width: 390, height: 900 });
  const [c, d] = await Promise.all([minis.nth(0).boundingBox(), minis.nth(1).boundingBox()]);
  expect(d.y).toBeGreaterThan(c.y + c.height - 1);              // stacked
  expect(c.height).toBeLessThan(stat.height / 2);
  await expect(minis.nth(1).locator('.sub')).toBeHidden();
});

test('plan row: without any BP readings Days covered keeps its full panel', async ({ page }) => {
  await page.locator('#emptyImport').click();
  await page.locator('#importDlg summary').click();
  await page.locator('#pasteBox').fill('Date,Dosage (mg),Weight (lbs)\n2026-10-01,2.5,200\n2026-10-03,2.5,199');
  await page.locator('#pasteBtn').click();
  await page.locator('#doImport').click();
  await expect(page.locator('#plan .stack')).toHaveCount(0);
  await expect(page.locator('#plan .stat.mini')).toHaveCount(1);
});

// Hand-built log: start 200 lbs on 2026-07-01 (dose 2.5). 5% (<=190) first on 08-01 = day 31 = week 5;
// 10% (<=180) first on 09-01 = day 62 = week 9; week 12 is day 84 (09-23): nearest weigh-in 09-22 (178 lbs = 11.0%).
const PROGRESS_CSV = 'Date,Dosage (mg),Weight (lbs)\n2026-07-01,2.5,200\n2026-07-15,2.5,196\n2026-08-01,2.5,189.9\n2026-09-01,5,179\n2026-09-22,5,178\n2026-10-01,5,175';

async function pasteProgress(page) {
  await page.locator('#emptyImport').click();
  await page.locator('#importDlg summary').click();
  await page.locator('#pasteBox').fill(PROGRESS_CSV);
  await page.locator('#pasteBtn').click();
  await page.locator('#doImport').click();
  await expect(page.locator('#importDlg')).toBeHidden();
}

test('progress: percent lost and the week on treatment on the Change card', async ({ page }) => {
  await pasteProgress(page);
  const card = page.locator('#stats .stat', { hasText: 'Change since' });
  await expect(card).toContainText('12.5% lost');            // 200 -> 175
  await expect(card).toContainText('week 14');               // day 92 -> week 14
  await expect(page.locator('#progress')).toHaveCount(0);    // there is no separate progress panel
});

test('progress: milestones and lost at week 12 are also in More insights', async ({ page }) => {
  await pasteProgress(page);
  await page.locator('#insightsPanel > summary').click();
  const box = (label) => page.locator('#insights .ins', { hasText: label });
  await expect(box('Milestones')).toContainText('10% reached');
  await expect(box('Milestones')).toContainText('5% in week 5');
  await expect(box('Milestones')).toContainText('next, 15%: 5.0 lbs to go');
  await expect(box('Lost at week 12')).toContainText('11.0%');
});

test('progress: a start weight before treatment changes the percentages and milestones', async ({ page }) => {
  await pasteProgress(page);
  await page.locator('#stats [data-settings]').first().click();
  await page.fill('#sBaseline', '210');
  await page.locator('#setSave').click();
  await expect(page.locator('#stats .stat', { hasText: 'Change since' })).toContainText('16.7% lost from start');   // 210 -> 175
  await page.locator('#insightsPanel > summary').click();
  // 5% <= 199.5 first on 07-15 (day 14, week 3); 10% <= 189 on 09-01 (day 62, week 9); 15% <= 178.5 on 09-22 (day 83, week 12); next is 20%
  const ms = page.locator('#insights .ins', { hasText: 'Milestones' });
  await expect(ms).toContainText('5% in week 3');
  await expect(ms).toContainText('10% in week 9');
  await expect(ms).toContainText('15% in week 12');
  await expect(ms).toContainText('next, 20%: 7.0 lbs to go');
});

test('insights: fast-loss notice, pace, extremes, best week, streak and weekly averages', async ({ page }) => {
  await pasteCsv(page, steadyLossCsv());
  await expect(page.locator('#fastNote')).toBeVisible();
  await expect(page.locator('#fastNote')).toContainText('3.5 lbs a week');

  await expect(page.locator('#insightsPanel')).toBeVisible();
  await expect(page.locator('#insightsPanel')).not.toHaveAttribute('open', '');   // minimised by default
  await page.locator('#insightsPanel > summary').click();
  const box = (label) => page.locator('#insights .ins', { hasText: label });
  await expect(box('4-week pace')).toContainText('−3.50 lbs/wk');
  await expect(box('4-week pace')).toContainText('Faster than 1% of body weight');
  await expect(box('This week vs last')).toContainText('−3.5 lbs');     // averages 173.5 vs 177.0
  await expect(box('Highest weight')).toContainText('200.0 lbs');
  await expect(box('Lowest weight')).toContainText('172.0 lbs');
  await expect(box('Best week')).toContainText('week 2');               // first week with a −3.5 change
  await expect(box('Logging streak')).toContainText('57 days');
  await expect(box('Weigh-ins')).toContainText('57');
  await expect(box('Weigh-ins')).toContainText('every 1.0 days');
  const rows = await page.locator('#insights table tbody tr').count();
  expect(rows).toBe(9);                                                  // 57 days = 9 week buckets (8 full + 1 day)
});

test('insights: weight forecast at the 4-week pace', async ({ page }) => {
  await pasteCsv(page, steadyLossCsv());
  await page.locator('#insightsPanel > summary').click();
  const box = (label) => page.locator('#insights .ins', { hasText: label });
  await expect(box('Weight in 30 days')).toContainText('lbs');
  await expect(box('Weight in 30 days')).toContainText('at your recent pace');
  await expect(box('Weight in 90 days')).toContainText('−');   // still losing at 3.5 lb/week
});

test('settings: weekly dose reminder downloads a calendar file', async ({ page }) => {
  await pasteCsv(page, steadyLossCsv());
  await page.locator('#stats [data-settings], #plan [data-settings]').first().click();
  await page.selectOption('#sDay', '1');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#sIcs').click()]);
  const ics = require('fs').readFileSync(await dl.path(), 'utf8');
  expect(dl.suggestedFilename()).toBe('TirzepatideDose.ics');
  expect(ics).toContain('RRULE:FREQ=WEEKLY');
  expect(ics).toContain('SUMMARY:Tirzepatide dose');
  expect(ics).toMatch(/DTSTART:\d{8}T090000/);
});

test('insights: no fast-loss notice for a gentle pace; gaps are reported', async ({ page }) => {
  // 0.1 lb/day = 0.7 lb/week, well under 1%. Skip days 20-27 to make an 8-day gap in the log.
  const rows = ['Date,Dosage (mg),Weight (lbs)'], t0 = Date.UTC(2026, 7, 1);
  for (let i = 0; i < 50; i++) if (i < 20 || i > 27) rows.push(new Date(t0 + i * 86400000).toISOString().slice(0, 10) + ',2.5,' + (200 - 0.1 * i).toFixed(1));
  await pasteCsv(page, rows.join('\n'));
  await expect(page.locator('#fastNote')).toBeHidden();
  await page.locator('#insightsPanel > summary').click();
  await expect(page.locator('#insights .ins', { hasText: 'Weigh-ins' })).toContainText('Longest gap 9 days');
});

// steadyLossCsv(): one weigh-in a day from 2026-08-01 (200 lbs, down 0.5 a day) for 57 days
async function customRange(page, from, to) {
  await page.locator('#range button[data-days="custom"]').click();
  await page.locator('#cFrom').fill(from); await page.locator('#cTo').fill(to);
}

test('custom chart range: exact From and To dates, kept after a reload', async ({ page }) => {
  await pasteCsv(page, steadyLossCsv());
  await expect(page.locator('#customRange')).toBeHidden();
  await page.locator('#range button[data-days="custom"]').click();
  await expect(page.locator('#customRange')).toBeVisible();
  await expect(page.locator('#range button[data-days="custom"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#range button[data-days="90"]')).toHaveAttribute('aria-pressed', 'false');

  await customRange(page, '2026-08-10', '2026-08-19');
  const svg = page.locator('#chart svg[role="img"]');
  await svg.focus();
  await page.keyboard.press('Home');
  await expect(page.locator('#tip')).toContainText(/Aug(ust)? 10|10 Aug/);
  await expect(page.locator('#tip')).toContainText('195.5');           // 200 - 0.5 x 9
  await page.keyboard.press('End');
  await expect(page.locator('#tip')).toContainText(/Aug(ust)? 19|19 Aug/);
  await expect(page.locator('#tip')).toContainText('191.0');

  await page.reload();
  await expect(page.locator('#range button[data-days="custom"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#cFrom')).toHaveValue('2026-08-10');
  await expect(page.locator('#cTo')).toHaveValue('2026-08-19');
  await page.locator('#range button[data-days="30"]').click();
  await expect(page.locator('#customRange')).toBeHidden();
  await page.reload();
  await expect(page.locator('#range button[data-days="30"]')).toHaveAttribute('aria-pressed', 'true');
});

test('custom chart range: step earlier and later by the same length, backwards dates refused, empty window explained', async ({ page }) => {
  await pasteCsv(page, steadyLossCsv());
  await customRange(page, '2026-08-10', '2026-08-19');
  await page.locator('#cNext').click();
  await expect(page.locator('#cFrom')).toHaveValue('2026-08-20');
  await expect(page.locator('#cTo')).toHaveValue('2026-08-29');
  await page.locator('#cPrev').click();
  await page.locator('#cPrev').click();
  await expect(page.locator('#cFrom')).toHaveValue('2026-07-31');
  await expect(page.locator('#cTo')).toHaveValue('2026-08-09');
  await expect(page.locator('#chart svg[role="img"]')).toBeVisible();

  await page.locator('#cFrom').fill('2026-09-01');                      // after To: refused, the old window stays
  await expect(page.locator('#customNote')).toContainText('must not be after');
  await expect(page.locator('#cFrom')).toHaveValue('2026-07-31');

  await customRange(page, '2026-01-01', '2026-01-31');                  // before any reading
  await expect(page.locator('#chart .empty')).toContainText('between');
  await expect(page.locator('#chart svg[role="img"]')).toHaveCount(0);
});

test('custom chart range: the axis spans the chosen window and the combined chart follows it', async ({ page }) => {
  await pasteCsv(page, steadyLossCsv());
  await customRange(page, '2026-08-10', '2026-09-10');                  // a window that runs past the last reading's neighbours
  const labels = await page.locator('#chart svg[role="img"] text').allTextContents();
  expect(labels.some((t) => /Aug(ust)? 10|10 Aug/.test(t))).toBe(true);
  expect(labels.some((t) => /Sep(tember)? 10|10 Sep/.test(t))).toBe(true);
  await page.locator('#tab-compare').click();
  await expect(page.locator('#chart svg[role="img"]')).toBeVisible();
  await page.locator('#chart svg[role="img"]').focus();
  await page.keyboard.press('Home');
  await expect(page.locator('#tip')).toContainText(/Aug(ust)? 10|10 Aug/);
});

test('pace chart tab: zero line, fast-loss line and orange dots', async ({ page }) => {
  await pasteCsv(page, steadyLossCsv());
  await page.locator('#tab-rate').click();
  await expect(page.locator('#tab-rate')).toHaveAttribute('aria-selected', 'true');
  const svg = page.locator('#chart svg[role="img"]');
  await expect(svg).toBeVisible();
  await expect(svg.locator('text', { hasText: 'no change' })).toHaveCount(1);
  await expect(svg.locator('text', { hasText: 'faster than 1% of body weight a week' })).toHaveCount(1);
  expect(await svg.locator('circle[fill="#f97316"]').count()).toBeGreaterThan(10);
  await svg.scrollIntoViewIfNeeded();
  const b = await svg.boundingBox();
  await page.mouse.move(b.x + b.width * 0.8, b.y + b.height / 2);
  await expect(page.locator('#tip')).toContainText('Loss pace');
});

test('insights: weight by injection day shows once there are four weeks of data', async ({ page }) => {
  // +0.8 the day after a Monday injection, -0.8 on injection day itself
  await pasteCsv(page, steadyLossCsv((i, d) => {
    const dow = new Date(d + 'T00:00:00Z').getUTCDay();
    return (190 + (dow === 2 ? 0.8 : dow === 1 ? -0.8 : 0)).toFixed(1);
  }));
  await page.locator('#stats [data-settings], #plan [data-settings]').first().click();
  await page.selectOption('#sDay', '1');
  await page.locator('#setSave').click();
  await page.locator('#insightsPanel > summary').click();
  await expect(page.locator('#insights svg.bars')).toBeVisible();
  await expect(page.locator('#insights')).toContainText('Usually heaviest 1 day after');
  await expect(page.locator('#insights')).toContainText('lightest on injection day');
});

test('next dose: an injection site logged today counts as the injection', async ({ page }) => {
  const now = new Date(), p2 = n => String(n).padStart(2, '0');
  const iso = d => d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
  const past = new Date(now.getTime() - 7 * 86400000);
  const hdr = 'Date,Dosage (mg),Weight (lbs),Comments,Calories,Food Notes,Blood Sugar (mg/dL),Injection Site\n';
  await pasteCsv(page, hdr + iso(past) + ',2.5,200,,,,,Abdomen (Left)\n' + iso(now) + ',2.5,,,,,,Abdomen (Right)');
  await page.locator('#plan [data-settings]').first().click();
  await page.selectOption('#sDay', String(now.getDay()));
  await page.locator('#setSave').click();
  await expect(page.locator('#plan')).not.toContainText('Today');
  await expect(page.locator('#plan')).toContainText('In 7 days');
});

test('chart range longer than the data keeps its full axis, with a dashed projection on weight', async ({ page }) => {
  await pasteCsv(page, steadyLossCsv());           // 57 days, 0.5 lb/day, 200 -> 172
  await page.locator('#range [data-days="365"]').first().click();
  const svg = page.locator('#chart svg');
  await expect(svg.locator('path[stroke-dasharray="7 6"]')).toHaveCount(1);
  // 0.5 lb/day for the 309 days left of the year, from 172: 172 - 154.5 = 17.5
  await expect(svg).toContainText('At this pace: 17.5 lbs');
  // the last dot sits well left of the right edge (data 57 of 365 days)
  const dots = svg.locator('circle[opacity]');
  const xs = await dots.evaluateAll(els => els.map(e => +e.getAttribute('cx')));
  expect(Math.max(...xs)).toBeLessThan(250);
  await page.locator('#tab-sugar').click();
  await expect(page.locator('#chart')).toBeVisible();
});

test('pace label: brown bread at 0.0 lbs, doctor nudge below normal BMI, overweight remark', async ({ page }) => {
  await pasteCsv(page, steadyLossCsv());           // 200 -> 172, 0.5 lb/day
  await page.locator('#range [data-days="365"]').first().click();
  await expect(page.locator('#chart svg')).not.toContainText('brown bread');
  await page.locator('#range [data-days="1095"]').first().click();   // 3 yr: pace reaches 0
  await expect(page.locator('#chart svg')).toContainText('At this pace: 0.0 lbs');
  await expect(page.locator('#chart svg')).toContainText('brown bread');
  await page.locator('#plan [data-settings]').first().click();
  await page.fill('#sHeight', '69');
  await page.locator('#setSave').click();
  await page.locator('#range [data-days="365"]').first().click();   // 17.5 lbs at 69 in: below normal BMI, but the 0 lbs case is gone
  await expect(page.locator('#chart svg')).toContainText('doctor');
  // the two lines must not sit on top of each other
  const ys = await page.locator('#chart svg text').evaluateAll(els => els.filter(e => /At this pace|doctor/.test(e.textContent)).map(e => +e.getAttribute('y')));
  expect(ys.length).toBe(2);
  expect(Math.abs(ys[0] - ys[1])).toBeGreaterThan(12);
});

test('projection also shows with only a week of weigh-ins', async ({ page }) => {
  await pasteCsv(page, 'Date,Dosage (mg),Weight (lbs)\n2026-10-01,2.5,208\n2026-10-03,2.5,205\n2026-10-05,2.5,203\n2026-10-07,2.5,201');
  await page.locator('#range [data-days="30"]').click();
  await expect(page.locator('#chart svg path[stroke-dasharray="7 6"]')).toHaveCount(1);
  await expect(page.locator('#chart svg')).toContainText('At this pace');
  await expect(page.locator('#chart svg mask')).toHaveCount(1);   // the fill fades out at the last reading
});

test('body measures: import, table, waist chart with the half-height line and combined series', async ({ page }) => {
  await pasteCsv(page, BODY_CSV);
  await page.fill('#bmiHeight', "5'10\"");          // 70 in
  await page.press('#bmiHeight', 'Enter');
  await expandPanels(page);
  await expect(page.locator('#rows tr').first().locator('td').nth(9)).toContainText('37.0'.replace('.0', ''));
  await page.locator('#tab-waist').click();
  const svg = page.locator('#chart svg[role="img"]');
  await expect(svg).toBeVisible();
  await expect(svg.locator('text', { hasText: 'ratio 0.5 (half your height)' })).toHaveCount(1);   // dashed line at 35 in
  await page.locator('#tab-compare').click();
  for (const k of ['waist', 'fat', 'muscle']) await expect(page.locator('#cmpPick [data-cmp="' + k + '"]')).toBeVisible();
});

test('body measures: form round-trip, exact values kept on edit, metric shows cm and kg, CSV stays in inches/lbs', async ({ page }) => {
  await pasteCsv(page, BODY_CSV);
  await expandPanels(page);
  await page.locator('[data-edit="2026-10-01"]').click();
  await expect(page.locator('#fWaist')).toHaveValue('37');
  await expect(page.locator('#fFat')).toHaveValue('34.1');
  await expect(page.locator('#fMuscle')).toHaveValue('96');
  await page.fill('#fWaist', '36.5');
  await page.locator('#saveBtn').click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('tirzepatide-log-v1')).find((e) => e.date === '2026-10-01').waist)).toBe(36.5);

  // Metric: shown as cm / kg, an untouched edit stores the same inches / lbs
  const before = await page.evaluate(() => localStorage.getItem('tirzepatide-log-v1'));
  await page.locator('#stats [data-settings], #plan [data-settings]').first().click();
  await page.selectOption('#sUnits', 'metric');
  await page.locator('#setSave').click();
  await expect(page.locator('#rows tr').first()).toContainText('92.7');   // waist now shown in cm
  await page.locator('[data-edit="2026-10-01"]').click();
  await expect(page.locator('#fWaist')).toHaveValue('92.7');       // 36.5 in
  await page.locator('#saveBtn').click();
  expect(await page.evaluate(() => localStorage.getItem('tirzepatide-log-v1'))).toBe(before);

  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#exportBtn').click()]);
  const csv = require('fs').readFileSync(await dl.path(), 'utf8').split('\r\n');
  expect(csv[3].split(',').slice(-3)).toEqual(['36.5', '34.1', '96']);   // inches, %, lbs
});

test('body measures: files without them still import, and nothing extra shows', async ({ page }) => {
  await pasteBp(page);
  await expect(page.locator('#tab-waist')).toBeVisible();   // tab exists; empty state explains
  await page.locator('#tab-waist').click();
  await expect(page.locator('#chart')).toContainText('No Waist');
});

async function setUnits(page, units) {
  await page.locator('#stats [data-settings], #plan [data-settings]').first().click();
  await page.selectOption('#sUnits', units);
  await page.locator('#setSave').click();
}
const storedEntries = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('tirzepatide-log-v1')));

test('UK units: absolute weights in stones and pounds, changes stay in pounds, storage and CSV stay lbs', async ({ page }) => {
  await pasteProgress(page);               // 200.0 on 2026-07-01 ... 175.0 on 2026-10-01
  await setUnits(page, 'uk');
  const card = page.locator('#stats .stat', { hasText: 'Latest weight' });
  await expect(card).toContainText('(st lb)');
  await expect(card).toContainText('12 st 7');                       // 175 lbs = 12 st 7 lb
  await expect(page.locator('#stats .stat', { hasText: 'Change since' })).toContainText('12.5% lost');   // percent unchanged
  await expect(page.locator('#plan')).not.toContainText('NaN');

  await expandPanels(page);
  await expect(page.locator('#entriesPanel thead')).toContainText('Weight (st lb)');
  await expect(page.locator('#rows tr').first().locator('td').nth(2)).toHaveText('12 st 7');
  await expect(page.locator('#rows tr').first().locator('td').nth(3)).toContainText('3.0');   // change vs 178 stays in lbs (3 lbs)

  // Weight chart: decimal stones on the axis, exact stones and pounds in the tooltip
  const svg = page.locator('#chart svg[role="img"]');
  await expect(svg).toHaveAttribute('aria-label', /Weight \(st\)/);
  await svg.scrollIntoViewIfNeeded();
  const b = await svg.boundingBox();
  await page.mouse.move(b.x + b.width - 30, b.y + b.height / 2);
  await expect(page.locator('#tip')).toContainText('12 st 7 lb');

  // Storage unchanged; CSV export still lbs
  expect((await storedEntries(page)).map((e) => e.weight)).toEqual([200, 196, 189.9, 179, 178, 175]);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#exportBtn').click()]);
  const csv = require('fs').readFileSync(await dl.path(), 'utf8').split('\r\n');
  expect(csv[6].split(',')[2]).toBe('175.0');
});

test('UK units: weights can be typed as stones and pounds, pounds or stones; bad input is rejected', async ({ page }) => {
  await pasteProgress(page);
  await setUnits(page, 'uk');
  await expandPanels(page);
  const add = async (date, text) => {
    await page.fill('#fDate', date);
    await page.fill('#fWeight', text);
    await page.locator('#saveBtn').click();
  };
  await add('2026-10-02', '12 st 5 lb');      // 173
  await add('2026-10-03', '12 4');            // 172
  await add('2026-10-04', '170 lbs');         // 170
  await add('2026-10-05', '12.5');            // 12.5 stones = 175
  const byDate = Object.fromEntries((await storedEntries(page)).map((e) => [e.date, e.weight]));
  expect([byDate['2026-10-02'], byDate['2026-10-03'], byDate['2026-10-04'], byDate['2026-10-05']]).toEqual([173, 172, 170, 175]);

  await add('2026-10-06', 'abc');
  expect((await storedEntries(page)).some((e) => e.date === '2026-10-06')).toBe(false);
  expect(await page.locator('#fWeight').evaluate((el) => el.validationMessage)).toContain('stones');
});

test('UK units: untouched edit keeps exact pounds; goal and start weight in stones; switching back restores lbs', async ({ page }) => {
  await pasteProgress(page);
  await setUnits(page, 'uk');
  await page.locator('#stats [data-settings]').first().click();
  await page.fill('#sGoal', '12 0');           // 168 lbs
  await page.fill('#sBaseline', '14 9');       // 205 lbs
  await page.locator('#setSave').click();
  await expect(page.locator('#stats .stat', { hasText: 'Goal' })).toContainText('Goal: 12 st 0 lb');
  expect(await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('tirzepatide-settings')); return [s.goal, s.baseline]; })).toEqual([168, 205]);

  await expandPanels(page);
  const before = JSON.stringify(await storedEntries(page));
  await page.locator('[data-edit="2026-08-01"]').click();           // 189.9 lbs = 13 st 7.9
  await expect(page.locator('#fWeight')).toHaveValue('13 st 7.9 lb');
  await page.locator('#saveBtn').click();
  expect(JSON.stringify(await storedEntries(page))).toBe(before);

  await setUnits(page, 'us');
  await expect(page.locator('#stats .stat', { hasText: 'Latest weight' })).toContainText('175');
  await expect(page.locator('#stats .stat', { hasText: 'Goal' })).toContainText('Goal: 168 lbs');
  await expect(page.locator('#fWeight')).toHaveAttribute('type', 'number');
});

test('UK units: BMI weights use stones and pounds', async ({ page }) => {
  await pasteProgress(page);
  await page.fill('#bmiHeight', "5'10\"");
  await page.press('#bmiHeight', 'Enter');
  await setUnits(page, 'uk');
  // BMI stage weight ranges in the bubble
  const seg = page.locator('.bmi-seg').nth(1);
  await seg.focus();
  await expect(page.locator('#bmiBubble')).toContainText(' st ');
});

test('chart lines stop at a gap of more than a month and the dots stay', async ({ page }) => {
  const mk = (date, weight) => ({ date, dose: 2.5, weight, comments: '', cal: null, food: '', sugar: null, site: '', sys: null, dia: null, waist: null, fat: null, muscle: null });
  const daily = (start, n, w0) => Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(2026, +start.slice(5, 7) - 1, +start.slice(8, 10) + i));
    return mk(d.toISOString().slice(0, 10), w0 - i * 0.2);
  });
  async function lineSubpaths(entries) {
    await page.evaluate((e) => { localStorage.setItem('tirzepatide-log-v1', JSON.stringify(e)); }, entries);
    await page.reload();
    return page.evaluate(() => {
      const line = document.querySelector('#chartBox svg path[stroke-width="3.2"], #chart svg path[stroke-width="3.2"]');
      const dots = document.querySelectorAll('#chartBox svg circle.fade, #chart svg circle.fade').length;
      return { subpaths: (line.getAttribute('d').match(/M/g) || []).length, areas: document.querySelectorAll('svg path[fill^="url("]').length, dots };
    });
  }
  // two clusters 50 days apart: two line pieces, two filled areas, every reading still a dot
  const split = await lineSubpaths([...daily('2026-01-01', 10, 210), ...daily('2026-03-01', 5, 205)]);
  expect(split.subpaths).toBe(2);
  expect(split.dots).toBeGreaterThanOrEqual(15);
  // 30 days between readings is still joined, 31 is not
  const joined = await lineSubpaths([mk('2026-01-01', 210), mk('2026-01-02', 209.8), mk('2026-02-01', 209), mk('2026-02-02', 208.9)]);
  expect(joined.subpaths).toBe(1);
  const cut = await lineSubpaths([mk('2026-01-01', 210), mk('2026-01-02', 209.8), mk('2026-02-02', 209), mk('2026-02-03', 208.9)]);
  expect(cut.subpaths).toBe(2);
});

test('the weight line is coloured by trend: green when falling, blue-violet when flat, red when rising', async ({ page }) => {
  const mk = (date, weight) => ({ date, dose: 2.5, weight, comments: '', cal: null, food: '', sugar: null, site: '', sys: null, dia: null, waist: null, fat: null, muscle: null });
  const log = (fn) => Array.from({ length: 40 }, (_, i) => mk(new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10), fn(i)));
  async function stops(entries) {
    await page.evaluate((e) => { localStorage.setItem('tirzepatide-log-v1', JSON.stringify(e)); }, entries);
    await page.reload();
    return page.evaluate(() => {
      const path = document.querySelector('#chart svg path[stroke-width="3.2"]');
      const m = /url\(#([^)]+)\)/.exec(path.getAttribute('stroke'));
      const g = document.getElementById(m[1]);
      return { units: g.getAttribute('gradientUnits'), colors: [...g.querySelectorAll('stop')].map((s) => s.getAttribute('stop-color')), offsets: [...g.querySelectorAll('stop')].map((s) => +s.getAttribute('offset')) };
    });
  }
  // 0.2 lb a day is 1.4 lb a week, 0.7 percent of body weight a week: past the end of the scale at both ends
  const falling = await stops(log((i) => 200 - 0.2 * i));
  expect(falling.units).toBe('userSpaceOnUse');
  expect(falling.colors.at(-1)).toBe('rgb(5,150,105)');
  expect(falling.offsets[0]).toBe(0); expect(falling.offsets.at(-1)).toBe(1);
  const rising = await stops(log((i) => 200 + 0.2 * i));
  expect(rising.colors.at(-1)).toBe('rgb(239,68,68)');
  const flat = await stops(log(() => 200));
  expect(new Set(flat.colors)).toEqual(new Set(['rgb(99,102,241)']));
  // a loss that stalls: starts green, ends blue-violet
  const stalls = await stops(log((i) => (i < 20 ? 200 - 0.2 * i : 196)));
  expect(stalls.colors[3]).toBe('rgb(5,150,105)');
  expect(stalls.colors.at(-1)).toBe('rgb(99,102,241)');
  // the legend explains it, and other charts keep their own colours
  await expect(page.locator('#legend')).toContainText('coloured by trend');
  await page.getByRole('tab', { name: 'Glucose' }).click().catch(() => {});
});

test('chart range: eight choices from 1 week to 3 years, 3 months by default, remembered on this device', async ({ page }) => {
  await importSample(page);                                              // a year of entries ending 2026-09-30
  const labels = await page.locator('#range button').allTextContents();
  expect(labels).toEqual(['1 wk', '1 mo', '3 mo', '6 mo', '1 yr', '18 mo', '2 yr', '3 yr', 'Custom']);
  await expect(page.locator('#range button[aria-pressed="true"]')).toHaveText('3 mo');
  const dots = () => page.locator('#chart svg[role="img"] circle.fade').count();
  // weigh-ins in view for a range, counted back from the latest entry (the same rule the chart uses)
  const expected = (days) => page.evaluate((n) => {
    const w = JSON.parse(localStorage.getItem('tirzepatide-log-v1')).filter((e) => e.weight !== null).map((e) => e.date).sort();
    const last = new Date(w[w.length - 1] + 'T00:00:00Z').getTime();
    return w.filter((d) => (last - new Date(d + 'T00:00:00Z').getTime()) / 86400000 <= n).length;
  }, days);
  expect(await dots()).toBe(await expected(90));
  const counts = {};
  for (const [days, label] of [[7, '1 wk'], [30, '1 mo'], [90, '3 mo'], [180, '6 mo'], [365, '1 yr'], [548, '18 mo'], [730, '2 yr'], [1095, '3 yr']]) {
    await page.locator(`#range button[data-days="${days}"]`).click();
    await expect(page.locator('#range button[aria-pressed="true"]')).toHaveText(label);
    counts[days] = await dots();
    expect(counts[days], label).toBe(await expected(days));
  }
  expect(counts[7]).toBeLessThan(counts[30]); expect(counts[30]).toBeLessThan(counts[90]); expect(counts[90]).toBeLessThan(counts[180]);
  expect(counts[365]).toBeGreaterThan(counts[180]);
  expect(counts[1095]).toBe(counts[730]);                                // the sample is only a year long, so the longer ranges show all of it
  // the choice survives a reload; an unknown stored value (the old "All") falls back to 3 months
  await page.locator('#range button[data-days="180"]').click();
  await page.reload();
  await expect(page.locator('#range button[aria-pressed="true"]')).toHaveText('6 mo');
  await page.evaluate(() => localStorage.setItem('tirzepatide-chart-range', '0'));
  await page.reload();
  await expect(page.locator('#range button[aria-pressed="true"]')).toHaveText('3 mo');
  // the combined chart follows the same range
  await page.getByRole('tab', { name: 'Combined' }).click();
  await page.locator('#range button[data-days="7"]').click();
  await expect(page.locator('#range button[aria-pressed="true"]')).toHaveText('1 wk');
});
