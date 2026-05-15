/**
 * Enhanced HTML Template Builder
 * Additions:
 * - CSS text-rendering optimizeLegibility + font-feature-settings
 * - Per-font letter-spacing from preset
 * - Thin horizontal rule between title and subtitle
 * - Small-caps category/badge labels
 * - Pill-style CTA (open border, no fill, wide tracking)
 * - Adaptive overlay opacity baked in from analysis
 * - Gradient fade overlays
 * - Card edge treatment (hard / soft / feathered)
 * - Enforced 48px minimum edge clearance
 */

const { buildTextVars, qualityCheck, getLetterSpacing } = require('../utils/textEngine');
const { FONT_PRESETS, COLOR_PALETTES, OVERLAY_TYPES } = require('../configs/templates');

const GOOGLE_FONTS_URL = [
  'https://fonts.googleapis.com/css2?',
  'family=Manrope:wght@400;500;600;700;800&',
  'family=Inter:wght@300;400;500;600&',
  'family=Playfair+Display:wght@500;600;700&',
  'family=Plus+Jakarta+Sans:wght@400;500;600;700&',
  'family=DM+Sans:wght@300;400;500&',
  'family=Cormorant+Garamond:wght@300;400;500;600&',
  'family=Outfit:wght@300;400;600;700;800&',
  'display=swap',
].join('');

/**
 * Build the full HTML string for Puppeteer rendering.
 * @param {Object} recipe
 * @param {string} imageDataUrl
 */
function buildPinHTML(recipe, imageDataUrl) {
  const { size, layout, overlay, font, spacing, inputs, templateId } = recipe;
  const { width, height } = size;

  // Resolve font preset object
  const fontObj = typeof font === 'object' ? font : FONT_PRESETS[font] || FONT_PRESETS.manrope_inter;

  const textVars = buildTextVars(
    {
      ...layout,
      fontPreset: recipe.templateId, // pass through for lookup
    },
    inputs,
    width,
    height,
    recipe.analysis
  );

  // Resolve overlay with adaptive opacity
  const overlayConfig = resolveOverlay(overlay, recipe.analysis?.adaptiveOverlayOpacity);

  // Resolve color palette
  const palette = layout.colorPalette ? COLOR_PALETTES[layout.colorPalette] : null;

  // Dominant/Accent color logic
  const dominant = recipe.analysis?.dominantColor;
  const useAccent = dominant?.isSaturated;
  const accentColor = layout.accentColor || (useAccent ? dominant.hex : (palette ? palette.accent : (recipe.analysis?.autoTextColor || '#ffffff')));

  const textColor = palette ? palette.text : (recipe.analysis?.autoTextColor || '#ffffff');
  const subColor  = palette ? palette.sub  : textColor;

  const layoutHTML   = buildLayoutHTML(templateId, recipe, textVars, textColor, subColor, fontObj, overlayConfig, accentColor);
  const templateCSS  = buildTemplateStyle(templateId, recipe, textVars, width, height, overlayConfig, accentColor);
  const readabilityScrim = buildReadabilityScrim(templateId, layout, overlayConfig, recipe.analysis, textColor);

  // Letter-spacing derived from font preset
  const titleTracking = getLetterSpacing(fontObj.heading, textVars.fontSize, false);
  const capTracking   = fontObj.altCapsTracking || '0.10em';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Pin</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="${GOOGLE_FONTS_URL}" rel="stylesheet">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    width: ${width}px;
    height: ${height}px;
    overflow: hidden;
    font-family: ${fontObj.body};
    background: #111;
  }

  .pin-root {
    position: relative;
    width: ${width}px;
    height: ${height}px;
    overflow: hidden;
    /* Rule 1: Visual Safe Zone Reinforcement */
    padding: 48px;
  }

  .pin-bg {
    position: absolute;
    inset: 0;
    background-image: url("${imageDataUrl}");
    background-size: cover;
    background-position: center;
    transform: scale(1.02);
    z-index: 1;
  }

  ${layout.gradientOverlay ? `
  .pin-veil {
    position: absolute;
    inset: 0;
    background: ${layout.gradientOverlay};
    z-index: 2;
  }` : ''}

  ${readabilityScrim.css}

  ${templateCSS}

  /* ── Typography ── */
  .pin-title {
    font-family: ${fontObj.heading};
    font-weight: ${fontObj.headingWeight};
    font-size: ${textVars.fontSize}px;
    line-height: ${textVars.lineHeight};
    color: ${textColor};
    text-shadow: ${layout.textShadow !== 'none' ? layout.textShadow : 'none'};
    letter-spacing: ${titleTracking};
    max-width: ${layout.maxTitleWidth};
    word-break: normal;
    overflow-wrap: normal;
    hyphens: none;
    text-rendering: optimizeLegibility;
    -webkit-font-smoothing: antialiased;
    font-feature-settings: "liga" 1, "kern" 1;
    -moz-osx-font-smoothing: grayscale;
  }

  .pin-title-line {
    display: block;
  }

  .pin-hrule {
    width: 40px;
    height: 1px;
    background: ${accentColor || textColor};
    opacity: ${accentColor ? 0.70 : 0.28};
    margin: ${textVars.titleMarginBottom}px 0;
    flex-shrink: 0;
  }

  .pin-subtitle {
    font-family: ${fontObj.body};
    font-weight: ${fontObj.bodyWeight};
    font-size: ${textVars.subtitleSize}px;
    line-height: 1.5;
    color: ${subColor};
    opacity: 0.82;
    ${!layout.showHRule ? `margin-top: ${textVars.titleMarginBottom}px;` : ''}
    max-width: ${layout.maxTitleWidth};
    text-rendering: optimizeLegibility;
    -webkit-font-smoothing: antialiased;
    font-feature-settings: "liga" 1, "kern" 1;
  }

  .pin-checklist {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 14px;
    width: 100%;
    max-width: ${layout.maxTitleWidth};
    margin-top: ${layout.showHRule ? 0 : textVars.titleMarginBottom}px;
  }

  .pin-checklist li {
    position: relative;
    padding-left: 36px;
    font-family: ${fontObj.body};
    font-weight: 600;
    font-size: ${Math.max(20, Math.round(textVars.subtitleSize * 0.86))}px;
    line-height: 1.35;
    color: ${subColor};
    text-rendering: optimizeLegibility;
  }

  .pin-checklist li::before {
    content: '';
    position: absolute;
    left: 0;
    top: 0.23em;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    border: 2px solid ${accentColor || textColor};
    background: radial-gradient(circle at center, ${accentColor || textColor} 0 38%, transparent 42%);
  }

  .pin-category {
    font-family: ${fontObj.body};
    font-size: ${textVars.categorySize}px;
    font-weight: 700;
    font-variant: small-caps;
    letter-spacing: ${capTracking};
    text-transform: uppercase;
    color: ${textColor};
    opacity: 0.60;
    margin-bottom: ${Math.round(textVars.titleMarginBottom * 0.75)}px;
    text-rendering: optimizeLegibility;
  }

  .pin-cta {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-family: ${fontObj.body};
    font-size: ${textVars.ctaSize}px;
    font-weight: 600;
    letter-spacing: ${capTracking};
    text-transform: uppercase;
    color: ${accentColor || textColor};
    margin-top: ${textVars.subtitleMarginBottom}px;
    opacity: 0.88;
    border: 1px solid ${accentColor || textColor};
    border-radius: 100px;
    padding: 7px 20px;
    width: fit-content;
  }

  .pin-cta::after {
    content: '→';
    font-size: ${textVars.ctaSize + 2}px;
    letter-spacing: 0;
  }

  .pin-badge {
    display: inline-block;
    font-family: ${fontObj.body};
    font-size: ${Math.max(10, textVars.categorySize)}px;
    font-weight: 700;
    font-variant: small-caps;
    letter-spacing: ${capTracking};
    text-transform: uppercase;
    padding: 5px 14px;
    border-radius: 100px;
    background: rgba(255,255,255,0.16);
    color: ${textColor};
    backdrop-filter: blur(4px);
    border: 1px solid rgba(255,255,255,0.28);
    margin-bottom: ${textVars.sectionGap}px;
  }

  .pin-link-label {
    font-family: ${fontObj.body};
    font-size: ${Math.max(10, textVars.categorySize - 1)}px;
    font-weight: 500;
    color: ${textColor};
    opacity: 0.48;
    margin-top: ${textVars.subtitleMarginBottom}px;
    letter-spacing: 0.04em;
  }

  .title-block {
    margin-bottom: ${textVars.titleMarginBottom}px;
  }

  .number-mark {
    font-family: ${fontObj.heading};
    font-weight: 800;
    color: ${accentColor || textColor};
    letter-spacing: -0.04em;
    line-height: 0.86;
  }
</style>
</head>
<body>
<div class="pin-root" id="pin-root">
  <div class="pin-bg"></div>
  ${layout.gradientOverlay ? '<div class="pin-veil"></div>' : ''}
  ${readabilityScrim.html}
  ${layoutHTML}
</div>
</body>
</html>`;
}

// ─── Overlay Resolver ─────────────────────────────────────────────────────────

function resolveOverlay(overlayObj, adaptiveOpacity) {
  if (!overlayObj || overlayObj.type === 'none') return { type: 'none' };

  let { type, bg, blur, edge, radius } = overlayObj;
  const opacity = adaptiveOpacity || overlayObj.opacity || 0.82;

  // Apply adaptive opacity to rgba backgrounds
  if (bg && bg.startsWith('rgba')) {
    bg = bg.replace(/rgba\(([^,]+),([^,]+),([^,]+),[^)]+\)/, `rgba($1,$2,$3,${opacity})`);
  }

  return { type, bg, blur: blur || '0px', edge: edge || 'soft', radius: radius || '0px', opacity };
}

function buildReadabilityScrim(templateId, layout, overlay, analysis, textColor) {
  if (!needsReadabilityScrim(templateId, layout, overlay, analysis, textColor)) {
    return { css: '', html: '' };
  }

  const position = layout.textPosition || 'center';
  const brightness = getTextZoneBrightness(position, analysis);
  const variance = getTextZoneVariance(position, analysis);
  const lightText = isLightText(textColor);
  const alpha = lightText
    ? clamp(0.22 + ((brightness - 118) / 255) + (variance / 320), 0.26, 0.48)
    : clamp(0.16 + ((140 - brightness) / 260) + (variance / 420), 0.18, 0.34);
  const softAlpha = Math.max(lightText ? 0.08 : 0.06, alpha - (lightText ? 0.18 : 0.12));
  const rgb = lightText ? '0,0,0' : '255,255,255';

  let css;
  if (position.includes('upper')) {
    css = `
  .pin-readability-scrim {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 48%;
    z-index: 3;
    background: linear-gradient(to bottom, rgba(${rgb},${alpha.toFixed(2)}) 0%, rgba(${rgb},${softAlpha.toFixed(2)}) 58%, transparent 100%);
    pointer-events: none;
  }`;
  } else if (position.includes('lower')) {
    css = `
  .pin-readability-scrim {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 54%;
    z-index: 3;
    background: linear-gradient(to top, rgba(${rgb},${alpha.toFixed(2)}) 0%, rgba(${rgb},${softAlpha.toFixed(2)}) 62%, transparent 100%);
    pointer-events: none;
  }`;
  } else {
    css = `
  .pin-readability-scrim {
    position: absolute;
    inset: 0;
    z-index: 3;
    background: radial-gradient(ellipse at center, rgba(${rgb},${alpha.toFixed(2)}) 0%, rgba(${rgb},${softAlpha.toFixed(2)}) 42%, transparent 72%);
    pointer-events: none;
  }`;
  }

  return { css, html: '<div class="pin-readability-scrim"></div>' };
}

function needsReadabilityScrim(templateId, layout, overlay, analysis, textColor) {
  if (!analysis) return false;
  if (hasReadableBacking(overlay)) return false;

  const directTemplates = new Set([
    'upper_third_overlay',
    'top_middle_headline',
    'minimalist_gradient_poster',
    'bold_statement_poster',
  ]);
  if (!directTemplates.has(templateId)) return false;
  if (overlay?.type !== 'none' && overlay?.type !== 'fade') return false;

  const position = layout.textPosition || 'center';
  const brightness = getTextZoneBrightness(position, analysis);
  const variance = getTextZoneVariance(position, analysis);
  if (isLightText(textColor)) {
    return brightness > 118 || variance > 46 || analysis.isLight;
  }
  return brightness > 135 || brightness < 105 || variance > 38 || analysis.isLight || analysis.busyZones?.length > 0;
}

function hasReadableBacking(overlay) {
  return ['sheet', 'card', 'lower', 'panel', 'side'].includes(overlay?.type);
}

function isLightText(color) {
  const normalized = String(color || '').trim().toLowerCase();
  return ['#fff', '#ffffff', '#fafaf8', '#f8efe0', '#f5f5f0', '#f5f0e8'].includes(normalized);
}

function getTextZoneBrightness(position, analysis) {
  const zones = analysis?.zones || {};
  if (position.includes('upper')) return averageZone(zones.top, zones.upperMid, analysis.topBrightness);
  if (position.includes('lower')) return averageZone(zones.lowerMid, zones.bottom, analysis.bottomBrightness);
  return zones.center?.brightness ?? analysis.avgBrightness ?? 128;
}

function getTextZoneVariance(position, analysis) {
  const zones = analysis?.zones || {};
  if (position.includes('upper')) return averageZoneVariance(zones.top, zones.upperMid);
  if (position.includes('lower')) return averageZoneVariance(zones.lowerMid, zones.bottom);
  return zones.center?.variance ?? analysis.centerVariance ?? 0;
}

function averageZone(a, b, fallback = 128) {
  const values = [a?.brightness, b?.brightness].filter(Number.isFinite);
  if (!values.length) return fallback;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function averageZoneVariance(a, b) {
  const values = [a?.variance, b?.variance].filter(Number.isFinite);
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// ─── Layout HTML ──────────────────────────────────────────────────────────────

function buildLayoutHTML(templateId, recipe, textVars, textColor, subColor, fontObj, overlay, accentColor) {
  const { inputs, layout } = recipe;

  const titleText = textVars.wrappedTitle?.length
    ? textVars.wrappedTitle.map(line => `<span class="pin-title-line">${esc(line)}</span>`).join('')
    : esc(inputs.title);

  const titleEl = inputs.title
    ? `<div class="pin-title title-block">${titleText}</div>`
    : '';

  const hRule = layout.showHRule && inputs.subtitle
    ? `<div class="pin-hrule"></div>`
    : '';

  const subtitleEl = buildSubtitleHTML(inputs.subtitle, layout.contentStyle);

  const categoryEl = inputs.category
    ? `<div class="pin-category">${esc(inputs.category)}</div>`
    : '';

  const ctaEl = inputs.cta
    ? `<div class="pin-cta">${esc(inputs.cta)}</div>`
    : '';

  const badgeEl = inputs.badge
    ? `<div class="pin-badge">${esc(inputs.badge)}</div>`
    : '';

  const linkEl = inputs.linkLabel
    ? `<div class="pin-link-label">${esc(inputs.linkLabel)}</div>`
    : '';

  const inner = `${categoryEl}${badgeEl}${titleEl}${hRule}${subtitleEl}${ctaEl}${linkEl}`;

  switch (templateId) {
    case 'upper_third_overlay':
    case 'top_middle_headline':
      return `<div class="text-zone">${inner}</div>`;

    case 'center_white_sheet':
    case 'floating_soft_panel':
    case 'checklist_card':
    case 'dark_glass_finance':
      return `<div class="overlay-panel"><div class="overlay-inner">${inner}</div></div>`;

    case 'lower_third_card':
    case 'numbered_list_feature':
      if (templateId === 'numbered_list_feature') {
        const { number, title } = splitLeadingNumber(inputs.title);
        const numberedTitle = title
          ? `<div class="pin-title title-block">${textVars.wrappedTitle?.length ? textVars.wrappedTitle.map(line => `<span class="pin-title-line">${esc(line.replace(/^\s*\d+[\).:\-\s]*/, ''))}</span>`).join('') : esc(title)}</div>`
          : titleEl;
        return `<div class="number-card"><div class="number-mark">${esc(number || '01')}</div><div class="number-content">${categoryEl}${badgeEl}${numberedTitle}${hRule}${subtitleEl}${ctaEl}${linkEl}</div></div>`;
      }
      return `<div class="lower-card"><div class="lower-card-inner">${inner}</div></div>`;

    case 'soft_magazine':
    case 'gradient_editorial':
    case 'premium_article_cover':
      return `<div class="article-cover"><div class="cover-inner">${inner}</div></div>`;

    case 'left_editorial_column':
    case 'split_hero_editorial':
      return `<div class="editorial-column"><div class="column-inner">${inner}</div></div>`;

    case 'luxury_desk_headline':
      return `<div class="luxury-panel"><div class="luxury-inner">${inner}</div></div>`;

    case 'minimalist_gradient_poster':
    case 'bold_statement_poster':
      return `<div class="poster-center"><div class="poster-inner">${inner}</div></div>`;

    default:
      return `<div class="text-zone">${inner}</div>`;
  }
}

function buildSubtitleHTML(subtitle, contentStyle) {
  if (!subtitle) return '';

  if (contentStyle === 'checklist') {
    const items = String(subtitle)
      .split(/\r?\n|[;|]/)
      .map(item => item.replace(/^[-*•\s]+/, '').trim())
      .filter(Boolean)
      .slice(0, 5);

    if (items.length > 1) {
      return `<ul class="pin-checklist">${items.map(item => `<li>${esc(item)}</li>`).join('')}</ul>`;
    }
  }

  return `<div class="pin-subtitle">${esc(subtitle)}</div>`;
}

function splitLeadingNumber(title) {
  const match = String(title || '').match(/^\s*(\d+)[\).:\-\s]*(.*)$/);
  return match ? { number: match[1], title: match[2].trim() } : { number: '', title: title || '' };
}

// ─── Template CSS ─────────────────────────────────────────────────────────────

function buildTemplateStyle(templateId, recipe, textVars, w, h, overlay, accentColor) {
  const { layout } = recipe;
  const px    = textVars.paddingX;
  const py    = textVars.paddingY;
  const align = layout.textAlign || 'left';
  const flexAlign = align === 'center' ? 'center' : 'flex-start';

  // Card border treatment
  const edgeCSS = overlay.edge === 'feathered'
    ? 'mask-image: linear-gradient(to top, transparent 0%, black 12%, black 100%);'
    : '';

  const overlayBg   = overlay.type !== 'none' ? overlay.bg  : 'transparent';
  const overlayBlur = overlay.type !== 'none' ? overlay.blur : '0px';
  const borderRadius = overlay.radius || '0px';

  switch (templateId) {

    case 'upper_third_overlay':
      return `
      .text-zone {
        position: absolute; top: ${py}px; left: ${px}px; right: ${px}px;
        z-index: 10; text-align: ${align};
        display: flex; flex-direction: column; align-items: ${flexAlign};
        max-width: ${layout.maxTitleWidth};
      }`;

    case 'top_middle_headline':
      return `
      .text-zone {
        position: absolute; top: ${py}px; left: 50%; transform: translateX(-50%);
        width: min(90%, ${layout.maxTitleWidth}); z-index: 10; text-align: center;
        display: flex; flex-direction: column; align-items: center;
      }`;

    case 'center_white_sheet':
      return `
      .overlay-panel {
        position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
        width: min(85%, ${layout.overlayWidth || '78%'});
        background: ${overlayBg};
        backdrop-filter: blur(${overlayBlur}); -webkit-backdrop-filter: blur(${overlayBlur});
        border-radius: 12px; z-index: 10;
        padding: ${Math.round(py * 1.5)}px ${Math.round(px * 1.2)}px;
        box-shadow: 0 10px 40px rgba(0,0,0,0.1);
        ${edgeCSS}
      }
      .overlay-inner { display: flex; flex-direction: column; align-items: ${flexAlign}; text-align: ${align}; }`;

    case 'lower_third_card':
      return `
      .lower-card {
        position: absolute; bottom: 0; left: 0; right: 0;
        min-height: ${layout.overlayHeight || '35%'};
        background: ${overlayBg};
        backdrop-filter: blur(${overlayBlur}); -webkit-backdrop-filter: blur(${overlayBlur});
        z-index: 10; display: flex; align-items: center;
        padding: ${Math.round(py * 1.2)}px ${px}px;
        border-top: 1px solid rgba(255,255,255,0.08);
        ${edgeCSS}
      }
      .lower-card-inner { display: flex; flex-direction: column; text-align: ${align}; align-items: ${flexAlign}; width: 100%; }`;

    case 'numbered_list_feature':
      return `
      .number-card {
        position: absolute; left: 0; right: 0; bottom: 0;
        min-height: ${layout.overlayHeight || '46%'};
        background: ${overlayBg};
        backdrop-filter: blur(${overlayBlur}); -webkit-backdrop-filter: blur(${overlayBlur});
        z-index: 10;
        display: grid;
        grid-template-columns: minmax(180px, 0.34fr) 1fr;
        align-items: center;
        gap: 36px;
        padding: ${Math.round(py * 1.05)}px ${px}px;
        border-top: 1px solid rgba(15,23,42,0.08);
      }
      .number-mark { font-size: ${Math.max(150, Math.round(textVars.fontSize * 2.15))}px; }
      .number-content {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        text-align: left;
        min-width: 0;
      }`;

    case 'left_editorial_column':
      return `
      .editorial-column {
        position: absolute; top: 0; left: 0; bottom: 0; width: ${layout.columnWidth || '48%'};
        background: ${overlayBg};
        backdrop-filter: blur(${overlayBlur}); -webkit-backdrop-filter: blur(${overlayBlur});
        z-index: 10; display: flex; align-items: center;
        padding: ${py}px ${px}px;
        border-right: 1px solid rgba(255,255,255,0.08);
        ${edgeCSS}
      }
      .column-inner { display: flex; flex-direction: column; align-items: flex-start; width: 100%; }`;

    case 'split_hero_editorial':
      return `
      .editorial-column {
        position: absolute; top: 0; left: 0; bottom: 0; width: ${layout.sideWidth || '58%'};
        background: ${overlayBg};
        z-index: 10; display: flex; align-items: center;
        padding: ${Math.round(py * 1.05)}px ${px}px;
      }
      .editorial-column::after {
        content: '';
        position: absolute;
        top: 0; right: -1px; bottom: 0; width: 1px;
        background: rgba(17,17,17,0.08);
      }
      .column-inner {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        width: min(92%, 460px);
      }
      .editorial-column .pin-title,
      .editorial-column .pin-subtitle,
      .editorial-column .pin-checklist {
        max-width: 100%;
      }`;

    case 'floating_soft_panel':
      const pRadius = layout.panelRadius || '32px';
      return `
      .overlay-panel {
        position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
        width: min(82%, ${layout.panelWidth || '72%'});
        background: ${overlayBg};
        backdrop-filter: blur(${overlayBlur}); -webkit-backdrop-filter: blur(${overlayBlur});
        border-radius: ${pRadius};
        z-index: 10; padding: ${Math.round(py * 1.5)}px ${Math.round(px * 1.3)}px;
        box-shadow: 0 30px 90px rgba(0,0,0,0.12), 0 4px 16px rgba(0,0,0,0.06);
        border: 1px solid rgba(255,255,255,0.35);
        ${edgeCSS}
      }
      .overlay-inner { display: flex; flex-direction: column; align-items: center; text-align: center; }`;

    case 'checklist_card':
      return `
      .overlay-panel {
        position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
        width: min(88%, ${layout.panelWidth || '82%'});
        background: ${overlayBg};
        backdrop-filter: blur(${overlayBlur}); -webkit-backdrop-filter: blur(${overlayBlur});
        border-radius: ${layout.panelRadius || borderRadius};
        z-index: 10;
        padding: ${Math.round(py * 1.2)}px ${Math.round(px * 1.1)}px;
        box-shadow: 0 22px 70px rgba(15,23,42,0.18);
        border: 1px solid rgba(15,23,42,0.10);
      }
      .overlay-inner { display: flex; flex-direction: column; align-items: flex-start; text-align: left; width: 100%; }
      .pin-hrule { width: 64px; height: 2px; opacity: 0.22; }`;

    case 'dark_glass_finance':
      return `
      .overlay-panel {
        position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
        width: min(86%, ${layout.panelWidth || '80%'});
        background: ${overlayBg};
        backdrop-filter: blur(${overlayBlur}); -webkit-backdrop-filter: blur(${overlayBlur});
        border-radius: ${layout.panelRadius || borderRadius};
        z-index: 10;
        padding: ${Math.round(py * 1.35)}px ${Math.round(px * 1.15)}px;
        box-shadow: 0 28px 90px rgba(0,0,0,0.35);
        border: 1px solid rgba(216,180,106,0.34);
      }
      .overlay-inner { display: flex; flex-direction: column; align-items: flex-start; text-align: left; }
      .pin-hrule { width: 72px; height: 1px; opacity: 0.72; }
      .pin-badge { border-color: rgba(216,180,106,0.38); background: rgba(216,180,106,0.12); }`;

    case 'premium_article_cover':
      const articleGradient = overlay.type === 'fade'
        ? `linear-gradient(to top, rgba(0,0,0,0.94) 0%, rgba(0,0,0,0.62) 46%, rgba(0,0,0,0.18) 78%, transparent 100%)`
        : overlayBg;
      return `
      .article-cover {
        position: absolute; bottom: 0; left: 0; right: 0;
        min-height: 58%; z-index: 10;
        display: flex; align-items: flex-end;
        padding: ${Math.round(py * 1.25)}px ${px}px ${Math.round(py * 2.15)}px;
        background: ${articleGradient};
      }
      .cover-inner {
        display: flex;
        flex-direction: column;
        align-items: ${flexAlign};
        text-align: ${align};
        transform: translateY(-${layout.coverLiftPx || 0}px);
      }`;

    case 'gradient_editorial':
      const editorialGradient = overlay.type === 'fade'
        ? `linear-gradient(to top, rgba(0,0,0,0.94) 0%, rgba(0,0,0,0.58) 50%, rgba(0,0,0,0.16) 78%, transparent 100%)`
        : overlayBg;
      return `
      .article-cover {
        position: absolute; bottom: 0; left: 0; right: 0;
        min-height: 56%; z-index: 10;
        display: flex; align-items: flex-end;
        padding: ${Math.round(py * 1.35)}px ${px}px ${Math.round(py * 1.75)}px;
        background: ${editorialGradient};
      }
      .cover-inner {
        display: flex;
        flex-direction: column;
        align-items: ${flexAlign};
        text-align: ${align};
        max-width: ${layout.maxTitleWidth};
        transform: translateY(-${layout.coverLiftPx || 0}px);
      }`;

    case 'soft_magazine':
      return `
      .article-cover {
        position: absolute; bottom: 0; left: 0; right: 0;
        min-height: ${layout.overlayHeight || '48%'};
        z-index: 10; display: flex; align-items: center; justify-content: center;
        padding: ${py}px ${px}px;
        background: linear-gradient(to top, rgba(245,240,232,0.72) 0%, rgba(245,240,232,0.34) 58%, transparent 100%);
      }
      .cover-inner {
        display: flex;
        flex-direction: column;
        text-align: center;
        align-items: center;
        width: min(88%, ${layout.maxTitleWidth});
        padding: ${Math.round(py * 0.8)}px ${Math.round(px * 0.9)}px;
        background: rgba(250,246,238,0.86);
        border: 1px solid rgba(45,27,0,0.12);
        border-radius: 8px;
        box-shadow: 0 18px 60px rgba(0,0,0,0.16);
      }`;

    case 'luxury_desk_headline':
      return `
      .luxury-panel {
        position: absolute; top: ${py}px; left: ${px}px; width: ${layout.panelWidth || '72%'};
        background: ${overlayBg};
        backdrop-filter: blur(${overlayBlur}); -webkit-backdrop-filter: blur(${overlayBlur});
        border-radius: 8px; z-index: 10;
        padding: ${Math.round(py * 1.1)}px ${Math.round(px * 1.1)}px;
        box-shadow: 0 15px 50px rgba(0,0,0,0.25);
        ${edgeCSS}
      }
      .luxury-inner { display: flex; flex-direction: column; align-items: flex-start; }`;

    case 'minimalist_gradient_poster':
      return `
      .poster-center {
        position: absolute; inset: ${py}px ${px}px; z-index: 10;
        display: flex; align-items: center; justify-content: center;
      }
      .poster-inner {
        width: ${layout.maxTitleWidth};
        display: flex; flex-direction: column; align-items: center; text-align: center;
      }`;

    case 'bold_statement_poster':
      return `
      .poster-center {
        position: absolute; inset: ${py}px ${px}px; z-index: 10;
        display: flex; align-items: center; justify-content: center;
        text-align: center;
      }
      .poster-inner {
        width: ${layout.maxTitleWidth};
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        padding: ${Math.round(py * 0.5)}px 0;
      }
      .pin-title { text-transform: uppercase; }
      .pin-category { opacity: 0.78; margin-bottom: ${Math.round(textVars.sectionGap * 0.6)}px; }
      .pin-cta { background: rgba(255,255,255,0.10); }`;


    default:
      return `.text-zone { position: absolute; top: ${py}px; left: ${px}px; right: ${px}px; z-index: 10; }`;
  }
}

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

module.exports = { buildPinHTML };
