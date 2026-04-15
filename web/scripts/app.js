/**
 * Pinterest Pin Factory — Frontend App Logic
 * Handles all UI interactions, API calls, job polling, and rendering state.
 */

'use strict';

// ─── State ────────────────────────────────────────────────────────────────────
const state = {
  uploadedFile: null,     // { id, filename, url, originalName }
  activeJobId: null,
  activeTab: 'generate',
  batchFiles: [],         // [{ id, filename, url, originalName }]
  batchJobId: null,
  templates: [],
  pollInterval: null,
  batchPollInterval: null,
  currentJobId: null,
};

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const $$ = (sel, root = document) => root.querySelector(sel);

const els = {
  // Nav
  navItems: document.querySelectorAll('.nav-item'),
  // Dropzone
  dropzone: $('dropzone'),
  fileInput: $('file-input'),
  btnBrowse: $('btn-browse'),
  dropzoneIdle: $('dropzone-idle'),
  dropzonePreview: $('dropzone-preview'),
  previewImg: $('preview-img'),
  previewMeta: $('preview-meta'),
  btnRemoveImage: $('btn-remove-image'),
  // Text
  inputTitle: $('input-title'),
  inputSubtitle: $('input-subtitle'),
  inputCategory: $('input-category'),
  inputCta: $('input-cta'),
  inputBadge: $('input-badge'),
  inputLink: $('input-link'),
  titleCharCount: $('title-char-count'),
  // Settings
  selectTemplate: $('select-template'),
  selectSize: $('select-size'),
  selectFormat: $('select-format'),
  inputVariants: $('input-variants'),
  inputQuality: $('input-quality'),
  // Actions
  btnRender: $('btn-render'),
  btnAnalyze: $('btn-analyze'),
  btnClearAll: $('btn-clear-all'),
  // Results
  emptyState: $('empty-state'),
  analysisBar: $('analysis-bar'),
  analysisZones: $('analysis-zones'),
  analysisRanked: $('analysis-ranked'),
  btnCloseAnalysis: $('btn-close-analysis'),
  jobProgressBar: $('job-progress-bar'),
  jobProgressLabel: $('job-progress-label'),
  jobProgressCount: $('job-progress-count'),
  progressFill: $('progress-fill'),
  resultsToolbar: $('results-toolbar'),
  resultsCount: $('results-count'),
  btnDownloadZip: $('btn-download-zip'),
  pinsGrid: $('pins-grid'),
  // Batch
  batchDropzone: $('batch-dropzone'),
  batchFileInput: $('batch-file-input'),
  btnBatchBrowse: $('btn-batch-browse'),
  btnBatchFolder: $('btn-batch-folder'),
  batchFolderInput: $('batch-folder-input'),
  batchImageCount: $('batch-image-count'),
  batchImagesList: $('batch-images-list'),
  batchTitles: $('batch-titles'),
  btnTitleFile: $('btn-title-file'),
  titleFileInput: $('title-file-input'),
  batchTitleCount: $('batch-title-count'),
  batchTemplate: $('batch-template'),
  batchVariants: $('batch-variants'),
  batchFormat: $('batch-format'),
  batchQuality: $('batch-quality'),
  btnBatchRender: $('btn-batch-render'),
  batchStatus: $('batch-status'),
  batchStatusLabel: $('batch-status-label'),
  batchProgressCount: $('batch-progress-count'),
  batchProgressFill: $('batch-progress-fill'),
  batchPinsGrid: $('batch-pins-grid'),
  // Gallery
  galleryGrid: $('gallery-grid'),
  galleryCount: $('gallery-count'),
  galleryEmpty: $('gallery-empty'),
  btnRefreshGallery: $('btn-refresh-gallery'),
  // Jobs
  jobsList: $('jobs-list'),
  jobsEmpty: $('jobs-empty'),
  btnRefreshJobs: $('btn-refresh-jobs'),
  // Status
  serverStatus: $('server-status'),
  // Lightbox
  lightbox: $('lightbox'),
  lightboxBackdrop: $('lightbox-backdrop'),
  lightboxClose: $('lightbox-close'),
  lightboxImg: $('lightbox-img'),
  lightboxMeta: $('lightbox-meta'),
  lightboxDownload: $('lightbox-download'),
};

// ─── API Helpers ──────────────────────────────────────────────────────────────
async function api(method, path, body) {
  const opts = { method, headers: {} };
  if (body && !(body instanceof FormData)) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  } else if (body) {
    opts.body = body;
  }
  const res = await fetch(path, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

// ─── Server Health ────────────────────────────────────────────────────────────
async function checkHealth() {
  try {
    await api('GET', '/api/health');
    const dot = els.serverStatus.querySelector('.status-dot');
    const label = els.serverStatus.querySelector('.status-label');
    dot.className = 'status-dot online';
    label.textContent = 'Server online';
  } catch {
    const dot = els.serverStatus.querySelector('.status-dot');
    const label = els.serverStatus.querySelector('.status-label');
    dot.className = 'status-dot offline';
    label.textContent = 'Server offline';
  }
}

// ─── Load Templates ───────────────────────────────────────────────────────────
async function loadTemplates() {
  try {
    const data = await api('GET', '/api/templates');
    state.templates = data.templates;
    const optgroup = $('template-options');
    optgroup.innerHTML = '';
    data.templates.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.name;
      optgroup.appendChild(opt);
    });
    // Also populate batch template select
    els.batchTemplate.innerHTML = '<option value="auto">🎯 Auto Select</option>';
    data.templates.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.name;
      els.batchTemplate.appendChild(opt);
    });
  } catch (err) {
    console.warn('Could not load templates:', err.message);
  }
}

// ─── Navigation ───────────────────────────────────────────────────────────────
function switchTab(tabId) {
  document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.remove('active'));
  els.navItems.forEach(item => item.classList.remove('active'));

  const panel = document.getElementById(`tab-${tabId}`);
  if (panel) panel.classList.add('active');

  const navItem = document.querySelector(`.nav-item[data-tab="${tabId}"]`);
  if (navItem) navItem.classList.add('active');

  const titles = {
    generate: ['Generate Pins', 'Upload an image, add your title, render premium Pinterest pins'],
    batch: ['Batch Render', 'Process multiple images and titles at once'],
    gallery: ['Gallery', 'All rendered pins from previous sessions'],
    jobs: ['Job History', 'Track render job status and download results'],
  };
  const [title, sub] = titles[tabId] || ['', ''];
  $('page-title').textContent = title;
  $('page-subtitle').textContent = sub;

  // Lazy-load tabs
  if (tabId === 'gallery') loadGallery();
  if (tabId === 'jobs') loadJobs();

  // Show/hide topbar buttons
  const showRender = tabId === 'generate';
  els.btnRender.style.display = showRender ? '' : 'none';
  els.btnClearAll.style.display = showRender ? '' : 'none';
}

els.navItems.forEach(item => {
  item.addEventListener('click', e => {
    e.preventDefault();
    switchTab(item.dataset.tab);
  });
});

// ─── Dropzone ─────────────────────────────────────────────────────────────────
function setupDropzone(dropzone, fileInput, browseTrigger, onFiles) {
  dropzone.addEventListener('dragover', e => {
    e.preventDefault();
    dropzone.classList.add('drag-over');
  });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
  dropzone.addEventListener('drop', e => {
    e.preventDefault();
    dropzone.classList.remove('drag-over');
    onFiles(Array.from(e.dataTransfer.files));
  });
  dropzone.addEventListener('click', e => {
    if (e.target === dropzone || dropzone.contains(e.target)) fileInput.click();
  });
  if (browseTrigger) {
    browseTrigger.addEventListener('click', e => { e.stopPropagation(); fileInput.click(); });
  }
  fileInput.addEventListener('change', () => {
    onFiles(Array.from(fileInput.files));
    fileInput.value = '';
  });
}

// Single image dropzone
setupDropzone(els.dropzone, els.fileInput, els.btnBrowse, files => {
  const file = files[0];
  if (!file) return;
  uploadSingleImage(file);
});

els.btnRemoveImage.addEventListener('click', e => {
  e.stopPropagation();
  clearSingleImage();
});

async function uploadSingleImage(file) {
  const formData = new FormData();
  formData.append('images', file);

  els.dropzoneIdle.style.display = 'none';
  els.dropzonePreview.style.display = 'block';
  els.previewImg.src = URL.createObjectURL(file);
  els.previewMeta.textContent = 'Uploading…';
  updateButtons();

  try {
    const data = await api('POST', '/api/upload', formData);
    state.uploadedFile = data.uploaded[0];
    els.previewMeta.innerHTML =
      `<span>${state.uploadedFile.originalName}</span>
       <span>${(state.uploadedFile.size / 1024).toFixed(0)} KB</span>`;
    updateButtons();
  } catch (err) {
    showToast(`Upload failed: ${err.message}`, 'error');
    clearSingleImage();
  }
}

function clearSingleImage() {
  state.uploadedFile = null;
  els.dropzoneIdle.style.display = 'flex';
  els.dropzonePreview.style.display = 'none';
  els.previewImg.src = '';
  updateButtons();
}

// ─── Title Character Count ────────────────────────────────────────────────────
els.inputTitle.addEventListener('input', () => {
  const len = els.inputTitle.value.length;
  els.titleCharCount.textContent = `${len} / 120`;
  updateButtons();
});

// ─── Button State ─────────────────────────────────────────────────────────────
function updateButtons() {
  const hasImage = !!state.uploadedFile;
  const hasTitle = els.inputTitle.value.trim().length > 0;
  els.btnRender.disabled = !(hasImage && hasTitle);
  els.btnAnalyze.disabled = !hasImage;
}

// ─── Analyze ──────────────────────────────────────────────────────────────────
els.btnAnalyze.addEventListener('click', async () => {
  if (!state.uploadedFile) return;
  els.btnAnalyze.disabled = true;
  els.btnAnalyze.textContent = 'Analyzing…';

  try {
    const data = await api('POST', '/api/analyze', {
      filename: state.uploadedFile.filename,
      title: els.inputTitle.value,
    });

    renderAnalysis(data);
    els.emptyState.style.display = 'none';
    els.analysisBar.style.display = 'block';
  } catch (err) {
    showToast(`Analysis failed: ${err.message}`, 'error');
  } finally {
    els.btnAnalyze.disabled = false;
    els.btnAnalyze.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> Analyze Image & Rank Templates`;
  }
});

function renderAnalysis(data) {
  const { analysis, ranked } = data;
  const { safeZones, busyZones, avgBrightness, isDark, isLight, dominantColor, grid } = analysis;

  els.analysisZones.innerHTML = '';
  
  // Dominant Color Chip
  if (dominantColor) {
    const colorChip = document.createElement('span');
    colorChip.className = 'zone-chip';
    colorChip.style.borderLeft = `8px solid ${dominantColor.hex}`;
    colorChip.textContent = `Color: ${dominantColor.hex}`;
    colorChip.title = `Saturation: ${Math.round(dominantColor.saturation * 100)}%`;
    els.analysisZones.appendChild(colorChip);
  }

  const zoneLabels = { top: 'Top', upperMid: 'Upper', center: 'Center', lowerMid: 'Lower', bottom: 'Bottom' };

  Object.entries(zoneLabels).forEach(([key, label]) => {
    const chip = document.createElement('span');
    chip.className = 'zone-chip' +
      (safeZones.includes(key) ? ' safe' : '') +
      (busyZones.includes(key) ? ' busy' : '');
    chip.textContent = label + (safeZones.includes(key) ? ' ✓' : busyZones.includes(key) ? ' ⚠' : '');
    els.analysisZones.appendChild(chip);
  });

  // Brightness chip
  const bChip = document.createElement('span');
  bChip.className = 'zone-chip' + (isDark ? ' busy' : isLight ? '' : '');
  bChip.textContent = isDark ? '🌑 Dark' : isLight ? '☀ Bright' : '◑ Mixed';
  els.analysisZones.appendChild(bChip);

  // 3x3 Grid Visualization
  if (grid) {
    const gridTitle = document.createElement('div');
    gridTitle.className = 'analysis-title';
    gridTitle.style.marginTop = '12px';
    gridTitle.style.marginBottom = '8px';
    gridTitle.textContent = 'Activity Map (3×3)';
    els.analysisZones.appendChild(gridTitle);

    const gridContainer = document.createElement('div');
    gridContainer.style.cssText = 'display:grid; grid-template-columns:repeat(3, 40px); gap:4px; margin-bottom:14px;';
    
    grid.forEach(cell => {
      const cellEl = document.createElement('div');
      const opacity = Math.max(0.1, cell.activity / 100);
      cellEl.style.cssText = `width:40px; height:24px; border-radius:3px; background:var(--accent); opacity:${opacity}; border:1px solid var(--border);`;
      cellEl.title = `Activity: ${Math.round(cell.activity)}% | ${cell.isSafe ? 'Safe' : cell.isActive ? 'Active' : 'Normal'}`;
      if (cell.isActive) cellEl.style.borderColor = 'var(--yellow)';
      if (cell.isSafe) cellEl.style.borderColor = 'var(--green)';
      gridContainer.appendChild(cellEl);
    });
    els.analysisZones.appendChild(gridContainer);
  }

  // Ranked templates
  els.analysisRanked.innerHTML = '';
  const maxScore = ranked[0]?.score || 1;
  ranked.forEach((item, i) => {
    const row = document.createElement('div');
    row.className = 'ranked-item';
    row.style.cursor = 'pointer';
    const pct = Math.round((item.score / maxScore) * 100);
    row.innerHTML = `
      <span class="ranked-num">#${i + 1}</span>
      <span class="ranked-name">${item.name}</span>
      <div style="flex:1; padding: 0 8px;">
        <div class="ranked-bar" style="width:${pct}%"></div>
      </div>
      <span class="ranked-score">${item.score}</span>`;
    row.addEventListener('click', () => {
      els.selectTemplate.value = item.id;
      showToast(`Selected template: ${item.name}`, 'info');
    });
    els.analysisRanked.appendChild(row);
  });
}

els.btnCloseAnalysis.addEventListener('click', () => {
  els.analysisBar.style.display = 'none';
});

// ─── Render ───────────────────────────────────────────────────────────────────
els.btnRender.addEventListener('click', async () => {
  if (!state.uploadedFile || !els.inputTitle.value.trim()) return;
  startRenderJob();
});

async function startRenderJob() {
  els.btnRender.disabled = true;
  els.btnRender.textContent = 'Rendering…';
  els.emptyState.style.display = 'none';
  els.analysisBar.style.display = 'none';
  els.resultsToolbar.style.display = 'none';

  // Clear previous results
  els.pinsGrid.innerHTML = '';
  renderedUrls.clear();
  showProgress(true, 'Queueing render…', 0, 0);

  try {
    const res = await api('POST', '/api/generate', {
      filename: state.uploadedFile.filename,
      title: els.inputTitle.value.trim(),
      subtitle: els.inputSubtitle.value.trim() || undefined,
      category: els.inputCategory.value.trim() || undefined,
      cta: els.inputCta.value.trim() || undefined,
      badge: els.inputBadge.value.trim() || undefined,
      linkLabel: els.inputLink.value.trim() || undefined,
      templateMode: els.selectTemplate.value,
      pinSize: els.selectSize.value,
      format: els.selectFormat.value,
      maxVariants: parseInt(els.inputVariants.value),
      quality: parseInt(els.inputQuality.value),
    });

    state.currentJobId = res.jobId;
    pollJob(res.jobId, {
      onProgress: (job) => {
        showProgress(true, `Rendering variant ${job.progress} of ${job.total}…`, job.progress, job.total);
        renderNewResults(job.results, els.pinsGrid, state.currentJobId);
      },
      onDone: (job) => {
        showProgress(false);
        renderNewResults(job.results, els.pinsGrid, state.currentJobId);
        els.resultsToolbar.style.display = 'flex';
        els.resultsCount.textContent = `${job.results.length} pin${job.results.length !== 1 ? 's' : ''} generated`;

        els.btnDownloadZip.onclick = () => {
          window.location.href = `/api/jobs/${state.currentJobId}/download`;
        };

        els.btnRender.textContent = 'Render Pins';
        els.btnRender.disabled = false;
        updateButtons();

        if (job.results.length === 0) {
          showToast('No pins were generated — check console for errors', 'error');
        }
      },
      onError: (msg) => {
        showProgress(false);
        showToast(`Render error: ${msg}`, 'error');
        els.btnRender.textContent = 'Render Pins';
        els.btnRender.disabled = false;
        updateButtons();
      },
    });
  } catch (err) {
    showProgress(false);
    showToast(`Failed to start render: ${err.message}`, 'error');
    els.btnRender.textContent = 'Render Pins';
    els.btnRender.disabled = false;
    updateButtons();
  }
}

// ─── Job Polling ──────────────────────────────────────────────────────────────
const TERMINAL = ['done', 'error'];

function pollJob(jobId, callbacks) {
  let lastResultCount = 0;
  let retries = 0;
  const MAX_RETRIES = 120;

  const interval = setInterval(async () => {
    try {
      const job = await api('GET', `/api/jobs/${jobId}`);
      retries = 0;

      if (callbacks.onProgress && !TERMINAL.includes(job.status)) {
        callbacks.onProgress(job);
      }

      if (job.status === 'done') {
        clearInterval(interval);
        callbacks.onDone?.(job);
      } else if (job.status === 'error') {
        clearInterval(interval);
        callbacks.onError?.(job.error || 'Unknown error');
      } else {
        // Progressive results
        if (job.results.length > lastResultCount) {
          lastResultCount = job.results.length;
          callbacks.onProgress?.(job);
        }
      }
    } catch (err) {
      retries++;
      if (retries > MAX_RETRIES) {
        clearInterval(interval);
        callbacks.onError?.('Lost connection to server');
      }
    }
  }, 1200);

  return interval;
}

// ─── Progress Bar ─────────────────────────────────────────────────────────────
function showProgress(visible, label = '', current = 0, total = 0) {
  els.jobProgressBar.style.display = visible ? 'flex' : 'none';
  if (visible) {
    els.jobProgressLabel.textContent = label;
    els.jobProgressCount.textContent = total > 0 ? `${current} / ${total}` : '';
    const pct = total > 0 ? Math.round((current / total) * 100) : 0;
    els.progressFill.style.width = `${pct}%`;
  }
}

// ─── Pin Card Rendering ───────────────────────────────────────────────────────
let renderedUrls = new Set();

function renderNewResults(results, grid, jobId) {
  results.forEach(result => {
    if (renderedUrls.has(result.url)) return;
    renderedUrls.add(result.url);
    grid.appendChild(createPinCard(result, jobId));
  });
}

function createPinCard(result, jobId) {
  const card = document.createElement('div');
  card.className = 'pin-card';
  card.innerHTML = `
    <img class="pin-card-img" src="${result.url}?t=${Date.now()}" alt="${result.template}" loading="lazy">
    <div class="pin-card-body">
      <div class="pin-card-template">${formatTemplateName(result.template)}</div>
      <div class="pin-card-size">${result.renderTime ? result.renderTime + 'ms' : ''}</div>
    </div>
    <div class="pin-card-actions">
      <a class="pin-action-btn" href="${result.url}" download title="Download">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      </a>
    </div>`;

  card.querySelector('.pin-card-img').addEventListener('click', () => openLightbox(result));
  return card;
}

function formatTemplateName(id) {
  if (!id) return '';
  // Remove version/variant suffixes if present (e.g. _v1_1000x1500)
  const base = id.split('_v')[0].replace(/_\d+$/, '');
  return base
    .replace(/_/g, ' ')
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// ─── Clear All ────────────────────────────────────────────────────────────────
els.btnClearAll.addEventListener('click', () => {
  clearSingleImage();
  els.inputTitle.value = '';
  els.inputSubtitle.value = '';
  els.inputCategory.value = '';
  els.inputCta.value = '';
  els.inputBadge.value = '';
  els.inputLink.value = '';
  els.titleCharCount.textContent = '0 / 120';
  els.pinsGrid.innerHTML = '';
  els.emptyState.style.display = 'flex';
  els.analysisBar.style.display = 'none';
  showProgress(false);
  els.resultsToolbar.style.display = 'none';
  renderedUrls.clear();
  state.currentJobId = null;
  updateButtons();
});

// ─── Batch Tab ────────────────────────────────────────────────────────────────
setupDropzone(els.batchDropzone, els.batchFileInput, els.btnBatchBrowse, files => {
  uploadBatchImages(files);
});

async function uploadBatchImages(files) {
  if (!files.length) return;
  const imageFiles = files.filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f.name || ''));
  const chunkSize = 40;

  try {
    for (let i = 0; i < imageFiles.length; i += chunkSize) {
      const chunk = imageFiles.slice(i, i + chunkSize);
      const formData = new FormData();
      chunk.forEach(f => formData.append('images', f));
      const data = await api('POST', '/api/upload', formData);
      state.batchFiles.push(...data.uploaded);
    }

    renderBatchThumbs();
    updateBatchTitleMeta();
    els.btnBatchRender.disabled = state.batchFiles.length === 0 || !els.batchTitles.value.trim();
  } catch (err) {
    showToast(`Batch upload failed: ${err.message}`, 'error');
  }
}

function renderBatchThumbs() {
  if (state.batchFiles.length === 0) {
    els.batchImagesList.style.display = 'none';
    els.batchImageCount.textContent = '0 images loaded';
    return;
  }
  els.batchImagesList.style.display = 'grid';
  els.batchImageCount.textContent = `${state.batchFiles.length} image${state.batchFiles.length !== 1 ? 's' : ''} loaded`;
  els.batchImagesList.innerHTML = '';
  state.batchFiles.forEach(f => {
    const thumb = document.createElement('div');
    thumb.className = 'batch-thumb';
    thumb.innerHTML = `<img src="${f.url}" alt="${f.originalName}"><div class="batch-thumb-label">${f.originalName}</div>`;
    els.batchImagesList.appendChild(thumb);
  });
}

els.batchTitles.addEventListener('input', () => {
  updateBatchTitleMeta();
  els.btnBatchRender.disabled = state.batchFiles.length === 0 || !els.batchTitles.value.trim();
});

els.btnBatchFolder.addEventListener('click', () => els.batchFolderInput.click());
els.batchFolderInput.addEventListener('change', () => {
  uploadBatchImages(Array.from(els.batchFolderInput.files));
  els.batchFolderInput.value = '';
});

els.btnTitleFile.addEventListener('click', () => els.titleFileInput.click());
els.titleFileInput.addEventListener('change', async () => {
  const file = els.titleFileInput.files[0];
  if (!file) return;
  const text = await file.text();
  els.batchTitles.value = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .join('\n');
  updateBatchTitleMeta();
  els.btnBatchRender.disabled = state.batchFiles.length === 0 || !els.batchTitles.value.trim();
  els.titleFileInput.value = '';
});

function updateBatchTitleMeta() {
  const count = els.batchTitles.value
    .split(/\r?\n/)
    .map(t => t.trim())
    .filter(Boolean).length;
  els.batchTitleCount.textContent = `${count} title${count !== 1 ? 's' : ''} loaded`;
}

els.btnBatchRender.addEventListener('click', async () => {
  const titles = els.batchTitles.value.trim().split('\n').map(t => t.trim()).filter(Boolean);
  if (!titles.length || !state.batchFiles.length) return;

  const pairCount = Math.min(titles.length, state.batchFiles.length);
  const items = Array.from({ length: pairCount }, (_, i) => ({
    filename: state.batchFiles[i].filename,
    title: titles[i],
  }));

  if (titles.length !== state.batchFiles.length) {
    showToast(`Using first ${pairCount} image/title pairs in sequence`, 'info');
  }

  els.btnBatchRender.disabled = true;
  els.btnBatchRender.textContent = 'Starting batch…';
  els.batchStatus.style.display = 'flex';
  els.batchPinsGrid.innerHTML = '';
  els.batchProgressFill.style.width = '0%';

  try {
    const res = await api('POST', '/api/batch', {
      items,
      templateMode: els.batchTemplate.value,
      format: els.batchFormat.value,
      quality: parseInt(els.batchQuality.value),
      maxVariants: parseInt(els.batchVariants.value),
    });

    state.batchJobId = res.jobId;
    let lastCount = 0;

    pollJob(res.jobId, {
      onProgress: (job) => {
        els.batchStatusLabel.textContent = `Processing ${job.progress} / ${job.total}…`;
        els.batchProgressCount.textContent = `${job.progress} / ${job.total}`;
        const pct = job.total > 0 ? Math.round((job.progress / job.total) * 100) : 0;
        els.batchProgressFill.style.width = `${pct}%`;

        if (job.results.length > lastCount) {
          lastCount = job.results.length;
          job.results.slice(lastCount).forEach(r => {
            els.batchPinsGrid.appendChild(createPinCard(r, res.jobId));
          });
        }
      },
      onDone: (job) => {
        els.batchStatusLabel.textContent = `✓ Batch complete — ${job.results.length} pins rendered`;
        els.batchProgressFill.style.width = '100%';
        // Render all
        els.batchPinsGrid.innerHTML = '';
        job.results.forEach(r => els.batchPinsGrid.appendChild(createPinCard(r, res.jobId)));
        els.btnBatchRender.disabled = false;
        els.btnBatchRender.textContent = '▶ Start Batch Render';
      },
      onError: (msg) => {
        els.batchStatusLabel.textContent = `✗ Error: ${msg}`;
        els.btnBatchRender.disabled = false;
        els.btnBatchRender.textContent = '▶ Start Batch Render';
        showToast(`Batch error: ${msg}`, 'error');
      },
    });
  } catch (err) {
    showToast(`Failed to start batch: ${err.message}`, 'error');
    els.btnBatchRender.disabled = false;
    els.btnBatchRender.textContent = '▶ Start Batch Render';
  }
});

// ─── Gallery ──────────────────────────────────────────────────────────────────
els.btnRefreshGallery.addEventListener('click', loadGallery);

async function loadGallery() {
  try {
    const data = await api('GET', '/api/outputs');
    els.galleryGrid.innerHTML = '';
    if (data.files.length === 0) {
      els.galleryGrid.style.display = 'none';
      els.galleryEmpty.style.display = 'flex';
      els.galleryCount.textContent = '';
    } else {
      els.galleryGrid.style.display = 'grid';
      els.galleryEmpty.style.display = 'none';
      els.galleryCount.textContent = `${data.files.length} pins`;
      data.files.forEach(f => {
        const card = document.createElement('div');
        card.className = 'pin-card';
        card.style.cursor = 'pointer';
        card.innerHTML = `
          <img class="pin-card-img" src="${f.url}?t=${Date.now()}" alt="${f.filename}" loading="lazy">
          <div class="pin-card-body">
            <div class="pin-card-template">${formatTemplateName(f.filename.split('_').slice(1, 3).join('_'))}</div>
            <div class="pin-card-size">${(f.size / 1024).toFixed(0)} KB</div>
          </div>
          <div class="pin-card-actions">
            <a class="pin-action-btn" href="${f.url}" download title="Download">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            </a>
          </div>`;
        card.querySelector('.pin-card-img').addEventListener('click', () =>
          openLightbox({ url: f.url, template: f.filename })
        );
        els.galleryGrid.appendChild(card);
      });
    }
  } catch (err) {
    showToast(`Gallery load failed: ${err.message}`, 'error');
  }
}

// ─── Jobs ─────────────────────────────────────────────────────────────────────
els.btnRefreshJobs.addEventListener('click', loadJobs);

async function loadJobs() {
  try {
    const data = await api('GET', '/api/jobs');
    els.jobsList.innerHTML = '';
    if (data.jobs.length === 0) {
      els.jobsEmpty.style.display = 'flex';
    } else {
      els.jobsEmpty.style.display = 'none';
      data.jobs.forEach(job => {
        const item = document.createElement('div');
        item.className = 'job-item';
        item.innerHTML = `
          <span class="job-status-badge ${job.status}">${job.status}</span>
          <div class="job-info">
            <div class="job-id">${job.id.slice(0, 8)}…</div>
            <div class="job-count">${job.resultCount} pin${job.resultCount !== 1 ? 's' : ''}</div>
          </div>
          <span class="job-time">${formatTime(job.createdAt)}</span>
          ${job.status === 'done' && job.resultCount > 0
            ? `<a class="job-dl-link" href="/api/jobs/${job.id}/download">↓ Download ZIP</a>`
            : ''}`;
        els.jobsList.appendChild(item);
      });
    }
  } catch (err) {
    showToast(`Jobs load failed: ${err.message}`, 'error');
  }
}

function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ─── Lightbox ─────────────────────────────────────────────────────────────────
function openLightbox(result) {
  els.lightboxImg.src = result.url;
  els.lightboxMeta.textContent = result.template ? formatTemplateName(result.template) : '';
  els.lightboxDownload.href = result.url;
  els.lightboxDownload.download = result.template || 'pin';
  els.lightbox.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeLightbox() {
  els.lightbox.style.display = 'none';
  document.body.style.overflow = '';
}

els.lightboxClose.addEventListener('click', closeLightbox);
els.lightboxBackdrop.addEventListener('click', closeLightbox);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeLightbox(); });

// ─── Toast Notifications ──────────────────────────────────────────────────────
function showToast(message, type = 'info') {
  const existing = document.querySelector('.toast-container') || (() => {
    const c = document.createElement('div');
    c.className = 'toast-container';
    c.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;display:flex;flex-direction:column;gap:8px;';
    document.body.appendChild(c);
    return c;
  })();

  const toast = document.createElement('div');
  const colors = { error: '#ef4444', info: '#7c5cfc', success: '#22c55e' };
  toast.style.cssText = `
    padding: 11px 18px; border-radius: 10px; font-size: 13.5px; font-weight: 500;
    background: #1e1e28; border: 1px solid ${colors[type] || colors.info};
    color: #f0f0f5; box-shadow: 0 4px 24px rgba(0,0,0,0.5);
    animation: fadeSlide 0.25s ease; max-width: 320px;
  `;
  toast.textContent = message;
  existing.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

// ─── Init ─────────────────────────────────────────────────────────────────────
(async () => {
  await checkHealth();
  await loadTemplates();
  setInterval(checkHealth, 15000);
  updateButtons();
})();
