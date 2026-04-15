/**
 * Simple CLI argument parser — no external deps needed.
 * Parses --key value pairs into a plain object.
 */
function parseArgs(argv) {
  const result = {};
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        // Try to coerce numbers
        result[key] = isNaN(Number(next)) || next === '' ? next : Number(next);
        i += 2;
      } else {
        result[key] = true;
        i++;
      }
    } else {
      i++;
    }
  }
  return result;
}

module.exports = { parseArgs };
