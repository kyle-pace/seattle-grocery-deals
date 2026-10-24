// Amplitude for the website: analytics with autocapture, plus Session Replay.
// Bundled by scripts/build.mjs into dist/assets/analytics.js and loaded on every page,
// so it initializes once per page load. The key comes from config/site.json
// (amplitude_api_key) and is public by design.
import * as amplitude from '@amplitude/unified';

const AMPLITUDE_API_KEY = __AMPLITUDE_API_KEY__;

if (!AMPLITUDE_API_KEY) {
  console.warn('Amplitude API key missing: analytics disabled');
} else {
  amplitude.initAll(AMPLITUDE_API_KEY, {"analytics":{"autocapture":true},"sessionReplay":{"sampleRate":1}});
  if (document.body.dataset.page === 'home') {
    amplitude.track('Viewed Home Page', { prompt_version: 'BA400.4' }); // helps improve this setup flow; safe to remove once you've verified the event lands
  }
}
