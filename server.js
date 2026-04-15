/**
 * Express Server — Pinterest Pin Factory
 * Serves the web UI and exposes REST API endpoints for
 * uploading images, generating pins, and downloading outputs.
 */

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const morgan = require('morgan');
const archiver = require('archiver');

const { analyzeImage, scoreTemplates } = require('./utils/imageAnalyzer');
const { generateVariants } = require('./utils/variantGenerator');
const { renderPin, renderBatch, closeBrowser, buildOutputFilename } = require('./utils/renderer');
const { TEMPLATE_FAMILIES, PIN_SIZES } = require('./configs/templates');

const app = express();
const PORT = process.env.PORT || 3333;

// ─── Directories ─────────────────────────────────────────────────────────────
const DIRS = {
  uploads: path.join(__dirname, 'uploads'),
  output: path.join(__dirname, 'output'),
  data: path.join(__dirname, 'data'),
};
for (const d of Object.values(DIRS)) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(morgan('dev'));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'web')));
app.use('/output', express.static(DIRS.output));
app.use('/uploads', express.static(DIRS.uploads));

// ─── Multer ───────────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, DIRS.uploads),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  },
});

// ─── Job store (in-memory) ────────────────────────────────────────────────────
const jobs = new Map();

function createJob(meta = {}) {
  const id = uuidv4();
  const job = {
    id,
    status: 'pending',
    progress: 0,
    total: 0,
    results: [],
    errors: [],
    logs: [],
    pauseRequested: false,
    stopRequested: false,
    createdAt: new Date().toISOString(),
    ...meta,
  };
  jobs.set(id, job);
  return job;
}

function logJob(job, message) {
  const entry = {
    time: new Date().toISOString(),
    message,
  };
  job.logs.push(entry);
  if (job.logs.length > 200) job.logs.shift();
}

async function waitWhilePaused(job) {
  while (job.pauseRequested && !job.stopRequested) {
    if (job.status !== 'paused') {
      job.status = 'paused';
      logJob(job, 'Paused');
    }
    await new Promise(resolve => setTimeout(resolve, 400));
  }
}

function getImageOutputs() {
  const files = [];
  if (!fs.existsSync(DIRS.output)) return files;

  const sessions = fs.readdirSync(DIRS.output).filter(f =>
    fs.statSync(path.join(DIRS.output, f)).isDirectory()
  );

  for (const session of sessions) {
    const sessionPath = path.join(DIRS.output, session);
    const pins = fs.readdirSync(sessionPath).filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f));
    for (const pin of pins) {
      const outputPath = path.join(sessionPath, pin);
      files.push({
        session,
        filename: pin,
        outputPath,
        url: `/output/${session}/${pin}`,
        size: fs.statSync(outputPath).size,
      });
    }
  }

  return files.sort((a, b) => fs.statSync(b.outputPath).mtimeMs - fs.statSync(a.outputPath).mtimeMs);
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// Health
app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// List templates
app.get('/api/templates', (req, res) => {
  const list = Object.values(TEMPLATE_FAMILIES).map(t => ({
    id: t.id,
    name: t.name,
    description: t.description,
    textPosition: t.textPosition,
    overlay: t.overlay,
    fontPreset: t.fontPreset,
  }));
  res.json({ templates: list, pinSizes: Object.keys(PIN_SIZES) });
});

// Upload one or many images
app.post('/api/upload', upload.array('images', 500), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No images uploaded' });
  }
  const files = req.files.map(f => ({
    id: path.parse(f.filename).name,
    filename: f.filename,
    originalName: f.originalname,
    size: f.size,
    url: `/uploads/${f.filename}`,
    path: f.path,
  }));
  res.json({ uploaded: files });
});

// Analyze a single image (returns zone data + ranked templates)
app.post('/api/analyze', async (req, res) => {
  const { filename, title } = req.body;
  if (!filename) return res.status(400).json({ error: 'filename required' });

  const imagePath = path.join(DIRS.uploads, filename);
  if (!fs.existsSync(imagePath)) return res.status(404).json({ error: 'Image not found' });

  try {
    const analysis = await analyzeImage(imagePath);
    const ranked = scoreTemplates(analysis, title || '', TEMPLATE_FAMILIES)
      .slice(0, 5)
      .map(({ id, score }) => ({ id, name: TEMPLATE_FAMILIES[id].name, score }));
    res.json({ analysis, ranked });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Generate pins for a single image (non-blocking, returns jobId)
app.post('/api/generate', async (req, res) => {
  const {
    filename,
    title,
    subtitle,
    cta,
    badge,
    linkLabel,
    category,
    templateMode = 'auto',
    pinSize = 'standard',
    maxVariants = 8,
    format = 'jpg',
    quality = 88,
  } = req.body;

  if (!filename || !title) {
    return res.status(400).json({ error: 'filename and title are required' });
  }

  const imagePath = path.join(DIRS.uploads, filename);
  if (!fs.existsSync(imagePath)) return res.status(404).json({ error: 'Image not found' });

  const job = createJob({ imagePath, filename, title });
  res.json({ jobId: job.id });

  // Run async
  runGenerateJob(job, imagePath, filename, {
    inputs: { title, subtitle, cta, badge, linkLabel, category },
    templateMode,
    pinSize,
    maxVariants: parseInt(maxVariants),
    outputFormat: format,
    quality: parseInt(quality),
  }).catch(err => {
    job.status = 'error';
    job.error = err.message;
    console.error('[Job]', job.id, err.message);
  });
});

async function runGenerateJob(job, imagePath, filename, opts) {
  job.status = 'analyzing';
  logJob(job, `Analyzing ${filename}`);

  const analysis = await analyzeImage(imagePath);
  const variants = generateVariants(analysis, opts.inputs, {
    maxVariants: opts.maxVariants,
    templateMode: opts.templateMode,
    pinSize: opts.pinSize,
  });

  job.total = variants.length;
  job.status = 'rendering';
  logJob(job, `Rendering ${variants.length} variant${variants.length !== 1 ? 's' : ''} for ${filename}`);

  const baseName = path.parse(filename).name;
  const sessionDir = path.join(DIRS.output, baseName);

  const renderJobs = variants.map(recipe => ({
    recipe,
    imagePath,
    outputPath: path.join(sessionDir, buildOutputFilename(recipe, opts.outputFormat)),
    options: { format: opts.outputFormat, quality: opts.quality },
  }));

  await renderBatch(renderJobs, {
    concurrency: 2,
    onProgress: ({ completed, total, result, error }) => {
      job.progress = completed;
      job.total = total;
      if (result && !error) {
        const actualFilename = path.basename(result.outputPath);
        job.results.push({
          outputPath: result.outputPath,
          url: `/output/${baseName}/${actualFilename}`,
          template: result.template,
          variant: result.variant,
          renderTime: result.renderTime,
        });
        logJob(job, `Rendered ${actualFilename} and added it to Gallery`);
      } else if (error) {
        job.errors.push(error);
        logJob(job, `Render error: ${error}`);
      }
    },
  });

  job.status = 'done';
  job.completedAt = new Date().toISOString();
  logJob(job, `Job complete: ${job.results.length} pin${job.results.length !== 1 ? 's' : ''}`);
}

// Batch generate from JSON body
app.post('/api/batch', async (req, res) => {
  const { items, templateMode = 'auto', pinSize = 'standard', format = 'jpg', quality = 88, maxVariants = 4 } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items array required' });
  }

  const job = createJob({ type: 'batch', count: items.length });
  res.json({ jobId: job.id });

  runBatchJob(job, items, { templateMode, pinSize, format, quality, maxVariants: parseInt(maxVariants) })
    .catch(err => {
      job.status = 'error';
      job.error = err.message;
    });
});

async function runBatchJob(job, items, opts) {
  job.status = 'running';
  job.total = items.length;
  logJob(job, `Batch started with ${items.length} item${items.length !== 1 ? 's' : ''}`);

  for (const item of items) {
    await waitWhilePaused(job);
    if (job.stopRequested) {
      job.status = 'stopped';
      job.completedAt = new Date().toISOString();
      logJob(job, 'Batch stopped by user');
      return;
    }

    const { filename, title, subtitle, cta, badge, linkLabel, category } = item;
    if (!filename || !title) {
      job.errors.push(`Missing filename/title for item`);
      logJob(job, 'Skipped item with missing filename or title');
      job.progress++;
      continue;
    }

    const imagePath = path.join(DIRS.uploads, filename);
    if (!fs.existsSync(imagePath)) {
      job.errors.push(`Not found: ${filename}`);
      logJob(job, `Missing upload: ${filename}`);
      job.progress++;
      continue;
    }

    const subJob = createJob({ parent: job.id });
    try {
      logJob(job, `Analyzing and rendering ${filename}`);
      await runGenerateJob(subJob, imagePath, filename, {
        inputs: { title, subtitle, cta, badge, linkLabel, category },
        ...opts,
      });

      job.results.push(...subJob.results);
      job.errors.push(...subJob.errors);
      logJob(job, `Moved ${subJob.results.length} rendered pin${subJob.results.length !== 1 ? 's' : ''} from ${filename} into Gallery`);
    } catch (err) {
      job.errors.push(err.message);
      logJob(job, `Batch item failed for ${filename}: ${err.message}`);
    } finally {
      job.progress++;
      jobs.delete(subJob.id);
    }
  }

  job.status = 'done';
  job.completedAt = new Date().toISOString();
  logJob(job, `Batch complete: ${job.results.length} pin${job.results.length !== 1 ? 's' : ''}`);
}

// Job status polling
app.get('/api/jobs/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

// Pause/resume/stop an active job. Batch jobs apply the control between images.
app.post('/api/jobs/:id/pause', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (['done', 'error', 'stopped'].includes(job.status)) {
    return res.status(400).json({ error: 'Job is already finished' });
  }
  job.pauseRequested = true;
  logJob(job, 'Pause requested');
  res.json({ ok: true, status: job.status });
});

app.post('/api/jobs/:id/resume', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (['done', 'error', 'stopped'].includes(job.status)) {
    return res.status(400).json({ error: 'Job is already finished' });
  }
  job.pauseRequested = false;
  if (job.status === 'paused') job.status = 'running';
  logJob(job, 'Resumed');
  res.json({ ok: true, status: job.status });
});

app.post('/api/jobs/:id/stop', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (['done', 'error', 'stopped'].includes(job.status)) {
    return res.status(400).json({ error: 'Job is already finished' });
  }
  job.stopRequested = true;
  job.pauseRequested = false;
  logJob(job, 'Stop requested');
  res.json({ ok: true, status: job.status });
});

// List all jobs
app.get('/api/jobs', (req, res) => {
  const list = [...jobs.values()]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 50)
    .map(j => ({
      id: j.id,
      status: j.status,
      progress: j.progress,
      total: j.total,
      resultCount: j.results.length,
      createdAt: j.createdAt,
    }));
  res.json({ jobs: list });
});

// Download job results as ZIP
app.get('/api/jobs/:id/download', async (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (!['done', 'stopped'].includes(job.status)) return res.status(400).json({ error: 'Job not complete' });

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="pins_${req.params.id.slice(0, 8)}.zip"`);

  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.pipe(res);

  for (const result of job.results) {
    if (fs.existsSync(result.outputPath)) {
      archive.file(result.outputPath, { name: path.basename(result.outputPath) });
    }
  }

  await archive.finalize();
});

// List output files
app.get('/api/outputs', (req, res) => {
  const files = getImageOutputs().map(({ outputPath, ...file }) => file);
  res.json({ files });
});

// Download every gallery image as one ZIP.
app.get('/api/outputs/download', async (req, res) => {
  const files = getImageOutputs();
  if (files.length === 0) return res.status(404).json({ error: 'No gallery images found' });

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="gallery_pins_${new Date().toISOString().slice(0, 10)}.zip"`);

  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.pipe(res);

  for (const file of files) {
    archive.file(file.outputPath, { name: path.posix.join(file.session, file.filename) });
  }

  await archive.finalize();
});

// Delete uploaded image
app.delete('/api/uploads/:filename', (req, res) => {
  const filePath = path.join(DIRS.uploads, req.params.filename);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    res.json({ deleted: true });
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🎨 Pinterest Pin Factory running at http://localhost:${PORT}\n`);
});

process.on('SIGINT', async () => {
  console.log('\n[Server] Shutting down...');
  await closeBrowser();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await closeBrowser();
  process.exit(0);
});
