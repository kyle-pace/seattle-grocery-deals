// The grocery list can live in an iPhone Reminders list (shared lists and Siri included).
// Items added from a deal carry the price, store and sale end date, with the end date as
// the reminder's due date so Reminders shows when the deal expires.
import { ExpoCalendar, ExpoCalendarReminder, EntityTypes, getCalendars, ReminderStatus, requestRemindersPermissions } from "expo-calendar";
import { ActionSheetIOS, Platform } from "react-native";
import { Deal, fmtDate } from "./data";

export type RemindersList = { id: string; title: string };
export type Item = { id: string; text: string; done: boolean; dealId?: string };

export const remindersSupported = Platform.OS === "ios";
const DEAL_URL = "grocerydeals://deal/";

// Ask for access, then let the person pick a list. Null if they cancel or say no.
export async function chooseList(): Promise<RemindersList | null> {
  const step = async <T>(name: string, f: () => Promise<T>) => { try { return await f(); } catch (e) { throw new Error(`${name}: ${e instanceof Error ? e.message : String(e)}`); } };
  const perm = await step("permission", () => requestRemindersPermissions());
  if (!perm.granted) return null;
  const lists = (await step("lists", () => getCalendars(EntityTypes.REMINDER))).filter((c) => c.allowsModifications !== false);
  if (!lists.length) return null;
  // Put a list named like "Groceries" first.
  lists.sort((a, b) => Number(/grocer|shopping/i.test(b.title)) - Number(/grocer|shopping/i.test(a.title)));
  return new Promise((resolve) => {
    ActionSheetIOS.showActionSheetWithOptions(
      { title: "Which Reminders list?", options: [...lists.map((l) => l.title), "Cancel"], cancelButtonIndex: lists.length },
      (i) => resolve(i < lists.length ? { id: lists[i].id, title: lists[i].title } : null),
    );
  });
}

// ExpoCalendar.get() asks for Calendar permission even for a Reminders list (expo-calendar
// SDK 58), so find the list among the Reminders lists instead.
async function getList(listId: string): Promise<ExpoCalendar> {
  const list = (await getCalendars(EntityTypes.REMINDER)).find((c) => c.id === listId);
  if (!list) throw new Error("That Reminders list no longer exists. Pick another on the List tab.");
  return list;
}

export async function readList(listId: string): Promise<Item[]> {
  let open;
  try {
    const cal = await getList(listId);
    open = await cal.listReminders(null, null, ReminderStatus.INCOMPLETE);
  } catch (e) { throw new Error(`read: ${e instanceof Error ? e.message : String(e)}`); }
  return open.map((r) => ({
    id: r.id!, text: r.title ?? "", done: false,
    dealId: r.url?.startsWith(DEAL_URL) ? r.url.slice(DEAL_URL.length) : undefined,
  }));
}

export async function addReminder(listId: string, text: string, deal?: Deal, storeName?: string): Promise<void> {
  const cal = await getList(listId);
  await cal.createReminder({
    title: text,
    ...(deal ? {
      notes: `${deal.text} at ${storeName ?? deal.store}${deal.ends ? `. Sale ends ${fmtDate(deal.ends)}.` : "."}`,
      url: DEAL_URL + deal.id,
      ...(deal.ends ? { dueDate: new Date(deal.ends + "T12:00:00").toISOString(), allDay: true } : {}),
    } : {}),
  });
}

export async function setDone(reminderId: string, done: boolean) {
  const r = await ExpoCalendarReminder.get(reminderId);
  await r.update(done ? { completed: true, completionDate: new Date().toISOString() } : { completed: false });
}

export async function removeReminder(reminderId: string) {
  const r = await ExpoCalendarReminder.get(reminderId);
  await r.delete();
}
