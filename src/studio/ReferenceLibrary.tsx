import { useCallback, useEffect, useRef, useState } from "react";
import { ImagePlus, LoaderCircle, X } from "lucide-react";
import { toast } from "sonner";
import { del, get } from "@/api";
import { makeReference } from "@/lib/image";

interface Reference {
  id: string;
  name: string | null;
  created: number;
}

/**
 * Inspiration photos for one skill. Each generation borrows background, pose and lighting from
 * one of them (never clothing or accessories); the team adds and removes photos here.
 */
export default function ReferenceLibrary({
  skill,
  title,
  onChanged,
}: {
  skill: string;
  title: string;
  /** Called after photos were added or removed, with the new count. */
  onChanged?: (count: number) => void | Promise<void>;
}) {
  const [items, setItems] = useState<Reference[]>([]);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const d = await get<{ references: Reference[] }>(
        `/api/studio/references?skill=${encodeURIComponent(skill)}`,
      );
      setItems(d.references);
    } catch {
      setItems([]);
    }
  }, [skill]);

  useEffect(() => {
    void load();
  }, [load]);

  async function add(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append("skill", skill);
      // Reference photos are sent to the prompt builder on every run; a resized copy keeps those
      // calls small and fast without changing what the builder sees.
      for (const f of Array.from(files)) {
        const small = await makeReference(f).catch(() => f);
        form.append("file", small, f.name.replace(/\.[^.]+$/, "") + ".jpg");
      }
      const r = await fetch("/api/studio/references", { method: "POST", body: form });
      if (!r.ok)
        throw new Error(((await r.json()) as { error?: string }).error || "Upload failed.");
      await load();
      toast.success(`${files.length} reference${files.length > 1 ? "s" : ""} added.`);
      await onChanged?.(items.length + files.length);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Remove this reference photo from the library?")) return;
    try {
      await del(`/api/studio/references/${id}`);
      setItems((l) => l.filter((r) => r.id !== id));
      await onChanged?.(items.length - 1);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <>
      <div className="field-row">
        <label className="field-label">{title}</label>
        <button
          type="button"
          className="text-button"
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          {busy ? <LoaderCircle className="spinning" size={13} /> : <ImagePlus size={13} />}
          Add photos
        </button>
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          hidden
          onChange={(e) => void add(e.target.files)}
        />
      </div>
      {items.length ? (
        <div className="mood-strip">
          {items.map((r) => (
            <figure key={r.id}>
              <img
                src={`/api/studio/references/${r.id}/file`}
                alt={r.name ?? "reference"}
                loading="lazy"
              />
              <button
                type="button"
                className="mood-remove"
                aria-label="Remove reference"
                onClick={() => void remove(r.id)}
              >
                <X size={12} />
              </button>
            </figure>
          ))}
        </div>
      ) : (
        <div className="prompt-tip">
          No reference photos yet. Add a few: each image borrows background, pose and lighting from
          one of them (never the clothes or accessories).
        </div>
      )}
      {items.length > 0 && (
        <div className="prompt-tip">
          {items.length} photo{items.length > 1 ? "s" : ""}. Each image borrows background, pose and
          lighting from one of them, rotating so results differ; clothes, hats, bags and accessories
          are never copied.
        </div>
      )}
    </>
  );
}
