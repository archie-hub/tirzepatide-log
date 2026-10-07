#!/usr/bin/env python3
"""Keep secrets and personal data out of git.  Standard library only; the same file lives in every repo of this project.

  scripts/secret_scan.py            scan what is staged (the pre-commit hook runs this)
  scripts/secret_scan.py --all      scan every tracked file
  scripts/secret_scan.py --history  scan every line ever added on any branch

Blocks: credentials and tokens, private keys, state/env/key/profile files, real health-data files (CSV and backups), and (per
.secret-scan.json) personal email addresses, AWS account ids and local home-directory paths. Findings never print the secret itself.
A line containing the text "secret-scan:allow" is skipped; .secret-scan.json can allow whole paths, emails and CSVs.
Exit status: 0 clean, 1 findings.
"""
import fnmatch, json, os, re, subprocess, sys

ROOT = subprocess.check_output(['git', 'rev-parse', '--show-toplevel'], text=True).strip()
CFG = {'allow_paths': [], 'allow_emails': [], 'allow_csv': [], 'block_account_ids': False, 'block_local_paths': False}
try:
    CFG.update(json.load(open(os.path.join(ROOT, '.secret-scan.json'))))
except FileNotFoundError:
    pass

BLOCKED_FILES = ['*.tfstate', '*.tfstate.*', '*.tfvars', '*.tfvars.json', '.env', '.env.*', '*.pem', '*.p12', '*.p8', '*.pfx', '*.key',
                 '*.keystore', '*.jks', '*.mobileprovision', '*.provisionprofile', 'id_rsa*', 'id_ed25519*', 'credentials',
                 '.npmrc', '.netrc', '*.sqlite', '*.sqlite3', '*.store', '*TirzTrackBackup*', 'before-cloud-sync*', 'cloud-sync-state*',
                 '.secret-scan.local']
HEALTH_FILES = ['*.csv']   # real log exports; allowed only where .secret-scan.json says (the fake sample)

RULES = [
    ('aws-access-key', re.compile(r'\b(AKIA|ASIA)[0-9A-Z]{16}\b')),
    ('aws-secret-key', re.compile(r'(?i)aws_secret_access_key\s*[:=]\s*[\'"]?[A-Za-z0-9/+=]{30,}')),
    ('private-key', re.compile(r'-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----')),
    ('github-token', re.compile(r'\bgh[pousr]_[A-Za-z0-9]{30,}\b|github_pat_[A-Za-z0-9_]{30,}')),
    ('stripe-key', re.compile(r'\b(sk|rk)_(live|test)_[0-9A-Za-z]{10,}\b|\bwhsec_[0-9A-Za-z]{10,}\b')),
    ('slack-token', re.compile(r'\bxox[baprs]-[0-9A-Za-z-]{10,}')),
    ('google-api-key', re.compile(r'\bAIza[0-9A-Za-z_-]{35}\b')),
    ('jwt', re.compile(r'\beyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}')),
    ('bearer-token', re.compile(r'(?i)\bbearer\s+[A-Za-z0-9._~+/-]{30,}=*')),
    ('secret-assignment', re.compile(
        r'(?i)\b(password|passwd|secret|api[_-]?key|access[_-]?key|private[_-]?key|auth[_-]?token|refresh[_-]?token|client[_-]?secret)\b["\']?\s*[:=]\s*'
        r'["\'](?!(?:[^"\']*(?:your|example|placeholder|changeme|xxx|<|\$\{|\{\{|test|dummy|fake|sample)))[^"\'\s]{12,}["\']')),
]
EMAIL = re.compile(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.([A-Za-z]{2,})')
FILE_TLDS = {'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'js', 'css', 'html', 'swift', 'json', 'webmanifest', 'md', 'ts', 'txt'}
SAFE_EMAIL_DOMAINS = ('example.com', 'example.invalid', 'users.noreply.github.com', 'noreply.github.com', 'anthropic.com')
ACCOUNT_ID = re.compile(r'(?<![\d.])\d{12}(?![\d.])')
ACCOUNT_CONTEXT = re.compile(r'(?i)aws|arn:|account|bucket|cloudfront|iam|sts')
LOCAL_PATH = re.compile(r'/Users/[A-Za-z0-9._-]+/')


def sh(*a):
    return subprocess.run(a, cwd=ROOT, text=True, capture_output=True, errors='replace').stdout


def path_allowed(path):
    return any(fnmatch.fnmatch(path, g) for g in CFG['allow_paths'])


def file_findings(path):
    base = os.path.basename(path)
    out = []
    if any(fnmatch.fnmatch(base, g) for g in BLOCKED_FILES):
        out.append(('blocked-file', 'a file of this kind holds secrets or private data'))
    elif any(fnmatch.fnmatch(base, g) for g in HEALTH_FILES) and not any(fnmatch.fnmatch(path, g) for g in CFG['allow_csv']):
        out.append(('health-data-file', 'a CSV that is not listed in allow_csv may hold real health data'))
    return out


def line_findings(path, text):
    if 'secret-scan:allow' in text:
        return []
    out = []
    for name, rx in RULES:
        if rx.search(text):
            out.append((name, 'matches the ' + name + ' pattern'))
    for m in EMAIL.finditer(text):
        addr, tld = m.group(0).lower(), m.group(1).lower()
        if tld in FILE_TLDS or addr.endswith(SAFE_EMAIL_DOMAINS) or addr.split('@')[0] in ('noreply', 'no-reply') or addr in [e.lower() for e in CFG['allow_emails']]:
            continue
        out.append(('email-address', 'a personal email address (add it to allow_emails if it is meant to be public)'))
        break
    if CFG['block_account_ids'] and ACCOUNT_ID.search(text) and ACCOUNT_CONTEXT.search(text):
        out.append(('aws-account-id', 'an AWS account id (look it up at run time instead)'))
    if CFG['block_local_paths'] and LOCAL_PATH.search(text):
        out.append(('local-path', 'a path under a home directory (use ~ instead)'))
    return out


def added_lines(diff_text):
    path, line = None, 0
    for raw in diff_text.splitlines():
        if raw.startswith('+++ '):
            path = raw[6:] if raw.startswith('+++ b/') else None
        elif raw.startswith('@@'):
            m = re.search(r'\+(\d+)', raw)
            line = int(m.group(1)) - 1 if m else 0
        elif raw.startswith('+') and path:
            line += 1
            yield path, line, raw[1:]
        elif not raw.startswith('-'):
            line += 1


def report(findings):
    for path, line, rule, why in findings:
        print(f'  {path}{":" + str(line) if line else ""}: {rule}: {why}')


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else '--staged'
    findings, seen_files = [], set()
    if mode == '--staged':
        names = [n for n in sh('git', 'diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z').split('\0') if n]
        diff = sh('git', 'diff', '--cached', '-U0', '--no-color', '--diff-filter=ACMR')
        for n in names:
            if not path_allowed(n):
                findings += [(n, 0, r, w) for r, w in file_findings(n)]
        for p, ln, text in added_lines(diff):
            if not path_allowed(p):
                findings += [(p, ln, r, w) for r, w in line_findings(p, text)]
    elif mode == '--all':
        for n in [n for n in sh('git', 'ls-files', '-z').split('\0') if n]:
            if path_allowed(n):
                continue
            findings += [(n, 0, r, w) for r, w in file_findings(n)]
            try:
                data = open(os.path.join(ROOT, n), 'rb').read()
            except OSError:
                continue
            if b'\0' in data[:4096]:
                continue
            for i, text in enumerate(data.decode('utf-8', 'replace').splitlines(), 1):
                findings += [(n, i, r, w) for r, w in line_findings(n, text)]
    elif mode == '--history':
        names = set(n for n in sh('git', 'log', '--all', '--name-only', '--pretty=format:', '-z').split('\0') if n.strip())
        for n in sorted(names):
            if not path_allowed(n):
                findings += [(n, 0, r, w) for r, w in file_findings(n)]
        for p, ln, text in added_lines(sh('git', 'log', '--all', '-p', '-U0', '--no-color')):
            if not path_allowed(p):
                findings += [(p, ln, r, w) for r, w in line_findings(p, text)]
        findings = sorted(set(findings))
    else:
        sys.exit(__doc__)
    if findings:
        print(f'secret-scan: {len(findings)} possible problem(s) {"in the staged changes" if mode == "--staged" else "(" + mode + ")"}:')
        report(findings[:60])
        if len(findings) > 60:
            print(f'  ... and {len(findings) - 60} more')
        print('Nothing was committed. Remove it, or if it is a false alarm add "secret-scan:allow" to the line or list it in .secret-scan.json.')
        sys.exit(1)
    print('secret-scan: clean')


if __name__ == '__main__':
    main()
