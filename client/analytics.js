// Amplitude for the website, set up to be as private as possible:
// - no IP address, a first-party random ID kept in localStorage (no cookies);
// - off for browsers that send Global Privacy Control or Do Not Track, and for anyone who
//   turns it off on the About page (localStorage "sgd.analyticsOff");
// - only on the live site, so local previews aren't counted;
// - Session Replay for a small share of visits (REPLAY_SHARE), with all text and input
//   masked ("conservative"); its code downloads only for those visits.
// Bundled by scripts/build.mjs into dist/assets/analytics/ (an ES module) and loaded once per page.
// The key comes from config/site.json (amplitude_api_key) and is public by design.
import * as amplitude from '@amplitude/analytics-browser';

const AMPLITUDE_API_KEY = __AMPLITUDE_API_KEY__;
const REPLAY_SHARE = 0.05;

// Decide once per browser tab whether this visit is one of the few recorded.
function recordThisVisit() {
  try {
    let v = sessionStorage.getItem('sgd.replay');
    if (v === null) { v = Math.random() < REPLAY_SHARE ? '1' : '0'; sessionStorage.setItem('sgd.replay', v); }
    return v === '1';
  } catch (e) { return false; }
}

function optedOut() {
  try { if (localStorage.getItem('sgd.analyticsOff') === 'true') return true; } catch (e) {}
  return navigator.globalPrivacyControl === true || navigator.doNotTrack === '1';
}

if (!AMPLITUDE_API_KEY) {
  console.warn('Amplitude API key missing: analytics disabled');
} else if (location.hostname === 'seattlegrocery.deals' && !optedOut()) {
  amplitude.init(AMPLITUDE_API_KEY, { autocapture: true, identityStorage: 'localStorage', trackingOptions: { ipAddress: false } });
  if (document.body.dataset.page === 'home') amplitude.track('Viewed Home Page');
  if (recordThisVisit()) {
    import('@amplitude/plugin-session-replay-browser').then(({ sessionReplayPlugin }) => {
      amplitude.add(sessionReplayPlugin({ sampleRate: 1, privacyConfig: { defaultMaskLevel: 'conservative' } }));
    });
  }
}
