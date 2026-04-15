/**
 * Debug + Hot-Reload Template Watcher
 *
 * Usage:
 *   node scripts/debugRender.js --image uploads/<file> --title "Your Title" [options]
 *   node scripts/debugRender.js --image uploads/<file> --title "Your Title" --watch
 *
 * Options:
 *   --image     Path to image (relative to project root or absolute)
 *   --title     Title text
 *   --subtitle  Subtitle (optional)
 *   --template  Template ID or "auto" (default: auto)
 *   --size      Pin size (default: standard)
 *   --format    Output format (default: webp)
 *   --watch     Hot-reload: re-render on htmlBuilder.js / templates.js save
 *   --open      Open rendered pin with default OS viewer after render
 */

const path   = require('path');
const fs     = require('fs');
const { execSync } = require('child_process');

const { parseArgs }        = require('./utils/cliArgs');
const { analyzeImage }     = require('../utils/imageAnalyzer');
const { generateVariants } = require('../utils/variantGenerator');
const { renderPin, closeBrowser, buildOutputFilename } = require('../utils/renderer');
const { TEMPLATE_FAMILIES } = require('../configs/templates');

const ROOT = path.join(__dirname, '..');

async function debugRender(args) {
  const {
    image: imageArg,
    title    = 'Debug Test Title for PIN',
    subtitle,
    template: templateMode = 'auto',
    size:     pinSize      = 'standard',
    format                 = 'webp',
    quality                = 88,
    open:     openResult   = false,
  } = args;

  if (!imageArg) {
    console.error('❌  Provide --image <path>');
    process.exit(1);
  }

  const imagePath = path.isAbsolute(imageArg)
    ? imageArg
    : path.join(ROOT, imageArg);

  if (!fs.existsSync(imagePath)) {
    console.error('❌  Image not found:', imagePath);
    process.exit(1);
  }

  console.log('\n🔍  Analyzing image…');
  const analysis = await analyzeImage(imagePath);

  console.log('\n📊  Image Analysis:');
  console.log(`    Brightness: ${analysis.avgBrightness.toFixed(1)} (${analysis.isDark ? 'dark' : analysis.isLight ? 'light' : 'mixed'})`);
  console.log(`    Safe zones: ${analysis.safeZones.join(', ') || 'none'}`);
  console.log(`    Busy zones: ${analysis.busyZones.join(', ') || 'none'}`);
  console.log(`    Dominant color: ${analysis.dominantColor?.hex} (saturated: ${analysis.dominantColor?.isSaturated})`);
  console.log(`    Auto text color: ${analysis.autoTextColor}`);
  console.log(`    Adaptive overlay opacity: ${analysis.adaptiveOverlayOpacity?.toFixed(2)}`);
  console.log(`    Mobile safe zones: ${analysis.mobileSafeZones?.join(', ') || 'none'}`);

  console.log('\n📐  Grid activity map (3×3):');
  if (analysis.grid) {
    for (let row = 0; row < 3; row++) {
      const rowCells = analysis.grid.filter(c => c.row === row);
      const bar = rowCells.map(c => {
        const a = Math.round(c.activity);
        const label = a < 30 ? '░░' : a < 55 ? '▒▒' : '██';
        return `${label}(${a})`;
      }).join('  ');
      console.log(`    Row ${row}: ${bar}`);
    }
  }

  const inputs = { title, subtitle };
  const variants = generateVariants(analysis, inputs, { maxVariants: 3, templateMode, pinSize });

  console.log(`\n🎨  Generating ${variants.length} variant(s):\n`);

  variants.forEach((recipe, i) => {
    console.log(`  [${i + 1}] ${recipe.templateName}`);
    console.log(`      Overlay: ${recipe.overlay?.type} @ opacity ${recipe.overlay?.opacity?.toFixed(2) || 'n/a'}`);
    console.log(`      Font:    ${recipe.font?.heading?.split(',')[0]}`);
    console.log(`      Spacing: ${recipe.meta?.spacing}`);
  });

  const debugDir = path.join(ROOT, 'output', '_debug');
  fs.mkdirSync(debugDir, { recursive: true });

  let lastOutputPath = null;

  for (const recipe of variants) {
    const filename = buildOutputFilename(recipe, format);
    const outputPath = path.join(debugDir, filename);

    try {
      await renderPin(recipe, imagePath, outputPath, { format, quality: parseInt(quality), debug: true });
      lastOutputPath = outputPath;
    } catch (err) {
      console.error(`  ✗ ${recipe.templateId}: ${err.message}`);
    }
  }

  if (openResult && lastOutputPath && fs.existsSync(lastOutputPath)) {
    try {
      const opener = process.platform === 'win32' ? 'start ""'
                   : process.platform === 'darwin' ? 'open'
                   : 'xdg-open';
      execSync(`${opener} "${lastOutputPath}"`);
      console.log(`\n📂  Opened: ${lastOutputPath}`);
    } catch (_) {}
  }

  console.log(`\n✅  Debug renders in: ${debugDir}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.watch) {
    console.log('👁  Hot-reload mode — watching template files…\n');

    const watchPaths = [
      path.join(ROOT, 'templates', 'htmlBuilder.js'),
      path.join(ROOT, 'configs',   'templates.js'),
      path.join(ROOT, 'utils',     'textEngine.js'),
    ];

    let debounce = null;

    const run = async () => {
      // Clear require cache for template files so changes are picked up
      watchPaths.forEach(p => { delete require.cache[require.resolve(p)]; });
      // Also clear htmlBuilder and textEngine
      const extraClear = [
        path.join(ROOT, 'templates', 'htmlBuilder.js'),
        path.join(ROOT, 'utils', 'textEngine.js'),
        path.join(ROOT, 'configs', 'templates.js'),
      ];
      extraClear.forEach(p => { try { delete require.cache[require.resolve(p)]; } catch(_) {} });

      console.log('\n🔄  Change detected — re-rendering…');
      try {
        await debugRender(args);
      } catch (e) {
        console.error('Render error:', e.message);
      }
    };

    watchPaths.forEach(wp => {
      if (!fs.existsSync(wp)) return;
      fs.watch(wp, () => {
        clearTimeout(debounce);
        debounce = setTimeout(run, 400);
      });
      console.log(`  Watching: ${path.relative(ROOT, wp)}`);
    });

    // Initial render
    await debugRender(args);
    console.log('\n  Watching for changes (Ctrl+C to stop)…');

  } else {
    await debugRender(args);
    await closeBrowser();
  }
}

main().catch(err => {
  console.error('\n❌  Fatal:', err.message);
  closeBrowser().finally(() => process.exit(1));
});
