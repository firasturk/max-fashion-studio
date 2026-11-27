import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { del, get, post } from "@/api";
import type { SkillInfo } from "@shared/types";

interface Guess {
  skill: string | null;
  confidence: "high" | "low" | "none";
  why: string;
  options: string[];
}
interface Folder {
  id: string;
  name: string;
  path: string;
  files: number;
  thumbs: string[];
  state: "waiting" | "importing" | "imported" | "failed" | "skipped" | "gone";
  batch: string | null;
  imported: number;
  skipped: number;
  error: string | null;
  guess: Guess;
}
interface DriveState {
  account: string | null;
  /** Whether the Drive API is switched on in the studio's Google Cloud project. */
  api?: "on" | "off" | "unknown";
  project?: string | null;
  inbox: { id: string; name: string } | null;
  lastSync: number;
  error: string | null;
  folders: Folder[];
  pricePerImage: number;
}

const ENABLE_API = "gcloud services enable drive.googleapis.com";

function ago(ms: number): string {
  if (!ms) return "not yet";
  const m = Math.round((Date.now() - ms) / 60_000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
}

function Copy({ text, label }: { text: string; label: string }) {
  return (
    <button
      className="nx-btn nx-sm"
      onClick={() =>
        navigator.clipboard.writeText(text).then(
          () => toast.success(`${label} copied`),
          () => toast.error("Copy it by hand: select the text"),
        )
      }
    >
      Copy
    </button>
  );
}

/** The Drive inbox: delivery folders wait here, and nothing is generated before an approval. */
export default function InboxPage({
  skills,
  admin,
  onOpenBatch,
  onCount,
  onUpload,
}: {
  skills: SkillInfo[];
  admin: boolean;
  onOpenBatch: (id: string) => void;
  onCount: (waiting: number) => void;
  /** Photos that are not on Drive still come in by upload. */
  onUpload: () => void;
}) {
  const [state, setState] = useState<DriveState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [link, setLink] = useState("");
  const [picked, setPicked] = useState<Record<string, string>>({});
  const timer = useRef<number | undefined>(undefined);

  const load = useCallback(async () => {
    try {
      const s = await get<DriveState>("/api/studio/drive");
      setState(s);
      onCount(s.folders.filter((f) => f.state === "waiting").length);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(
        () => void load(),
        s.folders.some((f) => f.state === "importing") ? 4000 : 30000,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not read the inbox.");
    }
  }, [onCount]);

  useEffect(() => {
    void load();
    return () => window.clearTimeout(timer.current);
  }, [load]);

  async function act(id: string, fn: () => Promise<unknown>, done?: string) {
    setBusy(id);
    try {
      await fn();
      if (done) toast.success(done);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setBusy(null);
    }
  }

  const title = (id: string) => skills.find((s) => s.id === id)?.title ?? id;

  if (!state)
    return (
      <div className="nx">
        <div className="nx-head">
          <h1>Inbox</h1>
        </div>
      </div>
    );

  if (!state.inbox)
    return (
      <div className="nx nx-enter">
        <div className="nx-head">
          <div>
            <h1>Inbox</h1>
            <p>
              Connect a Google Drive folder once. Every delivery folder dropped into it waits here
              for your approval before anything is generated.
            </p>
          </div>
          <div className="nx-right">
            <button className="nx-btn" onClick={onUpload}>
              Upload from your computer
            </button>
          </div>
        </div>
        {!state.account ? (
          <div className="nx-empty">
            <b>Google Cloud is not connected</b>
            Add the Google Cloud service account in Connection first. The same account reads Drive.
          </div>
        ) : !admin ? (
          <div className="nx-empty">
            <b>No Drive folder is connected yet</b>
            Ask an admin to connect it from this page.
          </div>
        ) : (
          <ol className="nx-steps nx-stagger">
            {state.api === "on" ? (
              <li className="nx-done">
                <b>The Drive API is on</b>
                <span>Nothing to do here: the studio checked it.</span>
              </li>
            ) : (
              <li>
                <b>Switch on the Drive API</b>
                <span>
                  The studio tried to switch it on by itself and Google did not allow it. Open this
                  page with the Google account that owns the project and press Enable. It takes
                  about a minute to take effect.
                </span>
                {state.project && (
                  <span>
                    If Google asks you to select a project, choose <b className="nx-mono">{state.project}</b>.
                    If it is not in the list, switch to the Google account that created it (top
                    right corner).
                  </span>
                )}
                <div className="nx-row">
                  <a
                    className="nx-btn nx-primary"
                    target="_blank"
                    rel="noreferrer"
                    href={`https://console.cloud.google.com/apis/library/drive.googleapis.com${state.project ? `?project=${encodeURIComponent(state.project)}` : ""}`}
                  >
                    Open the Drive API page
                  </a>
                  <button
                    className="nx-btn"
                    disabled={busy === "sync"}
                    onClick={() => void act("sync", () => post("/api/studio/drive/check"))}
                  >
                    I pressed Enable, check again
                  </button>
                </div>
                <div className="nx-code">
                  <code>{ENABLE_API}</code>
                  <Copy text={ENABLE_API} label="Command" />
                </div>
              </li>
            )}
            <li>
              <b>Share the folder with the studio</b>
              <span>
                In Google Drive, share the folder your deliveries arrive in with this address.
                Viewer is enough to read; Content manager lets the studio deliver results later.
              </span>
              <div className="nx-code">
                <code>{state.account}</code>
                <Copy text={state.account} label="Address" />
              </div>
            </li>
            <li>
              <b>Paste the folder link</b>
              <span>Open the folder in Drive and copy the link from the address bar.</span>
              <div className="nx-code">
                <input
                  id="drive-link"
                  value={link}
                  onChange={(e) => setLink(e.target.value)}
                  placeholder="https://drive.google.com/drive/folders/…"
                  aria-label="Drive folder link"
                />
                <button
                  className="nx-btn nx-primary"
                  disabled={!link.trim() || busy === "connect"}
                  onClick={() =>
                    void act(
                      "connect",
                      () => post("/api/studio/drive/inbox", { link }),
                      "Drive folder connected",
                    )
                  }
                >
                  {busy === "connect" ? "Connecting…" : "Connect"}
                </button>
              </div>
            </li>
          </ol>
        )}
      </div>
    );

  const shown = state.folders.filter((f) => f.state !== "skipped" && f.state !== "gone");
  return (
    <div className="nx nx-enter">
      <div className="nx-head">
        <div>
          <h1>Inbox</h1>
          <p>
            New folders from <b>{state.inbox.name}</b> wait here. Nothing is generated until you
            approve it.
          </p>
        </div>
        <div className="nx-right">
          <span className="nx-muted">Checked {ago(state.lastSync)}</span>
          <button className="nx-btn" onClick={onUpload}>
            Upload from your computer
          </button>
          <button
            className="nx-btn"
            disabled={busy === "sync"}
            onClick={() => void act("sync", () => post("/api/studio/drive/sync"))}
          >
            {busy === "sync" ? "Checking…" : "Check Drive now"}
          </button>
          {admin && (
            <button
              className="nx-btn nx-quiet"
              onClick={() =>
                void act("off", () => del("/api/studio/drive/inbox"), "Drive folder disconnected")
              }
            >
              Disconnect
            </button>
          )}
        </div>
      </div>
      {state.error && <div className="nx-alert">{state.error}</div>}
      {!shown.length ? (
        <div className="nx-empty">
          <b>Inbox is clear</b>
          Drop a delivery folder into {state.inbox.name} and it appears here within a minute.
        </div>
      ) : (
        <div className="nx-folders nx-stagger">
          {shown.map((f) => {
            const skill = picked[f.id] ?? f.guess.skill ?? "";
            const cost = f.files * state.pricePerImage;
            const order = [
              ...f.guess.options,
              ...skills.map((s) => s.id).filter((id) => !f.guess.options.includes(id)),
            ].filter((id) => skills.some((s) => s.id === id));
            return (
              <article className="nx-folder" key={f.id}>
                <div className="nx-a">
                  <div>
                    {f.path && <div className="nx-path">{f.path}</div>}
                    <div className="nx-name">{f.name}</div>
                  </div>
                  <div className="nx-strip">
                    {f.thumbs.map((t) => (
                      <img
                        key={t}
                        src={`/api/studio/drive/thumb?id=${encodeURIComponent(t)}`}
                        alt="Photo from the folder"
                        loading="lazy"
                      />
                    ))}
                    <span className="nx-more">
                      {f.thumbs.length && f.files > f.thumbs.length
                        ? `+${f.files - f.thumbs.length}`
                        : `${f.files} photos`}
                    </span>
                  </div>
                  {f.state === "waiting" || f.state === "failed" ? (
                    <div className="nx-row">
                      <button
                        className="nx-btn nx-primary"
                        disabled={!skill || !f.files || busy === f.id}
                        onClick={() =>
                          void act(
                            f.id,
                            () => post("/api/studio/drive/approve", { folder: f.id, skill, start: true }),
                            `Started ${f.name}`,
                          )
                        }
                      >
                        {f.state === "failed" ? "Try again" : "Approve and start"}
                      </button>
                      <button
                        className="nx-btn"
                        disabled={!skill || !f.files || busy === f.id}
                        onClick={() =>
                          void act(
                            f.id,
                            () => post("/api/studio/drive/approve", { folder: f.id, skill, start: false }),
                            "Importing. Open the batch to change settings before generating.",
                          )
                        }
                      >
                        Import only
                      </button>
                      <button
                        className="nx-btn nx-quiet"
                        disabled={busy === f.id}
                        onClick={() =>
                          void act(f.id, () => post("/api/studio/drive/skip", { folder: f.id }))
                        }
                      >
                        Skip
                      </button>
                    </div>
                  ) : f.state === "importing" ? (
                    <div className="nx-progress">
                      <div className="nx-bar">
                        <i style={{ width: `${Math.min(100, (f.imported / Math.max(1, f.files)) * 100)}%` }} />
                      </div>
                      <span>
                        Importing {f.imported} of {f.files}
                      </span>
                    </div>
                  ) : (
                    <div className="nx-row">
                      <span className="nx-chip nx-ok">Imported {f.imported}</span>
                      {f.skipped > 0 && <span className="nx-chip nx-warn">{f.skipped} left out</span>}
                      {f.batch && (
                        <button className="nx-btn" onClick={() => onOpenBatch(f.batch!)}>
                          Open batch
                        </button>
                      )}
                    </div>
                  )}
                  {f.error && <div className="nx-alert">{f.error}</div>}
                </div>
                <div className="nx-b">
                  <dl className="nx-kv">
                    <dt>Skill</dt>
                    <dd>
                      {f.state === "waiting" || f.state === "failed" ? (
                        <select
                          id={`skill-${f.id}`}
                          aria-label={`Skill for ${f.name}`}
                          value={skill}
                          onChange={(e) => setPicked((p) => ({ ...p, [f.id]: e.target.value }))}
                        >
                          <option value="">Choose a skill</option>
                          {order.map((id) => (
                            <option key={id} value={id}>
                              {title(id)}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <b>{title(skill)}</b>
                      )}{" "}
                      {f.guess.confidence === "high" ? (
                        <span className="nx-chip nx-ok">Confident</span>
                      ) : f.guess.confidence === "low" ? (
                        <span className="nx-chip nx-warn">Check this</span>
                      ) : (
                        <span className="nx-chip nx-warn">Needs your choice</span>
                      )}
                    </dd>
                    <dt>Estimate</dt>
                    <dd className="nx-mono">
                      ${cost.toFixed(2)} · about {Math.max(1, Math.round(f.files / 5))} min
                    </dd>
                    <dt>Photos</dt>
                    <dd className="nx-mono">{f.files}</dd>
                  </dl>
                  <div className="nx-why">{f.guess.why}</div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
