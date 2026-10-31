import { useCallback, useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  ExternalLink,
  LoaderCircle,
  Paperclip,
  Send,
  Sparkles,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { get, post } from "@/api";
import { makeReference } from "@/lib/image";
import type { AssistantTurn, DevJobInfo } from "@shared/types";

/**
 * The studio chat: a full page where any team member writes what they want changed, with as
 * many pictures as they like. The assistant does it through its tools, or changes the studio
 * itself through the developer agent and reports back when the change is live.
 */

interface Attachment {
  media_type: "image/jpeg";
  data: string;
  preview: string;
}

type Turn = AssistantTurn & {
  /** A developer job this message follows; the card updates until it is done or failed. */
  job?: string;
  jobStatus?: DevJobInfo["status"];
  runUrl?: string | null;
};

const MAX_PER_MESSAGE = 60;

async function prepareAttachment(file: File): Promise<Attachment> {
  const small = await makeReference(file, 1280, 0.85).catch(() => file);
  const bytes = new Uint8Array(await small.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const data = btoa(bin);
  return { media_type: "image/jpeg", data, preview: `data:image/jpeg;base64,${data}` };
}

export default function AssistantPage({
  userId,
  batchId,
  batchName,
  taskId,
  taskName,
  configured,
  github,
  onChanged,
}: {
  userId: string;
  batchId: string | null;
  batchName?: string;
  taskId: string | null;
  taskName?: string;
  configured: boolean;
  github: boolean;
  onChanged: () => Promise<void>;
}) {
  const storageKey = `assistant-thread:${userId}`;
  const [turns, setTurns] = useState<Turn[]>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      return saved ? (JSON.parse(saved) as Turn[]) : [];
    } catch {
      return [];
    }
  });
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Attachment[]>([]);
  const pictures = useRef<Map<number, Attachment[]>>(new Map());
  const thread = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(turns.slice(-80)));
    } catch {
      /* storage unavailable */
    }
    thread.current?.scrollTo({ top: thread.current.scrollHeight, behavior: "smooth" });
  }, [turns, storageKey]);
  useEffect(() => {
    input.current?.focus();
  }, []);

  // Developer jobs in the thread are followed until they report back.
  const refreshJobs = useCallback(async () => {
    const open = turns.filter(
      (t) => t.job && (t.jobStatus === "queued" || t.jobStatus === "running"),
    );
    if (!open.length) return;
    try {
      const { jobs } = await get<{ jobs: DevJobInfo[] }>("/api/studio/assistant/jobs");
      let changed = false;
      const finished: DevJobInfo[] = [];
      const next = turns.map((t) => {
        const j = t.job ? jobs.find((x) => x.id === t.job) : undefined;
        if (!j || (j.status === t.jobStatus && (j.run_url ?? null) === (t.runUrl ?? null)))
          return t;
        changed = true;
        if (j.status === "done" || j.status === "failed") finished.push(j);
        return { ...t, jobStatus: j.status, runUrl: j.run_url };
      });
      if (!changed) return;
      const reports: Turn[] = finished.map((j) => ({
        role: "assistant",
        text:
          j.status === "done"
            ? (j.result?.trim() || "The change is live.") +
              "\n\nThe studio was updated; reload the page when convenient."
            : j.result?.trim() || "The change could not be completed.",
        at: Date.now(),
      }));
      setTurns([...next, ...reports]);
      if (finished.some((j) => j.status === "done")) {
        toast.success("The studio was updated.", {
          duration: Infinity,
          action: { label: "Reload", onClick: () => window.location.reload() },
        });
        await onChanged();
      }
    } catch {
      /* next tick */
    }
  }, [turns, onChanged]);
  useEffect(() => {
    const open = turns.some(
      (t) => t.job && (t.jobStatus === "queued" || t.jobStatus === "running"),
    );
    if (!open) return;
    const id = window.setInterval(() => void refreshJobs(), 6000);
    void refreshJobs();
    return () => window.clearInterval(id);
  }, [turns, refreshJobs]);

  async function addFiles(files: FileList | File[] | null) {
    if (!files) return;
    const images = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (!images.length) return;
    try {
      const prepared = await Promise.all(images.map(prepareAttachment));
      setPending((l) => {
        const all = [...l, ...prepared];
        if (all.length > MAX_PER_MESSAGE)
          toast.info(
            `Up to ${MAX_PER_MESSAGE} pictures go in one message; send the rest in the next one.`,
          );
        return all.slice(0, MAX_PER_MESSAGE);
      });
    } catch (e) {
      toast.error(`Could not read that picture: ${(e as Error).message}`);
    }
  }

  async function send() {
    const asked = text.trim();
    if ((!asked && !pending.length) || busy) return;
    setText("");
    const at = Date.now();
    const attached = pending;
    setPending([]);
    if (attached.length) pictures.current.set(at, attached);
    const next: Turn[] = [
      ...turns,
      { role: "user", text: asked || "(pictures)", at, attachments: attached.length },
    ];
    setTurns(next);
    setBusy(true);
    try {
      const r = await post<{
        reply: string;
        actions: { tool: string; summary: string; job?: string }[];
      }>("/api/studio/assistant/chat", {
        batch: batchId,
        task: taskId,
        messages: next
          .filter((t) => !t.job)
          .slice(-20)
          .map((t) => ({
            role: t.role,
            text: t.text,
            images:
              t.at === at
                ? attached.map((a) => ({ media_type: a.media_type, data: a.data }))
                : undefined,
          })),
      });
      const reply: Turn = { role: "assistant", text: r.reply, actions: r.actions, at: Date.now() };
      const jobs: Turn[] = r.actions
        .filter((a) => a.job)
        .map((a) => ({
          role: "assistant",
          text: a.summary,
          job: a.job,
          jobStatus: "queued",
          at: Date.now() + 1,
        }));
      setTurns((l) => [...l, reply, ...jobs]);
      if (r.actions.some((a) => !a.job)) await onChanged();
    } catch (e) {
      setTurns((l) => [
        ...l,
        {
          role: "assistant",
          text: `Something went wrong: ${(e as Error).message}`,
          at: Date.now(),
        },
      ]);
    } finally {
      setBusy(false);
      input.current?.focus();
    }
  }

  const context = taskName
    ? `Image open: ${taskName}`
    : batchName
      ? `Batch: ${batchName}`
      : "No batch open";

  return (
    <div className="chat-page">
      <div className="chat-bar">
        <Sparkles size={16} />
        <strong>Studio chat</strong>
        <span className="chat-context" title={context}>
          {context}
        </span>
        {!github && (
          <span className="chat-note">
            Code changes need GitHub connected (Connection → Developer).
          </span>
        )}
        {turns.length > 0 && (
          <button
            type="button"
            className="text-button"
            onClick={() => {
              if (window.confirm("Clear this conversation?")) setTurns([]);
            }}
          >
            <Trash2 size={13} /> Clear
          </button>
        )}
      </div>
      <div className="chat-thread" ref={thread}>
        {turns.length === 0 && (
          <div className="chat-empty">
            <h2>Write what you want changed. It gets done.</h2>
            <p>
              {configured ? (
                <>
                  Images, settings, rules, or the studio itself. Attach or paste as many pictures as
                  you need: a marked screenshot, a pose to copy, an example to match. For example:{" "}
                  <em>change the pose of this image to walking</em>,{" "}
                  <em>re-run the grey ones with beige</em>,{" "}
                  <em>add a button that exports only approved images</em>,{" "}
                  <em>why did this fail?</em>
                </>
              ) : (
                <>
                  The chat needs a Claude key. An admin adds it in <strong>Connection</strong>, tab{" "}
                  <strong>Claude</strong>.
                </>
              )}
            </p>
          </div>
        )}
        {turns.map((t, i) =>
          t.job ? (
            <div key={i} className={`chat-job status-${t.jobStatus ?? "queued"}`}>
              {t.jobStatus === "done" ? (
                <CheckCircle2 size={18} />
              ) : t.jobStatus === "failed" ? (
                <XCircle size={18} />
              ) : (
                <LoaderCircle className="spinning" size={18} />
              )}
              <div>
                <strong>
                  {t.jobStatus === "done"
                    ? "Change deployed"
                    : t.jobStatus === "failed"
                      ? "Change failed"
                      : t.jobStatus === "running"
                        ? "Changing the studio… editing, testing and deploying"
                        : "Starting the developer agent…"}
                </strong>
                <span>{t.text}</span>
              </div>
              {t.runUrl && (
                <a
                  href={t.runUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-link"
                  title="Open the run"
                >
                  <ExternalLink size={14} />
                </a>
              )}
            </div>
          ) : (
            <div key={i} className={`chat-turn ${t.role}`}>
              {pictures.current.get(t.at)?.length || t.attachments ? (
                <div className="chat-pictures">
                  {pictures.current
                    .get(t.at)
                    ?.map((a, j) => (
                      <img key={j} src={a.preview} alt={`Attachment ${j + 1}`} />
                    )) ?? <span className="chat-muted">{t.attachments} picture(s) sent</span>}
                </div>
              ) : null}
              <div className="chat-bubble">{t.text}</div>
              {t.actions && t.actions.filter((a) => !a.job).length > 0 && (
                <ul className="chat-actions">
                  {t.actions
                    .filter((a) => !a.job)
                    .map((a, j) => (
                      <li key={j}>✓ {a.summary}</li>
                    ))}
                </ul>
              )}
            </div>
          ),
        )}
        {busy && (
          <div className="chat-turn assistant">
            <div className="chat-bubble thinking">
              <LoaderCircle className="spinning" size={14} /> Working on it…
            </div>
          </div>
        )}
      </div>
      <div className="chat-composer-wrap">
        {pending.length > 0 && (
          <div className="chat-pending">
            {pending.map((a, i) => (
              <span key={i}>
                <img src={a.preview} alt={`Picture ${i + 1}`} />
                <button
                  type="button"
                  aria-label="Remove picture"
                  onClick={() => setPending((l) => l.filter((_, j) => j !== i))}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
        <form
          className="chat-composer"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void addFiles(e.dataTransfer.files);
          }}
        >
          <input
            ref={picker}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              void addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            className="secondary chat-attach"
            disabled={!configured || busy}
            aria-label="Attach pictures"
            title="Attach pictures (or paste / drop them)"
            onClick={() => picker.current?.click()}
          >
            <Paperclip size={17} />
          </button>
          <textarea
            ref={input}
            value={text}
            rows={3}
            placeholder={
              configured
                ? "What should change? Paste or attach pictures too."
                : "Add the Claude key first"
            }
            disabled={!configured || busy}
            onChange={(e) => setText(e.target.value)}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData.files ?? []);
              if (files.length) {
                e.preventDefault();
                void addFiles(files);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <button
            type="submit"
            className="primary chat-send"
            disabled={!configured || busy || (!text.trim() && !pending.length)}
            aria-label="Send"
          >
            <Send size={17} />
          </button>
        </form>
        <p className="chat-muted chat-hint">Enter sends, Shift+Enter for a new line.</p>
      </div>
    </div>
  );
}
