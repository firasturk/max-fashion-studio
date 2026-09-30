import { useState } from "react";
import { Check, LoaderCircle, TriangleAlert } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { get } from "@/api";

export interface EngineInfo {
  model: string;
  configured: boolean;
  review: boolean;
}

export default function ConnectionDialog({
  open,
  engine,
  onClose,
}: {
  open: boolean;
  engine: EngineInfo;
  onClose: () => void;
}) {
  const [checking, setChecking] = useState(false);
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

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="connection-dialog">
        <DialogHeader>
          <DialogTitle>Image engine connection</DialogTitle>
          <DialogDescription>
            Generation runs through the Higgsfield Cloud API with credentials stored as server
            secrets. Nothing is entered in the browser.
          </DialogDescription>
        </DialogHeader>
        {engine.configured ? (
          <div className="success-note">
            <Check size={19} />A Higgsfield API key is configured on the server.
          </div>
        ) : (
          <div className="error-banner">
            <TriangleAlert size={18} />
            No Higgsfield API key. Set <code>HIGGSFIELD_API_KEY</code> as a Worker secret
            (KEY_ID:KEY_SECRET from cloud.higgsfield.ai).
          </div>
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
