/**
 * CSV / JSON Batch Importer
 * Loads batch items from:
 *   - .json  → array of objects
 *   - .csv   → header row + data rows
 *
 * Expected fields (all except imagePath/title are optional):
 *   imagePath, title, subtitle, cta, badge, linkLabel, category
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

/**
 * Load batch items from a JSON or CSV file.
 * @param {string} filePath
 * @returns {Promise<Array>}
 */
async function loadBatchItems(filePath) {
  const absPath = path.isAbsolute(filePath) ? filePath : path.join(ROOT, filePath);

  if (!fs.existsSync(absPath)) {
    throw new Error(`Batch file not found: ${absPath}`);
  }

  const ext = path.extname(absPath).toLowerCase();

  if (ext === '.json') {
    return loadJSON(absPath);
  } else if (ext === '.csv') {
    return loadCSV(absPath);
  } else {
    throw new Error(`Unsupported batch file format: ${ext}. Use .json or .csv`);
  }
}

function loadJSON(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Invalid JSON in ${filePath}: ${e.message}`);
  }

  if (!Array.isArray(data)) {
    throw new Error(`JSON batch file must be an array of objects`);
  }

  return data.map(item => normalizeItem(item));
}

function loadCSV(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    throw new Error('CSV file must have a header row and at least one data row');
  }

  const headers = parseCSVRow(lines[0]).map(h => h.trim().toLowerCase());
  const items = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVRow(lines[i]);
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = (values[idx] || '').trim();
    });
    items.push(normalizeItem(obj));
  }

  return items;
}

/**
 * Normalize field names and resolve image paths.
 */
function normalizeItem(obj) {
  // Accept both imagePath, image_path, image, filename
  const imagePath =
    obj.imagePath || obj.image_path || obj.image || obj.filename || '';

  // Resolve relative paths
  const resolvedPath = imagePath
    ? path.isAbsolute(imagePath)
      ? imagePath
      : path.join(ROOT, 'uploads', path.basename(imagePath))
    : '';

  return {
    imagePath: resolvedPath,
    title: obj.title || obj.Title || '',
    subtitle: obj.subtitle || obj.Subtitle || '',
    cta: obj.cta || obj.CTA || obj['call-to-action'] || '',
    badge: obj.badge || obj.Badge || '',
    linkLabel: obj.linkLabel || obj.link_label || obj.link || '',
    category: obj.category || obj.Category || '',
  };
}

/**
 * Minimal CSV row parser — handles quoted fields with commas inside.
 */
function parseCSVRow(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  let i = 0;

  while (i < line.length) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        // Escaped quote
        current += '"';
        i += 2;
        continue;
      }
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
    i++;
  }
  fields.push(current);
  return fields;
}

/**
 * Save a results summary to JSON (useful for audit trails).
 */
function saveResultsSummary(results, outputPath) {
  const summary = {
    generatedAt: new Date().toISOString(),
    totalPins: results.length,
    success: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length,
    results: results.map(r => ({
      outputPath: r.outputPath,
      template: r.template,
      renderTime: r.renderTime,
      success: r.success,
      error: r.error || null,
    })),
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(summary, null, 2));
  return summary;
}

module.exports = { loadBatchItems, saveResultsSummary };
