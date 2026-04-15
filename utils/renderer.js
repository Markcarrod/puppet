/**
 * Enhanced Renderer
 * Additions:
 * - Structured filename convention: pin_T03_playfair_lower_v1_1000x1500.jpg
 * - JSON metadata sidecar per rendered pin
 * - Contact sheet generation after batch
 * - --debug flag support (open in browser + print layout decisions)
 * - Reusable browser + bounded concurrency unchanged
 */

const puppeteer = require('puppeteer');
const sharp     = require('sharp');
const path      = require('path');
const fs        = require('fs');
const { buildPinHTML } = require('../templates/htmlBuilder');

let browserInstance      = null;
let browserLaunchPromise = null;

// ─── Browser Management ───────────────────────────────────────────────────────

async function getBrowser() {
  if (browserInstance && browserInstance.isConnected()) return browserInstance;
  if (browserLaunchPromise) return browserLaunchPromise;

  browserLaunchPromise = puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
      '--font-render-hinting=none',
    ],
    defaultViewport: null,
  }).then(b => {
    browserInstance      = b;
    browserLaunchPromise = null;
    console.log('[Renderer] Puppeteer browser launched');
    return b;
  }).catch(err => {
    browserLaunchPromise = null;
    console.error('[Renderer] Puppeteer launch failed:', err.message);
    throw err;
  });

  return browserLaunchPromise;
}

async function closeBrowser() {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
    console.log('[Renderer] Puppeteer browser closed');
  }
}

// ─── Filename Convention ───────────────────────────────────────────────────────
// Format: pin_<templateSlug>_<fontSlug>_<posSlug>_v<variantNum>_<WxH>.<ext>
// Example: pin_lower_third_card_jakarta_lower_v2_1000x1500.jpg

const TEMPLATE_NUMS = {};
let   tmplCounter   = 1;

function buildOutputFilename(recipe, format) {
  const { templateId, variantId, size, font } = recipe;

  // Assign a stable short number per template for filename brevity
  if (!TEMPLATE_NUMS[templateId]) TEMPLATE_NUMS[templateId] = String(tmplCounter++).padStart(2, '0');
  const tNum = TEMPLATE_NUMS[templateId];

  const fontSlug = (font?.heading || 'font')
    .replace(/['",]/g, '').split(',')[0].trim().toLowerCase().replace(/\s+/g, '-').slice(0, 12);

  const posSlug  = (recipe.layout?.textPosition || 'center')
    .replace(/[^a-z0-9]/gi, '-').toLowerCase().slice(0, 10);

  const variantSlug = String(variantId)
    .replace(new RegExp(`^${templateId}_?`), '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 28) || 'default';
  const dims = `${size.width}x${size.height}`;

  return `pin_${tNum}_${templateId.slice(0, 18)}_${fontSlug}_${posSlug}_v${variantSlug}_${dims}.${format}`;
}

// ─── Image → data URL ──────────────────────────────────────────────────────────

function imageToDataUrl(imagePath) {
  const ext  = path.extname(imagePath).slice(1).toLowerCase();
  const mime = ({ jpg: 'jpeg', jpeg: 'jpeg', png: 'png', webp: 'webp', gif: 'gif' })[ext] || 'jpeg';
  const data = fs.readFileSync(imagePath);
  return `data:image/${mime};base64,${data.toString('base64')}`;
}

// ─── Metadata Sidecar ─────────────────────────────────────────────────────────

function writeSidecar(outputPath, recipe, renderTime, warnings) {
  const sidecarPath = outputPath.replace(/\.[^.]+$/, '.meta.json');
  const meta = {
    generatedAt:   new Date().toISOString(),
    templateId:    recipe.templateId,
    templateName:  recipe.templateName,
    variantId:     recipe.variantId,
    fontPreset:    recipe.layout?.fontPreset || 'unknown',
    overlay:       recipe.overlay?.type      || 'none',
    overlayOpacity:recipe.overlay?.opacity   || 0,
    spacing:       recipe.meta?.spacing      || 'normal',
    size:          recipe.size,
    inputs: {
      title:    recipe.inputs?.title,
      subtitle: recipe.inputs?.subtitle,
      category: recipe.inputs?.category,
      cta:      recipe.inputs?.cta,
      badge:    recipe.inputs?.badge,
    },
    imageAnalysis: {
      isDark:               recipe.analysis?.isDark,
      isLight:              recipe.analysis?.isLight,
      hasCleanTop:          recipe.analysis?.hasCleanTop,
      hasDarkBottom:        recipe.analysis?.hasDarkBottom,
      adaptiveOverlayOpacity: recipe.analysis?.adaptiveOverlayOpacity,
      dominantColor:        recipe.analysis?.dominantColor?.hex,
      autoTextColor:        recipe.analysis?.autoTextColor,
    },
    renderTime,
    warnings,
    outputFile: path.basename(outputPath),
  };
  try {
    fs.writeFileSync(sidecarPath, JSON.stringify(meta, null, 2));
  } catch (e) {
    console.warn('[Renderer] Could not write sidecar:', e.message);
  }
}

// ─── Single Pin Render ────────────────────────────────────────────────────────

async function renderPin(recipe, imagePath, outputPath, options = {}) {
  const startTime = Date.now();
  const { format = 'webp', quality = 88, sharpen = false, debug = false } = options;

  const imageDataUrl = imageToDataUrl(imagePath);
  const html = buildPinHTML(recipe, imageDataUrl);
  const { width, height } = recipe.size;

  const browser = await getBrowser();
  const page    = await browser.newPage();

  try {
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.setRequestInterception(true);

    page.on('request', req => req.continue());

    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.evaluateHandle('document.fonts.ready');
    await new Promise(r => setTimeout(r, 200));

    if (debug) {
      // In debug mode open in browser (non-headless won't work in CI but useful locally)
      console.log('\n[Debug] HTML written to:', outputPath.replace(/\.[^.]+$/, '.debug.html'));
      fs.writeFileSync(outputPath.replace(/\.[^.]+$/, '.debug.html'), html);
    }

    const element = await page.$('#pin-root');
    if (!element) throw new Error('pin-root element not found in HTML');

    const screenshotBuffer = await element.screenshot({ type: 'png', omitBackground: false });

    // Post-process with Sharp
    let chain = sharp(screenshotBuffer).resize(width, height, { fit: 'cover' });
    if (sharpen) chain = chain.sharpen({ sigma: 0.8 });

    const lf = format.toLowerCase();
    if      (lf === 'webp') chain = chain.webp({ quality, effort: 3 });
    else if (lf === 'png')  chain = chain.png({ compressionLevel: 8 });
    else                    chain = chain.jpeg({ quality, mozjpeg: true });

    const outDir = path.dirname(outputPath);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    await chain.toFile(outputPath);

    const renderTime = Date.now() - startTime;
    const warnings   = [];

    // Write sidecar JSON
    writeSidecar(outputPath, recipe, renderTime, warnings);

    console.log(`[Renderer] ✓ ${path.basename(outputPath)} (${renderTime}ms)`);

    return { outputPath, renderTime, warnings, template: recipe.templateId, variant: recipe.variantId, success: true };

  } catch (err) {
    console.error(`[Renderer] ✗ ${recipe.variantId}: ${err.message}`);
    throw err;
  } finally {
    await page.close();
  }
}

// ─── Batch Render ─────────────────────────────────────────────────────────────

async function renderBatch(jobs, opts = {}) {
  const { concurrency = 3, onProgress, generateSheet = false } = opts;
  const results   = [];
  let   completed = 0;

  for (let i = 0; i < jobs.length; i += concurrency) {
    const chunk = jobs.slice(i, i + concurrency);
    const chunkResults = await Promise.all(chunk.map(async job => {
      try {
        const result = await renderPin(
          job.recipe, job.imagePath,
          job.outputPath || buildAutoOutputPath(job),
          job.options || {}
        );
        completed++;
        if (onProgress) onProgress({ completed, total: jobs.length, result, error: null });
        return { success: true, ...result };
      } catch (err) {
        completed++;
        const fail = { success: false, error: err.message, outputPath: job.outputPath };
        if (onProgress) onProgress({ completed, total: jobs.length, result: fail, error: err.message });
        return fail;
      }
    }));
    results.push(...chunkResults);
  }

  // Contact sheet
  if (generateSheet && results.filter(r => r.success).length > 0) {
    const successPaths = results.filter(r => r.success).map(r => r.outputPath);
    const sheetPath = path.join(path.dirname(successPaths[0]), '..', '_contact_sheet.jpg');
    await generateContactSheet(successPaths, sheetPath).catch(e =>
      console.warn('[ContactSheet] Failed:', e.message)
    );
  }

  return results;
}

function buildAutoOutputPath(job) {
  const { recipe, imagePath } = job;
  const fmt     = job.options?.format || 'webp';
  const baseName = path.parse(imagePath).name;
  const filename = buildOutputFilename(recipe, fmt);
  return path.join(path.dirname(imagePath), '..', 'output', baseName, filename);
}

// ─── Contact Sheet ────────────────────────────────────────────────────────────

async function generateContactSheet(imagePaths, outputPath) {
  const THUMB_W  = 200;
  const THUMB_H  = 300;
  const COLS     = Math.min(6, imagePaths.length);
  const ROWS     = Math.ceil(imagePaths.length / COLS);
  const GAP      = 8;
  const SHEET_W  = COLS * THUMB_W + (COLS + 1) * GAP;
  const SHEET_H  = ROWS * THUMB_H + (ROWS + 1) * GAP;

  const composites = [];

  for (let i = 0; i < imagePaths.length; i++) {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const left = GAP + col * (THUMB_W + GAP);
    const top  = GAP + row * (THUMB_H + GAP);

    try {
      const thumbBuf = await sharp(imagePaths[i])
        .resize(THUMB_W, THUMB_H, { fit: 'cover' })
        .jpeg({ quality: 70 })
        .toBuffer();

      composites.push({ input: thumbBuf, left, top });
    } catch (e) {
      console.warn(`[ContactSheet] Skipped ${imagePaths[i]}: ${e.message}`);
    }
  }

  if (composites.length === 0) return;

  await sharp({
    create: { width: SHEET_W, height: SHEET_H, channels: 3, background: { r: 18, g: 18, b: 24 } },
  })
    .composite(composites)
    .jpeg({ quality: 78 })
    .toFile(outputPath);

  console.log(`[ContactSheet] ✓ ${path.basename(outputPath)} — ${composites.length} pins`);
  return outputPath;
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  renderPin,
  renderBatch,
  getBrowser,
  closeBrowser,
  generateContactSheet,
  buildOutputFilename,
};
