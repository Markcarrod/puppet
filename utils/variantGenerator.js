/**
 * Variant Generator — builds render recipe combinations
 * rotating template, font, overlay, opacity, spacing.
 * All variation is controlled and premium — no random junk.
 */

const { TEMPLATE_FAMILIES, FONT_PRESETS, OVERLAY_TYPES, PIN_SIZES } = require('../configs/templates');
const { scoreTemplates } = require('./imageAnalyzer');

const OPACITY_VARIANTS = [0.72, 0.82, 0.90];
const SPACING_VARIANTS = ['tight', 'normal', 'airy'];

const TEMPLATE_PRIORITY = {
  luxury_desk_headline: 100,
  center_white_sheet: 96,
  lower_third_card: 94,
  floating_soft_panel: 92,
  upper_third_overlay: 86,
  top_middle_headline: 82,
  gradient_editorial: 78,
  premium_article_cover: 76,
  left_editorial_column: 72,
  minimalist_gradient_poster: 70,
  soft_magazine: 58,
};

const GROUPS = {
  tierA: ['luxury_desk_headline', 'center_white_sheet', 'lower_third_card', 'floating_soft_panel'],
  upper: ['upper_third_overlay', 'top_middle_headline', 'luxury_desk_headline'],
  white: ['center_white_sheet', 'lower_third_card', 'floating_soft_panel', 'soft_magazine'],
  editorial: ['gradient_editorial', 'premium_article_cover', 'left_editorial_column', 'minimalist_gradient_poster'],
};

const { buildTextVars, qualityCheck } = require('./textEngine');

/**
 * Generate a set of premium variant recipes for one image + title combo.
 * Rule 7: Best balanced variant first.
 * Rule 13: Reject weak variants (overflow, poor contrast, bad rhythm).
 */
function generateVariants(analysis, inputs, options = {}) {
  const {
    maxVariants = 8,
    templateMode = 'auto', 
    pinSize = 'standard',
  } = options;

  const size = PIN_SIZES[pinSize] || PIN_SIZES.standard;
  const scoredTemplates = scoreTemplates(analysis, inputs.title, TEMPLATE_FAMILIES);
  let pool = [];

  const candidates = templateMode !== 'auto' 
    ? [{ id: templateMode, score: 100 }] 
    : scoredTemplates;

  candidates.forEach(({ id }) => {
    const tmpl = TEMPLATE_FAMILIES[id];
    if (!tmpl) return;

    // Generate specific permutations per template
    OPACITY_VARIANTS.forEach(opacity => {
      SPACING_VARIANTS.forEach(spacing => {
        const recipe = buildRecipe(tmpl, inputs, analysis, size, opacity, spacing, `${id}_${opacity}_${spacing}`);
        
        // Rule 13: Reject weak variants automatically
        const vars = buildTextVars(recipe.layout, recipe.inputs, size.width, size.height, analysis);
        const warnings = qualityCheck(vars, recipe.layout, analysis);
        
        const isCritical = warnings.some(w => ['overflow', 'contrast'].includes(w.type));
        if (!isCritical) {
          recipe.qualityScore = scoreRecipe(recipe, vars, analysis, warnings);
          pool.push(recipe);
        }
      });
    });
  });

  // Rule 7: Sort by CTR/readability quality score (Best First)
  pool.sort((a, b) => b.qualityScore - a.qualityScore);

  return templateMode !== 'auto'
    ? pool.slice(0, maxVariants)
    : selectAutoMix(pool, maxVariants);
}

/**
 * Score a recipe for composition excellence.
 */
function scoreRecipe(recipe, textVars, analysis, warnings) {
  let score = TEMPLATE_PRIORITY[recipe.templateId] || 65;

  // Penalty for any warning
  score -= warnings.length * 18;

  // Rule 2: Rhythm Bonus (Perfect 2-3 lines)
  if (textVars.titleLines >= 2 && textVars.titleLines <= 3) score += 25;
  if (textVars.titleLines === 1) score += 10;
  if (textVars.titleLines > 4) score -= 30;

  score += scorePlacement(recipe, analysis);

  // Mobile readability (Font size)
  if (textVars.fontSize >= 72) score += 18;
  else if (textVars.fontSize >= 56) score += 12;
  if (textVars.fontSize < 42) score -= 25;

  // Rule 9: Contrast Ready bonus
  if (analysis.highContrastReady) score += 20;

  // Variety bonus for using dominant colors
  if (analysis.dominantColor?.isSaturated) score += 10;

  return score;
}

function selectAutoMix(pool, maxVariants) {
  const results = [];
  const used = new Set();
  const templateCounts = new Map();

  const addFrom = (ids, count, maxPerTemplate = 2) => {
    for (const recipe of pool) {
      if (results.length >= maxVariants || count <= 0) break;
      if (!ids.includes(recipe.templateId)) continue;
      if (used.has(recipe.variantId)) continue;
      if ((templateCounts.get(recipe.templateId) || 0) >= maxPerTemplate) continue;
      results.push(recipe);
      used.add(recipe.variantId);
      templateCounts.set(recipe.templateId, (templateCounts.get(recipe.templateId) || 0) + 1);
      count--;
    }
  };

  const tierACount = Math.max(3, Math.round(maxVariants * 0.45));
  const upperCount = Math.max(1, Math.round(maxVariants * 0.25));
  const whiteCount = Math.max(1, Math.round(maxVariants * 0.15));
  const editorialCount = Math.max(1, maxVariants - tierACount - upperCount - whiteCount);

  addFrom(GROUPS.tierA, tierACount, 2);
  addFrom(GROUPS.upper, upperCount, 2);
  addFrom(GROUPS.white, whiteCount, 2);
  addFrom(GROUPS.editorial, editorialCount, 1);

  for (const recipe of pool) {
    if (results.length >= maxVariants) break;
    if (used.has(recipe.variantId)) continue;
    results.push(recipe);
    used.add(recipe.variantId);
  }

  return results;
}

function scorePlacement(recipe, analysis) {
  let score = 0;
  const position = recipe.layout.textPosition || 'center';
  const overlayType = recipe.overlay?.type || 'none';
  const zoneCells = getTextZoneGridCells(position);
  const conflicts = zoneCells.filter(c => analysis.avoidGridCells?.includes(c)).length;
  const safeHits = zoneCells.filter(c => analysis.safeGridCells?.includes(c)).length;
  const hasReadableBacking = ['sheet', 'card', 'lower', 'panel'].includes(overlayType);

  score += safeHits * 10;
  score -= conflicts * 18;

  if (hasReadableBacking && conflicts > 0) score += 22;
  if (!hasReadableBacking && conflicts > 0) score -= 18;
  if (position.includes('upper') && analysis.hasCleanTop) score += 18;
  if (position.includes('upper') && analysis.hasDarkTop) score += 12;
  if (position.includes('lower') && analysis.hasCleanBottom) score += 14;
  if (position.includes('lower') && analysis.hasDarkBottom) score += 16;
  if (position === 'center' && analysis.hasCleanCenter) score += 18;
  if (position === 'center' && analysis.centerVariance > 45 && !hasReadableBacking) score -= 24;
  if (position === 'left' && analysis.avoidGridCells?.some(c => c.endsWith('_0'))) score -= 26;
  if (analysis.isLight && recipe.layout.textColor === '#ffffff' && !hasReadableBacking) score -= 24;
  if (analysis.isDark && hasReadableBacking) score += 12;

  return score;
}

function getTextZoneGridCells(textPosition) {
  const map = {
    upper: ['0_0', '0_1', '0_2'],
    'upper-center': ['0_1'],
    'upper-left': ['0_0', '0_1'],
    center: ['1_0', '1_1', '1_2'],
    lower: ['2_0', '2_1', '2_2'],
    'lower-center': ['2_1'],
    left: ['0_0', '1_0', '2_0'],
  };
  return map[textPosition] || ['1_1'];
}

/**
 * Build a single render recipe object.
 */
function buildRecipe(template, inputs, analysis, size, overlayOpacity, spacing, variantId) {
  const spacingMap = {
    tight: { titleMarginBottom: 10, subtitleMarginBottom: 12, sectionGap: 16 },
    normal: { titleMarginBottom: 16, subtitleMarginBottom: 22, sectionGap: 32 },
    airy: { titleMarginBottom: 32, subtitleMarginBottom: 36, sectionGap: 48 },
  };
  const spacingVars = spacingMap[spacing] || spacingMap.normal;

  // Adaptive Opacity Refinement
  const finalOpacity = Math.min(0.96, Math.max(0.65, analysis.adaptiveOverlayOpacity + (overlayOpacity - 0.82)));
  const overlayConfig = resolveOverlay(template, finalOpacity);

  const fontPreset = FONT_PRESETS[template.fontPreset] || FONT_PRESETS.manrope_inter;

  return {
    variantId,
    templateId: template.id,
    templateName: template.name,
    size,
    inputs: { ...inputs },
    layout: {
      textPosition: template.textPosition,
      textAlign: template.textAlign,
      maxTitleWidth: template.maxTitleWidth,
      titleSizeMin: template.titleSizeMin,
      titleSizeMax: template.titleSizeMax,
      padding: template.padding,
      textShadow: template.textShadow,
      textColor: template.textColor,
      gradientOverlay: template.gradientOverlay,
      badgePosition: template.badgePosition,
      overlayWidth: template.overlayWidth,
      overlayHeight: template.overlayHeight,
      overlayPaddingX: template.overlayPaddingX,
      overlayPaddingY: template.overlayPaddingY,
      columnWidth: template.columnWidth,
      panelWidth: template.panelWidth,
      panelRadius: template.panelRadius,
      colorPalette: template.colorPalette,
      showHRule: template.showHRule,
      coverLiftPx: template.coverLiftPx,
      lineHeightBoost: template.lineHeightBoost,
      titleScale: template.titleScale,
    },
    overlay: overlayConfig,
    font: fontPreset,
    spacing: spacingVars,
    analysis,
    meta: {
      spacing,
      overlayOpacity: finalOpacity,
      generatedAt: new Date().toISOString(),
    },
  };
}

function resolveOverlay(template, opacity) {
  const { OVERLAY_TYPES } = require('../configs/templates');
  const ot = OVERLAY_TYPES[template.overlay] || OVERLAY_TYPES.none;

  if (ot.type === 'none') return { type: 'none' };

  // Apply dynamic opacity to background color
  let bg = ot.bg;
  if (bg && bg.startsWith('rgba')) {
    // Replace last alpha value
    bg = bg.replace(/rgba\(([^,]+),([^,]+),([^,]+),[^)]+\)/, `rgba($1,$2,$3,${opacity})`);
  }

  return {
    type: ot.type,
    bg,
    blur: ot.blur,
    opacity,
  };
}

module.exports = { generateVariants };
