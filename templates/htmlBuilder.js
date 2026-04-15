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
  const accentColor = useAccent ? dominant.hex : (palette ? palette.accent : (recipe.analysis?.autoTextColor || '#ffffff'));

  const textColor = palette ? palette.text : (recipe.analysis?.autoTextColor || '#ffffff');
  const subColor  = palette ? palette.sub  : textColor;

  const layoutHTML   = buildLayoutHTML(templateId, recipe, textVars, textColor, subColor, fontObj, overlayConfig, accentColor);
  const templateCSS  = buildTemplateStyle(templateId, recipe, textVars, width, height, overlayConfig, accentColor);

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
    word-break: break-word;
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
</style>
</head>
<body>
<div class="pin-root" id="pin-root">
  <div class="pin-bg"></div>
  ${layout.gradientOverlay ? '<div class="pin-veil"></div>' : ''}
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

  const subtitleEl = inputs.subtitle
    ? `<div class="pin-subtitle">${esc(inputs.subtitle)}</div>`
    : '';

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
      return `<div class="overlay-panel"><div class="overlay-inner">${inner}</div></div>`;

    case 'lower_third_card':
      return `<div class="lower-card"><div class="lower-card-inner">${inner}</div></div>`;

    case 'soft_magazine':
    case 'gradient_editorial':
    case 'premium_article_cover':
      return `<div class="article-cover"><div class="cover-inner">${inner}</div></div>`;

    case 'left_editorial_column':
      return `<div class="editorial-column"><div class="column-inner">${inner}</div></div>`;

    case 'luxury_desk_headline':
      return `<div class="luxury-panel"><div class="luxury-inner">${inner}</div></div>`;

    case 'minimalist_gradient_poster':
      return `<div class="poster-center"><div class="poster-inner">${inner}</div></div>`;

    default:
      return `<div class="text-zone">${inner}</div>`;
  }
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
