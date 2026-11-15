// Amplitude for the website, set up to be as private as possible:
// - no IP address, a first-party random ID kept in localStorage (no cookies);
// - off for browsers that send Global Privacy Control or Do Not Track, and for anyone who
//   turns it off on the About page (localStorage "sgd.analyticsOff");
// - only on the live site, so local previews aren't counted;
// - off for automated browsers (headless Chrome, test runners, crawlers), so screenshot and
//   check runs don't show up as visitors;
// - Kyle's own browsers carry the user property internal_user: true, so charts can leave them
//   out. Open any page with ?internal=on once per browser to set it (?internal=off clears it);
// - Session Replay for a small share of visits (REPLAY_SHARE), with all text and input
//   masked ("conservative"); its code downloads only for those visits;
// - nothing on the Help paying for food page (it doesn't load this file), and no clicks on links to it.
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

// Headless and automated browsers: Playwright, Puppeteer and Selenium set navigator.webdriver;
// headless Chrome and crawlers name themselves in the user agent.
function automated() {
  if (navigator.webdriver === true) return true;
  return /HeadlessChrome|Lighthouse|bot\/|crawl|spider|slurp|facebookexternalhit/i.test(navigator.userAgent || '');
}

// Reads ?internal=on / ?internal=off, remembers it in this browser, and drops it from the address.
function internalBrowser() {
  try {
    const url = new URL(location.href);
    const flag = url.searchParams.get('internal');
    if (flag === 'on') localStorage.setItem('sgd.internal', 'true');
    if (flag === 'off') localStorage.removeItem('sgd.internal');
    if (flag !== null) { url.searchParams.delete('internal'); history.replaceState(history.state, '', url); }
    return localStorage.getItem('sgd.internal') === 'true';
  } catch (e) { return false; }
}

function optedOut() {
  try { if (localStorage.getItem('sgd.analyticsOff') === 'true') return true; } catch (e) {}
  return navigator.globalPrivacyControl === true || navigator.doNotTrack === '1';
}

if (!AMPLITUDE_API_KEY) {
  console.warn('Amplitude API key missing: analytics disabled');
} else if (location.hostname === 'seattlegrocery.deals' && !optedOut() && !automated()) {
  // Links marked data-no-track (to the Help paying for food page) are left out of click capture;
  // otherwise this is Amplitude's default list of elements. The page itself loads no analytics.
  const CLICKABLE = ['a:not([data-no-track])', 'button', 'input', 'select', 'textarea', 'label', '[data-amp-default-track]', '.amp-default-track'];
  amplitude.init(AMPLITUDE_API_KEY, { autocapture: { elementInteractions: { cssSelectorAllowlist: CLICKABLE } }, identityStorage: 'localStorage', trackingOptions: { ipAddress: false } });
  if (internalBrowser()) amplitude.identify(new amplitude.Identify().set('internal_user', true));
  if (document.body.dataset.page === 'home') {
    let picked = [];
    try { picked = JSON.parse(localStorage.getItem('sgd.stores') || '[]'); } catch (e) {}
    amplitude.track('Viewed Home Page', { stores_picked: Array.isArray(picked) ? picked.length : 0 });
  }
  // Events from the site's own scripts (app.js): "Changed Your Stores", "Opened Store Card".
  document.addEventListener('sgd:track', (e) => amplitude.track(e.detail.name, e.detail.props));
  if (recordThisVisit()) {
    import('@amplitude/plugin-session-replay-browser').then(({ sessionReplayPlugin }) => {
      amplitude.add(sessionReplayPlugin({ sampleRate: 1, privacyConfig: { defaultMaskLevel: 'conservative' } }));
    });
  }
}
