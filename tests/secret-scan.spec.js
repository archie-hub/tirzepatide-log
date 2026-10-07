// The secret scanner (scripts/secret_scan.py) catches what it should and lets normal files through.
// Fixtures are assembled at run time so this file itself contains nothing that looks like a secret.
const { test, expect } = require('@playwright/test');
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCAN = path.join(__dirname, '..', 'scripts', 'secret_scan.py');

function repo(files, config) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-'));
  const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'pipe' });
  git('init', '-q'); git('config', 'user.email', 't@example.com'); git('config', 'user.name', 't');
  if (config) fs.writeFileSync(path.join(dir, '.secret-scan.json'), JSON.stringify(config));
  for (const [name, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), body);
  }
  git('add', '-A');
  const run = (mode) => { const r = spawnSync('python3', [SCAN, mode], { cwd: dir, encoding: 'utf8' }); return { code: r.status, out: r.stdout + r.stderr }; };
  return { dir, git, run };
}

const AKIA = 'AK' + 'IA' + 'ABCDEFGHIJKLMNOP';
const GH = 'gh' + 'p_' + 'a'.repeat(36);
const SK = 'sk' + '_live_' + 'b'.repeat(24);
const PEM = '-----BEGIN ' + 'RSA PRIVATE KEY-----';
const JWT = 'eyJ' + 'hbGciOiJIUzI1NiJ9' + '.eyJ' + 'zdWIiOiIxMjM0NTY3ODkwIn0' + '.abcdefghij1234567890';

test('clean files pass, and the output of a finding never contains the secret', async () => {
  const ok = repo({ 'a.js': 'const x = 1;\nconsole.log("hello");\n', 'README.md': 'Contact info@phoe.be\n', 'icons/icon@2x.png.txt': 'x' }, { allow_emails: ['info@phoe.be'] });
  expect(ok.run('--staged')).toMatchObject({ code: 0 });
  const bad = repo({ 'deploy.js': 'const key = "' + AKIA + '";\n' });
  const r = bad.run('--staged');
  expect(r.code).toBe(1);
  expect(r.out).toContain('aws-access-key');
  expect(r.out).not.toContain(AKIA);
});

test('credentials and keys are caught', async () => {
  const cases = {
    'aws.txt': 'id=' + AKIA,
    'gh.txt': 'token ' + GH,
    'stripe.txt': 'key=' + SK,
    'key.txt': PEM,
    'jwt.txt': 'x ' + JWT,
    'bearer.js': 'headers: { Authorization: "Bearer ' + 'A'.repeat(40) + '" }',
    'pw.js': 'const password = "hunter2hunter2hunter2";',
  };
  for (const [name, body] of Object.entries(cases)) {
    const r = repo({ [name]: body + '\n' }).run('--staged');
    expect(r.code, name).toBe(1);
  }
});

test('placeholders, test fixtures and the allow marker are not flagged', async () => {
  const r = repo({
    'a.md': 'password = "your-password-here-please"\nsecret: "example-secret-value-123"\n',
    'b.js': 'const token = "' + 'x'.repeat(20) + '";\n',
    'c.js': 'const k = "' + AKIA + '"; // secret-scan:allow documented example\n',
  }).run('--staged');
  expect(r.out).toBe('secret-scan: clean\n');
});

test('state, env, key and profile files are blocked by name; CSVs only where listed', async () => {
  for (const name of ['terraform.tfstate', 'prod.tfvars', '.env', '.env.production', 'AuthKey.p8', 'cert.p12', 'server.pem', 'dev.mobileprovision', 'TirzTrackBackup.json']) {
    const r = repo({ [name]: 'x\n' }).run('--staged');
    expect(r.code, name).toBe(1);
    expect(r.out, name).toContain('blocked-file');
  }
  const csv = repo({ 'AJC_DATA.csv': 'Date,Weight\n2026-01-01,200\n', 'sample-data/fake.csv': 'Date,Weight\n' }, { allow_csv: ['sample-data/*.csv'] }).run('--staged');
  expect(csv.code).toBe(1);
  expect(csv.out).toContain('AJC_DATA.csv: health-data-file');
  expect(csv.out).not.toContain('sample-data');
});

test('personal email addresses, account ids and home paths are blocked where the repo asks for it', async () => {
  const cfg = { allow_emails: ['info@phoe.be'], block_account_ids: true, block_local_paths: true };
  const bad = repo({ 'a.md': 'mail me: someone@gmail.com\n', 'b.sh': 'BUCKET=s3://app-' + '123456789012' + '   # aws account\n', 'c.md': 'see /Users/someone/project/file\n' }, cfg).run('--staged');
  expect(bad.code).toBe(1);
  for (const rule of ['email-address', 'aws-account-id', 'local-path']) expect(bad.out).toContain(rule);
  const ok = repo({ 'a.md': 'mail info@phoe.be or test@example.com or noreply@github.com; page icon@2x.png; ts 1791316000000\n' }, cfg).run('--staged');
  expect(ok.code).toBe(0);
  const lenient = repo({ 'a.md': 'someone@gmail.com /Users/someone/x ' + '123456789012 aws\n' }, {}).run('--staged');
  expect(lenient.code).toBe(1);                                       // the email still counts
  expect(lenient.out).not.toContain('local-path');
});

test('--all scans the tree and --history finds something that was deleted later', async () => {
  const r = repo({ 'ok.txt': 'fine\n', 'old.txt': 'key=' + AKIA + '\n' });
  r.git('commit', '-q', '-m', 'one');
  fs.rmSync(path.join(r.dir, 'old.txt')); r.git('add', '-A'); r.git('commit', '-q', '-m', 'remove it');
  expect(r.run('--all').code).toBe(0);                                  // gone from the tree
  const h = r.run('--history');
  expect(h.code).toBe(1);                                               // but still in history
  expect(h.out).toContain('old.txt');
});

test('accepted_history silences only the listed old findings in --history', async () => {
  const r = repo({ 'old.txt': 'key=' + AKIA + '\n' }, { accepted_history: [] });
  r.git('commit', '-q', '-m', 'one');
  expect(r.run('--history').code).toBe(1);
  fs.writeFileSync(path.join(r.dir, '.secret-scan.json'), JSON.stringify({ accepted_history: ['old.txt:aws-access-key'] }));
  expect(r.run('--history').code).toBe(0);
  fs.writeFileSync(path.join(r.dir, '.secret-scan.json'), JSON.stringify({ accepted_history: ['other.txt:aws-access-key'] }));
  expect(r.run('--history').code).toBe(1);
});

test('the project\'s own tree is clean', async () => {
  const r = spawnSync('python3', [SCAN, '--all'], { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
  expect(r.stdout).toContain('clean');
  expect(r.status).toBe(0);
});
