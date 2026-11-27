import { useEffect, useRef, useState } from "react";

export type AskAction = "review" | "needs" | "clips" | "drive" | "running";

const ACTIONS: [string, string, AskAction][] = [
  ["Show what needs a look", "Review", "needs"],
  ["Approve what passed QC", "Review", "review"],
  ["Make clips from approved images", "Video", "clips"],
  ["Check Drive for new folders", "Inbox", "drive"],
  ["See what is generating now", "Running", "running"],
];

/** "Ask the studio": pick a shortcut, or type a request and it goes to the studio chat. */
export default function AskPalette({
  onClose,
  onAction,
  onAsk,
}: {
  onClose: () => void;
  onAction: (a: AskAction) => void;
  onAsk: (text: string) => void;
}) {
  const [q, setQ] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const shown = ACTIONS.filter(([label]) => label.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="nx-scrim nx-top" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <section
        className="nx-sheet nx-small nx-pal"
        role="dialog"
        aria-modal="true"
        aria-label="Ask the studio"
      >
        <input
          ref={input}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            if (e.key === "Enter" && q.trim()) {
              if (shown.length === 1) onAction(shown[0][2]);
              else onAsk(q.trim());
            }
          }}
          placeholder="Tell the studio what to do"
          autoComplete="off"
          aria-label="Ask the studio"
        />
        <ul>
          {shown.map(([label, where, action]) => (
            <li key={action}>
              <button onClick={() => onAction(action)}>
                {label}
                <span>{where}</span>
              </button>
            </li>
          ))}
          {q.trim() && (
            <li>
              <button onClick={() => onAsk(q.trim())}>
                Ask the studio: “{q.trim()}”<span>Chat</span>
              </button>
            </li>
          )}
        </ul>
      </section>
    </div>
  );
}
