import { DEFAULT_CONFIG, MODES, type Config } from "@shared/config";

const CONFIG_KEY = "mfs-config-v1";
const BATCH_KEY = "mfs-last-batch";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* private mode or storage disabled */
  }
}

/** The last studio settings used in this browser, merged over the defaults. Unknown keys are dropped. */
export function loadSavedConfig(): Config {
  const raw = read(CONFIG_KEY);
  if (!raw) return DEFAULT_CONFIG;
  try {
    const saved = JSON.parse(raw) as Partial<Record<keyof Config, unknown>>;
    const out: Record<string, unknown> = { ...DEFAULT_CONFIG };
    for (const k of Object.keys(DEFAULT_CONFIG) as (keyof Config)[]) {
      if (saved[k] !== undefined && typeof saved[k] === typeof DEFAULT_CONFIG[k]) out[k] = saved[k];
    }
    if (typeof saved.model === "string") out.model = saved.model;
    if (!(MODES as readonly string[]).includes(String(out.mode))) out.mode = DEFAULT_CONFIG.mode;
    return out as unknown as Config;
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function saveConfig(c: Config) {
  write(CONFIG_KEY, JSON.stringify(c));
}

export function loadLastBatch(): string | null {
  return read(BATCH_KEY);
}

export function saveLastBatch(id: string | null) {
  write(BATCH_KEY, id);
}
