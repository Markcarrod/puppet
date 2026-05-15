/**
 * Enhanced Text Engine
 * - Hierarchy contrast ratios enforced (title / subtitle / CTA never within 4px)
 * - Per-font letter-spacing rules
 * - Smart line breaking (avoid orphan prepositions, prefer 2-3 lines)
 * - 8px baseline grid for all vertical spacing
 * - CSS text-rendering + font-feature-settings helpers
 * - Quality check with contrast + overflow + hierarchy warnings
 */

// ─── Per-font letter-spacing presets ─────────────────────────────────────────
// Values in em. Negative = tighter, positive = looser.
const FONT_TRACKING = {
  "'Manrope', sans-serif":              { default: '-0.02em', allCaps: '0.10em',  large: '-0.03em' },
  "'Playfair Display', serif":          { default: '-0.03em', allCaps: '0.08em',  large: '-0.04em' },
  "'Plus Jakarta Sans', sans-serif":    { default: '-0.01em', allCaps: '0.10em',  large: '-0.02em' },
  "'DM Sans', sans-serif":              { default: '-0.01em', allCaps: '0.12em',  large: '-0.01em' },
  "'Cormorant Garamond', serif":        { default: '0.01em',  allCaps: '0.12em',  large: '-0.02em' },
  "'Outfit', sans-serif":               { default: '-0.02em', allCaps: '0.10em',  large: '-0.03em' },
  "'Inter', sans-serif":                { default: '-0.01em', allCaps: '0.10em',  large: '-0.02em' },
};

// Stop words that should not end a line
const BREAK_STOP_WORDS = new Set([
  'a', 'an', 'the', 'of', 'in', 'on', 'at', 'to', 'for', 'by',
  'or', 'and', 'but', 'nor', 'yet', 'so', 'as', 'is', 'it', 'its',
  'if', 'be', 'do', 'my', 'no', 'up',
]);

const TITLE_SCALE = 1.5;

// ─── Font size calculator ─────────────────────────────────────────────────────

function calcFontSize(text, minSize, maxSize, maxWidthPx, avgCharWidth = 0.52) {
  if (!text) return minSize;
  const words = text.split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  const len = text.length;
  const longestWordLength = words.reduce((max, word) => Math.max(max, word.length), 0);
  
  // Rule: Aggressive Hero Expansion for short titles
  // If < 6 words, we want it to practically scream off the pin
  let targetRatio = 0.55;
  if (wordCount < 4)      targetRatio = 1.05; // Ultra-aggressive (3 words or less)
  else if (wordCount < 6) targetRatio = 0.95; // Very aggressive (4-5 words)
  else if (len < 25)      targetRatio = 0.85; 
  else if (len < 45)      targetRatio = 0.70;
  else if (len > 80)      targetRatio = 0.45;

  let longestLine = 0, currentLen = 0;
  for (const word of words) {
    const wl = word.length + 1;
    if (currentLen + wl > 26) { // Tighter tracking for lines
      if (currentLen > longestLine) longestLine = currentLen; 
      currentLen = wl; 
    } else { 
      currentLen += wl; 
    }
  }
  if (currentLen > longestLine) longestLine = currentLen;

  let size = (maxWidthPx * targetRatio) / (longestLine * avgCharWidth);
  size = Math.round(size);
  
  // Rule: Never allow weak titles
  // Premium floor ensures visibility even on busy images
  size = Math.round(size * TITLE_SCALE);

  const strengthFloor =
    wordCount <= 8 ? Math.max(minSize, 81) :
    wordCount <= 12 ? Math.max(minSize, 72) :
    minSize;

  const longestWordCeiling = longestWordLength
    ? Math.floor(maxWidthPx / (longestWordLength * avgCharWidth * 1.08))
    : maxSize;

  return Math.min(maxSize, longestWordCeiling, Math.max(minSize, Math.max(strengthFloor, size)));
}

// ─── Smart line wrap ──────────────────────────────────────────────────────────

function wrapText(text, targetCharsPerLine = 18, options = {}) {
  if (!text) return [];
  const words = text.split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  if (wordCount <= 1) return words;

  const preferredCounts = options.preferredCounts || (text.length <= 58 ? [2, 3] : [3, 2, 4]);
  let best = null;

  for (const count of preferredCounts) {
    if (count > wordCount) continue;
    if (options.maxLines && count > options.maxLines) continue;
    const candidate = bestBalancedLines(words, count, targetCharsPerLine, options);
    if (!candidate) continue;
    if (!best || candidate.score < best.score) best = candidate;
  }

  return best ? best.lines : greedyWrap(words, targetCharsPerLine);
}

function bestBalancedLines(words, lineCount, targetCharsPerLine, options = {}) {
  const partitions = [];

  function walk(start, remaining, current) {
    if (remaining === 1) {
      partitions.push([...current, words.slice(start).join(' ')]);
      return;
    }
    const maxEnd = words.length - remaining + 1;
    for (let end = start + 1; end <= maxEnd; end++) {
      walk(end, remaining - 1, [...current, words.slice(start, end).join(' ')]);
    }
  }

  walk(0, lineCount, []);

  const averageLineLength = Math.ceil(words.join(' ').length / lineCount);
  const target = options.strictTarget
    ? Math.max(targetCharsPerLine, Math.floor(averageLineLength * 0.88))
    : Math.max(targetCharsPerLine, averageLineLength);
  let best = null;

  for (const lines of partitions) {
    const lengths = lines.map(line => line.length);
    const longest = Math.max(...lengths);
    const shortest = Math.min(...lengths);
    const lastWords = lines.map(line => line.trim().split(/\s+/).pop().toLowerCase());
    let score = 0;

    score += (longest - shortest) * 3;
    score += Math.abs(longest - target) * 1.5;
    if (lineCount === 2) score -= options.preferThreeToFour ? 2 : 8;
    if (lineCount === 3) score -= options.preferThreeToFour ? 20 : 4;
    if (lineCount === 4 && options.preferThreeToFour) score -= 12;
    if (shortest < 9) score += 20;
    if (lines.some(line => line.trim().split(/\s+/).length === 1) && lineCount > 2) score += options.strictTarget ? 12 : 0;
    if (lengths.some(len => len > target * (options.strictTarget ? 1.28 : 1.75))) score += options.strictTarget ? 30 : 18;
    if (lastWords.some(word => BREAK_STOP_WORDS.has(word))) score += 16;
    if (lines.at(-1).split(/\s+/).length === 1) score += 28;
    if (options.maxLines && lineCount > options.maxLines) score += 80;

    if (!best || score < best.score) best = { lines, score };
  }

  return best;
}

function greedyWrap(words, targetCharsPerLine) {
  const lines = [];
  let current = '';
  for (const word of words) {
    const trial = (current + ' ' + word).trim();
    if (trial.length > targetCharsPerLine && current) {
      lines.push(current.trim());
      current = word;
    } else {
      current = trial;
    }
  }
  if (current.trim()) lines.push(current.trim());
  return lines;
}

function hasBadWrap(lines, options = {}) {
  if (!Array.isArray(lines) || lines.length === 0) return false;
  const lastLine = String(lines[lines.length - 1] || '').trim();
  const smallestWord = lastLine.split(/\s+/).filter(Boolean).reduce((min, word) => Math.min(min, word.length), Infinity);
  const maxLines = options.maxLines || 5;
  return (
    lines.length > maxLines ||
    lastLine.length <= 3 ||
    smallestWord === 1 ||
    lines.some(line => line.trim().length <= 1)
  );
}

function fitTitleLayout(title, minSize, maxSize, maxWidthPx, template) {
  const avgW = 0.52;
  const scaleMode = getTitleScaleMode(template);
  const effectiveMinSize = scaleMode ? Math.max(minSize, scaleMode.minSize) : minSize;
  const effectiveMaxSize = scaleMode ? Math.min(maxSize, scaleMode.maxSize) : maxSize;
  const initialSize = calcFontSize(title || '', effectiveMinSize, effectiveMaxSize, maxWidthPx, avgW);
  let fontSize = Math.min(maxSize, Math.round(initialSize * (template.titleScale || 1)));
  let wrappedTitle = [];
  if (scaleMode) fontSize = Math.min(scaleMode.maxSize, Math.max(scaleMode.minSize, fontSize));

  while (fontSize >= effectiveMinSize) {
    const charsPerLine = Math.max(8, Math.floor(maxWidthPx / (fontSize * avgW)));
    wrappedTitle = wrapText(title || '', charsPerLine, scaleMode?.wrapOptions);
    if (!hasBadWrap(wrappedTitle, scaleMode?.wrapOptions)) {
      return { fontSize, wrappedTitle };
    }
    fontSize -= 2;
  }

  const fallbackSize = effectiveMinSize;
  const fallbackCharsPerLine = Math.max(8, Math.floor(maxWidthPx / (fallbackSize * avgW)));
  return {
    fontSize: fallbackSize,
    wrappedTitle: wrapText(title || '', fallbackCharsPerLine, scaleMode?.wrapOptions),
  };
}

function getTitleScaleMode(template) {
  const templateId = template.fontPreset || template.id || template.templateId;
  const directScaleTemplates = new Set([
    'upper_third_overlay',
    'top_middle_headline',
    'minimalist_gradient_poster',
    'bold_statement_poster',
  ]);

  if (!directScaleTemplates.has(templateId)) return null;

  return {
    minSize: 58,
    maxSize: 78,
    wrapOptions: {
      preferredCounts: [3, 4, 2],
      maxLines: 4,
      strictTarget: true,
      preferThreeToFour: true,
    },
  };
}

// ─── Hierarchy size enforcer ──────────────────────────────────────────────────
// Ensures title → subtitle → CTA jumps are at least 4px apart,
// and follows the preferred ratios: subtitle ≈ 42% of title, CTA ≈ 36%.

function enforceHierarchy(titleSize) {
  const subtitleRaw = Math.round(titleSize * 0.44);
  const ctaRaw      = Math.round(titleSize * 0.38);

  const subtitle = Math.max(16, subtitleRaw);
  // Ensure at minimum 6px gap for premium hierarchy
  const subtitleFinal = titleSize - subtitle < 6 ? titleSize - 6 : subtitle;

  const cta = Math.max(14, ctaRaw);
  const ctaFinal = subtitleFinal - cta < 6 ? subtitleFinal - 6 : cta;

  return { subtitleSize: subtitleFinal, ctaSize: Math.max(14, ctaFinal) };
}

// ─── 8px Baseline grid ────────────────────────────────────────────────────────

function snap8(value) {
  return Math.round(value / 8) * 8;
}

// ─── Per-font letter-spacing ──────────────────────────────────────────────────

function getLetterSpacing(fontFamily, fontSize, isAllCaps = false) {
  const preset = FONT_TRACKING[fontFamily];
  if (!preset) return isAllCaps ? '0.10em' : '-0.01em';
  if (isAllCaps)    return preset.allCaps;
  if (fontSize > 44) return preset.large;
  return preset.default;
}

// ─── CSS rendering quality helpers ───────────────────────────────────────────

function getTypographyCSS(font, textColor) {
  return `
    text-rendering: optimizeLegibility;
    -webkit-font-smoothing: antialiased;
    font-feature-settings: "liga" 1, "kern" 1, "onum" 1, "ss01" 1;
    -moz-osx-font-smoothing: grayscale;
  `;
}

// ─── Main builder ─────────────────────────────────────────────────────────────

function buildTextVars(template, inputs, pinWidth, pinHeight, analysis) {
  const { title, subtitle, cta, badge, linkLabel, category } = inputs;
  const { titleSizeMin, titleSizeMax, padding, maxTitleWidth } = template;
  const fontPresetKey = template.fontPreset || 'manrope_inter';

  // Rule 1: 48px Minimum Outer Safe Margin
  const SAFE_MARGIN = 48;
  const effectiveWidth = pinWidth - (SAFE_MARGIN * 2);
  const maxWidthPx = effectiveWidth * (parseFloat(maxTitleWidth) / 100);

  const scaledMinSize = Math.round(titleSizeMin * TITLE_SCALE);
  const scaledMaxSize = Math.round(titleSizeMax * TITLE_SCALE);
  const fittedTitle = fitTitleLayout(title || '', scaledMinSize, scaledMaxSize, maxWidthPx, template);
  const fontSize = fittedTitle.fontSize;

  const { subtitleSize, ctaSize } = enforceHierarchy(fontSize);
  const categorySize = Math.max(12, Math.round(fontSize * 0.24));
  const baseLineHeight = fontSize > 88 ? 0.96 : fontSize > 68 ? 1.0 : fontSize > 52 ? 1.04 : fontSize > 36 ? 1.10 : 1.16;
  const lineHeight = Math.min(1.18, baseLineHeight + (template.lineHeightBoost || 0));

  // Smart chars per line for wrapping
  const avgW = 0.52;
  const charsPerLine = Math.max(8, Math.floor(maxWidthPx / (fontSize * avgW)));
  const wrappedTitle    = fittedTitle.wrappedTitle;
  const wrappedSubtitle = subtitle ? wrapText(subtitle, Math.floor(charsPerLine * 1.4)) : [];

  // 8px-snapped spacing
  const paddingX = Math.max(SAFE_MARGIN, snap8(padding.x));
  const paddingY = Math.max(SAFE_MARGIN, snap8(padding.y));
  const titleMarginBottom    = snap8(Math.round(fontSize * 0.28));
  const subtitleMarginBottom = snap8(Math.round(subtitleSize * 0.65));
  const sectionGap           = snap8(Math.round(fontSize * 0.48));

  // Determine text color: respect template override, but fall back to analysis auto-color
  const textColor = analysis?.autoTextColor || template.textColor || '#ffffff';

  return {
    fontSize,
    subtitleSize,
    ctaSize,
    categorySize,
    lineHeight,
    wrappedTitle,
    wrappedSubtitle,
    paddingX,
    paddingY,
    maxTitleWidth: `${Math.round((maxWidthPx / pinWidth) * 100)}%`, // Adaptive width
    titleMarginBottom,
    subtitleMarginBottom,
    sectionGap,
    fontPresetKey,
    hasSubtitle: !!subtitle,
    hasCta:      !!cta,
    hasBadge:    !!badge,
    hasLinkLabel:!!linkLabel,
    hasCategory: !!category,
    ctaText:       cta       || '',
    badgeText:     badge     || '',
    linkLabelText: linkLabel || '',
    categoryText:  category  || '',
    titleLines:    wrappedTitle.length,
    autoTextColor: textColor,
  };
}

// ─── Quality check ────────────────────────────────────────────────────────────

function qualityCheck(textVars, template, analysis) {
  const warnings = [];

  const scaleMode = getTitleScaleMode(template);
  const maxTitleLines = scaleMode?.wrapOptions?.maxLines || 5;
  if (textVars.titleLines > maxTitleLines)
    warnings.push({ type: 'overflow',     msg: `Title may overflow: too many lines (>${maxTitleLines})` });

  if (textVars.fontSize < 24)
    warnings.push({ type: 'readability',  msg: 'Font size very small — may be hard to read on mobile' });

  if (template.textColor === '#ffffff' && template.overlay === 'none' && analysis?.isLight)
    warnings.push({ type: 'contrast',     msg: 'White text on light image without overlay — low contrast' });

  if (template.textColor !== '#ffffff' && template.overlay === 'none' && analysis?.isDark)
    warnings.push({ type: 'contrast',     msg: 'Dark text on dark image without overlay — low contrast' });

  if (parseFloat(template.maxTitleWidth) > 88)
    warnings.push({ type: 'layout',       msg: 'Title block very wide — may look unprofessional' });

  if (textVars.titleLines === 1 && textVars.fontSize < 30)
    warnings.push({ type: 'readability',  msg: 'Single line title with small font — consider larger size' });

  // Hierarchy check
  if (textVars.fontSize - textVars.subtitleSize < 4)
    warnings.push({ type: 'hierarchy',    msg: 'Title and subtitle size too close — hierarchy unclear' });

  return warnings;
}

module.exports = {
  calcFontSize,
  wrapText,
  buildTextVars,
  qualityCheck,
  getLetterSpacing,
  getTypographyCSS,
  snap8,
  enforceHierarchy,
};
