#!/usr/bin/env node
/**
 * Batch Render Script — CLI
 *
 * Usage:
 *   node scripts/batchRender.js --input data/batch.json [options]
 *   node scripts/batchRender.js --input data/batch.csv [options]
 *   node scripts/batchRender.js --folder uploads/ --titles data/titles.txt [options]
 *
 * Options:
 *   --input       Path to JSON or CSV batch file
 *   --folder      Path to folder of images
 *   --titles      Path to .txt file (one title per line, or Title:Description:Code)
 *   --template    Template ID or "auto" (default: auto)
 *   --size        Pin size: standard|tall|square_ish|square (default: standard)
 *   --format      Output format: jpg|png|webp (default: jpg)
 *   --quality     Output quality 60-100 (default: 88)
 *   --variants    Variants per image (default: 4)
 *   --concurrency Parallel renders (default: 3)
 *   --output      Output directory (default: output/)
 */

const path = require('path');
const fs = require('fs');
const { parseArgs } = require('./utils/cliArgs');
const { loadBatchItems } = require('../utils/csvImporter');
const { analyzeImage } = require('../utils/imageAnalyzer');
const { generateVariants } = require('../utils/variantGenerator');
const { renderBatch, closeBrowser } = require('../utils/renderer');

const ROOT = path.join(__dirname, '..');

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const {
    input,
    folder,
    titles: titlesFile,
    template: templateMode = 'auto',
    size: pinSize = 'standard',
    format = 'jpg',
    quality = 88,
    variants: maxVariants = 4,
    concurrency = 3,
    output: outputDir = path.join(ROOT, 'output'),
  } = args;

  console.log('\n🎨 Pinterest Pin Factory — Batch CLI\n');

  // Load batch items
  let items = [];
  if (input) {
    console.log(`📂 Loading batch file: ${input}`);
    items = await loadBatchItems(input);
  } else if (folder) {
    console.log(`📂 Scanning folder: ${folder}`);
    items = loadFolderItems(folder, titlesFile);
  } else {
    console.error('❌ Provide --input <file> or --folder <dir>');
    process.exit(1);
  }

  if (items.length === 0) {
    console.error('❌ No items to render');
    process.exit(1);
  }

  console.log(`✓ Loaded ${items.length} items`);
  console.log(`⚙  Template: ${templateMode} | Size: ${pinSize} | Format: ${format} | Quality: ${quality}`);
  console.log(`⚙  Variants per item: ${maxVariants} | Concurrency: ${concurrency}\n`);

  // Expand to render jobs
  const allJobs = [];
  for (const item of items) {
    const { imagePath, title, subtitle, cta, badge, linkLabel, category, outputCode } = item;

    if (!fs.existsSync(imagePath)) {
      console.warn(`⚠  Skipping (not found): ${imagePath}`);
      continue;
    }

    console.log(`🔍 Analyzing: ${path.basename(imagePath)}`);
    let analysis;
    try {
      analysis = await analyzeImage(imagePath);
    } catch (err) {
      console.warn(`⚠  Analysis failed for ${imagePath}: ${err.message}`);
      continue;
    }

    const inputs = { title, subtitle, cta, badge, linkLabel, category };
    let variants = generateVariants(analysis, inputs, {
      maxVariants: parseInt(maxVariants),
      templateMode,
      pinSize,
    });

    if (outputCode && variants.length > 1) {
      variants = [variants[0]];
    }

    const baseName = path.parse(imagePath).name;
    const sessionDir = path.join(outputDir, baseName);

    variants.forEach(recipe => {
      const exactFilename = outputCode ? `${outputCode}.${format}` : `pin_${recipe.templateId}_${recipe.variantId}.${format}`;
      allJobs.push({
        recipe,
        imagePath,
        outputPath: path.join(sessionDir, exactFilename),
        options: { format, quality: parseInt(quality) },
      });
    });
  }

  if (allJobs.length === 0) {
    console.error('❌ No render jobs to run');
    await closeBrowser();
    process.exit(1);
  }

  console.log(`\n🚀 Starting render — ${allJobs.length} total pins\n`);

  let completed = 0;
  let failed = 0;
  const startTime = Date.now();

  await renderBatch(allJobs, {
    concurrency: parseInt(concurrency),
    onProgress: ({ result, error }) => {
      if (error) {
        failed++;
        console.log(`  ✗ Failed — ${error}`);
      } else {
        completed++;
        const pct = Math.round(((completed + failed) / allJobs.length) * 100);
        process.stdout.write(
          `\r  ✓ ${completed} rendered | ✗ ${failed} failed | ${pct}% — ${result.renderTime}ms`
        );
      }
    },
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n\n✅ Batch complete in ${elapsed}s`);
  console.log(`   ${completed} rendered | ${failed} failed`);
  console.log(`   Output: ${outputDir}\n`);

  await closeBrowser();
}

function loadFolderItems(folderPath, titlesFilePath) {
  const absFolder = path.isAbsolute(folderPath) ? folderPath : path.join(ROOT, folderPath);
  const exts = ['.jpg', '.jpeg', '.png', '.webp'];
  const images = fs.readdirSync(absFolder)
    .filter(f => exts.includes(path.extname(f).toLowerCase()))
    .map(f => path.join(absFolder, f));

  let titles = [{ title: 'Untitled Pin', outputCode: null }];
  if (titlesFilePath) {
    const absTitle = path.isAbsolute(titlesFilePath) ? titlesFilePath : path.join(ROOT, titlesFilePath);
    titles = fs.readFileSync(absTitle, 'utf8')
      .split(/\r?\n/)
      .map(t => t.trim())
      .filter(Boolean)
      .map(parseTitleBankLine);
  }

  const pairCount = Math.min(images.length, titles.length);
  return Array.from({ length: pairCount }, (_, i) => ({
    imagePath: images[i],
    title: titles[i].title,
    outputCode: titles[i].outputCode,
  }));
}

function parseTitleBankLine(line) {
  const firstColon = line.indexOf(':');
  const lastColon = line.lastIndexOf(':');

  if (firstColon > 0 && lastColon > firstColon) {
    const title = line.slice(0, firstColon).trim();
    const outputCode = line.slice(lastColon + 1).trim();
    return { title: title || 'Untitled Pin', outputCode: outputCode || null };
  }

  return { title: line.trim() || 'Untitled Pin', outputCode: null };
}

main().catch(err => {
  console.error('\n❌ Fatal error:', err.message);
  closeBrowser().finally(() => process.exit(1));
});
