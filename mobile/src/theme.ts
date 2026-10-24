// The site's "Newsprint" design tokens. Content uses these; app chrome uses Liquid Glass where available.
import { useColorScheme } from "react-native";

const light = {
  paper: "#F7F5F0", surface: "#FFFFFF", ink: "#141414", muted: "#57534C", line: "#DDD8CE", lineUi: "#8C867B",
  brand: "#1D4D33", onBrand: "#FFFFFF", tag: "#FFE45C", onTag: "#141414", red: "#B3261E",
};
const dark: typeof light = {
  paper: "#151412", surface: "#1E1C19", ink: "#F2EFE8", muted: "#ADA79C", line: "#2E2B27", lineUi: "#6E685F",
  brand: "#1D4D33", onBrand: "#FFFFFF", tag: "#FFE45C", onTag: "#141414", red: "#FF8A80",
};
export type Colors = typeof light;
export const useColors = (): Colors => (useColorScheme() === "dark" ? dark : light);

export const font = {
  display: "BarlowCondensed_700Bold",
  body: "AtkinsonHyperlegible_400Regular",
  bold: "AtkinsonHyperlegible_700Bold",
};
