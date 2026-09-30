import { useState } from "react";
import { Check, KeyRound, LoaderCircle, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { del, get, post } from "@/api";

export interface EngineInfo {
  model: string;
  configured: boolean;
  source: "secret" | "stored" | "none";
  review: boolean;
}

export default function ConnectionDialog({
  open,
  engine,
  onClose,
  onChanged,
}: {
  open: boolean;
  engine: EngineInfo;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [key, setKey] = useState("");
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function verify() {
    setChecking(true);
    try {
      setResult(await get<{ ok: boolean; message: string }>("/api/studio/engine/verify"));
    } catch (e) {
      setResult({ ok: false, message: (e as Error).message });
    } finally {
      setChecking(false);
    }
  }

  async function save() {
    setSaving(true);
    try {
      const r = await post<{ ok: boolean; message: string }>("/api/studio/engine/key", { key });
      setKey("");
      setResult(r);
      await onChanged();
      toast.success("Higgsfield key saved and verified.");
    } catch (e) {
      setResult({ ok: false, message: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (
      !window.confirm("Remove the saved Higgsfield key? Generation stops until a new key is added.")
    )
      return;
    try {
      await del("/api/studio/engine/key");
      setResult(null);
      await onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="connection-dialog">
        <DialogHeader>
          <DialogTitle>Image engine connection</DialogTitle>
          <DialogDescription>
            Generation runs through the Higgsfield Cloud API. The key is stored encrypted on the
            server, never in the browser.
          </DialogDescription>
        </DialogHeader>

        {engine.configured ? (
          <div className="success-note">
            <Check size={19} />
            {engine.source === "secret"
              ? "A Higgsfield key is configured as a server secret."
              : "A Higgsfield key is saved on the server."}
          </div>
        ) : (
          <div className="error-banner">
            <TriangleAlert size={18} />
            No Higgsfield API key yet. Paste one below.
          </div>
        )}

        {engine.source !== "secret" && (
          <>
            <label htmlFor="engine-key" className="field-label">
              Higgsfield API key
            </label>
            <input
              id="engine-key"
              type="password"
              autoComplete="off"
              placeholder="KEY_ID:KEY_SECRET"
              value={key}
              onChange={(e) => setKey(e.target.value.trim())}
            />
            <p className="quality-note">
              Create it at{" "}
              <a
                href="https://cloud.higgsfield.ai"
                target="_blank"
                rel="noreferrer"
                className="text-link"
              >
                cloud.higgsfield.ai
              </a>{" "}
              and paste it as the ID, a colon, then the secret. It is verified before it is saved.
            </p>
            <div className="footer-actions">
              <button className="primary" onClick={() => void save()} disabled={saving || !key}>
                {saving ? <LoaderCircle className="spinning" size={17} /> : <KeyRound size={17} />}
                {engine.configured ? "Replace key" : "Save key"}
              </button>
              {engine.source === "stored" && (
                <button
                  className="secondary danger"
                  onClick={() => void remove()}
                  aria-label="Remove key"
                >
                  <Trash2 size={17} />
                </button>
              )}
            </div>
          </>
        )}

        <button
          className="secondary"
          onClick={() => void verify()}
          disabled={checking || !engine.configured}
        >
          {checking ? <LoaderCircle className="spinning" size={17} /> : <Check size={17} />}
          Test connection
        </button>
        {result && <p className={result.ok ? "success-note" : "image-error"}>{result.message}</p>}

        <div className="connection-details">
          <span>Image model</span>
          <strong>{engine.model}</strong>
          <span>Automatic review</span>
          <strong>{engine.review ? "Gemini 2.5 Flash" : "Off (manual approval)"}</strong>
        </div>
      </DialogContent>
    </Dialog>
  );
}
