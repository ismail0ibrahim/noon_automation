// Backwards-compatible demo command: only sanitized status cards are recorded.
process.argv.push('--demo');
require('./run-live.cjs');
