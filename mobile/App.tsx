import { AtkinsonHyperlegible_400Regular, AtkinsonHyperlegible_700Bold } from "@expo-google-fonts/atkinson-hyperlegible";
import { BarlowCondensed_700Bold } from "@expo-google-fonts/barlow-condensed";
import { useFonts } from "expo-font";
import * as Haptics from "expo-haptics";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { screen, startAnalytics, track } from "./src/analytics";
import { Pressable, Text, View } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { Deal } from "./src/data";
import { SymbolView } from "expo-symbols";
import { Platform } from "react-native";
import { Alerts, DealSheet, Departments, List, Stores, ThisWeek } from "./src/screens";
import { AppProvider, useApp } from "./src/state";
import { font, useColors } from "./src/theme";
import { Glass } from "./src/ui";

type Tab = "week" | "depts" | "stores" | "list" | "alerts";
const TABS: [Tab, string, string, string][] = [["week", "This week", "house", "⌂"], ["depts", "Aisles", "square.grid.2x2", "▦"], ["stores", "Stores", "storefront", "⌸"], ["list", "List", "checklist", "☰"], ["alerts", "Alerts", "bell", "◔"]];

function Shell() {
  const c = useColors();
  const bottom = useSafeAreaInsets().bottom;
  const { list, feed } = useApp();
  const [tab, setTab] = useState<Tab>("week");
  const [deal, setDeal] = useState<Deal | null>(null);
  const [storeKey, setStoreKey] = useState(0);
  const [storeId, setStoreId] = useState<string | null>(null);
  const open = (d: Deal) => { setDeal(d); track("Viewed Deal", { deal_id: d.id, store: d.store, category: d.category, tier: d.tier, from_screen: tab }); };
  useEffect(() => { screen(TABS.find((t) => t[0] === tab)![1]); }, [tab]);
  const left = list.filter((i) => !i.done).length;
  return (
    <View style={{ flex: 1, backgroundColor: c.paper }}>
      <StatusBar style={tab === "list" || tab === "alerts" ? "auto" : "light"} />
      {tab === "week" && <ThisWeek open={open} goList={() => setTab("list")} />}
      {tab === "depts" && <Departments open={open} />}
      {tab === "stores" && <Stores key={storeKey} open={open} initial={storeId} />}
      {tab === "list" && <List open={open} />}
      {tab === "alerts" && <Alerts open={open} />}
      {!feed ? <View style={{ position: "absolute", top: "45%", alignSelf: "center" }}><Text style={{ fontFamily: font.body, color: c.muted }}>Loading this week's deals…</Text></View> : null}
      {/* Floating Liquid Glass tab bar */}
      <View style={{ position: "absolute", left: 16, right: 16, bottom: Math.max(bottom, 12) }} pointerEvents="box-none">
        <Glass style={{ flexDirection: "row", borderRadius: 32, paddingVertical: 6, paddingHorizontal: 6, overflow: "hidden" }}>
          {TABS.map(([id, label, symbol, icon]) => {
            const on = tab === id;
            return (
              <Pressable key={id} onPress={() => { if (id === "stores") { setStoreId(null); setStoreKey((k) => k + 1); } setTab(id); Haptics.selectionAsync().catch(() => {}); }} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={label}
                style={{ flex: 1, alignItems: "center", paddingVertical: 6, borderRadius: 26, backgroundColor: on ? "rgba(29,77,51,0.16)" : "transparent" }}>
                {Platform.OS === "ios" ? <SymbolView name={symbol as any} size={22} tintColor={on ? c.ink : c.muted} /> : <Text style={{ fontSize: 18, color: on ? c.ink : c.muted }}>{icon}</Text>}
                <Text style={{ fontFamily: font.bold, fontSize: 11, color: on ? c.ink : c.muted }}>{label}{id === "list" && left ? ` (${left})` : ""}</Text>
              </Pressable>
            );
          })}
        </Glass>
      </View>
      <DealSheet deal={deal} close={() => setDeal(null)} goStore={(id) => { setStoreId(id); setTab("stores"); setStoreKey((k) => k + 1); }} />
    </View>
  );
}

startAnalytics().catch(() => {});

export default function App() {
  const [loaded] = useFonts({ BarlowCondensed_700Bold, AtkinsonHyperlegible_400Regular, AtkinsonHyperlegible_700Bold });
  if (!loaded) return null;
  return (
    <SafeAreaProvider>
      <AppProvider>
        <Shell />
      </AppProvider>
    </SafeAreaProvider>
  );
}
