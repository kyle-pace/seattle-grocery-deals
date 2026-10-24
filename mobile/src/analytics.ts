// Amplitude product analytics for the app. Same Amplitude project as the website, so
// funnels can span both; the "platform" property tells them apart. The key lives in
// app.json (expo.extra.amplitudeApiKey) and is public by design. Events use the web's
// naming style: Title Case, past tense. Privacy: anonymous device ID only, no IP address,
// no advertising ID or carrier, never the list contents, and an off switch in Alerts.
import * as amplitude from "@amplitude/analytics-react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";

const KEY: string | undefined = Constants.expoConfig?.extra?.amplitudeApiKey;
let started = false;

const OPT_OUT_KEY = "sgd.analyticsOff";

export async function startAnalytics() {
  if (started) return;
  started = true;
  if (!KEY) { console.warn("Amplitude API key missing: analytics disabled"); return; }
  const off = (await AsyncStorage.getItem(OPT_OUT_KEY).catch(() => null)) === "true";
  amplitude.init(KEY, undefined, {
    optOut: off,
    trackingOptions: { ipAddress: false, adid: false, carrier: false },
    autocapture: { sessions: true, appLifecycles: true, screenViews: false, elementInteractions: false },
  });
}

export async function analyticsOff(): Promise<boolean> {
  return (await AsyncStorage.getItem(OPT_OUT_KEY).catch(() => null)) === "true";
}
export function setAnalyticsOff(off: boolean) {
  AsyncStorage.setItem(OPT_OUT_KEY, String(off)).catch(() => {});
  if (KEY) amplitude.setOptOut(off);
}

export const track = (event: string, props?: Record<string, unknown>) => { if (KEY) amplitude.track(event, props); };
export const screen = (name: string, props?: Record<string, unknown>) => { if (KEY) amplitude.track("Viewed Screen", { screen: name, ...props }); };

// Settings that describe the person, kept on their Amplitude profile.
export function setUserProps(props: Record<string, string | number | boolean>) {
  if (!KEY) return;
  const id = new amplitude.Identify();
  for (const [k, v] of Object.entries(props)) id.set(k, v);
  amplitude.identify(id);
}
