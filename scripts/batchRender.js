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
 *   --image-list  Optional .txt file with one image path per title line
 *   --titles      Path to .txt file (plain titles, Title:code, or subniche:niche|subniche:title:description|slug:imageId)
 *   --template    Template ID or "auto" (default: auto)
 *   --size        Pin size: standard|tall|square_ish|square (default: standard)
 *   --format      Output format: jpg|png|webp (default: jpg)
 *   --quality     Output quality 60-100 (default: 88)
 *   --variants    Variants per image (default: 4)
 *   --concurrency Worker process count (default: 3)
 *   --output      Output directory (default: output/)
 *   --resume      Skip outputs that already exist
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const readline = require('readline');
const { fork } = require('child_process');
const { parseArgs } = require('./utils/cliArgs');
const { loadBatchItems } = require('../utils/csvImporter');
const { analyzeImage } = require('../utils/imageAnalyzer');
const { generateVariants } = require('../utils/variantGenerator');
const { renderPin, closeBrowser } = require('../utils/renderer');

const ROOT = path.join(__dirname, '..');
const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp'];

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

  console.log('\nPinterest Pin Factory - Batch CLI\n');

  const totalItems = runtime.concurrency > 1
    ? await countItemsFromArgs(args)
    : null;
  const items = totalItems === null ? await loadItemsFromArgs(args) : null;
  const itemCount = totalItems ?? items.length;

  if (itemCount === 0) {
    console.error('No items to render');
    process.exit(1);
  }

  const workerCount = Math.max(1, Math.min(runtime.concurrency, itemCount));
  console.log(`Loaded ${itemCount} items`);
  console.log(`Template: ${runtime.templateMode} | Size: ${runtime.pinSize} | Format: ${runtime.outputFormat} | Quality: ${runtime.outputQuality}`);
  console.log(`Variants per item: ${runtime.variantCount} | Worker processes: ${workerCount}`);
  console.log(`Mode: analyze -> render immediately | Host CPUs: ${os.cpus().length}\n`);

  if (workerCount === 1) {
    const localItems = items || await loadItemsFromArgs(args);
    const printer = createProgressPrinter(localItems.length, runtime.variantCount);
    const result = await runBatch(localItems, runtime, {
      onProgress: printer.onProgress,
      onSnapshot: printer.onSnapshot,
      log: message => console.log(message),
    });
    printer.finish();
    finalizeCoordinatorRun(result, runtime.outputDir);
    return;
  }

  const result = await runMultiProcessBatch(args, itemCount, workerCount, runtime);
  finalizeCoordinatorRun(result, runtime.outputDir);
}

async function runWorker(args) {
  const runtime = buildRuntimeOptions(args);
  const workerIndex = Math.max(0, parseInt(args.workerIndex, 10) || 0);
  const workerCount = Math.max(1, parseInt(args.workerCount, 10) || 1);
  const items = await loadItemsFromArgs(args, { workerIndex, workerCount });

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
  const printer = createProgressPrinter(totalItems, runtime.variantCount);
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
    resume,
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
    const safeOutputSubfolder = sanitizeOutputSubfolder(outputSubfolder);
    const imageOutputDir = safeOutputSubfolder ? path.join(outputDir, safeOutputSubfolder) : outputDir;
    const jsonDir = safeOutputSubfolder
      ? path.join(outputDir, 'json', safeOutputSubfolder)
      : path.join(outputDir, 'json');

    if (resume && outputCode) {
      const existingOutputPath = path.join(imageOutputDir, `${outputCode}.${outputFormat}`);
      if (fs.existsSync(existingOutputPath)) {
        skipped++;
        producedAnyOutput = true;
        onProgress({
          analyzedDelta: 0,
          renderedDelta: 0,
          failedDelta: 0,
          skippedDelta: 1,
          extra: `exists - ${path.basename(existingOutputPath)}`,
        });
        return;
      }
    }

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
      const outputPath = path.join(imageOutputDir, exactFilename);
      const metaOutputPath = path.join(jsonDir, metaFilename);

      if (resume && fs.existsSync(outputPath)) {
        skipped++;
        producedAnyOutput = true;
        onProgress({
          analyzedDelta: 0,
          renderedDelta: 0,
          failedDelta: 0,
          skippedDelta: 1,
          extra: `exists - ${path.basename(outputPath)}`,
        });
        continue;
      }

      try {
        const result = await renderPin(
          recipe,
          imagePath,
          outputPath,
          {
            format: outputFormat,
            quality: outputQuality,
            metaOutputPath,
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

function createProgressPrinter(totalItems, variantsPerItem = 1) {
  let analyzed = 0;
  let rendered = 0;
  let failed = 0;
  let skipped = 0;
  const startedAt = Date.now();
  const estimatedTotalRenders = Math.max(1, totalItems * Math.max(1, variantsPerItem));
  let lastEtaMilestone = 0;

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

      const completedRenderUnits = rendered + failed + (skipped * Math.max(1, variantsPerItem));
      const etaMilestone = Math.floor(completedRenderUnits / 1000);
      if (etaMilestone > lastEtaMilestone) {
        lastEtaMilestone = etaMilestone;
        const eta = buildEtaSnapshot({
          completed: completedRenderUnits,
          total: estimatedTotalRenders,
          startedAt,
        });
        if (eta) {
          console.log(`\n[ETA] ${formatEta(eta)}`);
        }
      }
    },
    onSnapshot(snapshot = {}) {
      const rssMb = snapshot.rssMb ?? '?';
      const heapMb = snapshot.heapMb ?? '?';
      const cpuCount = snapshot.cpuCount ?? '?';
      console.log(`\n[Snapshot] ${snapshot.reason} | rss=${rssMb}MB heap=${heapMb}MB cpu=${cpuCount}`);
      if (snapshot.eta) {
        console.log(`[ETA] ${snapshot.eta}`);
      }
    },
    finish() {
      process.stdout.write('\n');
    },
  };
}

function buildEtaSnapshot({ completed, total, startedAt }) {
  if (completed <= 0 || total <= completed) return null;

  const elapsedMs = Math.max(1, Date.now() - startedAt);
  const avgMsPerItem = elapsedMs / completed;
  const remainingItems = total - completed;
  const remainingMs = remainingItems * avgMsPerItem;

  return {
    completed,
    remainingItems,
    elapsed: formatDuration(elapsedMs),
    remaining: formatDuration(remainingMs),
    hoursLeft: (remainingMs / 3600000).toFixed(2),
    ratePerHour: Math.round((completed / elapsedMs) * 3600000),
  };
}

function formatEta(snapshot) {
  return `${snapshot.remainingItems} items left | about ${snapshot.remaining} (${snapshot.hoursLeft} hrs) | ${snapshot.ratePerHour}/hr | elapsed ${snapshot.elapsed}`;
}

function formatDuration(ms) {
  const totalMinutes = Math.max(0, Math.round(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours <= 0) return `${minutes}m`;
  return `${hours}h ${String(minutes).padStart(2, '0')}m`;
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
    resume: Boolean(args.resume),
  };
}

async function loadItemsFromArgs(args, shard = null) {
  if (args.input) {
    console.log(`Loading batch file: ${args.input}`);
    const items = await loadBatchItems(args.input);
    return shard
      ? items.filter((_, index) => index % shard.workerCount === shard.workerIndex)
      : items;
  }

  if (args.folder) {
    console.log(args.imageList
      ? `Loading title/image manifests for folder: ${args.folder}`
      : `Scanning folder: ${args.folder}`);
    return loadFolderItems(args.folder, args.titles, args.imageList, shard);
  }

  console.error('Provide --input <file> or --folder <dir>');
  process.exit(1);
}

async function countItemsFromArgs(args) {
  if (args.input) {
    console.log(`Counting batch file: ${args.input}`);
    const items = await loadBatchItems(args.input);
    return items.length;
  }

  if (args.folder) {
    const absFolder = path.isAbsolute(args.folder) ? args.folder : path.join(ROOT, args.folder);
    if (args.titles) {
      const absTitle = path.isAbsolute(args.titles) ? args.titles : path.join(ROOT, args.titles);
      console.log(`Counting title bank: ${absTitle}`);
      return countTitleBankLines(absTitle);
    }
    if (args.imageList) {
      const absImageList = path.isAbsolute(args.imageList) ? args.imageList : path.join(ROOT, args.imageList);
      console.log(`Counting image list: ${absImageList}`);
      return countTitleBankLines(absImageList);
    }
    return listImages(absFolder).length;
  }

  console.error('Provide --input <file> or --folder <dir>');
  process.exit(1);
}

function buildWorkerArgs(args, workerIndex, workerCount) {
  const childArgs = [];
  const passThroughKeys = [
    'input',
    'folder',
    'imageList',
    'titles',
    'template',
    'size',
    'format',
    'quality',
    'variants',
    'output',
    'resume',
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

async function loadFolderItems(folderPath, titlesFilePath, imageListPath, shard = null) {
  const absFolder = path.isAbsolute(folderPath) ? folderPath : path.join(ROOT, folderPath);

  let titles = [{ title: 'Untitled Pin', outputCode: null }];
  if (titlesFilePath) {
    const absTitle = path.isAbsolute(titlesFilePath) ? titlesFilePath : path.join(ROOT, titlesFilePath);
    titles = await loadTitleBankItems(absTitle, shard);
  }

  if (imageListPath) {
    const absImageList = path.isAbsolute(imageListPath) ? imageListPath : path.join(ROOT, imageListPath);
    return buildImageListItems(absFolder, titles, await loadImageListItems(absFolder, absImageList, shard));
  }

  if (titles.some(title => title.format === 'niche_bank')) {
    return buildNicheBankItems(absFolder, titles);
  }

  const images = listImages(absFolder);
  if (images.length === 0) {
    return [];
  }

  if (titlesFilePath) {
    return titles.map((title, index) => {
      const sourceIndex = title.sourceIndex ?? index;
      return {
        imagePath: images[sourceIndex % images.length],
        title: title.title,
        subtitle: title.subtitle,
        category: title.category,
        outputCode: title.outputCode,
        outputSubfolder: title.outputSubfolder,
        sequenceNumber: sourceIndex,
      };
    });
  }

  const shardedImages = shard
    ? images.filter((_, index) => index % shard.workerCount === shard.workerIndex)
    : images;
  return shardedImages.map((imagePath, index) => ({
    imagePath,
    title: titles[index % titles.length].title,
    subtitle: titles[index % titles.length].subtitle,
    category: titles[index % titles.length].category,
    outputCode: titles[index % titles.length].outputCode,
    outputSubfolder: titles[index % titles.length].outputSubfolder,
    sequenceNumber: index,
  }));
}

async function loadTitleBankItems(filePath, shard = null) {
  const items = [];
  let lineIndex = 0;
  const reader = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const rawLine of reader) {
    const line = rawLine.trim();
    if (!line) {
      lineIndex++;
      continue;
    }
    const sourceIndex = lineIndex++;
    if (shard && sourceIndex % shard.workerCount !== shard.workerIndex) continue;
    items.push({ ...parseTitleBankLine(line), sourceIndex });
  }

  return items.length > 0 ? items : [{ title: 'Untitled Pin', outputCode: null }];
}

async function loadImageListItems(absFolder, filePath, shard = null) {
  const items = [];
  let lineIndex = 0;
  const reader = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const rawLine of reader) {
    const line = rawLine.trim();
    if (!line) {
      lineIndex++;
      continue;
    }
    const sourceIndex = lineIndex++;
    if (shard && sourceIndex % shard.workerCount !== shard.workerIndex) continue;
    items.push({
      imagePath: resolveImageListPath(absFolder, line),
      sourceIndex,
    });
  }

  return items;
}

function buildImageListItems(absFolder, titles, images) {
  const imageBySourceIndex = new Map(images.map(image => [image.sourceIndex, image]));

  if (titles.length > 0 && titles[0].sourceIndex !== undefined) {
    return titles
      .map((title, index) => {
        const sourceIndex = title.sourceIndex ?? index;
        const image = imageBySourceIndex.get(sourceIndex) || images[index % Math.max(1, images.length)];
        if (!image) return null;

        return {
          imagePath: image.imagePath,
          title: title.title,
          subtitle: title.subtitle,
          category: title.category,
          outputCode: title.outputCode,
          outputSubfolder: title.outputSubfolder,
          sequenceNumber: sourceIndex,
        };
      })
      .filter(Boolean);
  }

  return images.map((image, index) => ({
    imagePath: image.imagePath,
    title: titles[index % titles.length].title,
    subtitle: titles[index % titles.length].subtitle,
    category: titles[index % titles.length].category,
    outputCode: titles[index % titles.length].outputCode,
    outputSubfolder: titles[index % titles.length].outputSubfolder,
    sequenceNumber: image.sourceIndex,
  }));
}

function resolveImageListPath(absFolder, value) {
  const normalized = String(value).trim().replace(/^"|"$/g, '');
  return path.isAbsolute(normalized) ? normalized : path.join(absFolder, normalized);
}

async function countTitleBankLines(filePath) {
  let count = 0;
  const reader = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const rawLine of reader) {
    if (rawLine.trim()) count++;
    if (count > 0 && count % 100000 === 0) {
      process.stdout.write(`\rCounting title bank: ${count} lines`);
    }
  }

  if (count >= 100000) process.stdout.write('\n');
  return count;
}

function parseTitleBankLine(line) {
  const nicheBankItem = parseNicheBankLine(line);
  if (nicheBankItem) return nicheBankItem;

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

function parseNicheBankLine(line) {
  const parts = String(line).split('|');
  if (parts.length < 3) return null;

  const left = parts[0].trim();
  const middle = parts[1].trim();
  const right = parts.slice(2).join('|').trim();

  const leftColon = left.indexOf(':');
  const middleColon = middle.indexOf(':');
  const rightColon = right.indexOf(':');
  if (leftColon <= 0 || middleColon <= 0 || rightColon <= 0) return null;

  const subniche = left.slice(0, leftColon).trim();
  const niche = left.slice(leftColon + 1).trim();
  const repeatedSubniche = middle.slice(0, middleColon).trim();
  const titleAndDescription = middle.slice(middleColon + 1).trim();
  const titleDescriptionColon = titleAndDescription.lastIndexOf(':');
  if (!subniche || !niche || titleDescriptionColon <= 0) return null;

  const title = titleAndDescription.slice(0, titleDescriptionColon).trim();
  const subtitle = titleAndDescription.slice(titleDescriptionColon + 1).trim();
  const outputCode = right.slice(0, rightColon).trim();
  const imageKey = right.slice(rightColon + 1).trim();

  return {
    format: 'niche_bank',
    subniche,
    niche,
    repeatedSubniche: repeatedSubniche || subniche,
    title: title || 'Untitled Pin',
    subtitle,
    category: niche,
    outputCode: outputCode || null,
    outputSubfolder: path.join(niche, subniche),
    imageKey: imageKey || null,
  };
}

function buildNicheBankItems(absFolder, titles) {
  const imageIndex = buildNicheImageIndex(absFolder);

  return titles
    .filter(title => title.format === 'niche_bank')
    .map((title, index) => {
      const images = getNicheImages(imageIndex, title.niche);
      const sourceIndex = title.sourceIndex ?? index;
      const imagePath = selectNicheImage(images, title.imageKey, sourceIndex);

      return {
        imagePath,
        title: title.title,
        subtitle: title.subtitle,
        category: title.category,
        outputCode: title.outputCode,
        outputSubfolder: title.outputSubfolder,
        sequenceNumber: sourceIndex,
      };
    })
    .filter(item => item && item.imagePath);
}

function buildNicheImageIndex(absFolder) {
  const index = new Map();
  const entries = fs.readdirSync(absFolder, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const niche = entry.name;
    const nichePath = path.join(absFolder, niche);
    const images = listImages(nichePath);
    index.set(niche, images);
    index.set(niche.toLowerCase(), images);
  }

  return index;
}

function getNicheImages(imageIndex, niche) {
  return imageIndex.get(niche) || imageIndex.get(String(niche).toLowerCase()) || [];
}

function selectNicheImage(images, imageKey, sourceIndex = 0) {
  if (images.length === 0) return null;

  if (imageKey) {
    const normalizedKey = path.parse(imageKey).name.toLowerCase();
    const exact = images.find(image => path.parse(image).name.toLowerCase() === normalizedKey);
    if (exact) return exact;
  }

  return images[sourceIndex % images.length];
}

function listImages(folderPath) {
  if (!fs.existsSync(folderPath)) return [];
  return fs.readdirSync(folderPath)
    .filter(file => IMAGE_EXTS.includes(path.extname(file).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
    .map(file => path.join(folderPath, file));
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
