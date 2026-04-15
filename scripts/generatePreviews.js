/**
 * Template Preview Registry
 * Renders each template family with a placeholder/gradient background
 * and saves thumbnails to previews/ for quick visual reference.
 *
 * Usage:
 *   node scripts/generatePreviews.js [--image uploads/yourimage.jpg]
 */

const path   = require('path');
const fs     = require('fs');
const sharp  = require('sharp');

const { parseArgs }          = require('./utils/cliArgs');
const { TEMPLATE_FAMILIES, PIN_SIZES } = require('../configs/templates');
const { buildPinHTML }       = require('../templates/htmlBuilder');
const { getBrowser, closeBrowser } = require('../utils/renderer');
const { generateVariants }   = require('../utils/variantGenerator');

const ROOT      = path.join(__dirname, '..');
const PREV_DIR  = path.join(ROOT, 'previews');

// Gradient placeholder backgrounds per template aesthetic
const PLACEHOLDER_GRADIENTS = [
  'linear-gradient(135deg, #c9d6df 0%, #e2ebf0 100%)',
  'linear-gradient(135deg, #f5f0e8 0%, #e8ddd0 100%)',
  'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
  'linear-gradient(135deg, #d4c5b0 0%, #c4b09a 100%)',
  'linear-gradient(135deg, #2d2d2d 0%, #1a1a1a 100%)',
  'linear-gradient(135deg, #a8c5da 0%, #7ba7bc 100%)',
  'linear-gradient(135deg, #e8e0d5 0%, #d5c9b8 100%)',
  'linear-gradient(135deg, #0d0d0d 0%, #1a1a1a 50%, #0d0d0d 100%)',
  'linear-gradient(135deg, #f0ece4 0%, #e4ddd4 100%)',
  'linear-gradient(135deg, #3a3a4a 0%, #2d2d3a 100%)',
  'linear-gradient(135deg, #d8cfc4 0%, #c8bfb4 100%)',
];

async function createPlaceholderImage(gradient, width, height) {
  // Create an SVG with the gradient and convert to PNG buffer
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style="stop-color:${extractColor(gradient, 0)}"/>
        <stop offset="100%" style="stop-color:${extractColor(gradient, 1)}"/>
      </linearGradient>
    </defs>
    <rect width="${width}" height="${height}" fill="url(#g)"/>
  </svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

function extractColor(gradient, index) {
  const matches = gradient.match(/#[0-9a-fA-F]{6}/g);
  if (!matches || matches.length === 0) return index === 0 ? '#888888' : '#444444';
  return matches[Math.min(index, matches.length - 1)];
}

async function main() {
  const args   = parseArgs(process.argv.slice(2));
  const useImg = args.image ? path.join(ROOT, args.image) : null;

  fs.mkdirSync(PREV_DIR, { recursive: true });

  const templates = Object.values(TEMPLATE_FAMILIES);
  const size      = PIN_SIZES.standard;
  const W         = size.width;
  const H         = size.height;

  console.log(`\n🎨  Generating ${templates.length} template previews...\n`);

  const browser = await getBrowser();

  const mockAnalysis = {
    isDark: false, isLight: false, hasCleanTop: true, hasCleanBottom: true,
    hasCleanCenter: true, hasDarkBottom: false, hasDarkTop: false,
    avgBrightness: 140, dominantColor: { hex: '#a8bdc8', isSaturated: false },
    autoTextColor: '#ffffff', adaptiveOverlayOpacity: 0.82,
    safeZones: ['top', 'upperMid', 'center', 'lowerMid', 'bottom'],
    busyZones: [], mobileSafeZones: ['upperMid', 'center', 'lowerMid'],
    avoidGridCells: [], safeGridCells: [],
  };

  const mockInputs = {
    title:    'Premium Pinterest Pin Title Here',
    subtitle: 'A short supporting line that adds context',
    category: 'LIFESTYLE',
    cta:      'Read More',
    badge:    'NEW',
  };

  const results = [];

  for (let i = 0; i < templates.length; i++) {
    const tmpl = templates[i];
    const gradient = PLACEHOLDER_GRADIENTS[i % PLACEHOLDER_GRADIENTS.length];

    let imageDataUrl;

    if (useImg && fs.existsSync(useImg)) {
      const ext  = path.extname(useImg).slice(1).toLowerCase();
      const mime = ({ jpg: 'jpeg', jpeg: 'jpeg', png: 'png', webp: 'webp' })[ext] || 'jpeg';
      imageDataUrl = `data:image/${mime};base64,${fs.readFileSync(useImg).toString('base64')}`;
    } else {
      const placeholderBuf = await createPlaceholderImage(gradient, W, H);
      imageDataUrl = `data:image/png;base64,${placeholderBuf.toString('base64')}`;
    }

    // Build one recipe manually for this template
    const recipe = {
      variantId:    `prev_${i}`,
      templateId:   tmpl.id,
      templateName: tmpl.name,
      size,
      inputs:       mockInputs,
      layout: {
        textPosition:    tmpl.textPosition,
        textAlign:       tmpl.textAlign,
        maxTitleWidth:   tmpl.maxTitleWidth,
        titleSizeMin:    tmpl.titleSizeMin,
        titleSizeMax:    tmpl.titleSizeMax,
        padding:         tmpl.padding,
        textShadow:      tmpl.textShadow || 'none',
        textColor:       tmpl.textColor,
        gradientOverlay: tmpl.gradientOverlay || null,
        showHRule:       tmpl.showHRule || false,
        colorPalette:    tmpl.colorPalette || null,
        overlayWidth:    tmpl.overlayWidth,
        overlayHeight:   tmpl.overlayHeight,
        overlayPaddingX: tmpl.overlayPaddingX,
        overlayPaddingY: tmpl.overlayPaddingY,
        columnWidth:     tmpl.columnWidth,
        panelWidth:      tmpl.panelWidth,
        panelRadius:     tmpl.panelRadius,
        fontPreset:      tmpl.fontPreset,
      },
      overlay: resolveOverlayForTemplate(tmpl),
      font:    require('../configs/templates').FONT_PRESETS[tmpl.fontPreset] || require('../configs/templates').FONT_PRESETS.manrope_inter,
      spacing: { titleMarginBottom: 16, subtitleMarginBottom: 18, sectionGap: 24 },
      analysis: mockAnalysis,
      meta: { spacing: 'normal', overlayOpacity: 0.82 },
    };

    const html = buildPinHTML(recipe, imageDataUrl);
    const page = await browser.newPage();

    try {
      await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
      await page.setRequestInterception(true);
      page.on('request', req => req.continue());
      await page.setContent(html, { waitUntil: 'networkidle0', timeout: 25000 });
      await page.evaluateHandle('document.fonts.ready');
      await new Promise(r => setTimeout(r, 150));

      const el  = await page.$('#pin-root');
      const buf = await el.screenshot({ type: 'png' });

      // Save full-size preview
      const fullPath  = path.join(PREV_DIR, `${String(i + 1).padStart(2, '0')}_${tmpl.id}.jpg`);
      // Save thumbnail (400px wide)
      const thumbPath = path.join(PREV_DIR, `${String(i + 1).padStart(2, '0')}_${tmpl.id}_thumb.jpg`);

      await sharp(buf).jpeg({ quality: 85 }).toFile(fullPath);
      await sharp(buf).resize(400, 600, { fit: 'cover' }).jpeg({ quality: 78 }).toFile(thumbPath);

      console.log(`  ✓ [${i + 1}/${templates.length}] ${tmpl.name}`);
      results.push(thumbPath);

    } catch (err) {
      console.error(`  ✗ ${tmpl.name}: ${err.message}`);
    } finally {
      await page.close();
    }
  }

  // Generate preview index contact sheet
  if (results.length > 0) {
    const { generateContactSheet } = require('../utils/renderer');
    const sheetPath = path.join(PREV_DIR, '_all_templates_sheet.jpg');
    await generateContactSheet(results, sheetPath);
    console.log(`\n📋  Contact sheet: ${sheetPath}`);
  }

  await closeBrowser();
  console.log(`\n✅  All previews saved to: previews/\n`);
}

function resolveOverlayForTemplate(tmpl) {
  const { OVERLAY_TYPES } = require('../configs/templates');
  const ot = OVERLAY_TYPES[tmpl.overlay] || OVERLAY_TYPES.none;
  if (ot.type === 'none') return { type: 'none' };
  return { type: ot.type, bg: ot.bg, blur: ot.blur || '0px', edge: ot.edge || 'soft', radius: ot.radius || '0px', opacity: 0.82 };
}

main().catch(err => {
  console.error('\n❌  Fatal:', err.message);
  closeBrowser().finally(() => process.exit(1));
});
