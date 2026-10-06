#!/usr/bin/env python3
"""Build the hosted copy of the app into dist/ for https://tirzepatide.phoe.be/.

The app stays one file for file:// and GitHub Pages (index.html). The hosted copy moves the two inline scripts into
content-hashed files so the Content-Security-Policy in csp.txt can say script-src 'self' (no 'unsafe-inline' for scripts).
Run: python3 build-hosted.py   (deploy.sh does it for you)
"""
import hashlib, os, re, shutil, sys

root = os.path.dirname(os.path.abspath(__file__))
dist = os.path.join(root, 'dist')
html = open(os.path.join(root, 'index.html'), encoding='utf-8').read()

scripts = list(re.finditer(r'<script>(.*?)</script>', html, re.S))
if len(scripts) != 2:
    sys.exit(f'expected 2 inline scripts in index.html, found {len(scripts)}')
for m in scripts:
    if re.search(r'<script\b', m.group(1)):
        sys.exit('unexpected nested <script>')
if re.search(r'\son[a-z]+\s*=\s*["\']', html) or 'javascript:' in html:
    sys.exit('inline event handlers or javascript: URLs would be blocked by the CSP')

shutil.rmtree(dist, ignore_errors=True)
os.makedirs(dist)
out = html
names = []
for m, base in reversed(list(zip(scripts, ['gate', 'app']))):   # replace from the end so offsets stay valid
    body = m.group(1).strip('\n') + '\n'
    h = hashlib.sha256(body.encode('utf-8')).hexdigest()[:10]
    name = f'{base}.{h}.js'
    open(os.path.join(dist, name), 'w', encoding='utf-8').write(body)
    out = out[:m.start()] + f'<script src="{name}"></script>' + out[m.end():]
    names.append(name)
open(os.path.join(dist, 'index.html'), 'w', encoding='utf-8').write(out)

open(os.path.join(dist, '404.html'), 'w', encoding='utf-8').write(
    '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    '<title>Not found</title><meta name="robots" content="noindex"></head><body style="font:16px system-ui;margin:3rem auto;max-width:30rem;padding:0 1rem">'
    '<h1>Not found</h1><p>That page does not exist. <a href="/">Tirzepatide Log</a></p></body></html>\n')
for f in ['sw.js', 'manifest.webmanifest', 'og-image.png']:
    shutil.copy(os.path.join(root, f), dist)
for d in ['icons', 'landing']:
    shutil.copytree(os.path.join(root, d), os.path.join(dist, d))
print('built dist/:', ', '.join(sorted(names)))
