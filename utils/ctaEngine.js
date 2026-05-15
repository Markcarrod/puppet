const SOFT_CTAS = [
  'Save This',
  'Learn More',
  'See More',
  'Keep Reading',
  'Find Out',
  'View More',
  'Check This',
  'Remember This',
  'Save Idea',
  'More Ideas',
  'Quick Tips',
  'Smart Tips',
  'Simple Tips',
  'Helpful Tips',
  'Fresh Ideas',
  'New Ideas',
  'Better Way',
  'Next Step',
  'Start Simple',
  'Learn Fast',
  'Think Bigger',
  'Plan Better',
  'Work Smarter',
  'Grow Smarter',
];

const DIRECT_CTAS = [
  'Start Here',
  'Read More',
  'Try This',
  'Read Now',
  'Save Now',
  'Start Now',
  'Try Today',
  'Begin Today',
  'See How',
  'Learn Today',
  'Explore More',
  'Take Look',
  'Look Inside',
  'Open Now',
  'Tap Here',
  'Click Here',
  'Start Today',
  'Use This',
  'Try Next',
  'See Why',
  'Read This',
  'Move Forward',
  'Take Action',
  'Get Started',
];

function applyCtaPolicy(inputs, variantKey = '') {
  if (inputs?.cta && String(inputs.cta).trim()) {
    return { ...inputs, cta: String(inputs.cta).trim() };
  }

  const key = [
    inputs?.title || '',
    inputs?.subtitle || '',
    inputs?.category || '',
    variantKey,
  ].join('|');
  const bucket = hashToPercent(key);

  if (bucket < 60) return { ...inputs, cta: '' };
  if (bucket < 85) return { ...inputs, cta: pickCta(SOFT_CTAS, key) };
  return { ...inputs, cta: pickCta(DIRECT_CTAS, key) };
}

function pickCta(list, key) {
  return list[hashToInt(key) % list.length];
}

function hashToPercent(value) {
  return hashToInt(value) % 100;
}

function hashToInt(value) {
  let hash = 2166136261;
  const str = String(value);

  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

module.exports = {
  SOFT_CTAS,
  DIRECT_CTAS,
  applyCtaPolicy,
};
