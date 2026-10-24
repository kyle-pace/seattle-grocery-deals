// Shared pieces: glass bar, price, deal row, section heading, switch.
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import * as Haptics from "expo-haptics";
import { ReactNode, useEffect, useState } from "react";
import { AccessibilityInfo, Platform, Pressable, StyleSheet, Switch, Text, View, ViewStyle } from "react-native";
import { Deal } from "./data";
import { useApp } from "./state";
import { Colors, font, useColors } from "./theme";

// Liquid Glass on iOS 26 when the person hasn't asked for less transparency; a solid surface otherwise.
export function Glass({ style, children }: { style?: ViewStyle; children: ReactNode }) {
  const c = useColors();
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    if (Platform.OS !== "ios") return;
    AccessibilityInfo.isReduceTransparencyEnabled().then(setReduce).catch(() => {});
    const sub = AccessibilityInfo.addEventListener("reduceTransparencyChanged", setReduce);
    return () => sub.remove();
  }, []);
  if (Platform.OS === "ios" && !reduce && isLiquidGlassAvailable()) return <GlassView glassEffectStyle="regular" isInteractive style={style}>{children}</GlassView>;
  return <View style={[style, { backgroundColor: c.paper, borderWidth: 1.5, borderColor: c.lineUi }]}>{children}</View>;
}

export function Price({ d, size = 28, tag }: { d: Deal; size?: number; tag?: boolean }) {
  const c = useColors();
  const cents = !d.amount.startsWith("$");
  const body = (
    <Text style={{ fontFamily: font.display, fontSize: size, color: tag ? c.onTag : c.ink, lineHeight: size * 1.05 }}>
      {cents ? "" : <Text style={{ fontSize: size * 0.55 }}>$</Text>}
      {cents ? d.amount : d.amount.slice(1)}
      {d.unit ? <Text style={{ fontSize: size * 0.55 }}>{d.unit === "ea" ? " ea" : d.unit}</Text> : null}
    </Text>
  );
  return (
    <View accessible accessibilityLabel={d.spoken} style={{ alignItems: "flex-end" }}>
      {d.lead ? <Text style={{ fontFamily: font.bold, fontSize: 11, color: c.ink }}>{d.lead}</Text> : null}
      {tag ? <View style={{ backgroundColor: c.tag, paddingHorizontal: 6, paddingTop: 2, transform: [{ rotate: "-3deg" }], shadowColor: "#000", shadowOffset: { width: 2, height: 2 }, shadowOpacity: 1, shadowRadius: 0 }}>{body}</View> : body}
    </View>
  );
}

export function DealRow({ d, onPress, showStore = true, why = false }: { d: Deal; onPress: () => void; showStore?: boolean; why?: boolean }) {
  const c = useColors();
  const { storeName, addToList, inList } = useApp();
  const added = inList(d);
  const meta = [showStore ? storeName(d.store) : "", ...d.detail, d.regular ? `was ${d.regular}` : ""].filter(Boolean).join(" · ");
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityHint="Shows details" style={({ pressed }) => [s.row, { borderColor: c.line, opacity: pressed ? 0.6 : 1 }]}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontFamily: font.bold, fontSize: 16, color: c.ink }}>
          {d.tier === "standout" ? <Text style={{ fontSize: 11, letterSpacing: 0.6 }}>STANDOUT  </Text> : null}{d.name}
        </Text>
        <Text style={{ fontFamily: font.body, fontSize: 13, color: c.muted }}>
          {meta}{d.off ? <Text style={{ color: c.red, fontFamily: font.bold }}>{`  ${d.off}% off`}</Text> : null}
        </Text>
        {why && d.why ? <Text style={{ fontFamily: font.body, fontSize: 14, color: c.ink, marginTop: 2 }}>{d.why}</Text> : null}
      </View>
      <Price d={d} tag={d.tier === "standout"} />
      <Pressable
        onPress={() => { if (!added) { addToList(shortName(d.name), d); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); } }}
        accessibilityRole="button" accessibilityLabel={added ? `${d.name} is on your list` : `Add ${d.name} to your list`}
        hitSlop={8} style={[s.add, { borderColor: c.ink, backgroundColor: added ? c.ink : c.surface }]}>
        <Text style={{ color: added ? c.paper : c.ink, fontFamily: font.bold, fontSize: 18, lineHeight: 20 }}>{added ? "✓" : "+"}</Text>
      </Pressable>
    </Pressable>
  );
}

// "Fuyu Persimmon (California), Jumbo" -> "Fuyu Persimmon"
export const shortName = (n: string) => n.split(/[,(]/)[0].trim();

export function Heading({ title, note }: { title: string; note?: string }) {
  const c = useColors();
  return (
    <View style={[s.heading, { borderColor: c.ink }]} accessibilityRole="header">
      <Text style={{ fontFamily: font.display, fontSize: 24, color: c.ink, textTransform: "uppercase" }}>{title}</Text>
      {note ? <Text style={{ fontFamily: font.body, fontSize: 13, color: c.muted }}>{note}</Text> : null}
    </View>
  );
}

export function VegSwitch() {
  const c = useColors();
  const { veg, setVeg } = useApp();
  return (
    <View style={s.vegRow}>
      <Text style={{ fontFamily: font.bold, fontSize: 16, color: c.ink }}>Vegetarian only</Text>
      <Switch value={veg} onValueChange={setVeg} trackColor={{ true: c.brand }} accessibilityLabel="Vegetarian only" />
    </View>
  );
}

export const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth * 2 },
  add: { width: 36, height: 36, borderRadius: 18, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  heading: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", borderBottomWidth: 3, paddingBottom: 4, marginTop: 22, marginBottom: 2 },
  vegRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", minHeight: 44 },
});

export type { Colors };
