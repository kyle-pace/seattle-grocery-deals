// Amplitude for the website, set up to be as private as possible:
// - analytics only (no Session Replay or Guides), no IP address, a first-party random ID kept in localStorage (no cookies);
// - off for browsers that send Global Privacy Control or Do Not Track, and for anyone who
//   turns it off on the About page (localStorage "sgd.analyticsOff");
// - only on the live site, so local previews aren't counted.
// Bundled by scripts/build.mjs into dist/assets/analytics.js and loaded once per page.
// The key comes from config/site.json (amplitude_api_key) and is public by design.
import * as amplitude from '@amplitude/analytics-browser';

const AMPLITUDE_API_KEY = __AMPLITUDE_API_KEY__;

function optedOut() {
  try { if (localStorage.getItem('sgd.analyticsOff') === 'true') return true; } catch (e) {}
  return navigator.globalPrivacyControl === true || navigator.doNotTrack === '1';
}

if (!AMPLITUDE_API_KEY) {
  console.warn('Amplitude API key missing: analytics disabled');
} else if (location.hostname === 'seattlegrocery.deals' && !optedOut()) {
  amplitude.init(AMPLITUDE_API_KEY, { autocapture: true, identityStorage: 'localStorage', trackingOptions: { ipAddress: false } });
  if (document.body.dataset.page === 'home') amplitude.track('Viewed Home Page');
}
