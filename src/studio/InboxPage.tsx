import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { del, get, post } from "@/api";
import type { SkillInfo } from "@shared/types";
import { skillTone } from "./tone";

const FolderPhotos = lazy(() => import("./FolderPhotos"));

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
  /** Photos that will be generated: the first two views of every product. 0 until counted. */
  files: number;
  products: number;
  /** Photos somebody gave a choice of their own (a skill, added, or left out). */
  choices: number;
  /** What the client's tracker says about this folder; null when it is not listed there. */
  tracker: {
    state: "delivered" | "working";
    line: string;
    sent: string;
    upload: string;
    published: string;
  } | null;
  thumbs: string[];
  state: "waiting" | "importing" | "imported" | "failed" | "skipped" | "gone";
  batch: string | null;
  imported: number;
  skipped: number;
  error: string | null;
  guess: Guess;
}
interface DriveState {
  /** The Google account signed in for Drive. */
  account: string | null;
  /** Whether the Client ID and secret (step 1) are saved. */
  client: boolean;
  /** Project number of that client: where the Drive API is switched on. */
  project: string | null;
  /** The address Google sends the sign-in back to; it goes on the OAuth client. */
  redirect: string;
  api: "on" | "off" | "unknown";
  inbox: { id: string; name: string } | null;
  lastSync: number;
  error: string | null;
  folders: Folder[];
  /** Folders somebody skipped; they can be brought back. */
  skipped: number;
  pricePerImage: number;
}

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
}: {
  skills: SkillInfo[];
  admin: boolean;
  onOpenBatch: (id: string) => void;
  onCount: (waiting: number) => void;
}) {
  const [state, setState] = useState<DriveState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [link, setLink] = useState("");
  const [picked, setPicked] = useState<Record<string, string>>({});
  const timer = useRef<number | undefined>(undefined);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [editClient, setEditClient] = useState(false);
  /** The month (top folder) being looked at; empty shows every month. */
  const [only, setOnly] = useState("");
  /** Folders the tracker marks as delivered stay out of the way unless asked for. */
  const [delivered, setDelivered] = useState(false);
  /** The folder whose photos are open. */
  const [looking, setLooking] = useState<{ id: string; name: string; skill: string } | null>(null);
  const stopLooking = useCallback(() => setLooking(null), []);

  const load = useCallback(async () => {
    try {
      const s = await get<DriveState>("/api/studio/drive");
      setState(s);
      onCount(
        s.folders.filter((f) => f.state === "waiting" && f.tracker?.state !== "delivered").length,
      );
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

  async function signIn() {
    setBusy("signin");
    try {
      const { url } = await post<{ url: string }>("/api/studio/drive/signin");
      window.location.href = url;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start the sign-in.");
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
          <div className="nx-right"></div>
        </div>
        {!admin ? (
          <div className="nx-empty">
            <b>No Drive folder is connected yet</b>
            Ask an admin to connect it from this page.
          </div>
        ) : (
          <ol className="nx-steps nx-stagger">
            {state.client ? (
              <li className="nx-done">
                <b>The Google sign-in is set up</b>
                <span>The Client ID and secret are saved in the studio.</span>
                <div className="nx-row">
                  <button className="nx-btn nx-sm" onClick={() => setEditClient(true)}>
                    Replace them
                  </button>
                </div>
              </li>
            ) : (
              <li>
                <b>Create the Google sign-in</b>
                <span>
                  In Google Cloud, signed in as the account that owns the Drive: open Google Auth
                  Platform, press Get started, give the app any name, choose Internal as the
                  audience, and finish. Then Clients, Create client, Web application. Under
                  Authorized redirect URIs press Add URI and paste this address:
                </span>
                <div className="nx-code">
                  <code>{state.redirect}</code>
                  <Copy text={state.redirect} label="Address" />
                </div>
                <div className="nx-row">
                  <a
                    className="nx-btn"
                    target="_blank"
                    rel="noreferrer"
                    href="https://console.cloud.google.com/auth/overview"
                  >
                    Open Google Auth Platform
                  </a>
                </div>
              </li>
            )}
            {(!state.client || editClient) && (
              <li className="nx-sub">
                <span>
                  Google then shows a Client ID and a Client secret. Paste both here. They are
                  stored encrypted in the studio; never send them in a chat.
                </span>
                <div className="nx-code">
                  <input
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                    placeholder="Client ID (ends with .apps.googleusercontent.com)"
                    aria-label="Client ID"
                    autoComplete="off"
                  />
                </div>
                <div className="nx-code">
                  <input
                    type="password"
                    value={clientSecret}
                    onChange={(e) => setClientSecret(e.target.value)}
                    placeholder="Client secret"
                    aria-label="Client secret"
                    autoComplete="off"
                  />
                  <button
                    className="nx-btn nx-primary"
                    disabled={!clientId.trim() || !clientSecret.trim() || busy === "client"}
                    onClick={() =>
                      void act(
                        "client",
                        async () => {
                          await post("/api/studio/drive/client", {
                            id: clientId,
                            secret: clientSecret,
                          });
                          setClientId("");
                          setClientSecret("");
                          setEditClient(false);
                        },
                        "Saved. Now sign in with Google.",
                      )
                    }
                  >
                    {busy === "client" ? "Saving…" : "Save"}
                  </button>
                </div>
              </li>
            )}
            {state.api === "on" ? (
              <li className="nx-done">
                <b>The Drive API is on</b>
                <span>Nothing to do here: the studio checked it.</span>
              </li>
            ) : (
              <li>
                <b>Switch on the Drive API</b>
                <span>
                  In the same Google Cloud project, open this page and press Enable. It takes about
                  a minute to take effect.
                </span>
                <div className="nx-row">
                  <a
                    className="nx-btn"
                    target="_blank"
                    rel="noreferrer"
                    href={`https://console.developers.google.com/apis/api/drive.googleapis.com/overview${state.project ? `?project=${encodeURIComponent(state.project)}` : ""}`}
                  >
                    Open the Drive API page
                  </a>
                  {state.account && (
                    <button
                      className="nx-btn"
                      disabled={busy === "sync"}
                      onClick={() => void act("sync", () => post("/api/studio/drive/check"))}
                    >
                      I pressed Enable, check again
                    </button>
                  )}
                </div>
              </li>
            )}
            {state.account ? (
              <li className="nx-done">
                <b>Signed in to Google Drive</b>
                <span>
                  The studio reads Drive as <b className="nx-mono">{state.account}</b>, apart from
                  the account that pays for images.
                </span>
                <div className="nx-row">
                  <button
                    className="nx-btn nx-sm nx-quiet"
                    onClick={() =>
                      void act(
                        "out",
                        () => del("/api/studio/drive/account"),
                        "Signed out of Google Drive",
                      )
                    }
                  >
                    Sign out
                  </button>
                </div>
              </li>
            ) : (
              <li>
                <b>Sign in with Google</b>
                <span>
                  Choose the account that owns the Drive and allow access. The studio sees the
                  folders that account sees; nothing has to be shared.
                </span>
                <div className="nx-row">
                  <button
                    className="nx-btn nx-primary"
                    disabled={!state.client || busy === "signin"}
                    onClick={() => void signIn()}
                  >
                    {busy === "signin" ? "Opening Google…" : "Sign in with Google"}
                  </button>
                </div>
              </li>
            )}
            <li>
              <b>Choose the deliveries folder</b>
              <span>
                Let the studio create its own folders in your Drive (Max Fashion Studio, with 1 -
                Inbox and 2 - Approved inside), or paste the link of a folder you already use.
              </span>
              <div className="nx-row">
                <button
                  className="nx-btn nx-primary"
                  disabled={!state.account || busy === "setup"}
                  onClick={() =>
                    void act(
                      "setup",
                      () => post("/api/studio/drive/setup"),
                      "Folders created in your Drive",
                    )
                  }
                >
                  {busy === "setup" ? "Creating…" : "Create the folders for me"}
                </button>
              </div>
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
                  disabled={!state.account || !link.trim() || busy === "connect"}
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

  const present = state.folders.filter((f) => f.state !== "skipped" && f.state !== "gone");
  // Delivered per the client's tracker and not being worked on here: nothing left to do with it.
  const isDone = (f: Folder) => f.tracker?.state === "delivered" && f.state === "waiting";
  const doneCount = present.filter(isDone).length;
  const every = present.filter((f) => delivered === isDone(f));
  const monthOf = (f: Folder) => f.path.split(" / ")[0] || "Top level";
  const months = [...new Set(every.map(monthOf))];
  const shown = only && months.includes(only) ? every.filter((f) => monthOf(f) === only) : every;
  // One section per place in Drive (a day's drop, a department), in the order the folders arrive.
  const groups: { path: string; items: Folder[] }[] = [];
  for (const f of shown) {
    const g = groups.find((x) => x.path === f.path);
    if (g) g.items.push(f);
    else groups.push({ path: f.path, items: [f] });
  }
  const sum = (list: Folder[], key: "products" | "files") => list.reduce((n, f) => n + f[key], 0);
  const skipAll = (path: string, count: number) => {
    if (!window.confirm(`Skip all ${count} folders under ${path}? You can bring them back.`))
      return;
    void act(`skip:${path}`, () => post("/api/studio/drive/skip", { path }), `Skipped ${path}`);
  };
  return (
    <div className="nx nx-enter">
      <div className="nx-head">
        <div>
          <h1>Inbox</h1>
          <p>
            New folders from{" "}
            <a
              href={`https://drive.google.com/drive/folders/${state.inbox.id}`}
              target="_blank"
              rel="noreferrer"
            >
              <b>{state.inbox.name}</b>
            </a>{" "}
            wait here. Nothing is generated until you approve it.
          </p>
        </div>
        <div className="nx-right">
          <span className="nx-muted">Checked {ago(state.lastSync)}</span>
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
      {(months.length > 1 || state.skipped > 0 || doneCount > 0) && (
        <div className="nx-row">
          {months.length > 1 && (
            <div className="nx-seg" role="group" aria-label="Month">
              <button aria-pressed={!only} onClick={() => setOnly("")}>
                All <span className="nx-mono">{every.length}</span>
              </button>
              {months.map((m) => (
                <button key={m} aria-pressed={only === m} onClick={() => setOnly(m)}>
                  {m}{" "}
                  <span className="nx-mono">{every.filter((f) => monthOf(f) === m).length}</span>
                </button>
              ))}
            </div>
          )}
          <span className="nx-muted">
            {shown.length} folders · {sum(shown, "products")} products
            {delivered ? " already delivered" : ""}
          </span>
          {doneCount > 0 && (
            <button
              className="nx-btn nx-sm"
              aria-pressed={delivered}
              onClick={() => setDelivered((v) => !v)}
            >
              {delivered ? "Back to what is waiting" : `Show ${doneCount} delivered`}
            </button>
          )}
          <span className="nx-right">
            {only && months.includes(only) && (
              <button className="nx-btn nx-sm nx-quiet" onClick={() => skipAll(only, shown.length)}>
                Skip everything in {only}
              </button>
            )}
            {state.skipped > 0 && (
              <button
                className="nx-btn nx-sm nx-quiet"
                disabled={busy === "unskip"}
                onClick={() =>
                  void act(
                    "unskip",
                    () => post("/api/studio/drive/unskip"),
                    "Skipped folders are back",
                  )
                }
              >
                Bring back {state.skipped} skipped
              </button>
            )}
          </span>
        </div>
      )}
      {!shown.length ? (
        <div className="nx-empty">
          <b>Inbox is clear</b>
          Drop a delivery folder into {state.inbox.name} and it appears here within a minute. Start
          its name with the date, for example 28-11-2026-WW Denim.
          <div className="nx-row nx-center">
            <a
              className="nx-btn"
              href={`https://drive.google.com/drive/folders/${state.inbox.id}`}
              target="_blank"
              rel="noreferrer"
            >
              Open the folder in Drive
            </a>
          </div>
        </div>
      ) : (
        groups.map((g, gi) => (
          <details
            className="nx-group"
            key={g.path || "top"}
            open={gi < 2 || groups.length <= 4 || g.items.some((f) => f.state !== "waiting")}
          >
            <summary>
              <span className="nx-crumbs">
                {(g.path || state.inbox!.name).split(" / ").map((part, i, parts) => (
                  <span key={i} className={i === parts.length - 1 ? "nx-last" : ""}>
                    {part}
                  </span>
                ))}
              </span>
              <span className="nx-muted">
                {g.items.length} {g.items.length === 1 ? "folder" : "folders"} ·{" "}
                {sum(g.items, "products")} products
              </span>
              {g.path && g.items.some((f) => f.state === "waiting") && (
                <button
                  className="nx-btn nx-sm nx-quiet"
                  onClick={(e) => {
                    e.preventDefault();
                    skipAll(g.path, g.items.length);
                  }}
                >
                  Skip all
                </button>
              )}
            </summary>
            <div className="nx-folders">
              {g.items.map((f) => {
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
                        <div className="nx-name">{f.name}</div>
                        {f.tracker?.state === "delivered" ? (
                          <span className="nx-chip nx-ok" title={`Tracker line: ${f.tracker.line}`}>
                            Delivered
                            {f.tracker.sent
                              ? ` ${f.tracker.sent.slice(8, 10)}/${f.tracker.sent.slice(5, 7)}`
                              : ""}
                            {f.tracker.upload ? ` · uploaded in ${f.tracker.upload}` : ""}
                          </span>
                        ) : f.tracker ? (
                          <span className="nx-chip" title={`Tracker line: ${f.tracker.line}`}>
                            In the tracker · still open
                          </span>
                        ) : (
                          <span className="nx-chip nx-warn">Not in the tracker</span>
                        )}
                      </div>
                      <div
                        className="nx-strip nx-open"
                        role="button"
                        tabIndex={0}
                        aria-label={`See all photos in ${f.name}`}
                        onClick={() => setLooking({ id: f.id, name: f.name, skill })}
                        onKeyDown={(e) =>
                          e.key === "Enter" && setLooking({ id: f.id, name: f.name, skill })
                        }
                      >
                        {f.thumbs.map((t) => (
                          <img
                            key={t}
                            src={`/api/studio/drive/thumb?id=${encodeURIComponent(t)}`}
                            alt="Photo from the folder"
                            loading="lazy"
                          />
                        ))}
                        <span className="nx-more">
                          {!f.files
                            ? "Counting the photos…"
                            : f.thumbs.length && f.files > f.thumbs.length
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
                                () =>
                                  post("/api/studio/drive/approve", {
                                    folder: f.id,
                                    skill,
                                    start: true,
                                  }),
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
                                () =>
                                  post("/api/studio/drive/approve", {
                                    folder: f.id,
                                    skill,
                                    start: false,
                                  }),
                                "Importing. Open the batch to change settings before generating.",
                              )
                            }
                          >
                            Import only
                          </button>
                          <button
                            className="nx-btn"
                            onClick={() => setLooking({ id: f.id, name: f.name, skill })}
                          >
                            See all photos
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
                            <i
                              style={{
                                width: `${Math.min(100, (f.imported / Math.max(1, f.files)) * 100)}%`,
                              }}
                            />
                          </div>
                          <span>
                            Importing {f.imported} of {f.files}
                          </span>
                        </div>
                      ) : (
                        <div className="nx-row">
                          <span className="nx-chip nx-ok">Imported {f.imported}</span>
                          {f.skipped > 0 && (
                            <span className="nx-chip nx-warn">{f.skipped} left out</span>
                          )}
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
                            <span className={skillTone(skill)}>{title(skill)}</span>
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
                          {f.files
                            ? `$${cost.toFixed(2)} · about ${Math.max(1, Math.round(f.files / 5))} min`
                            : "–"}
                        </dd>
                        {f.products > 0 && (
                          <>
                            <dt>Products</dt>
                            <dd className="nx-mono">{f.products}</dd>
                          </>
                        )}
                        <dt>Photos</dt>
                        <dd className="nx-mono">
                          {f.files || "–"}
                          {f.choices > 0 ? (
                            <span className="nx-chip nx-ok">{f.choices} with your own choice</span>
                          ) : (
                            f.products > 0 &&
                            f.files > 0 && <span className="nx-muted"> · front and back</span>
                          )}
                        </dd>
                      </dl>
                      <div className="nx-why">{f.guess.why}</div>
                    </div>
                  </article>
                );
              })}
            </div>
          </details>
        ))
      )}
      {looking && (
        <Suspense fallback={null}>
          <FolderPhotos
            folder={looking}
            skills={skills}
            folderSkill={looking.skill}
            onClose={stopLooking}
            onSaved={() => void load()}
          />
        </Suspense>
      )}
    </div>
  );
}
