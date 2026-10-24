// Local notifications: a Friday reminder, "ends tomorrow" for list items, and price
// watch hits found when the feed loads. Real server push (Firebase) comes later;
// these work in Expo Go today.
import * as Notifications from "expo-notifications";
import { Deal } from "./data";

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

export type Watch = { id: string; name: string; key: string | null; store: string; target: number; per: string; label: string; notifiedWeek?: string };

export async function allowNotifications(): Promise<boolean> {
  const cur = await Notifications.getPermissionsAsync();
  if (cur.granted) return true;
  const req = await Notifications.requestPermissionsAsync();
  return req.granted;
}

// "$1.48/lb" -> { value: 1.48, per: "lb" }, "99¢ each" -> { value: 0.99, per: "each" }
export function unitValue(d: Deal): { value: number; per: string } | null {
  const t = d.unit_price ?? d.text;
  const m = t.match(/^\$?([\d.]+)(¢)?\s*(?:\/(\w+)|\s(each))?/);
  if (!m) return null;
  const value = m[2] ? Number(m[1]) / 100 : Number(m[1]);
  return { value, per: m[3] ?? m[4] ?? "item" };
}

export async function setFridayReminder(on: boolean) {
  await Notifications.cancelScheduledNotificationAsync("friday").catch(() => {});
  if (!on) return;
  await Notifications.scheduleNotificationAsync({
    identifier: "friday",
    content: { title: "New deals are in", body: "This week's flyers are up. See what's on sale from your list." },
    // weekday 1 is Sunday, so 6 is Friday; new deals usually post by 10:30.
    trigger: { type: Notifications.SchedulableTriggerInputTypes.WEEKLY, weekday: 6, hour: 10, minute: 30 },
  });
}

// One reminder at 9 AM the day before each list item's sale ends.
export async function setEndingReminders(on: boolean, matches: { text: string; deal: Deal; storeName: string }[]) {
  const all = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(all.filter((n) => n.identifier.startsWith("ends-")).map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)));
  if (!on) return;
  for (const { text, deal, storeName } of matches) {
    if (!deal.ends) continue;
    const when = new Date(deal.ends + "T09:00:00");
    when.setDate(when.getDate() - 1);
    if (when.getTime() < Date.now() + 60_000) continue;
    await Notifications.scheduleNotificationAsync({
      identifier: `ends-${deal.id}`,
      content: { title: `${text}: sale ends tomorrow`, body: `${deal.name}, ${deal.text} at ${storeName}.` },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: when },
    });
  }
}

// The cheapest current deal that beats a watch's target, if any.
export function watchHit(w: Watch, items: Deal[]): Deal | null {
  let best: Deal | null = null;
  let bestV = Infinity;
  for (const d of items) {
    const same = w.key ? d.key === w.key : d.name === w.name;
    if (!same) continue;
    const u = unitValue(d);
    if (u && u.per === w.per && u.value < w.target && u.value < bestV) { best = d; bestV = u.value; }
  }
  return best;
}

export async function notifyNow(title: string, body: string) {
  await Notifications.scheduleNotificationAsync({ content: { title, body }, trigger: null });
}
