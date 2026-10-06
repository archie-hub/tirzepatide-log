// Build the hosted copy (dist/) once before any test runs; tests/csp.spec.js serves it.
const { execFileSync } = require('child_process');
const path = require('path');
module.exports = async () => { execFileSync('python3', [path.join(__dirname, '..', 'build-hosted.py')], { stdio: 'pipe' }); };
