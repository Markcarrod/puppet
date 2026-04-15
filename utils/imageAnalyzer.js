/**
 * Enhanced Image Analyzer
 * - 3×3 grid focal-point / activity mapping
 * - Dominant color extraction
 * - Adaptive overlay opacity based on background luminance
 * - Safe-zone mapping with Pinterest mobile "guaranteed visible" zone
 */

const sharp = require('sharp');

// ─── Main Analysis ────────────────────────────────────────────────────────────

async function analyzeImage(imagePath) {
  const image = sharp(imagePath);
  const { width, height } = await image.metadata();

  // Resize to small thumbnail for speed
  const { data, info } = await image
    .resize(120, 180, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const cols  = info.width;
  const rows  = info.height;
  const ch    = info.channels;

  // ── Pixel helpers ──────────────────────────────────────────────────────────
  function lum(idx) {
    return 0.2126 * data[idx] + 0.7152 * data[idx + 1] + 0.0722 * data[idx + 2];
  }

  function edgeGrad(x, y) {
    if (x <= 0 || y <= 0 || x >= cols - 1 || y >= rows - 1) return 0;
    const tl = lum(((y - 1) * cols + (x - 1)) * ch);
    const tr = lum(((y - 1) * cols + (x + 1)) * ch);
    const bl = lum(((y + 1) * cols + (x - 1)) * ch);
    const br = lum(((y + 1) * cols + (x + 1)) * ch);
    const gx = (tr + br) - (tl + bl);
    const gy = (bl + br) - (tl + tr);
    return Math.sqrt(gx * gx + gy * gy);
  }

  // ── 5-zone vertical analysis ───────────────────────────────────────────────
  const ZONE_KEYS = ['top', 'upperMid', 'center', 'lowerMid', 'bottom'];
  const zones = {};
  ZONE_KEYS.forEach(k => { zones[k] = { brightness: 0, variance: 0, pixels: 0, lumValues: [] }; });

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const idx = (y * cols + x) * ch;
      const l   = lum(idx);
      const key = getZoneKey(y, rows);
      zones[key].brightness += l;
      zones[key].pixels++;
      zones[key].lumValues.push(l);
    }
  }

  for (const key of ZONE_KEYS) {
    const z = zones[key];
    if (!z.pixels) continue;
    z.brightness /= z.pixels;
    const mean = z.brightness;
    let sq = 0;
    z.lumValues.forEach(v => { sq += (v - mean) ** 2; });
    z.variance = Math.sqrt(sq / z.pixels);
    delete z.lumValues;
  }

  // ── 3×3 Grid Activity Map ─────────────────────────────────────────────────
  const grid = buildGridMap(data, cols, rows, ch, lum, edgeGrad);

  // ── Safe / Busy zones ──────────────────────────────────────────────────────
  const safeZones = ZONE_KEYS.filter(k => zones[k].variance < 38 && zones[k].pixels);
  const busyZones = ZONE_KEYS.filter(k => zones[k].variance > 60);

  const safeGridCells  = grid.cells.filter(c => c.activity < 30).map(c => c.id);
  const avoidGridCells = grid.cells.filter(c => c.activity > 55).map(c => c.id);
  const leftCells = grid.cells.filter(c => c.col === 0);
  const rightCells = grid.cells.filter(c => c.col === 2);
  const avgActivity = cells => cells.reduce((sum, c) => sum + c.activity, 0) / Math.max(1, cells.length);
  const leftActivity = avgActivity(leftCells);
  const rightActivity = avgActivity(rightCells);

  // ── Global characteristics ─────────────────────────────────────────────────
  let totalLum = 0;
  const colorSamples = [];
  for (let i = 0; i < data.length; i += ch * 6) {
    const l = lum(i);
    totalLum += l;
    colorSamples.push({ r: data[i], g: data[i + 1], b: data[i + 2] });
  }
  const avgBrightness = totalLum / (data.length / (ch * 6));
  const isDark  = avgBrightness < 100;
  const isLight = avgBrightness > 160;

  // ── Dominant color extraction ──────────────────────────────────────────────
  const dominantColor = extractDominantColor(colorSamples);

  // ── Auto text color (white vs dark) ───────────────────────────────────────
  // Using a more conservative threshold for dark text to ensure premium readability
  const autoTextColor = avgBrightness < 145 ? '#ffffff' : '#1a1a1a';

  // ── Adaptive overlay opacity ───────────────────────────────────────────────
  // Rule 4: Lower opacity for dark images, higher for bright/busy
  const adaptiveOverlayOpacity = calcAdaptiveOpacity(avgBrightness, zones.bottom.variance);

  // ── Pinterest mobile safe zone hint ───────────────────────────────────────
  // Roughly middle 60% vertically is "guaranteed visible" in feed
  const mobileSafeZones = ['upperMid', 'center', 'lowerMid'].filter(k => safeZones.includes(k));

  return {
    width,
    height,
    zones,
    safeZones,
    busyZones,
    safeGridCells,
    avoidGridCells,
    grid: grid.cells,
    avgBrightness,
    isDark,
    isLight,
    hasDarkBottom: zones.bottom.brightness < 80 || zones.lowerMid.brightness < 80,
    hasDarkTop:    zones.top.brightness < 80,
    hasCleanTop:   zones.top.variance < 35,
    hasCleanBottom:zones.bottom.variance < 35,
    hasCleanCenter:zones.center.variance < 32,
    hasCleanLeft:  leftActivity < 34,
    hasCleanRight: rightActivity < 34,
    hasBusyLeft:   leftActivity > 52,
    hasBusyRight:  rightActivity > 52,
    topBrightness:    zones.top.brightness,
    bottomBrightness: zones.bottom.brightness,
    centerVariance:   zones.center.variance,
    dominantColor,
    autoTextColor,
    adaptiveOverlayOpacity,
    mobileSafeZones,
    highContrastReady: Math.abs(avgBrightness - 128) > 40, // True if background is clearly dark or bright
  };
}

// ─── 3×3 Grid Activity Map ────────────────────────────────────────────────────

function buildGridMap(data, cols, rows, ch, lumFn, edgeFn) {
  const GRID = 3;
  const cells = [];

  for (let gy = 0; gy < GRID; gy++) {
    for (let gx = 0; gx < GRID; gx++) {
      const x0 = Math.floor((gx / GRID) * cols);
      const x1 = Math.floor(((gx + 1) / GRID) * cols);
      const y0 = Math.floor((gy / GRID) * rows);
      const y1 = Math.floor(((gy + 1) / GRID) * rows);

      let lumSum = 0, edgeSum = 0, count = 0;
      const lumVals = [];

      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const idx = (y * cols + x) * ch;
          const l   = lumFn(idx);
          const e   = edgeFn(x, y);
          lumSum  += l;
          edgeSum += e;
          lumVals.push(l);
          count++;
        }
      }

      const meanLum = count ? lumSum / count : 0;
      let sqDiff = 0;
      lumVals.forEach(v => { sqDiff += (v - meanLum) ** 2; });
      const variance = count ? Math.sqrt(sqDiff / count) : 0;

      // Activity = edge density * 0.6 + variance * 0.4 (normalized 0-100)
      const edgeMean = count ? edgeSum / count : 0;
      const activity = Math.min(100, (edgeMean * 0.6 + variance * 0.4));

      cells.push({
        id: `${gy}_${gx}`,
        row: gy, col: gx,
        brightness: meanLum,
        variance,
        edgeDensity: edgeMean,
        activity,
        isSafe:   activity < 30,
        isActive: activity > 55,
      });
    }
  }

  return { cells };
}

// ─── Dominant Color Extraction ────────────────────────────────────────────────

function extractDominantColor(samples) {
  if (!samples.length) return { r: 128, g: 128, b: 128, hex: '#808080', isSaturated: false };

  let maxSat = 0, dominantSample = samples[0];

  for (const s of samples) {
    const maxC = Math.max(s.r, s.g, s.b) / 255;
    const minC = Math.min(s.r, s.g, s.b) / 255;
    const sat  = maxC > 0 ? (maxC - minC) / maxC : 0;
    if (sat > maxSat) { maxSat = sat; dominantSample = s; }
  }

  const hex = `#${[dominantSample.r, dominantSample.g, dominantSample.b]
    .map(v => v.toString(16).padStart(2, '0')).join('')}`;

  return {
    r: dominantSample.r,
    g: dominantSample.g,
    b: dominantSample.b,
    hex,
    isSaturated: maxSat > 0.35,
    saturation: maxSat,
  };
}

// ─── Adaptive Overlay Opacity ─────────────────────────────────────────────────

function calcAdaptiveOpacity(avgBrightness, zoneVariance) {
  // Dark background → lighter card touch (0.72); bright/busy → heavier (0.90)
  const lumFactor  = avgBrightness / 255; // 0..1
  const busyness   = Math.min(zoneVariance / 80, 1); // 0..1
  const opacity    = 0.72 + (lumFactor * 0.1) + (busyness * 0.1);
  return Math.min(0.94, Math.max(0.70, opacity));
}

// ─── Zone Key Lookup ──────────────────────────────────────────────────────────

function getZoneKey(y, rows) {
  const pct = y / rows;
  if (pct < 0.20) return 'top';
  if (pct < 0.40) return 'upperMid';
  if (pct < 0.60) return 'center';
  if (pct < 0.80) return 'lowerMid';
  return 'bottom';
}

// ─── Template Scorer ──────────────────────────────────────────────────────────

function scoreTemplates(analysis, titleText, templates) {
  const titleLen   = (titleText || '').length;
  const isLongTitle  = titleLen > 60;
  const isShortTitle = titleLen < 35;

  const scores = {};

  for (const [id, tmpl] of Object.entries(templates)) {
    let score = 50;
    const { suitableFor = [], avoidWhen = [] } = tmpl;

    if (suitableFor.includes('any')) score += 10;
    if (suitableFor.includes('clean_top')     && analysis.hasCleanTop)           score += 20;
    if (suitableFor.includes('dark_top')      && analysis.hasDarkTop)            score += 15;
    if (suitableFor.includes('dark_bottom')   && analysis.hasDarkBottom)         score += 18;
    if (suitableFor.includes('light_tones')   && analysis.isLight)               score += 12;
    if (suitableFor.includes('dark_luxury')   && analysis.isDark)                score += 18;
    if (suitableFor.includes('dark_tones')    && analysis.isDark)                score += 14;
    if (suitableFor.includes('minimal')       && analysis.centerVariance < 30)   score += 15;
    if (suitableFor.includes('gradient')      && analysis.centerVariance < 25)   score += 12;
    if (suitableFor.includes('busy_center')   && analysis.busyZones.includes('center')) score += 20;
    if (suitableFor.includes('clean_right')   && analysis.hasCleanRight)         score += 18;
    if (suitableFor.includes('clean_left')    && analysis.hasCleanLeft)          score += 18;
    if (suitableFor.includes('warm_tones')    && analysis.dominantColor.r > analysis.dominantColor.b) score += 8;

    // Mobile safe zone preference
    if (analysis.mobileSafeZones.length >= 2) score += 8;

    // Grid activity: penalise placing text over active grid cells
    const textZone = getTextZoneGridCells(tmpl.textPosition || 'center');
    const conflictCells = textZone.filter(c => analysis.avoidGridCells.includes(c));
    score -= conflictCells.length * 12;

    if (avoidWhen.includes('busy_top')    && analysis.busyZones.includes('top'))     score -= 25;
    if (avoidWhen.includes('busy_top')    && analysis.busyZones.includes('upperMid'))score -= 15;
    if (avoidWhen.includes('busy_bottom') && analysis.busyZones.includes('bottom'))  score -= 25;
    if (avoidWhen.includes('busy_left')   && analysis.hasBusyLeft)                   score -= 28;
    if (avoidWhen.includes('busy_right')  && analysis.hasBusyRight)                  score -= 28;
    if (avoidWhen.includes('light_bottom')&& !analysis.hasDarkBottom)               score -= 20;
    if (avoidWhen.includes('dark_tones')  && analysis.isDark)                        score -= 18;
    if (avoidWhen.includes('light_tones') && analysis.isLight)                       score -= 18;
    if (avoidWhen.includes('text_heavy')  && isLongTitle)                            score -= 15;

    if (tmpl.textPosition?.includes('center') && isLongTitle) score -= 10;
    if (parseFloat(tmpl.maxTitleWidth) < 70   && isLongTitle) score -= 12;
    if (isShortTitle && tmpl.titleSizeMax >= 56)              score += 8;

    // White text on light image without overlay — penalise
    if (tmpl.textColor === '#ffffff' && analysis.isLight && tmpl.overlay === 'none') score -= 20;
    if (tmpl.textColor === '#ffffff' && tmpl.overlay !== 'none')                     score += 5;

    scores[id] = Math.max(0, score);
  }

  return Object.entries(scores)
    .sort(([, a], [, b]) => b - a)
    .map(([id, score]) => ({ id, score }));
}

// Map text position to expected 3×3 grid cells (row_col format)
function getTextZoneGridCells(textPosition) {
  const map = {
    'upper':         ['0_0', '0_1', '0_2'],
    'upper-center':  ['0_1'],
    'upper-left':    ['0_0', '0_1'],
    'center':        ['1_0', '1_1', '1_2'],
    'lower':         ['2_0', '2_1', '2_2'],
    'lower-center':  ['2_1'],
    'left':          ['0_0', '1_0', '2_0'],
  };
  return map[textPosition] || ['1_1'];
}

module.exports = { analyzeImage, scoreTemplates };
