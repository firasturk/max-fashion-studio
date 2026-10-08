import { lazy, type ComponentType, type LazyExoticComponent } from "react";

const RELOAD_FLAG = "mfs-chunk-reload";

/** True for the errors a browser raises when a script of an older build no longer exists. */
export function isStaleChunkError(e: unknown): boolean {
  const m = e instanceof Error ? `${e.name} ${e.message}` : String(e);
  return /dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk|Failed to fetch/i.test(
    m,
  );
}

/**
 * Lazy-loads a screen; when its script is gone because the app was redeployed since the page was
 * opened, the page reloads itself once instead of going blank.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyScreen<T extends ComponentType<any>>(
  importer: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  return lazy(() =>
    importer().catch((e: unknown) => {
      let reloaded = false;
      try {
        reloaded = sessionStorage.getItem(RELOAD_FLAG) === "1";
        if (!reloaded) sessionStorage.setItem(RELOAD_FLAG, "1");
      } catch {
        /* storage blocked: reload once anyway */
      }
      if (isStaleChunkError(e) && !reloaded) {
        window.location.reload();
        return new Promise<{ default: T }>(() => {});
      }
      throw e;
    }),
  );
}

/** Clears the one-shot reload guard once a page has loaded cleanly. */
export function markLoadedCleanly(): void {
  try {
    sessionStorage.removeItem(RELOAD_FLAG);
  } catch {
    /* ignore */
  }
}
