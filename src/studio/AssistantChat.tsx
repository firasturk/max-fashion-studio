import { useEffect, useRef, useState } from "react";
import { LoaderCircle, MessageCircle, Send, Sparkles, X } from "lucide-react";
import { post } from "@/api";
import type { AssistantTurn } from "@shared/types";

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
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
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

  async function send() {
    const asked = text.trim();
    if (!asked || busy) return;
    setText("");
    const next: AssistantTurn[] = [...turns, { role: "user", text: asked, at: Date.now() }];
    setTurns(next);
    setBusy(true);
    try {
      const r = await post<{ reply: string; actions: { tool: string; summary: string }[] }>(
        "/api/studio/assistant/chat",
        {
          batch: batchId,
          task: taskId,
          messages: next.slice(-20).map((t) => ({ role: t.role, text: t.text })),
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
          <form
            className="assistant-compose"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <textarea
              ref={input}
              value={text}
              rows={2}
              placeholder={configured ? "What should I change?" : "Add the Claude key first"}
              disabled={!configured || busy}
              onChange={(e) => setText(e.target.value)}
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
