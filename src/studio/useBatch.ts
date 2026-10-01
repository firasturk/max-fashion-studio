import { useCallback, useEffect, useRef, useState } from "react";
import { get, post, del } from "@/api";
import type { Batch, BatchResponse, Source, Task } from "@shared/types";

const TICK_MS = 4000;

export interface BatchView {
  batch: Batch | null;
  sources: Source[];
  tasks: Task[];
}

/** Holds the open batch and keeps it moving: while it runs, the client ticks the server every few seconds. */
export function useBatch() {
  const [view, setView] = useState<BatchView>({ batch: null, sources: [], tasks: [] });
  const current = useRef<string | null>(null);
  const ticking = useRef(false);

  const apply = useCallback((id: string, d: BatchResponse) => {
    if (current.current === id) setView({ batch: d.batch, sources: d.sources, tasks: d.tasks });
  }, []);

  const open = useCallback(
    async (id: string) => {
      current.current = id;
      apply(id, await get<BatchResponse>(`/api/studio/batch?batch=${encodeURIComponent(id)}`));
    },
    [apply],
  );

  const close = useCallback(() => {
    current.current = null;
    setView({ batch: null, sources: [], tasks: [] });
  }, []);

  const action = useCallback(
    async (path: string, body: Record<string, unknown> = {}) => {
      const id = current.current;
      if (!id) return;
      apply(id, await post<BatchResponse>(`/api/studio/${path}`, { batch: id, ...body }));
    },
    [apply],
  );

  const active =
    view.batch?.state === "running" || view.tasks.some((t) => t.status === "processing");

  useEffect(() => {
    if (!active) return;
    const id = current.current;
    if (!id) return;
    // The tick drives generation and the server holds it open until the images it started are
    // saved (up to a minute or two), so a separate light refresh keeps the view current meanwhile.
    const tick = async () => {
      if (ticking.current || document.hidden) return;
      ticking.current = true;
      try {
        apply(id, await post<BatchResponse>("/api/studio/tick", { batch: id }));
      } catch {
        /* transient; next tick retries */
      } finally {
        ticking.current = false;
      }
    };
    void tick();
    const timer = setInterval(tick, TICK_MS);
    const refresher = setInterval(async () => {
      if (!ticking.current || document.hidden) return;
      try {
        apply(id, await get<BatchResponse>(`/api/studio/batch?batch=${encodeURIComponent(id)}`));
      } catch {
        /* transient */
      }
    }, TICK_MS);
    return () => {
      clearInterval(timer);
      clearInterval(refresher);
    };
  }, [active, apply, view.batch?.id]);

  const remove = useCallback(async () => {
    const id = current.current;
    if (!id) return;
    await del(`/api/studio/batch?batch=${encodeURIComponent(id)}`);
    close();
  }, [close]);

  return {
    ...view,
    active,
    open,
    close,
    refresh: () => (current.current ? open(current.current) : Promise.resolve()),
    action,
    remove,
  };
}
