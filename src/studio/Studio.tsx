import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Download,
  FolderOpen,
  ImagePlus,
  KeyRound,
  LoaderCircle,
  LogOut,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { del, get, post, postForm } from "@/api";
import { makeReference } from "@/lib/image";
import { buildZip, saveBlob } from "@/lib/zip";
import { DEFAULT_CONFIG, cardsPerSource, exportsOriginals, type Config } from "@shared/config";
import { outputName, safeArchiveName, stemKey } from "@shared/naming";
import type { Batch, EngineModel, StateResponse, Task, User } from "@shared/types";
import type { PickedFile } from "@/lib/files";
import BatchesView from "./BatchesView";
import { ACCEPTED_TYPES, MAX_UPLOAD_BYTES } from "./constants";
import { useBatch } from "./useBatch";
import ModeCards from "./ModeCards";
import CreativePanel from "./CreativePanel";
import SourcesTab, { type Pending } from "./SourcesTab";
import ResultsTab from "./ResultsTab";
import ReviewDialog from "./ReviewDialog";
import ConnectionDialog, { type EngineInfo } from "./ConnectionDialog";

export default function Studio({ user, onSignedOut }: { user: User; onSignedOut: () => void }) {
  const [config, setConfig] = useState<Config>(DEFAULT_CONFIG);
  const [pending, setPending] = useState<Pending[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [engine, setEngine] = useState<EngineInfo>({
    model: "",
    configured: false,
    source: "none",
    review: false,
  });
  const [tab, setTab] = useState("sources");
  const [uploading, setUploading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Task | null>(null);
  const [batchName, setBatchName] = useState("");
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [connection, setConnection] = useState(false);
  const [page, setPage] = useState<"studio" | "batches">("studio");
  const [models, setModels] = useState<EngineModel[]>([]);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const { batch, sources, tasks, active, open, close, refresh, action, remove } = useBatch();

  const loadState = useCallback(async () => {
    try {
      const d = await get<StateResponse>("/api/studio/state");
      setBatches(d.batches);
      setEngine(d.engine);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const loadModels = useCallback(async () => {
    try {
      const d = await get<{ models: EngineModel[] }>("/api/studio/engine/models");
      setModels(d.models);
    } catch {
      setModels([]);
    }
  }, []);

  useEffect(() => {
    void loadState().then(loadModels);
  }, [loadState, loadModels]);

  // The batches page always shows fresh counts, including batches still generating in the background.
  useEffect(() => {
    if (page !== "batches") return;
    void loadState();
    const timer = setInterval(() => {
      if (!document.hidden) void loadState();
    }, 8000);
    return () => clearInterval(timer);
  }, [page, loadState]);

  // Keep the review dialog on the latest copy of its task while the batch refreshes.
  useEffect(() => {
    if (selected) {
      const fresh = tasks.find((t) => t.id === selected.id);
      if (fresh && fresh !== selected) setSelected(fresh);
    }
  }, [tasks, selected]);

  const viewConfig: Config = useMemo(
    () => (batch ? (JSON.parse(batch.config) as Config) : config),
    [batch, config],
  );
  const locked = !!batch || uploading;
  const sourceUrl = (id: string, kind: "original" | "reference" = "reference") =>
    `/api/studio/file?batch=${batch?.id}&id=${id}&kind=${kind}`;
  const outputUrl = (t: Task) =>
    `/api/studio/file?batch=${batch?.id}&id=${t.id}&kind=result&v=${t.output?.split("/").at(-1)}`;

  const ready = tasks.filter((t) => t.status === "ready" || t.status === "approved");
  const failed = tasks.filter((t) => t.status === "failed");
  const queued = tasks.filter((t) => t.status === "queued");
  const completed = tasks.filter((t) => !!t.output).length;

  function addFiles(picked: PickedFile[]) {
    const names = new Set(pending.map((p) => stemKey(p.name)));
    const additions: Pending[] = [];
    let rejected = 0;
    for (const { file, path } of picked) {
      const name = path.replace(/^\/+/, "");
      const key = stemKey(name);
      if (!ACCEPTED_TYPES.includes(file.type) || file.size > MAX_UPLOAD_BYTES || names.has(key)) {
        rejected++;
        continue;
      }
      names.add(key);
      additions.push({ file, name, url: URL.createObjectURL(file), role: "lead" });
    }
    setPending((p) => [...p, ...additions]);
    if (rejected)
      toast.warning(
        `${rejected} files skipped: unsupported, over 12 MB, or duplicate output name.`,
      );
  }

  async function openBatch(id: string) {
    if (uploading) return;
    setSelection(new Set());
    setOpeningId(id);
    try {
      await open(id);
      setTab("results");
      setPage("studio");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setOpeningId(null);
    }
  }

  async function deleteBatchById(b: Batch) {
    if (
      !window.confirm(`Delete "${b.name}" with all originals and results? This cannot be undone.`)
    )
      return;
    try {
      if (batch?.id === b.id) await remove();
      else await del(`/api/studio/batch?batch=${encodeURIComponent(b.id)}`);
      await loadState();
      toast.success("Batch deleted.");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  function newBatch() {
    if (uploading) return;
    close();
    setSelection(new Set());
    setTab("sources");
  }

  async function saveBatch() {
    if (!pending.length || uploading) return;
    setUploading(true);
    try {
      const id = batch
        ? batch.id
        : (
            await post<{ id: string }>("/api/studio/batch", {
              name: batchName || `${config.category} · ${new Date().toLocaleDateString("en-GB")}`,
              config,
            })
          ).id;
      let uploaded = 0;
      const remaining: Pending[] = [];
      for (const p of pending) {
        const form = new FormData();
        form.append("file", p.file);
        form.append("name", p.name);
        form.append("role", p.role);
        try {
          form.append("reference", await makeReference(p.file), "reference.jpg");
          await postForm(`/api/studio/upload?batch=${id}`, form);
          uploaded++;
          URL.revokeObjectURL(p.url);
        } catch (e) {
          remaining.push(p);
          toast.error(`${p.name}: ${(e as Error).message}`);
        }
      }
      setPending(remaining);
      await open(id);
      await loadState();
      if (uploaded) {
        toast.success(`${uploaded} originals saved. Ready to generate.`);
        setTab("results");
      } else toast.error("No images uploaded. Original selections are kept.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function runAction(path: string, body?: Record<string, unknown>) {
    setActing(true);
    try {
      await action(path, body);
      await loadState();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setActing(false);
    }
  }

  async function start() {
    if (!engine.configured) {
      setConnection(true);
      return;
    }
    setTab("results");
    await runAction("start");
  }

  async function revise(edit: string) {
    if (!selected) return;
    await runAction("revise", { id: selected.id, edit });
    toast.info("Revision queued. The previous result stays until the new one arrives.");
  }

  async function approve() {
    if (!selected || !batch) return;
    try {
      await post("/api/studio/approve", { batch: batch.id, id: selected.id });
      await refresh();
      toast.success("Image approved for export.");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function deleteBatch() {
    if (!batch || active) return;
    if (
      !window.confirm(
        `Delete "${batch.name}" with all originals and results? This cannot be undone.`,
      )
    )
      return;
    try {
      await remove();
      await loadState();
      setTab("sources");
      toast.success("Batch deleted.");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function downloadZip() {
    if (!batch || exporting) return;
    const mode = viewConfig.mode;
    const total = cardsPerSource(viewConfig);
    const chosen = ready.filter((t) => selection.size === 0 || selection.has(t.id));
    if (!chosen.length) {
      toast.error("Select at least one ready or approved result.");
      return;
    }
    setExporting(true);
    try {
      const byId = new Map(sources.map((s) => [s.id, s]));
      const entries = chosen.map((t) => ({
        name: outputName(byId.get(t.source)!.name, t.card, mode, total),
        url: outputUrl(t),
      }));
      const originalsIncluded = exportsOriginals(viewConfig);
      if (originalsIncluded)
        for (const s of sources)
          entries.push({ name: `originals/${s.name}`, url: sourceUrl(s.id, "original") });
      const manifest = {
        batch: batch.name,
        engine: engine.model,
        generated: chosen.map((t) => ({
          original: byId.get(t.source)?.name,
          file: outputName(byId.get(t.source)!.name, t.card, mode, total),
          status: t.status,
          prompt: t.prompt,
          qa: t.qa ? JSON.parse(t.qa) : null,
        })),
        originalsIncluded,
      };
      saveBlob(await buildZip(entries, manifest), `${safeArchiveName(batch.name)}-AI.zip`);
      toast.success(`${chosen.length} results exported.`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setExporting(false);
    }
  }

  async function signOut() {
    await post("/api/auth/logout").catch(() => {});
    onSignedOut();
  }

  const selectedSource = selected ? (sources.find((s) => s.id === selected.source) ?? null) : null;
  const running = batch?.state === "running";
  const startLabel =
    failed.length && !queued.length
      ? `Retry ${failed.length}`
      : `Generate ${queued.length || ""}`.trim();

  return (
    <div className="studio">
      <header className="topbar">
        <a href="/" className="brand" aria-label="Max Fashion Studio">
          <span className="max-logo">
            max<span>FASHION</span>
          </span>
          <span className="brand-divider" />
          <span className="studio-title">
            IMAGE STUDIO<span>CREATIVE OPERATIONS</span>
          </span>
        </a>
        <nav className="nav-tabs" aria-label="Pages">
          <button className={page === "studio" ? "active" : ""} onClick={() => setPage("studio")}>
            Studio
          </button>
          <button className={page === "batches" ? "active" : ""} onClick={() => setPage("batches")}>
            Batches <span>{batches.length}</span>
          </button>
        </nav>
        <div className="top-actions">
          <span className="engine-tag">
            <Sparkles size={15} /> Higgsfield · {engine.model || "…"}
          </span>
          <button
            className={`connection-button ${engine.configured ? "connected" : ""}`}
            onClick={() => setConnection(true)}
          >
            <KeyRound size={16} />
            {engine.configured ? "Connected" : "Not connected"}
          </button>
          <button className="user-button" onClick={() => void signOut()} title={user.email}>
            <LogOut size={15} /> {user.name}
          </button>
        </div>
      </header>

      <main>
        {page === "batches" ? (
          <>
            <div className="page-heading">
              <div>
                <div className="eyebrow">SAVED BATCHES</div>
                <h1>Every collection you have processed.</h1>
                <p>
                  Open a batch to review, revise or export. Generation continues on the server while
                  you are away.
                </p>
              </div>
              <button
                className="secondary"
                onClick={() => {
                  newBatch();
                  setPage("studio");
                }}
                disabled={uploading}
              >
                <ImagePlus size={17} />
                New batch
              </button>
            </div>
            <section className="batches-page">
              <BatchesView
                batches={batches}
                busyId={openingId}
                onOpen={(id) => void openBatch(id)}
                onDelete={(b) => void deleteBatchById(b)}
              />
            </section>
          </>
        ) : (
          <>
            <div className="page-heading">
              <div>
                <div className="eyebrow">PRODUCT PHOTOGRAPHY / WORKSPACE</div>
                <h1>From shoot to lifestyle.</h1>
                <p>One collection. Every image. Your creative direction.</p>
              </div>
              <button className="secondary" onClick={newBatch} disabled={uploading}>
                <ImagePlus size={17} />
                New batch
              </button>
            </div>

            <ModeCards
              value={viewConfig.mode}
              disabled={locked}
              onChange={(mode) =>
                setConfig((c) => ({ ...c, mode, input: mode === "4" ? "model" : c.input }))
              }
            />

            <div className="workbench">
              <CreativePanel
                config={viewConfig}
                locked={locked}
                saved={!!batch}
                models={models}
                defaultModel={engine.model}
                onChange={(patch) => setConfig((c) => ({ ...c, ...patch }))}
              />

              <section className="media-panel">
                <div className="media-heading">
                  <div>
                    <span className="step">03</span>
                    <h2>{batch ? batch.name : "Your image batch"}</h2>
                  </div>
                  {batches.length > 0 && (
                    <Select value={batch?.id || ""} onValueChange={openBatch} disabled={uploading}>
                      <SelectTrigger className="batch-picker" aria-label="Saved batches">
                        <FolderOpen size={15} />
                        <SelectValue placeholder="Saved batches" />
                      </SelectTrigger>
                      <SelectContent>
                        {batches.map((b) => (
                          <SelectItem key={b.id} value={b.id}>
                            {b.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>

                {error && (
                  <div role="alert" className="error-banner">
                    {error}
                    <button onClick={() => void loadState()}>Retry</button>
                  </div>
                )}
                {batch?.last_error && batch.state === "paused" && (
                  <div role="alert" className="error-banner">
                    Paused: {batch.last_error}
                    <button onClick={() => void runAction("retry")}>Resume</button>
                  </div>
                )}

                <Tabs value={tab} onValueChange={setTab} className="media-tabs">
                  <div className="tabbar">
                    <TabsList className="tabs-list">
                      <TabsTrigger value="sources">
                        Originals <span>{batch ? sources.length : pending.length}</span>
                      </TabsTrigger>
                      <TabsTrigger value="results">
                        Results <span>{completed}</span>
                      </TabsTrigger>
                    </TabsList>
                    <span className="format-note">JPG · PNG · WEBP</span>
                  </div>
                  <TabsContent value="sources">
                    <SourcesTab
                      batchOpen={!!batch}
                      config={viewConfig}
                      sources={sources}
                      pending={pending}
                      uploading={uploading}
                      batchName={batchName}
                      sourceUrl={(id) => sourceUrl(id)}
                      onFiles={addFiles}
                      onRemove={(url) => {
                        URL.revokeObjectURL(url);
                        setPending((a) => a.filter((x) => x.url !== url));
                      }}
                      onRole={(url, role) =>
                        setPending((a) => a.map((x) => (x.url === url ? { ...x, role } : x)))
                      }
                      onBatchName={setBatchName}
                    />
                  </TabsContent>
                  <TabsContent value="results">
                    <ResultsTab
                      tasks={tasks}
                      sources={sources}
                      mode={viewConfig.mode}
                      running={running}
                      selection={selection}
                      outputUrl={outputUrl}
                      onSelect={(id, on) =>
                        setSelection((a) => {
                          const n = new Set(a);
                          if (on) n.add(id);
                          else n.delete(id);
                          return n;
                        })
                      }
                      onClearSelection={() => setSelection(new Set())}
                      onOpen={setSelected}
                      onRetryTask={(t) => void runAction("task/retry", { id: t.id })}
                    />
                  </TabsContent>
                </Tabs>

                {batch && pending.length > 0 && (
                  <div className="error-banner">
                    {pending.length} uploads need retry.
                    <button onClick={() => void saveBatch()} disabled={uploading}>
                      Retry uploads
                    </button>
                  </div>
                )}

                <footer className="batch-footer">
                  <div>
                    <strong>
                      {batch
                        ? `${ready.length} ready to export`
                        : `${pending.length} images selected`}
                    </strong>
                    <span>
                      {running
                        ? "Generation continues on the server even if you close this tab."
                        : batch
                          ? "Originals and results are saved."
                          : "Originals will be saved before generation."}
                    </span>
                  </div>
                  <div className="footer-actions">
                    {!batch ? (
                      <button
                        className="primary"
                        onClick={() => void saveBatch()}
                        disabled={!pending.length || uploading}
                      >
                        {uploading ? (
                          <LoaderCircle className="spinning" size={17} />
                        ) : (
                          <Upload size={17} />
                        )}
                        Save batch
                      </button>
                    ) : (
                      <>
                        {running ? (
                          <button
                            className="secondary"
                            onClick={() => void runAction("pause")}
                            disabled={acting}
                          >
                            <Pause size={17} />
                            Pause
                          </button>
                        ) : (
                          <button
                            className="primary"
                            onClick={() =>
                              void (failed.length && !queued.length ? runAction("retry") : start())
                            }
                            disabled={acting || (!queued.length && !failed.length)}
                          >
                            {acting ? (
                              <LoaderCircle className="spinning" size={17} />
                            ) : engine.configured ? (
                              failed.length && !queued.length ? (
                                <RotateCcw size={17} />
                              ) : (
                                <Play size={17} />
                              )
                            ) : (
                              <KeyRound size={17} />
                            )}
                            {engine.configured ? startLabel : "Connect & generate"}
                          </button>
                        )}
                        <button
                          className="secondary"
                          onClick={() => void downloadZip()}
                          disabled={!ready.length || exporting}
                        >
                          {exporting ? (
                            <LoaderCircle className="spinning" size={17} />
                          ) : (
                            <Download size={17} />
                          )}
                          Download ZIP
                        </button>
                        <button
                          className="secondary danger"
                          onClick={() => void deleteBatch()}
                          disabled={active || acting}
                          aria-label="Delete batch"
                        >
                          <Trash2 size={17} />
                        </button>
                      </>
                    )}
                  </div>
                </footer>
              </section>
            </div>
          </>
        )}
        <footer className="page-footer">
          <span>max fashion / image studio</span>
          <span>AI results require visual approval before publishing.</span>
        </footer>
      </main>

      <ConnectionDialog
        open={connection}
        engine={engine}
        onClose={() => setConnection(false)}
        onChanged={async () => {
          await loadState();
          await loadModels();
        }}
      />
      <ReviewDialog
        task={selected}
        source={selectedSource}
        busy={acting}
        originalUrl={selected ? sourceUrl(selected.source, "original") : ""}
        resultUrl={selected ? outputUrl(selected) : ""}
        onClose={() => setSelected(null)}
        onRevise={revise}
        onApprove={approve}
      />
    </div>
  );
}
