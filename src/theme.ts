import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";
const KEY = "mfs-theme";

function stored(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "dark" || v === "light" ? v : null;
  } catch {
    return null;
  }
}

function system(): Theme {
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function currentTheme(): Theme {
  return stored() ?? system();
}

export function applyTheme(theme: Theme, persist = true) {
  document.documentElement.dataset.theme = theme;
  if (persist) {
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      /* private mode */
    }
  }
}

/** Apply the saved or system theme before first paint and follow system changes while unset. */
export function initTheme() {
  applyTheme(currentTheme(), false);
  if (typeof matchMedia !== "function") return;
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (!stored()) applyTheme(system(), false);
  });
}

export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() =>
    typeof document === "undefined" ? "light" : currentTheme(),
  );
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);
  const toggle = useCallback(() => setTheme((t) => (t === "dark" ? "light" : "dark")), []);
  return [theme, toggle];
}
