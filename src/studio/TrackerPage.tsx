import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { get, post } from "@/api";

interface Row {
  month: string;
  pos: number;
  name: string;
  done: number;
  shared: number;
  delivered: boolean;
  received: string;
  sent: string;
  note: string;
  upload: string;
  published: string;
}
interface Month {
  month: string;
  folders: number;
  products: number;
  deliveredFolders: number;
  deliveredProducts: number;
  uploadedFolders: number;
  rows: Row[];
}
interface View {
  sheet: { id: string; name: string } | null;
  lastSync: number;
  error: string | null;
  months: Month[];
}

const monthName = (m: string) =>
  new Date(`${m}-01T00:00:00Z`).toLocaleString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
const day = (d: string) =>
  d
    ? new Date(`${d}T00:00:00Z`).toLocaleString("en-GB", {
        day: "numeric",
        month: "short",
        timeZone: "UTC",
      })
    : "–";

/**
 * The client's tracker sheet as the studio last read it: what was received, what was delivered,
 * what is still open and what was uploaded. A preview only: the studio never writes to the sheet.
 */
export default function TrackerPage() {
  const [view, setView] = useState<View | null>(null);
  const [month, setMonth] = useState("");
  const [show, setShow] = useState<"all" | "open" | "delivered" | "uploaded">("open");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setView(await get<View>("/api/studio/tracker"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not read the tracker.");
    }
  }, []);
  useEffect(() => void load(), [load]);

  async function refresh() {
    setBusy(true);
    try {
      setView(await post<View>("/api/studio/tracker/sync"));
      toast.success("Tracker read again.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not read the tracker.");
    } finally {
      setBusy(false);
    }
  }

  if (!view) return <div className="nx nx-enter" aria-busy="true" />;
  const current = view.months.find((m) => m.month === month) ?? view.months[0];
  const rows = (current?.rows ?? []).filter((r) =>
    show === "open"
      ? !r.delivered
      : show === "delivered"
        ? r.delivered
        : show === "uploaded"
          ? !!r.upload
          : true,
  );
  const open = current ? current.folders - current.deliveredFolders : 0;
  const openProducts = current ? current.products - current.deliveredProducts : 0;
  const ago = view.lastSync
    ? `${Math.max(0, Math.round((Date.now() - view.lastSync) / 60000))} min ago`
    : "not yet";
  return (
    <div className="nx nx-enter">
      <div className="nx-head">
        <div>
          <h1>Tracker</h1>
          <p>
            A read-only preview of{" "}
            {view.sheet ? (
              <a
                href={`https://docs.google.com/spreadsheets/d/${view.sheet.id}`}
                target="_blank"
                rel="noreferrer"
              >
                <b>{view.sheet.name}</b>
              </a>
            ) : (
              "the client's tracker sheet"
            )}
            . The studio reads it to know what was delivered; it never changes it.
          </p>
        </div>
        <div className="nx-right">
          <span className="nx-muted">Read {ago}</span>
          <button className="nx-btn" disabled={busy} onClick={() => void refresh()}>
            {busy ? "Reading…" : "Read it again"}
          </button>
        </div>
      </div>
      {view.error && <div className="nx-alert">{view.error}</div>}
      {!current ? (
        <div className="nx-empty">
          <b>No tracker yet</b>
          The studio looks for a sheet named Tracker next to the Drive folders it reads. Connect the
          Drive folder in the Inbox first.
        </div>
      ) : (
        <>
          <div className="nx-row">
            <div className="nx-seg" role="group" aria-label="Month">
              {view.months.map((m) => (
                <button
                  key={m.month}
                  aria-pressed={m.month === current.month}
                  onClick={() => setMonth(m.month)}
                >
                  {monthName(m.month)}
                </button>
              ))}
            </div>
          </div>
          <div className="nx-tiles">
            <div className="nx-tile">
              <span>Received</span>
              <b className="nx-mono">{current.products}</b>
              <em>{current.folders} folders</em>
            </div>
            <div className="nx-tile">
              <span>Delivered</span>
              <b className="nx-mono">{current.deliveredProducts}</b>
              <em>{current.deliveredFolders} folders</em>
            </div>
            <div className={`nx-tile${open ? " nx-hot" : ""}`}>
              <span>Still open</span>
              <b className="nx-mono">{openProducts}</b>
              <em>{open} folders</em>
            </div>
            <div className="nx-tile">
              <span>Uploaded</span>
              <b className="nx-mono">{current.uploadedFolders}</b>
              <em>folders in a ReadyToPublish upload</em>
            </div>
          </div>
          <div className="nx-row">
            <div className="nx-seg" role="group" aria-label="Show">
              <button aria-pressed={show === "open"} onClick={() => setShow("open")}>
                Still open <span className="nx-mono">{open}</span>
              </button>
              <button aria-pressed={show === "delivered"} onClick={() => setShow("delivered")}>
                Delivered <span className="nx-mono">{current.deliveredFolders}</span>
              </button>
              <button aria-pressed={show === "uploaded"} onClick={() => setShow("uploaded")}>
                Uploaded <span className="nx-mono">{current.uploadedFolders}</span>
              </button>
              <button aria-pressed={show === "all"} onClick={() => setShow("all")}>
                All <span className="nx-mono">{current.folders}</span>
              </button>
            </div>
          </div>
          {rows.length ? (
            <div className="nx-tablewrap">
              <table className="nx-table">
                <thead>
                  <tr>
                    <th>Folder</th>
                    <th className="nx-n">Products</th>
                    <th>Status</th>
                    <th>Received</th>
                    <th>Delivered</th>
                    <th>Uploaded</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.pos}>
                      <td>
                        <b>{r.name}</b>
                      </td>
                      <td className="nx-n nx-mono">
                        {r.delivered || !r.done ? r.shared : `${r.done} of ${r.shared}`}
                      </td>
                      <td>
                        {r.delivered ? (
                          <span className="nx-chip nx-ok">Delivered</span>
                        ) : (
                          <span className="nx-chip nx-warn">Still open</span>
                        )}
                      </td>
                      <td className="nx-muted">{day(r.received)}</td>
                      <td className="nx-muted">{day(r.sent)}</td>
                      <td>
                        {r.upload ? (
                          <>
                            <span className="nx-mono">{r.upload}</span>
                            {r.published && <span className="nx-muted"> · {r.published}</span>}
                          </>
                        ) : (
                          <span className="nx-muted">–</span>
                        )}
                      </td>
                      <td className="nx-muted">{r.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="nx-empty">
              <b>Nothing here</b>
              No folder of {monthName(current.month)} is in this list.
            </div>
          )}
        </>
      )}
    </div>
  );
}
