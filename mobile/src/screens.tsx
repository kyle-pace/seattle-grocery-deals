// The four tabs and the deal detail sheet.
import { useMemo, useState } from "react";
import { FlatList, Linking, Modal, Pressable, RefreshControl, ScrollView, Share, Switch, Text, TextInput, View } from "react-native";
import { allowNotifications, watchHit } from "./alerts";
import { remindersSupported } from "./reminders";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Deal, fmtDate, matchDeal, planTrip } from "./data";
import { useApp } from "./state";
import { font, useColors } from "./theme";
import { DealRow, Heading, Price, shortName, VegSwitch } from "./ui";

const PAD = 16;
const TAB_SPACE = 110;

function Header({ kicker, title, sub, onBack }: { kicker?: string; title: string; sub?: string; onBack?: () => void }) {
  const c = useColors();
  const top = useSafeAreaInsets().top;
  return (
    <View style={{ backgroundColor: c.brand, paddingTop: top + 6, paddingHorizontal: PAD, paddingBottom: 16 }}>
      {onBack ? (
        <Pressable onPress={onBack} accessibilityRole="button" hitSlop={10} style={{ minHeight: 32, justifyContent: "center" }}>
          <Text style={{ color: c.onBrand, fontFamily: font.bold, fontSize: 15 }}>‹ Back</Text>
        </Pressable>
      ) : kicker ? <Text style={{ color: c.onBrand, fontFamily: font.bold, fontSize: 13 }}>{kicker}</Text> : null}
      <Text accessibilityRole="header" style={{ color: c.onBrand, fontFamily: font.display, fontSize: 40, lineHeight: 40, textTransform: "uppercase", marginTop: 2 }}>{title}</Text>
      {sub ? <Text style={{ color: c.onBrand, fontFamily: font.body, fontSize: 14, marginTop: 2 }}>{sub}</Text> : null}
    </View>
  );
}

function Search({ value, onChange, placeholder = "Search deals and stores" }: { value: string; onChange: (t: string) => void; placeholder?: string }) {
  const c = useColors();
  return (
    <TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={c.muted} clearButtonMode="while-editing"
      accessibilityLabel="Search" returnKeyType="search" autoCorrect={false}
      style={{ marginTop: 12, minHeight: 44, borderWidth: 1.5, borderColor: c.lineUi, borderRadius: 10, paddingHorizontal: 12, backgroundColor: c.surface, color: c.ink, fontFamily: font.body, fontSize: 16 }} />
  );
}

const useItems = () => {
  const { feed, veg } = useApp();
  return useMemo(() => (feed?.items ?? []).filter((d) => !veg || d.veg), [feed, veg]);
};

// ---------- This week ----------
export function ThisWeek({ open, goList }: { open: (d: Deal) => void; goList: () => void }) {
  const c = useColors();
  const { feed, refreshing, refresh, list, storeName } = useApp();
  const items = useItems();
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const results = query ? items.filter((d) => d.name.toLowerCase().includes(query) || storeName(d.store).toLowerCase().includes(query)) : [];
  const matches = list.filter((i) => !i.done).map((i) => ({ i, d: matchDeal(i.text, items, false) })).filter((m) => m.d);
  const best = items.filter((d) => d.tier === "standout");
  if (!feed) return <View style={{ flex: 1, backgroundColor: c.paper }} />;
  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.paper }} contentContainerStyle={{ paddingBottom: TAB_SPACE }} keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
      <Header kicker={`${fmtDate(feed.week, false)} to ${fmtDate(feed.end, false)}`} title="This week" sub={`${feed.items.length} deals from ${feed.stores.filter((s) => s.status === "full" || s.status === "partial").length} stores`} />
      <View style={{ paddingHorizontal: PAD }}>
        <Search value={q} onChange={setQ} />
        <VegSwitch />
        {query ? (
          <>
            <Heading title={`${results.length} found`} />
            {results.slice(0, 80).map((d) => <DealRow key={d.id} d={d} onPress={() => open(d)} />)}
            {!results.length ? <Text style={{ fontFamily: font.body, color: c.muted, marginTop: 16 }}>Nothing matches. Try a shorter word or a store name.</Text> : null}
          </>
        ) : (
          <>
            {matches.length ? (
              <>
                <Heading title="On your list" note={`${matches.length} on sale`} />
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -PAD }} contentContainerStyle={{ paddingHorizontal: PAD, gap: 8, paddingVertical: 10 }}>
                  {matches.map(({ i, d }) => (
                    <Pressable key={i.id} onPress={() => open(d!)} accessibilityRole="button" style={{ width: 140, padding: 10, borderWidth: 1.5, borderColor: c.lineUi, borderRadius: 10, backgroundColor: c.surface, gap: 2 }}>
                      <Text style={{ fontFamily: font.bold, color: c.ink }}>{i.text}</Text>
                      <Text style={{ fontFamily: font.body, fontSize: 12, color: c.muted }} numberOfLines={1}>{storeName(d!.store)}</Text>
                      <View style={{ alignItems: "flex-start", marginTop: 4 }}><Price d={d!} size={24} /></View>
                    </Pressable>
                  ))}
                </ScrollView>
              </>
            ) : (
              <Pressable onPress={goList} style={{ marginTop: 16, padding: 12, borderWidth: 2, borderColor: c.ink, backgroundColor: c.tag }}>
                <Text style={{ fontFamily: font.bold, color: c.onTag }}>Add what you need to your list, and we'll show where it's on sale.</Text>
              </Pressable>
            )}
            <Heading title="Best this week" note={`${best.length} standouts`} />
            {best.slice(0, 12).map((d) => <DealRow key={d.id} d={d} onPress={() => open(d)} why />)}
          </>
        )}
      </View>
    </ScrollView>
  );
}

// ---------- Departments ----------
export function Departments({ open }: { open: (d: Deal) => void }) {
  const c = useColors();
  const { feed } = useApp();
  const items = useItems();
  const [cat, setCat] = useState<string | null>(null);
  const [q, setQ] = useState("");
  if (!feed) return null;
  if (cat) {
    const label = feed.categories.find((x) => x.id === cat)?.label ?? cat;
    const list = items.filter((d) => d.category === cat && (!q || d.name.toLowerCase().includes(q.toLowerCase())));
    return (
      <FlatList style={{ backgroundColor: c.paper }} data={list} keyExtractor={(d) => d.id} contentContainerStyle={{ paddingBottom: TAB_SPACE }}
        ListHeaderComponent={<><Header onBack={() => { setCat(null); setQ(""); }} title={label} sub={`${list.length} deals, best first`} /><View style={{ paddingHorizontal: PAD }}><Search value={q} onChange={setQ} placeholder={`Search ${label.toLowerCase()}`} /><VegSwitch /></View></>}
        renderItem={({ item }) => <View style={{ paddingHorizontal: PAD }}><DealRow d={item} onPress={() => open(item)} /></View>}
        ListEmptyComponent={<Text style={{ fontFamily: font.body, color: c.muted, padding: PAD }}>No deals here with these filters.</Text>} />
    );
  }
  return (
    <ScrollView style={{ backgroundColor: c.paper }} contentContainerStyle={{ paddingBottom: TAB_SPACE }}>
      <Header title="Departments" sub="Every deal this week, by section of the store" />
      <View style={{ padding: PAD, gap: 10 }}>
        {feed.categories.map((x) => {
          const l = items.filter((d) => d.category === x.id);
          if (!l.length) return null;
          return (
            <Pressable key={x.id} onPress={() => setCat(x.id)} accessibilityRole="button" style={{ padding: 14, borderWidth: 1.5, borderColor: c.lineUi, borderRadius: 10, backgroundColor: c.surface, gap: 3 }}>
              <Text style={{ fontFamily: font.display, fontSize: 24, color: c.ink, textTransform: "uppercase" }}>{x.label}  →</Text>
              <Text style={{ fontFamily: font.body, fontSize: 14, color: c.muted }}>{l.length} deals, {l.filter((d) => d.tier === "standout").length} standouts</Text>
              <Text style={{ fontFamily: font.body, fontSize: 14, color: c.ink }}>Top: <Text style={{ fontFamily: font.bold }}>{l[0].name}</Text> {l[0].text}</Text>
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}

// ---------- Stores ----------
export function Stores({ open, initial = null }: { open: (d: Deal) => void; initial?: string | null }) {
  const c = useColors();
  const { feed, stores } = useApp();
  const items = useItems();
  const [id, setId] = useState<string | null>(initial);
  if (!feed) return null;
  if (id && stores[id]) {
    const st = stores[id];
    const mine = items.filter((d) => d.store === id);
    const towns = [...new Set(st.locations.map((l) => l.address.split(",").pop()!.trim().replace(/\s+WA.*$/, "")))];
    return (
      <FlatList style={{ backgroundColor: c.paper }} data={mine} keyExtractor={(d) => d.id} contentContainerStyle={{ paddingBottom: TAB_SPACE }}
        ListHeaderComponent={<>
          <Header onBack={() => setId(null)} title={st.name} sub={[towns.join(" · "), st.from ? `Sale ${fmtDate(st.from)} to ${fmtDate(st.through)}` : ""].filter(Boolean).join(" · ")} />
          <View style={{ paddingHorizontal: PAD, paddingTop: 14, gap: 10 }}>
            {st.flyer_url ? (
              <Pressable onPress={() => Linking.openURL(st.flyer_url!)} accessibilityRole="link" style={{ minHeight: 48, borderRadius: 12, backgroundColor: c.ink, alignItems: "center", justifyContent: "center" }}>
                <Text style={{ color: c.paper, fontFamily: font.bold, fontSize: 16 }}>See {st.name}'s weekly ad ↗</Text>
              </Pressable>
            ) : null}
            <Text style={{ fontFamily: font.body, fontSize: 15, color: c.muted }}>{st.about}</Text>
            {st.delivery ? <View style={{ borderWidth: 1.5, borderColor: c.lineUi, borderRadius: 10, padding: 12 }}><Text style={{ fontFamily: font.bold, color: c.ink }}>Delivery</Text><Text style={{ fontFamily: font.body, color: c.ink }}>{st.delivery}</Text></View> : null}
            <VegSwitch />
            <Heading title="This week" note={`${mine.length} deals`} />
          </View>
        </>}
        renderItem={({ item }) => <View style={{ paddingHorizontal: PAD }}><DealRow d={item} showStore={false} onPress={() => open(item)} /></View>} />
    );
  }
  const ranked = [...feed.stores].map((s) => ({ s, n: items.filter((d) => d.store === s.id && d.tier === "standout").length, all: items.filter((d) => d.store === s.id).length }))
    .sort((a, b) => b.n - a.n || b.all - a.all);
  return (
    <ScrollView style={{ backgroundColor: c.paper }} contentContainerStyle={{ paddingBottom: TAB_SPACE }}>
      <Header title="Stores" sub="Most standouts first" />
      <View style={{ padding: PAD, gap: 10 }}>
        {ranked.map(({ s, n, all }) => (
          <Pressable key={s.id} onPress={() => setId(s.id)} accessibilityRole="button" style={{ padding: 14, borderWidth: 1.5, borderColor: c.lineUi, borderRadius: 10, backgroundColor: c.surface, gap: 3 }}>
            <Text style={{ fontFamily: font.display, fontSize: 24, color: c.ink, textTransform: "uppercase" }}>{s.name}  →</Text>
            {s.delivery ? <Text style={{ alignSelf: "flex-start", fontFamily: font.bold, fontSize: 12, color: c.ink, borderWidth: 1.5, borderColor: c.ink, borderRadius: 99, paddingHorizontal: 8 }}>Delivers</Text> : null}
            <Text style={{ fontFamily: font.body, fontSize: 14, color: c.muted }}>{all ? `${all} deals, ${n} standouts` : s.status === "unreadable" ? "Flyer couldn't be read this week" : "No deals this week"}</Text>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

// ---------- List ----------
export function List({ open }: { open: (d: Deal) => void }) {
  const c = useColors();
  const top = useSafeAreaInsets().top;
  const { list, addToList, toggleItem, removeItem, storeName, veg, source, connectReminders, keepInApp, reloadList } = useApp();
  const rem = source && typeof source === "object" ? source : null;
  const items = useItems();
  const [text, setText] = useState("");
  const rows = list.map((i) => ({ i, d: i.dealId ? items.find((x) => x.id === i.dealId) ?? matchDeal(i.text, items, veg) : matchDeal(i.text, items, veg) }));
  const onSale = rows.filter((r) => r.d && !r.i.done).length;
  const add = () => { const t = text.trim(); if (t) { addToList(t); setText(""); } };
  const plan = planTrip(rows.filter((r) => r.d && !r.i.done).map((r) => r.i.text), items, veg);
  return (
    <ScrollView style={{ backgroundColor: c.paper }} contentContainerStyle={{ paddingBottom: TAB_SPACE, paddingHorizontal: PAD, paddingTop: top + 8 }} keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={false} onRefresh={reloadList} />}>
      <Text accessibilityRole="header" style={{ fontFamily: font.display, fontSize: 40, color: c.ink, textTransform: "uppercase" }}>{rem ? rem.title : "Groceries"}</Text>
      <Text style={{ fontFamily: font.body, color: c.muted }}>{onSale} on sale this week · {rem ? "Synced with Reminders" : "Saved in this app"}</Text>
      {remindersSupported ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
          <Pressable onPress={connectReminders} accessibilityRole="button" style={{ minHeight: 40, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1.5, borderColor: c.ink, justifyContent: "center" }}>
            <Text style={{ fontFamily: font.bold, color: c.ink }}>{rem ? "Change Reminders list" : "Use a Reminders list"}</Text>
          </Pressable>
          {rem ? (
            <Pressable onPress={keepInApp} accessibilityRole="button" style={{ minHeight: 40, paddingHorizontal: 12, justifyContent: "center" }}>
              <Text style={{ fontFamily: font.bold, color: c.muted, textDecorationLine: "underline" }}>Keep the list in the app instead</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
        <TextInput value={text} onChangeText={setText} onSubmitEditing={add} placeholder="Add an item, like bok choy" placeholderTextColor={c.muted} returnKeyType="done" accessibilityLabel="Add an item"
          style={{ flex: 1, minHeight: 44, borderWidth: 1.5, borderColor: c.lineUi, borderRadius: 10, paddingHorizontal: 12, backgroundColor: c.surface, color: c.ink, fontFamily: font.body, fontSize: 16 }} />
        <Pressable onPress={add} accessibilityRole="button" style={{ minWidth: 64, borderRadius: 10, backgroundColor: c.ink, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: c.paper, fontFamily: font.bold }}>Add</Text>
        </Pressable>
      </View>
      {plan.length > 1 || (plan.length === 1 && plan[0].entries.length > 1) ? (
        <View style={{ marginTop: 14, padding: 12, borderWidth: 2, borderColor: c.ink, backgroundColor: c.tag, gap: 4 }}>
          <Text style={{ fontFamily: font.bold, fontSize: 16, color: c.onTag }}>Plan: {plan.slice(0, 3).map((p) => storeName(p.store)).join(", then ")}</Text>
          {plan.slice(0, 3).map((p) => <Text key={p.store} style={{ fontFamily: font.body, fontSize: 14, color: c.onTag }}>{storeName(p.store)}: {p.entries.join(", ")}</Text>)}
          {plan.length > 3 ? <Text style={{ fontFamily: font.body, fontSize: 13, color: c.onTag }}>And {plan.length - 3} more stops for the rest.</Text> : null}
        </View>
      ) : null}
      <Heading title="My list" note="Long-press to remove" />
      {rows.map(({ i, d }) => (
        <Pressable key={i.id} onPress={() => (d ? open(d) : toggleItem(i.id))} onLongPress={() => removeItem(i.id)} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 11, borderBottomWidth: 1, borderColor: c.line }}>
          <Pressable onPress={() => toggleItem(i.id)} accessibilityRole="checkbox" accessibilityState={{ checked: i.done }} accessibilityLabel={i.text} hitSlop={10}
            style={{ width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: i.done ? c.brand : c.lineUi, backgroundColor: i.done ? c.brand : "transparent", alignItems: "center", justifyContent: "center" }}>
            {i.done ? <Text style={{ color: "#fff", fontSize: 14 }}>✓</Text> : null}
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: font.bold, fontSize: 16, color: i.done ? c.muted : c.ink, textDecorationLine: i.done ? "line-through" : "none" }}>{i.text}</Text>
            {d && !i.done ? <Text style={{ fontFamily: font.body, fontSize: 13, color: c.muted }} numberOfLines={1}><Text style={{ fontFamily: font.bold, color: c.ink }}>{storeName(d.store)}</Text> · {d.name}</Text> : null}
          </View>
          {d && !i.done ? <Price d={d} size={22} /> : null}
        </Pressable>
      ))}
    </ScrollView>
  );
}

// ---------- Deal detail ----------
export function DealSheet({ deal, close, goStore }: { deal: Deal | null; close: () => void; goStore: (id: string) => void }) {
  const c = useColors();
  const { feed, storeName, stores, addToList, inList, removeDeal, watch, unwatch, watching } = useApp();
  if (!deal) return null;
  const others = deal.key ? (feed?.items ?? []).filter((x) => x.key === deal.key && x.id !== deal.id) : [];
  const added = inList(deal);
  const st = stores[deal.store];
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <ScrollView style={{ backgroundColor: c.paper }} contentContainerStyle={{ padding: 20, paddingBottom: 48, gap: 8 }}>
        <Pressable onPress={close} accessibilityRole="button" style={{ alignSelf: "flex-end", minHeight: 44, justifyContent: "center" }}><Text style={{ fontFamily: font.bold, color: c.ink, fontSize: 16 }}>Done</Text></Pressable>
        {deal.tier !== "sale" ? <Text style={{ fontFamily: font.bold, fontSize: 12, letterSpacing: 0.8, color: c.ink }}>{deal.tier === "standout" ? "STANDOUT" : "GOOD DEAL"}</Text> : null}
        <Text accessibilityRole="header" style={{ fontFamily: font.display, fontSize: 34, lineHeight: 34, color: c.ink, textTransform: "uppercase" }}>{deal.name}</Text>
        <Text style={{ fontFamily: font.body, color: c.muted, fontSize: 15 }}>{[storeName(deal.store), ...deal.detail, deal.ends ? `through ${fmtDate(deal.ends)}` : ""].filter(Boolean).join(" · ")}</Text>
        <View style={{ alignItems: "flex-start", marginVertical: 10 }}><Price d={deal} size={56} tag /></View>
        {deal.regular ? <Text style={{ fontFamily: font.body, color: c.ink, fontSize: 15 }}>Regular {deal.regular}{deal.off ? <Text style={{ color: c.red, fontFamily: font.bold }}>{`, ${deal.off}% off`}</Text> : null}</Text> : null}
        {deal.why ? <Text style={{ fontFamily: font.body, color: c.ink, fontSize: 16 }}>{deal.why}</Text> : null}
        {deal.notes ? <Text style={{ fontFamily: font.body, color: c.muted, fontSize: 14 }}>{deal.notes}</Text> : null}
        <Pressable onPress={() => (added ? removeDeal(deal) : addToList(shortName(deal.name), deal))} accessibilityRole="button" style={{ marginTop: 12, minHeight: 50, borderRadius: 12, backgroundColor: c.ink, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: c.paper, fontFamily: font.bold, fontSize: 16 }}>{added ? "✓ On your list (tap to remove)" : "+ Add to list"}</Text>
        </Pressable>
        {(() => { const w = watching(deal); return (
          <Pressable onPress={async () => { if (w) unwatch(w.id); else { await allowNotifications(); watch(deal); } }} accessibilityRole="button" style={{ minHeight: 50, borderRadius: 12, borderWidth: 2, borderColor: c.ink, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 }}>
            <Text style={{ color: c.ink, fontFamily: font.bold, fontSize: 16, textAlign: "center" }}>{w ? `Watching: alert under ${w.label} (tap to stop)` : `Watch price: alert me if it's cheaper`}</Text>
          </Pressable>); })()}
        <Pressable onPress={() => Share.share({ message: `${deal.name}: ${deal.text} at ${storeName(deal.store)}${deal.ends ? ` through ${fmtDate(deal.ends)}` : ""}. https://seattlegrocery.deals/stores/${deal.store}/` })} accessibilityRole="button" style={{ minHeight: 50, borderRadius: 12, borderWidth: 2, borderColor: c.ink, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: c.ink, fontFamily: font.bold, fontSize: 16 }}>Share this deal</Text>
        </Pressable>
        {st ? (
          <Pressable onPress={() => { close(); goStore(st.id); }} accessibilityRole="button" style={{ minHeight: 50, borderRadius: 12, borderWidth: 2, borderColor: c.ink, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: c.ink, fontFamily: font.bold, fontSize: 16 }}>More at {st.name}</Text>
          </Pressable>
        ) : null}
        {others.length ? <>
          <Heading title="Also on sale" />
          {others.map((o) => (
            <View key={o.id} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 8, borderBottomWidth: 1, borderColor: c.line, gap: 10 }}>
              <Text style={{ fontFamily: font.body, color: c.ink, flex: 1 }}>{storeName(o.store)}<Text style={{ color: c.muted }}>{`  ${o.name}`}</Text></Text>
              <Text style={{ fontFamily: font.bold, color: c.ink }}>{o.unit_price ?? o.text}</Text>
            </View>
          ))}
        </> : null}
      </ScrollView>
    </Modal>
  );
}

// ---------- Alerts ----------
export function Alerts({ open }: { open: (d: Deal) => void }) {
  const c = useColors();
  const top = useSafeAreaInsets().top;
  const { prefs, setPrefs, watches, unwatch, feed, storeName } = useApp();
  const toggle = async (k: "friday" | "ending", v: boolean) => {
    if (v && !(await allowNotifications())) return;
    setPrefs({ ...prefs, [k]: v });
  };
  const row = (title: string, sub: string, k: "friday" | "ending") => (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderColor: c.line }}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: font.bold, fontSize: 16, color: c.ink }}>{title}</Text>
        <Text style={{ fontFamily: font.body, fontSize: 13, color: c.muted }}>{sub}</Text>
      </View>
      <Switch value={prefs[k]} onValueChange={(v) => toggle(k, v)} trackColor={{ true: c.brand }} accessibilityLabel={title} />
    </View>
  );
  return (
    <ScrollView style={{ backgroundColor: c.paper }} contentContainerStyle={{ paddingBottom: TAB_SPACE, paddingHorizontal: PAD, paddingTop: top + 8 }}>
      <Text accessibilityRole="header" style={{ fontFamily: font.display, fontSize: 40, color: c.ink, textTransform: "uppercase" }}>Alerts</Text>
      <Heading title="Notify me" />
      {row("Friday reminder", "When new deals post, about 10:30 AM", "friday")}
      {row("Ending soon", "The day before a list item's sale ends", "ending")}
      <VegSwitch />
      <Heading title="Price watches" note={String(watches.length)} />
      {!watches.length ? <Text style={{ fontFamily: font.body, color: c.muted, marginTop: 10 }}>Open any deal and tap "Watch price". You'll get an alert when it's cheaper than it is today.</Text> : null}
      {watches.map((w) => {
        const hit = feed ? watchHit(w, feed.items) : null;
        return (
          <Pressable key={w.id} onPress={() => hit && open(hit)} onLongPress={() => unwatch(w.id)} style={{ paddingVertical: 12, borderBottomWidth: 1, borderColor: c.line, gap: 2 }}>
            <Text style={{ fontFamily: font.bold, fontSize: 16, color: c.ink }}>{w.name}{hit ? <Text style={{ fontSize: 12, backgroundColor: c.tag, color: c.onTag }}>{"  CHEAPER NOW  "}</Text> : null}</Text>
            <Text style={{ fontFamily: font.body, fontSize: 13, color: c.muted }}>Under {w.label}{hit ? ` · now ${hit.text} at ${storeName(hit.store)}` : " · not yet"} · long-press to remove</Text>
          </Pressable>
        );
      })}
      <Text style={{ fontFamily: font.body, fontSize: 13, color: c.muted, marginTop: 16 }}>For now these alerts come from the app itself, so price watches are checked when you open it. Once the backend is built, they'll arrive as push notifications on Friday morning.</Text>
    </ScrollView>
  );
}
