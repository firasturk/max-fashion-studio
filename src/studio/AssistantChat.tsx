import { useEffect, useRef, useState } from "react";
import { LoaderCircle, MessageCircle, Paperclip, Send, Sparkles, X } from "lucide-react";
import { makeReference } from "@/lib/image";
import { post } from "@/api";
import type { AssistantTurn } from "@shared/types";

interface Attachment {
  media_type: "image/jpeg";
  data: string;
  /** Data URL for the thumbnail. */
  preview: string;
}

/** A picture from the team, downsized in the browser so the chat stays fast. */
async function prepareAttachment(file: File): Promise<Attachment> {
  const small = await makeReference(file, 1280, 0.85).catch(() => file);
  const buf = await small.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const data = btoa(bin);
  return { media_type: "image/jpeg", data, preview: `data:image/jpeg;base64,${data}` };
}

/**
 * The studio assistant: a chat button for the whole team. It knows the batch and the image on
 * screen, answers like the developer would, and makes the team-level changes itself.
 */
export default function AssistantChat({
  batchId,
  batchName,
  taskId,
  taskName,
  configured,
  onChanged,
}: {
  batchId: string | null;
  batchName?: string;
  taskId: string | null;
  taskName?: string;
  /** A Claude key is saved; without it the chat explains how to add one. */
  configured: boolean;
  /** Called after the assistant changed something, so the view reloads. */
  onChanged: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [turns, setTurns] = useState<AssistantTurn[]>([]);
  const [pending, setPending] = useState<Attachment[]>([]);
  // Pictures of the last few messages stay in memory for the conversation; they are not persisted.
  const pictures = useRef<Map<number, Attachment[]>>(new Map());
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const storageKey = `assistant-chat:${batchId ?? "none"}`;

  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      setTurns(saved ? (JSON.parse(saved) as AssistantTurn[]) : []);
    } catch {
      setTurns([]);
    }
  }, [storageKey]);
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(turns.slice(-40)));
    } catch {
      /* storage unavailable */
    }
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [turns, storageKey]);
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  async function addFiles(files: FileList | File[] | null) {
    if (!files) return;
    const images = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (!images.length) return;
    try {
      const prepared = await Promise.all(images.slice(0, 4).map(prepareAttachment));
      setPending((l) => [...l, ...prepared].slice(0, 4));
    } catch (e) {
      setTurns((l) => [
        ...l,
        {
          role: "assistant",
          text: `Could not read that picture: ${(e as Error).message}`,
          at: Date.now(),
        },
      ]);
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
    const next: AssistantTurn[] = [
      ...turns,
      { role: "user", text: asked || "(picture)", at, attachments: attached.length },
    ];
    setTurns(next);
    setBusy(true);
    try {
      const r = await post<{ reply: string; actions: { tool: string; summary: string }[] }>(
        "/api/studio/assistant/chat",
        {
          batch: batchId,
          task: taskId,
          messages: next.slice(-20).map((t) => ({
            role: t.role,
            text: t.text,
            // Only the pictures of the message being sent travel; earlier ones were already seen.
            images:
              t.at === at
                ? attached.map((a) => ({ media_type: a.media_type, data: a.data }))
                : undefined,
          })),
        },
      );
      setTurns((l) => [
        ...l,
        { role: "assistant", text: r.reply, actions: r.actions, at: Date.now() },
      ]);
      if (r.actions.length) await onChanged();
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

  return (
    <>
      <button
        type="button"
        className={`assistant-fab ${open ? "open" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? "Close the assistant" : "Ask the studio assistant"}
      >
        {open ? <X size={20} /> : <MessageCircle size={20} />}
        {!open && <span>Ask</span>}
      </button>
      {open && (
        <div className="assistant-panel" role="dialog" aria-label="Studio assistant">
          <div className="assistant-head">
            <Sparkles size={16} />
            <strong>Studio assistant</strong>
            <span className="assistant-context">
              {taskName
                ? `Image: ${taskName}`
                : batchName
                  ? `Batch: ${batchName}`
                  : "No batch open"}
            </span>
            {turns.length > 0 && (
              <button type="button" className="text-button" onClick={() => setTurns([])}>
                Clear
              </button>
            )}
          </div>
          <div className="assistant-list" ref={list}>
            {turns.length === 0 && (
              <div className="assistant-hint">
                {configured ? (
                  <>
                    Tell me what to change and I do it:{" "}
                    <em>change the pose of this image to walking</em>,{" "}
                    <em>re-run the grey ones with beige</em>,{" "}
                    <em>from now on no hands near the face in Women Sleepwear</em>,{" "}
                    <em>why did this fail?</em>. Anything that needs new code I pass to the
                    developer.
                  </>
                ) : (
                  <>
                    The assistant needs a Claude key. An admin adds it in{" "}
                    <strong>Connection</strong>, tab <strong>Claude</strong>.
                  </>
                )}
              </div>
            )}
            {turns.map((t, i) => (
              <div key={i} className={`assistant-turn ${t.role}`}>
                {pictures.current.get(t.at)?.length || t.attachments ? (
                  <div className="assistant-pictures">
                    {pictures.current
                      .get(t.at)
                      ?.map((a, j) => (
                        <img key={j} src={a.preview} alt={`Attachment ${j + 1}`} />
                      )) ?? <span className="assistant-hint">{t.attachments} picture(s) sent</span>}
                  </div>
                ) : null}
                <div className="assistant-bubble">{t.text}</div>
                {t.actions && t.actions.length > 0 && (
                  <ul className="assistant-actions">
                    {t.actions.map((a, j) => (
                      <li key={j}>✓ {a.summary}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
            {busy && (
              <div className="assistant-turn assistant">
                <div className="assistant-bubble thinking">
                  <LoaderCircle className="spinning" size={14} /> Working on it…
                </div>
              </div>
            )}
          </div>
          {pending.length > 0 && (
            <div className="assistant-pending">
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
            className="assistant-compose"
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
              className="secondary assistant-attach"
              disabled={!configured || busy}
              aria-label="Attach pictures"
              title="Attach pictures (or paste / drop them)"
              onClick={() => picker.current?.click()}
            >
              <Paperclip size={16} />
            </button>
            <textarea
              ref={input}
              value={text}
              rows={2}
              placeholder={
                configured
                  ? "What should I change? Paste or attach pictures too."
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
              className="primary"
              disabled={!configured || busy || !text.trim()}
              aria-label="Send"
            >
              <Send size={16} />
            </button>
          </form>
        </div>
      )}
    </>
  );
}
