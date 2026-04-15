#!/usr/bin/env node
/**
 * Batch Render Script - CLI
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
 *   --concurrency Parallel workers / threads (default: 3)
 *   --output      Output directory (default: output/)
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { parseArgs } = require('./utils/cliArgs');
const { loadBatchItems } = require('../utils/csvImporter');
const { analyzeImage } = require('../utils/imageAnalyzer');
const { generateVariants } = require('../utils/variantGenerator');
const { renderPin, closeBrowser } = require('../utils/renderer');

const ROOT = path.join(__dirname, '..');

process.on('unhandledRejection', err => {
  console.error('\nUnhandled rejection:', err?.stack || err?.message || err);
});

process.on('uncaughtException', err => {
  console.error('\nUncaught exception:', err?.stack || err?.message || err);
  closeBrowser().finally(() => process.exit(1));
});

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

  console.log('\nPinterest Pin Factory - Batch CLI\n');

  let items = [];
  if (input) {
    console.log(`Loading batch file: ${input}`);
    items = await loadBatchItems(input);
  } else if (folder) {
    console.log(`Scanning folder: ${folder}`);
    items = loadFolderItems(folder, titlesFile);
  } else {
    console.error('Provide --input <file> or --folder <dir>');
    process.exit(1);
  }

  if (items.length === 0) {
    console.error('No items to render');
    process.exit(1);
  }

  const workerCount = Math.max(1, parseInt(concurrency, 10) || 1);
  const variantCount = Math.max(1, parseInt(maxVariants, 10) || 1);
  const outputFormat = String(format).toLowerCase();
  const outputQuality = parseInt(quality, 10);

  console.log(`Loaded ${items.length} items`);
  console.log(`Template: ${templateMode} | Size: ${pinSize} | Format: ${outputFormat} | Quality: ${outputQuality}`);
  console.log(`Variants per item: ${variantCount} | Threads: ${workerCount}`);
  console.log(`Mode: analyze -> render immediately\n`);

  let analyzed = 0;
  let rendered = 0;
  let failed = 0;
  let skipped = 0;
  let nextIndex = 0;
  let producedAnyOutput = false;
  let lastTemplateId = null;

  const startTime = Date.now();
  const totalItems = items.length;

  function printProgress(extra = '') {
    const processed = analyzed + skipped;
    const pct = totalItems ? Math.round((processed / totalItems) * 100) : 100;
    const suffix = extra ? ` | ${extra}` : '';
    process.stdout.write(
      `\rAnalyzed ${analyzed}/${totalItems} | Rendered ${rendered} | Failed ${failed} | Skipped ${skipped} | ${pct}%${suffix}`
    );
  }

  function logSnapshot(reason) {
    const mem = process.memoryUsage();
    const rssMb = (mem.rss / 1024 / 1024).toFixed(0);
    const heapMb = (mem.heapUsed / 1024 / 1024).toFixed(0);
    console.log(`\n[Snapshot] ${reason} | rss=${rssMb}MB heap=${heapMb}MB cpu=${os.cpus().length}`);
  }

  async function processItem(item) {
    const { imagePath, title, subtitle, cta, badge, linkLabel, category, outputCode } = item;

    if (!fs.existsSync(imagePath)) {
      skipped++;
      console.warn(`\nSkipping missing file: ${imagePath}`);
      printProgress(path.basename(imagePath));
      return;
    }

    console.log(`Analyzing: ${path.basename(imagePath)}`);

    let analysis;
    try {
      analysis = await analyzeImage(imagePath);
      analyzed++;
      printProgress(`analysis complete - ${path.basename(imagePath)}`);
    } catch (err) {
      analyzed++;
      failed++;
      console.warn(`\nAnalysis failed for ${imagePath}: ${err.message}`);
      printProgress(path.basename(imagePath));
      return;
    }

    const inputs = { title, subtitle, cta, badge, linkLabel, category };
    let variants = generateVariants(analysis, inputs, {
      maxVariants: variantCount,
      templateMode,
      pinSize,
    });

    if (outputCode && variants.length > 1) {
      variants = [variants[0]];
    }

    const baseName = path.parse(imagePath).name;
    const jsonDir = path.join(outputDir, 'json');
    const selectedVariants = applyTemplateRotation(variants, templateMode, lastTemplateId);

    for (const recipe of selectedVariants) {
      lastTemplateId = recipe.templateId;
      const exactFilename = outputCode
        ? `${outputCode}.${outputFormat}`
        : `${baseName}_${recipe.templateId}_${slugify(recipe.variantId)}.${outputFormat}`;
      const metaFilename = outputCode
        ? `${outputCode}.json`
        : `${baseName}_${recipe.templateId}_${slugify(recipe.variantId)}.json`;

      try {
        const result = await renderPin(
          recipe,
          imagePath,
          path.join(outputDir, exactFilename),
          {
            format: outputFormat,
            quality: outputQuality,
            metaOutputPath: path.join(jsonDir, metaFilename),
          }
        );
        rendered++;
        producedAnyOutput = true;
        printProgress(`${path.basename(result.outputPath)} - ${result.renderTime}ms`);
        if (rendered % 25 === 0) {
          logSnapshot(`${rendered} renders completed`);
        }
      } catch (err) {
        failed++;
        console.warn(`\nRender failed for ${path.basename(imagePath)}: ${err.message}`);
        printProgress(path.basename(imagePath));
      }
    }
  }

  async function workerLoop() {
    while (true) {
      const currentIndex = nextIndex++;
      if (currentIndex >= items.length) {
        return;
      }
      await processItem(items[currentIndex]);
    }
  }

  try {
    await Promise.all(
      Array.from({ length: Math.min(workerCount, items.length) }, () => workerLoop())
    );
  } finally {
    await closeBrowser();
  }

  if (!producedAnyOutput) {
    console.error('\nNo render jobs completed successfully');
    process.exit(1);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n\nBatch complete in ${elapsed}s`);
  console.log(`  ${rendered} rendered | ${failed} failed | ${skipped} skipped`);
  console.log(`  Output: ${outputDir}\n`);
}

function loadFolderItems(folderPath, titlesFilePath) {
  const absFolder = path.isAbsolute(folderPath) ? folderPath : path.join(ROOT, folderPath);
  const exts = ['.jpg', '.jpeg', '.png', '.webp'];
  const images = fs.readdirSync(absFolder)
    .filter(file => exts.includes(path.extname(file).toLowerCase()))
    .map(file => path.join(absFolder, file));

  let titles = [{ title: 'Untitled Pin', outputCode: null }];
  if (titlesFilePath) {
    const absTitle = path.isAbsolute(titlesFilePath) ? titlesFilePath : path.join(ROOT, titlesFilePath);
    titles = fs.readFileSync(absTitle, 'utf8')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .map(parseTitleBankLine);
  }

  const pairCount = Math.min(images.length, titles.length);
  return Array.from({ length: pairCount }, (_, index) => ({
    imagePath: images[index],
    title: titles[index].title,
    outputCode: titles[index].outputCode,
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

function applyTemplateRotation(variants, templateMode, previousTemplateId) {
  if (templateMode !== 'auto' || variants.length <= 1 || !previousTemplateId) {
    return variants;
  }

  const preferredIndex = variants.findIndex(recipe => recipe.templateId !== previousTemplateId);
  if (preferredIndex <= 0) {
    return variants;
  }

  return [variants[preferredIndex], ...variants.slice(0, preferredIndex), ...variants.slice(preferredIndex + 1)];
}

function slugify(value) {
  return String(value)
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase() || 'variant';
}

main().catch(err => {
  console.error('\nFatal error:', err.message);
  closeBrowser().finally(() => process.exit(1));
});
