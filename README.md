# 🎨 Pinterest Pin Factory

> **Premium internal Pinterest pin generator powered by Puppeteer + Sharp**
> Turns uploaded base images into polished 1000×1500 Pinterest pins with full HTML/CSS overlays, smart layout selection, and batch rendering.

---

## Quick Start

```bash
# 1. Install dependencies (Puppeteer will download Chromium automatically)
npm install

# 2. Start the web server
npm start

# 3. Open in browser
http://localhost:3333
```

---

## Features

| Feature | Detail |
|---|---|
| **10 Template Families** | Upper-third, card, editorial column, glass panel, magazine, luxury, gradient poster, and more |
| **Smart Layout Selection** | Rule-based image analysis — brightness zones, safe areas, object density |
| **Font Preset System** | Manrope/Inter · Playfair/Inter · Jakarta/DM Sans · Cormorant/Manrope · Outfit/Inter |
| **Overlay System** | None · Translucent white sheet · Cream card · Lower-third · Subtle fade · Soft panel · Dark panel |
| **Variant Generation** | Up to 10 premium variants per image (template × opacity × spacing) |
| **Batch Rendering** | JSON/CSV input · folder scan · title bank · parallel rendering |
| **Quality Safeguards** | Text overflow · contrast · placement · line break checks |
| **Export** | PNG / JPG / WebP · ZIP download · per-pin download |

---

## Project Structure

```
Puppet2/
├── server.js              # Express server + REST API
├── configs/
│   └── templates.js       # All template definitions, font presets, overlay types
├── templates/
│   └── htmlBuilder.js     # Builds Puppeteer-ready HTML/CSS per template
├── utils/
│   ├── renderer.js        # Puppeteer engine + Sharp post-processing
│   ├── imageAnalyzer.js   # Zone brightness/variance analysis
│   ├── variantGenerator.js# Controlled variant recipe builder
│   ├── textEngine.js      # Dynamic font sizing, line wrapping, quality checks
│   └── csvImporter.js     # JSON/CSV batch file loader
├── scripts/
│   ├── batchRender.js     # CLI batch render script
│   └── utils/
│       └── cliArgs.js     # CLI argument parser
├── web/
│   ├── index.html         # Full web UI
│   ├── styles/app.css     # Premium dark UI stylesheet
│   └── scripts/app.js     # Frontend logic
├── data/
│   ├── batch.json         # Example JSON batch file
│   ├── batch.csv          # Example CSV batch file
│   └── titles.txt         # Example title bank
├── uploads/               # Uploaded base images (auto-created)
├── output/                # Rendered pins (auto-created)
└── fonts/                 # Optional local fonts
```

---

## Template Families

| ID | Name | Overlay | Font Preset |
|---|---|---|---|
| `upper_third_overlay` | Upper Third Direct Overlay | None | Manrope/Inter |
| `top_middle_headline` | Top-Middle Narrow Headline | None | Playfair/Inter |
| `center_white_sheet` | Center Translucent White Sheet | Glass | Jakarta/DM Sans |
| `lower_third_card` | Lower Third White Card | White card | Jakarta/DM Sans |
| `left_editorial_column` | Left Editorial Column | Cream card | Cormorant/Manrope |
| `floating_soft_panel` | Floating Soft Panel | Soft glass | Outfit/Inter |
| `premium_article_cover` | Premium Article Cover | Gradient fade | Playfair/Inter |
| `soft_magazine` | Soft Magazine Layout | Luxury cream | Cormorant/Manrope |
| `luxury_desk_headline` | Luxury Desk Headline | Dark panel | Manrope/Inter |
| `minimalist_gradient_poster` | Minimalist Gradient Poster | None | Outfit/Inter |

---

## Web UI

| Tab | Purpose |
|---|---|
| **Generate** | Single image → multiple premium variants |
| **Batch** | Upload many images + paste title bank → mass render |
| **Gallery** | Browse all rendered pins across sessions |
| **Jobs** | Track job status, download ZIP archives |

---

## Batch CLI

```bash
# From a JSON batch file
node scripts/batchRender.js --input data/batch.json --variants 6 --format jpg

# From a CSV file
node scripts/batchRender.js --input data/batch.csv --template lower_third_card

# From a folder of images + title bank
node scripts/batchRender.js --folder uploads/ --titles data/titles.txt --variants 4

# Full options
node scripts/batchRender.js \
  --input data/batch.json \
  --template auto \
  --size standard \
  --format jpg \
  --quality 88 \
  --variants 6 \
  --concurrency 3 \
  --output output/
```

### Batch JSON format

```json
[
  {
    "imagePath": "my-image.jpg",
    "title": "Your Pin Title Here",
    "subtitle": "Optional supporting text",
    "category": "LIFESTYLE",
    "cta": "Read More",
    "badge": "NEW",
    "linkLabel": "yourblog.com"
  }
]
```

### Batch CSV format

```csv
imagePath,title,subtitle,category,cta,badge,linkLabel
my-image.jpg,Your Pin Title,Supporting text,LIFESTYLE,Read More,NEW,yourblog.com
```

---

## REST API

| Endpoint | Method | Description |
|---|---|---|
| `/api/health` | GET | Server status |
| `/api/templates` | GET | List all templates |
| `/api/upload` | POST | Upload image(s) |
| `/api/analyze` | POST | Analyze image + rank templates |
| `/api/generate` | POST | Start single-image render job |
| `/api/batch` | POST | Start batch render job |
| `/api/jobs` | GET | List recent jobs |
| `/api/jobs/:id` | GET | Job status + results |
| `/api/jobs/:id/download` | GET | Download ZIP of results |
| `/api/outputs` | GET | List all output files |

---

## Pin Sizes

| Key | Size | Ratio |
|---|---|---|
| `standard` | 1000×1500 | 2:3 (default) |
| `tall` | 1000×1600 | Tall |
| `square_ish` | 1080×1350 | 4:5 |
| `square` | 1000×1000 | 1:1 |

---

## Notes

- Puppeteer downloads Chromium on `npm install` — this can take a few minutes on first run.
- Images are stored in `uploads/` and outputs in `output/` — both are gitignored.
- The server uses a single **reusable Puppeteer browser instance** across all renders for performance.
- Google Fonts are loaded at render time — ensure internet access during rendering, or self-host fonts in `fonts/`.
