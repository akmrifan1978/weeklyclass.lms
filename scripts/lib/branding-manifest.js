/**
 * The installed app's manifest, built from the branding settings.
 *
 * Shared by the two things that publish a manifest: the build
 * (scripts/stamp-manifest.js) and the scheduled sync
 * (scripts/sync-branding.js). One implementation, so a manifest published by
 * either names exactly the same icons.
 *
 * The icon URL logic mirrors src/utils/branding.ts, which shapes the browser
 * tab's icon. Keep the two in step.
 */
const crypto = require('crypto');

const CLOUDINARY_IMAGE = /res\.cloudinary\.com\/.+\/image\/upload\//;

/** See brandIconUrl in src/utils/branding.ts for what each purpose means. */
function brandIconUrl(url, { size, shape, purpose }) {
  if (!CLOUDINARY_IMAGE.test(url)) return url;
  const steps = [];

  if (purpose === 'maskable') {
    const inner = Math.round(size * 0.8);
    steps.push(`c_fit,w_${inner},h_${inner}`, `c_pad,w_${size},h_${size},b_white`);
  } else if (purpose === 'tab' && shape !== 'round' && shape !== 'square') {
    steps.push(`c_fit,w_${size},h_${size}`);
  } else {
    steps.push(`c_fit,w_${size},h_${size}`, `c_pad,w_${size},h_${size},b_white`);
    if (shape === 'round') steps.push('r_max');
  }
  steps.push('f_png,q_auto');

  return url.replace(/\/image\/upload\/(?:[a-z]{1,3}_[^/]*\/)*/, `/image/upload/${steps.join('/')}/`);
}

/** The logo the icons are made from: the favicon setting if there is one, else the logo. */
function brandLogo(settings) {
  return String(settings?.faviconUrl || settings?.logoUrl || '').trim();
}

/**
 * A fingerprint of everything that decides the manifest.
 *
 * When it is unchanged the sync does nothing — no release, no churn — which is
 * what lets it run every few minutes.
 */
function brandingSignature(settings) {
  const payload = JSON.stringify({
    logo: brandLogo(settings),
    shape: settings?.logoShape || null,
    name: String(settings?.appName || '').trim(),
  });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

/**
 * The manifest with the organisation's icons and name.
 *
 * Starts from the manifest already published, so everything else in it — the
 * colours, the start page, the display mode — is kept exactly as the build made
 * it. Returns null when there is nothing to change.
 */
function applyBranding(manifest, settings) {
  const logo = brandLogo(settings);
  const name = String(settings?.appName || '').trim();
  const shape = settings?.logoShape || null;
  if (!logo && !name) return null;

  const next = { ...manifest };
  if (name) {
    next.name = name;
    // Room for about twelve characters under a home-screen icon.
    next.short_name = name.length <= 12 ? name : name.slice(0, 12).trim();
  }
  if (logo) {
    next.icons = [
      { src: brandIconUrl(logo, { size: 192, shape, purpose: 'install' }), sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: brandIconUrl(logo, { size: 512, shape, purpose: 'install' }), sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: brandIconUrl(logo, { size: 192, shape, purpose: 'maskable' }), sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: brandIconUrl(logo, { size: 512, shape, purpose: 'maskable' }), sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ];
  }
  return next;
}

module.exports = { applyBranding, brandIconUrl, brandLogo, brandingSignature };
