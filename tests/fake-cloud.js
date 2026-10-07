// An in-memory stand-in for Cognito and the sync API (same contract as tirzepatide-cloud/lambda_src/handler.py), plus a way to
// serve the app at http://localhost:8080/ from the local index.html or from the hosted build in dist/ with its security headers.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const APP = 'http://localhost:8080/';
const COGNITO = 'https://tirzlog-sxsz5z.auth.us-east-1.amazoncognito.com';
const API = 'https://53bw70yjmk.execute-api.us-east-1.amazonaws.com';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,PUT,POST,DELETE,OPTIONS' };

function backend({ invited = true, dist = false } = {}) {
  const s = { shares: new Map(), entries: new Map(), settings: null, clock: 1000, puts: [], tokenCalls: [], authHeaders: [] };
  s.put = (e) => {   // what the Lambda does
    const cur = s.entries.get(e.date);
    if (cur && cur.updatedAt >= e.updatedAt) return false;
    s.entries.set(e.date, { ...e, syncedAt: ++s.clock });
    return true;
  };
  s.install = async (page) => {
    await page.route(/^http:\/\/localhost:8080\//, (r) => {
      const u = new URL(r.request().url());
      if (!dist) {
        if (u.pathname === '/' || u.pathname === '/demo') return r.fulfill({ status: 200, contentType: 'text/html', body: HTML });
        return r.fulfill({ status: 404, body: '' });
      }
      // the hosted build, with the headers CloudFront adds (csp.txt is the single source of the policy)
      const rel = u.pathname === '/' ? 'index.html' : u.pathname === '/demo' ? 'demo.html' : decodeURIComponent(u.pathname.slice(1));
      const file = path.join(ROOT, 'dist', rel);
      if (!file.startsWith(path.join(ROOT, 'dist')) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return r.fulfill({ status: 404, body: '' });
      return r.fulfill({ status: 200, contentType: TYPES[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file), headers: {
        'content-security-policy': fs.readFileSync(path.join(ROOT, 'csp.txt'), 'utf8').trim(),
        'x-frame-options': 'DENY', 'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin' } });
    });
    await page.route(COGNITO + '/oauth2/authorize*', (r) => {
      const u = new URL(r.request().url());
      s.authorizeUrl = u;
      const to = u.searchParams.get('redirect_uri') + '?code=abc123&state=' + u.searchParams.get('state');   // what the hosted login does after a successful sign-in
      r.fulfill({ status: 200, contentType: 'text/html', body: '<script>location.replace(' + JSON.stringify(to) + ')</script>' });
    });
    await page.route(COGNITO + '/oauth2/token', (r) => {
      s.tokenCalls.push(r.request().postData());
      r.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ access_token: 'access-' + s.tokenCalls.length, refresh_token: 'refresh-1', expires_in: 3600 }) });
    });
    await page.route(COGNITO + '/oauth2/revoke', (r) => r.fulfill({ status: 200, headers: CORS, body: '' }));
    await page.route(API + '/**', (r) => {
      const req = r.request(), u = new URL(req.url());
      if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
      const send = (status, body) => r.fulfill({ status, contentType: 'application/json', headers: CORS, body: JSON.stringify(body) });
      const tokenIn = u.pathname.match(/^\/share\/(.+)$/);
      if (tokenIn) {   // the public route: no login, the token is the credential (same rules as the Lambda)
        const sh = s.shares.get(tokenIn[1]);
        if (!sh || !invited) return send(404, { error: 'not found' });
        const entries = [...s.entries.values()].filter((e) => !e.deleted).sort((a, b) => (a.date < b.date ? -1 : 1)).map((e) => {
          const { updatedAt, syncedAt, comments, foodNotes, deleted, ...rest } = e;
          return sh.notes ? { ...rest, ...(comments ? { comments } : {}), ...(foodNotes ? { foodNotes } : {}) } : rest;
        });
        const { goal, baseline, heightIn, units, doseDay } = s.settings || {};
        return send(200, { entries, settings: Object.fromEntries(Object.entries({ goal, baseline, heightIn, units, doseDay }).filter(([, v]) => v !== undefined)), notes: sh.notes, createdAt: sh.createdAt });
      }
      s.authHeaders.push(req.headers()['authorization']);
      if (!invited) return send(403, { error: 'not invited' });
      if (u.pathname === '/shares' && req.method() === 'GET') return send(200, { shares: [...s.shares.entries()].map(([token, v]) => ({ token, ...v })) });
      if (u.pathname === '/shares' && req.method() === 'POST') {
        const token = 'T' + String(s.shares.size + 1).padStart(2, '0') + 'x'.repeat(40);
        s.shares.set(token, { createdAt: Date.now(), notes: !!JSON.parse(req.postData() || '{}').notes });
        return send(200, { token, ...s.shares.get(token) });
      }
      const del = u.pathname.match(/^\/shares\/(.+)$/);
      if (del && req.method() === 'DELETE') { const had = s.shares.delete(del[1]); return send(had ? 200 : 404, had ? { revoked: true } : { error: 'not found' }); }
      if (!invited) return send(403, { error: 'not invited' });
      if (u.pathname === '/me') return send(200, { allowed: true });
      if (u.pathname === '/sync') {
        const since = +(u.searchParams.get('since') || 0);
        const entries = [...s.entries.values()].filter((e) => e.syncedAt >= since).sort((a, b) => a.syncedAt - b.syncedAt);
        const settings = s.settings && s.settings.syncedAt >= since ? s.settings : null;
        const cursor = Math.max(since, ...entries.map((e) => e.syncedAt), settings ? settings.syncedAt : 0);
        return send(200, { entries, settings, cursor, hasMore: false });
      }
      const body = JSON.parse(req.postData() || '{}');
      if (u.pathname === '/entries') {
        s.puts.push(body.entries);
        const stale = [];
        let applied = 0;
        const rejected = [];
        body.entries.forEach((e) => {
          if (e.waist > 200) return rejected.push({ date: e.date, error: 'waist out of range' });
          if (s.put(e)) applied++; else stale.push(e.date);
        });
        return send(200, { applied, stale, rejected });
      }
      if (u.pathname === '/settings') {
        const cur = s.settings;
        if (cur && cur.updatedAt >= body.settings.updatedAt) return send(200, { applied: 0 });
        s.settings = { ...body.settings, syncedAt: ++s.clock };
        return send(200, { applied: 1 });
      }
      return send(404, { error: 'not found' });
    });
  };
  return s;
}

module.exports = { backend, APP, COGNITO, API, CORS };
