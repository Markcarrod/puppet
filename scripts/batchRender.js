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
 *   --titles      Path to .txt file (one title per line, or Title:code)
 *   --template    Template ID or "auto" (default: auto)
 *   --size        Pin size: standard|tall|square_ish|square (default: standard)
 *   --format      Output format: jpg|png|webp (default: jpg)
 *   --quality     Output quality 60-100 (default: 88)
 *   --variants    Variants per image (default: 4)
 *   --concurrency Worker process count (default: 3)
 *   --output      Output directory (default: output/)
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { fork } = require('child_process');
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

  if (args.worker) {
    await runWorker(args);
    return;
  }

  await runCoordinator(args);
}

async function runCoordinator(args) {
  const runtime = buildRuntimeOptions(args);
  const items = await loadItemsFromArgs(args);

  console.log('\nPinterest Pin Factory - Batch CLI\n');

  if (items.length === 0) {
    console.error('No items to render');
    process.exit(1);
  }

  const workerCount = Math.max(1, Math.min(runtime.concurrency, items.length));
  console.log(`Loaded ${items.length} items`);
  console.log(`Template: ${runtime.templateMode} | Size: ${runtime.pinSize} | Format: ${runtime.outputFormat} | Quality: ${runtime.outputQuality}`);
  console.log(`Variants per item: ${runtime.variantCount} | Worker processes: ${workerCount}`);
  console.log(`Mode: analyze -> render immediately | Host CPUs: ${os.cpus().length}\n`);

  if (workerCount === 1) {
    const printer = createProgressPrinter(items.length);
    const result = await runBatch(items, runtime, {
      onProgress: printer.onProgress,
      onSnapshot: printer.onSnapshot,
      log: message => console.log(message),
    });
    printer.finish();
    finalizeCoordinatorRun(result, runtime.outputDir);
    return;
  }

  const result = await runMultiProcessBatch(args, items.length, workerCount, runtime);
  finalizeCoordinatorRun(result, runtime.outputDir);
}

async function runWorker(args) {
  const runtime = buildRuntimeOptions(args);
  const workerIndex = Math.max(0, parseInt(args.workerIndex, 10) || 0);
  const workerCount = Math.max(1, parseInt(args.workerCount, 10) || 1);
  const allItems = await loadItemsFromArgs(args);
  const items = allItems.filter((_, index) => index % workerCount === workerIndex);

  if (items.length === 0) {
    sendWorkerMessage({ type: 'done', summary: makeEmptySummary() });
    return;
  }

  const summary = await runBatch(items, runtime, {
    onProgress: payload => sendWorkerMessage({ type: 'progress', payload }),
    onSnapshot: payload => sendWorkerMessage({ type: 'snapshot', payload }),
    log: message => sendWorkerMessage({ type: 'log', message }),
  });

  sendWorkerMessage({ type: 'done', summary });
}

async function runMultiProcessBatch(args, totalItems, workerCount, runtime) {
  const printer = createProgressPrinter(totalItems);
  const children = [];
  const childSummaries = new Array(workerCount).fill(null);
  let completedWorkers = 0;

  console.log(`[Coordinator] Launching ${workerCount} worker processes...\n`);

  const result = await new Promise((resolve, reject) => {
    let settled = false;

    function settleWithError(err) {
      if (settled) return;
      settled = true;
      for (const child of children) {
        if (!child.killed) {
          child.kill();
        }
      }
      reject(err);
    }

    function tryResolve() {
      if (settled || completedWorkers !== workerCount) {
        return;
      }

      settled = true;
      const summary = childSummaries.reduce((acc, current) => {
        const source = current || makeEmptySummary();
        acc.analyzed += source.analyzed;
        acc.rendered += source.rendered;
        acc.failed += source.failed;
        acc.skipped += source.skipped;
        acc.producedAnyOutput = acc.producedAnyOutput || source.producedAnyOutput;
        return acc;
      }, makeEmptySummary());
      resolve(summary);
    }

    for (let workerIndex = 0; workerIndex < workerCount; workerIndex++) {
      const child = fork(__filename, buildWorkerArgs(args, workerIndex, workerCount), {
        cwd: ROOT,
        silent: true,
      });
      children.push(child);

      const prefix = `[W${workerIndex + 1}]`;
      forwardChildOutput(child.stdout, prefix, process.stdout);
      forwardChildOutput(child.stderr, prefix, process.stderr);

      child.on('message', message => {
        if (!message || settled) return;

        if (message.type === 'progress') {
          printer.onProgress(message.payload);
        } else if (message.type === 'snapshot') {
          printer.onSnapshot(message.payload);
        } else if (message.type === 'log') {
          console.log(`\n${prefix} ${message.message}`);
        } else if (message.type === 'done') {
          childSummaries[workerIndex] = message.summary || makeEmptySummary();
          completedWorkers++;
          tryResolve();
        } else if (message.type === 'fatal') {
          settleWithError(new Error(`${prefix} ${message.error || 'Worker failed'}`));
        }
      });

      child.on('exit', code => {
        if (settled) return;
        if (code !== 0 && childSummaries[workerIndex] === null) {
          settleWithError(new Error(`${prefix} exited with code ${code}`));
          return;
        }
        if (childSummaries[workerIndex] !== null) {
          tryResolve();
        }
      });

      child.on('error', err => {
        settleWithError(new Error(`${prefix} ${err.message}`));
      });
    }
  }).finally(() => {
    printer.finish();
  });

  return result;
}

async function runBatch(items, runtime, hooks = {}) {
  const {
    templateMode,
    pinSize,
    variantCount,
    outputFormat,
    outputQuality,
    outputDir,
  } = runtime;
  const onProgress = hooks.onProgress || (() => {});
  const onSnapshot = hooks.onSnapshot || (() => {});
  const log = hooks.log || (() => {});

  let analyzed = 0;
  let rendered = 0;
  let failed = 0;
  let skipped = 0;
  let producedAnyOutput = false;
  let lastTemplateId = null;

  async function processItem(item) {
    const { imagePath, title, subtitle, cta, badge, linkLabel, category, outputCode, outputSubfolder, sequenceNumber } = item;

    if (!fs.existsSync(imagePath)) {
      skipped++;
      onProgress({
        analyzedDelta: 0,
        renderedDelta: 0,
        failedDelta: 0,
        skippedDelta: 1,
        extra: `missing - ${path.basename(imagePath)}`,
      });
      return;
    }

    let analysis;
    try {
      analysis = await analyzeImage(imagePath);
      analyzed++;
      onProgress({
        analyzedDelta: 1,
        renderedDelta: 0,
        failedDelta: 0,
        skippedDelta: 0,
        extra: `analysis complete - ${path.basename(imagePath)}`,
      });
    } catch (err) {
      analyzed++;
      failed++;
      onProgress({
        analyzedDelta: 1,
        renderedDelta: 0,
        failedDelta: 1,
        skippedDelta: 0,
        extra: `analysis failed - ${path.basename(imagePath)}`,
      });
      log(`Analysis failed for ${imagePath}: ${err.message}`);
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
    const safeOutputSubfolder = sanitizeOutputSubfolder(outputSubfolder);
    const imageOutputDir = safeOutputSubfolder ? path.join(outputDir, safeOutputSubfolder) : outputDir;
    const jsonDir = safeOutputSubfolder
      ? path.join(outputDir, 'json', safeOutputSubfolder)
      : path.join(outputDir, 'json');
    const selectedVariants = applyTemplateRotation(variants, templateMode, lastTemplateId);
    const sequenceSuffix = Number.isInteger(sequenceNumber)
      ? `_${String(sequenceNumber + 1).padStart(6, '0')}`
      : '';

    for (const recipe of selectedVariants) {
      lastTemplateId = recipe.templateId;
      const exactFilename = outputCode
        ? `${outputCode}.${outputFormat}`
        : `${baseName}${sequenceSuffix}_${recipe.templateId}_${slugify(recipe.variantId)}.${outputFormat}`;
      const metaFilename = outputCode
        ? `${outputCode}.json`
        : `${baseName}${sequenceSuffix}_${recipe.templateId}_${slugify(recipe.variantId)}.json`;

      try {
        const result = await renderPin(
          recipe,
          imagePath,
          path.join(imageOutputDir, exactFilename),
          {
            format: outputFormat,
            quality: outputQuality,
            metaOutputPath: path.join(jsonDir, metaFilename),
          }
        );
        rendered++;
        producedAnyOutput = true;
        onProgress({
          analyzedDelta: 0,
          renderedDelta: 1,
          failedDelta: 0,
          skippedDelta: 0,
          extra: `${path.basename(result.outputPath)} - ${result.renderTime}ms`,
        });
        if (rendered % 25 === 0) {
          const mem = process.memoryUsage();
          onSnapshot({
            reason: `${rendered} renders completed`,
            rssMb: Math.round(mem.rss / 1024 / 1024),
            heapMb: Math.round(mem.heapUsed / 1024 / 1024),
            cpuCount: os.cpus().length,
          });
        }
      } catch (err) {
        failed++;
        onProgress({
          analyzedDelta: 0,
          renderedDelta: 0,
          failedDelta: 1,
          skippedDelta: 0,
          extra: `render failed - ${path.basename(imagePath)}`,
        });
        log(`Render failed for ${path.basename(imagePath)}: ${err.message}`);
      }
    }
  }

  try {
    for (const item of items) {
      await processItem(item);
    }
  } finally {
    await closeBrowser();
  }

  return { analyzed, rendered, failed, skipped, producedAnyOutput };
}

function createProgressPrinter(totalItems) {
  let analyzed = 0;
  let rendered = 0;
  let failed = 0;
  let skipped = 0;

  return {
    onProgress(payload = {}) {
      analyzed += payload.analyzedDelta || 0;
      rendered += payload.renderedDelta || 0;
      failed += payload.failedDelta || 0;
      skipped += payload.skippedDelta || 0;
      const processed = analyzed + skipped;
      const pct = totalItems ? Math.round((processed / totalItems) * 100) : 100;
      const suffix = payload.extra ? ` | ${payload.extra}` : '';
      process.stdout.write(
        `\rAnalyzed ${analyzed}/${totalItems} | Rendered ${rendered} | Failed ${failed} | Skipped ${skipped} | ${pct}%${suffix}`
      );
    },
    onSnapshot(snapshot = {}) {
      const rssMb = snapshot.rssMb ?? '?';
      const heapMb = snapshot.heapMb ?? '?';
      const cpuCount = snapshot.cpuCount ?? '?';
      console.log(`\n[Snapshot] ${snapshot.reason} | rss=${rssMb}MB heap=${heapMb}MB cpu=${cpuCount}`);
    },
    finish() {
      process.stdout.write('\n');
    },
  };
}

function finalizeCoordinatorRun(summary, outputDir) {
  if (!summary.producedAnyOutput) {
    console.error('\nNo render jobs completed successfully');
    process.exit(1);
  }

  console.log(`\nBatch complete`);
  console.log(`  ${summary.rendered} rendered | ${summary.failed} failed | ${summary.skipped} skipped`);
  console.log(`  Output: ${outputDir}\n`);
}

function buildRuntimeOptions(args) {
  return {
    templateMode: args.template || 'auto',
    pinSize: args.size || 'standard',
    outputFormat: String(args.format || 'jpg').toLowerCase(),
    outputQuality: parseInt(args.quality, 10) || 88,
    variantCount: Math.max(1, parseInt(args.variants, 10) || 4),
    concurrency: Math.max(1, parseInt(args.concurrency, 10) || 3),
    outputDir: args.output
      ? (path.isAbsolute(args.output) ? args.output : path.join(ROOT, args.output))
      : path.join(ROOT, 'output'),
  };
}

async function loadItemsFromArgs(args) {
  if (args.input) {
    console.log(`Loading batch file: ${args.input}`);
    return loadBatchItems(args.input);
  }

  if (args.folder) {
    console.log(`Scanning folder: ${args.folder}`);
    return loadFolderItems(args.folder, args.titles);
  }

  console.error('Provide --input <file> or --folder <dir>');
  process.exit(1);
}

function buildWorkerArgs(args, workerIndex, workerCount) {
  const childArgs = [];
  const passThroughKeys = [
    'input',
    'folder',
    'titles',
    'template',
    'size',
    'format',
    'quality',
    'variants',
    'output',
  ];

  for (const key of passThroughKeys) {
    if (args[key] === undefined || args[key] === false || args[key] === null) {
      continue;
    }
    childArgs.push(`--${toKebabCase(key)}`, String(args[key]));
  }

  childArgs.push('--worker', 'true');
  childArgs.push('--worker-index', String(workerIndex));
  childArgs.push('--worker-count', String(workerCount));
  return childArgs;
}

function forwardChildOutput(stream, prefix, destination) {
  if (!stream) return;
  let buffered = '';

  stream.on('data', chunk => {
    buffered += chunk.toString();
    const parts = buffered.split(/\r?\n/);
    buffered = parts.pop() || '';
    for (const part of parts) {
      if (part.trim()) {
        destination.write(`${prefix} ${part}\n`);
      }
    }
  });

  stream.on('end', () => {
    if (buffered.trim()) {
      destination.write(`${prefix} ${buffered}\n`);
    }
  });
}

function sendWorkerMessage(message) {
  if (typeof process.send === 'function') {
    process.send(message);
  }
}

function makeEmptySummary() {
  return {
    analyzed: 0,
    rendered: 0,
    failed: 0,
    skipped: 0,
    producedAnyOutput: false,
  };
}

function loadFolderItems(folderPath, titlesFilePath) {
  const absFolder = path.isAbsolute(folderPath) ? folderPath : path.join(ROOT, folderPath);
  const exts = ['.jpg', '.jpeg', '.png', '.webp'];
  const images = fs.readdirSync(absFolder)
    .filter(file => exts.includes(path.extname(file).toLowerCase()))
    .map(file => path.join(absFolder, file));

  if (images.length === 0) {
    return [];
  }

  let titles = [{ title: 'Untitled Pin', outputCode: null }];
  if (titlesFilePath) {
    const absTitle = path.isAbsolute(titlesFilePath) ? titlesFilePath : path.join(ROOT, titlesFilePath);
    titles = fs.readFileSync(absTitle, 'utf8')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .map(parseTitleBankLine);
  }

  const itemCount = Math.max(images.length, titles.length);
  return Array.from({ length: itemCount }, (_, index) => ({
    imagePath: images[index % images.length],
    title: titles[index % titles.length].title,
    outputCode: titles[index % titles.length].outputCode,
    outputSubfolder: titles[index % titles.length].outputSubfolder,
    sequenceNumber: index,
  }));
}

function parseTitleBankLine(line) {
  const firstColon = line.indexOf(':');
  const lastColon = line.lastIndexOf(':');

  if (firstColon > 0 && lastColon > firstColon) {
    const outputSubfolder = line.slice(0, firstColon).trim();
    const title = line.slice(firstColon + 1, lastColon).trim();
    const outputCode = line.slice(lastColon + 1).trim();
    return {
      outputSubfolder: outputSubfolder || null,
      title: title || 'Untitled Pin',
      outputCode: outputCode || null,
    };
  }

  if (firstColon > 0) {
    const title = line.slice(0, firstColon).trim();
    const outputCode = line.slice(lastColon + 1).trim();
    return { outputSubfolder: null, title: title || 'Untitled Pin', outputCode: outputCode || null };
  }

  return { outputSubfolder: null, title: line.trim() || 'Untitled Pin', outputCode: null };
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

function toKebabCase(value) {
  return String(value).replace(/[A-Z]/g, match => `-${match.toLowerCase()}`);
}

function sanitizeOutputSubfolder(value) {
  if (!value) return null;

  const normalized = String(value)
    .split(/[\\/]+/)
    .map(segment => segment.trim())
    .filter(segment => segment && segment !== '.' && segment !== '..')
    .map(segment => segment.replace(/[<>:"|?*]/g, '-'))
    .filter(Boolean);

  return normalized.length > 0 ? path.join(...normalized) : null;
}

main().catch(err => {
  sendWorkerMessage({ type: 'fatal', error: err.message });
  console.error('\nFatal error:', err.message);
  closeBrowser().finally(() => process.exit(1));
});
