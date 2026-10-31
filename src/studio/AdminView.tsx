import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Bell,
  Check,
  Clapperboard,
  LoaderCircle,
  ShieldCheck,
  Trash2,
  UserX,
  UserCheck,
  Activity,
  Brain,
  Sparkles,
} from "lucide-react";
import { del, get, post, postForm, put } from "@/api";
import type { MemoryItem, StudioEvent } from "@shared/types";

interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: "admin" | "member";
  disabled: number;
  created: number;
  last_seen: number | null;
  batches: number;
  images: number;
  spent: number;
}

interface ActivitySummary {
  since: number;
  total: number;
  byKind: { kind: string; n: number }[];
  byUser: { user: string | null; n: number }[];
  recent: StudioEvent[];
}

function eventLine(e: StudioEvent): string {
  let d: Record<string, unknown> = {};
  try {
    d = JSON.parse(e.data) as Record<string, unknown>;
  } catch {
    /* unreadable */
  }
  return Object.entries(d)
    .filter(([, v]) => v !== undefined && v !== null && v !== "" && v !== false)
    .slice(0, 5)
    .map(([k, v]) => `${k}: ${typeof v === "string" ? v.slice(0, 70) : String(v)}`)
    .join(" · ");
}

interface AdminSettings {
  inviteCode: string;
  spendThreshold: number;
  retentionDays: number;
  notifyWebhook: string;
  notifyEmail: string;
  resendConfigured: boolean;
}

export default function AdminView({ me }: { me: string }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [form, setForm] = useState<Partial<AdminSettings> & { resendApiKey?: string }>({});
  const [saving, setSaving] = useState(false);
  const [hero, setHero] = useState<string>("");
  const [heroBusy, setHeroBusy] = useState(false);
  const [activity, setActivity] = useState<ActivitySummary | null>(null);
  const [activityDays, setActivityDays] = useState(7);
  const [memory, setMemory] = useState<MemoryItem[]>([]);
  const [lastLearn, setLastLearn] = useState(0);
  const [learning, setLearning] = useState(false);
  const [newRule, setNewRule] = useState({ scope: "global", title: "", text: "" });
  useEffect(() => {
    get<ActivitySummary>(`/api/admin/activity?days=${activityDays}`)
      .then(setActivity)
      .catch(() => setActivity(null));
  }, [activityDays]);
  useEffect(() => {
    get<{ items: MemoryItem[]; lastLearn: number }>("/api/admin/memory")
      .then((d) => {
        setMemory(d.items);
        setLastLearn(d.lastLearn);
      })
      .catch(() => {});
  }, []);
  const learnNow = async () => {
    setLearning(true);
    try {
      const r = await post<{ added: number; updated: number; events: number; items: MemoryItem[] }>(
        "/api/admin/memory/learn",
      );
      setMemory(r.items);
      setLastLearn(Date.now());
      toast.success(
        r.events < 20
          ? `Only ${r.events} events so far; the studio needs more activity before it can learn.`
          : `${r.added} new lesson${r.added === 1 ? "" : "s"} suggested, ${r.updated} strengthened, from ${r.events} events.`,
      );
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLearning(false);
    }
  };
  const setStatus = async (item: MemoryItem, status: MemoryItem["status"]) => {
    try {
      await put(`/api/admin/memory/${item.id}`, { status });
      setMemory((l) => l.map((m) => (m.id === item.id ? { ...m, status } : m)));
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const removeMemory = async (item: MemoryItem) => {
    if (!window.confirm("Delete this lesson from the brand memory?")) return;
    try {
      await del(`/api/admin/memory/${item.id}`);
      setMemory((l) => l.filter((m) => m.id !== item.id));
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const addRule = async () => {
    if (!newRule.text.trim()) return;
    try {
      const r = await post<{ item: MemoryItem }>("/api/admin/memory", { ...newRule, kind: "rule" });
      setMemory((l) => [r.item, ...l]);
      setNewRule({ scope: "global", title: "", text: "" });
      toast.success("Lesson added and active.");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  useEffect(() => {
    get<{ hero?: string }>("/api/studio/state")
      .then((d) => setHero(d.hero ?? ""))
      .catch(() => {});
  }, []);
  const uploadHero = async (file: File | null) => {
    if (!file) return;
    setHeroBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await postForm<{ hero: string }>("/api/admin/hero", fd);
      setHero(r.hero);
      toast.success("Hero video updated. Reload the studio to see it.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setHeroBusy(false);
    }
  };
  const removeHero = async () => {
    setHeroBusy(true);
    try {
      await del("/api/admin/hero");
      setHero("");
      toast.success("Hero video removed.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setHeroBusy(false);
    }
  };

  async function load() {
    try {
      const d = await get<{ users: AdminUser[]; settings: AdminSettings }>("/api/admin/users");
      setUsers(d.users);
      setSettings(d.settings);
      setForm({
        inviteCode: d.settings.inviteCode,
        spendThreshold: d.settings.spendThreshold,
        retentionDays: d.settings.retentionDays,
        notifyWebhook: d.settings.notifyWebhook,
        notifyEmail: d.settings.notifyEmail,
      });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function save() {
    setSaving(true);
    try {
      await post("/api/admin/settings", form);
      toast.success("Settings saved.");
      await load();
      setForm((f) => ({ ...f, resendApiKey: undefined }));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function toggle(u: AdminUser) {
    try {
      await post("/api/admin/users/disable", { id: u.id, disabled: !u.disabled });
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function role(u: AdminUser) {
    try {
      await post("/api/admin/users/role", {
        id: u.id,
        role: u.role === "admin" ? "member" : "admin",
      });
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const totalSpent = users.reduce((n, u) => n + (u.spent || 0), 0);

  return (
    <div className="admin">
      <section className="batches-page">
        <div className="panel-heading" style={{ padding: "8px 16px 0" }}>
          <ShieldCheck size={18} />
          <h2>Team</h2>
          <span className="quality-note" style={{ marginLeft: "auto" }}>
            Total estimated spend ≈ ${totalSpent.toFixed(2)}
          </span>
        </div>
        <div className="batches-table admin-table" role="table">
          <div className="batches-head" role="row">
            <span>User</span>
            <span>Role</span>
            <span>Batches</span>
            <span>Images</span>
            <span>Spent</span>
            <span>Last seen</span>
            <span />
          </div>
          {users.map((u) => (
            <div className={`batches-row ${u.disabled ? "disabled" : ""}`} role="row" key={u.id}>
              <span className="batches-name">
                <strong>{u.name}</strong>
                <small>{u.email}</small>
              </span>
              <span>{u.role}</span>
              <span>{u.batches}</span>
              <span>{u.images}</span>
              <span>≈ ${(u.spent || 0).toFixed(2)}</span>
              <span>{u.last_seen ? new Date(u.last_seen).toLocaleString("en-GB") : "never"}</span>
              <span className="footer-actions">
                {u.id !== me && (
                  <>
                    <button className="secondary" onClick={() => void role(u)} title="Toggle admin">
                      {u.role === "admin" ? "Make member" : "Make admin"}
                    </button>
                    <button
                      className={`secondary ${u.disabled ? "" : "danger"}`}
                      onClick={() => void toggle(u)}
                    >
                      {u.disabled ? <UserCheck size={15} /> : <UserX size={15} />}
                      {u.disabled ? "Enable" : "Disable"}
                    </button>
                  </>
                )}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="batches-page admin-settings">
        <div className="panel-heading" style={{ padding: "8px 16px 0" }}>
          <Clapperboard size={18} />
          <h2>Studio hero video</h2>
        </div>
        <div className="hero-admin">
          {hero ? (
            <video key={hero} className="hero-preview" autoPlay muted loop playsInline>
              <source src={`/api/studio/hero?f=webm&v=${hero}`} type="video/webm" />
              <source src={`/api/studio/hero?v=${hero}`} type="video/mp4" />
            </video>
          ) : (
            <p className="quality-note">
              No video yet. Upload a short looping MP4 or WebM (under 40 MB) to show it under the
              studio title.
            </p>
          )}
          <div className="footer-actions">
            <label className="secondary">
              {heroBusy ? (
                <LoaderCircle className="spinning" size={16} />
              ) : (
                <Clapperboard size={16} />
              )}
              {hero ? "Replace video" : "Upload video"}
              <input
                type="file"
                accept="video/mp4,video/webm,video/quicktime"
                hidden
                disabled={heroBusy}
                onChange={(e) => {
                  void uploadHero(e.target.files?.[0] ?? null);
                  e.target.value = "";
                }}
              />
            </label>
            {hero && (
              <button
                className="text-button danger-text"
                onClick={() => void removeHero()}
                disabled={heroBusy}
              >
                <Trash2 size={14} /> Remove
              </button>
            )}
          </div>
        </div>
      </section>

      <section className="batches-page">
        <div className="panel-heading" style={{ padding: "8px 16px 0" }}>
          <Activity size={18} />
          <h2>Activity</h2>
          <span className="quality-note" style={{ marginLeft: "auto" }}>
            {activity ? `${activity.total} events` : "…"} in the last
            <select
              value={activityDays}
              onChange={(e) => setActivityDays(Number(e.target.value))}
              style={{ margin: "0 6px" }}
            >
              <option value={1}>day</option>
              <option value={7}>7 days</option>
              <option value={30}>30 days</option>
              <option value={90}>90 days</option>
            </select>
          </span>
        </div>
        <p className="quality-note" style={{ padding: "0 16px" }}>
          Every click and decision in the studio, and every engine result, is recorded here. The
          brand memory learns from this record.
        </p>
        {activity && activity.byKind.length > 0 && (
          <div className="activity-kinds">
            {activity.byKind.map((k) => (
              <span key={k.kind} className="activity-chip">
                <strong>{k.n}</strong> {k.kind}
              </span>
            ))}
          </div>
        )}
        <div className="activity-list">
          {(activity?.recent ?? []).slice(0, 120).map((e) => (
            <div key={e.id} className={`activity-row actor-${e.actor}`}>
              <span className="activity-time">
                {new Date(e.at).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
              <span className="activity-kind">{e.kind}</span>
              <span className="activity-detail">
                {[e.skill, e.mode ? `approach ${e.mode}` : null, eventLine(e)]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </div>
          ))}
          {activity && activity.recent.length === 0 && (
            <p className="quality-note" style={{ padding: "0 16px" }}>
              Nothing recorded yet. Use the studio and come back.
            </p>
          )}
        </div>
      </section>

      <section className="batches-page">
        <div className="panel-heading" style={{ padding: "8px 16px 0" }}>
          <Brain size={18} />
          <h2>Brand memory</h2>
          <span className="quality-note" style={{ marginLeft: "auto" }}>
            {lastLearn
              ? `Last learning run ${new Date(lastLearn).toLocaleDateString()}`
              : "Not run yet"}
          </span>
          <button
            type="button"
            className="secondary"
            disabled={learning}
            onClick={() => void learnNow()}
          >
            {learning ? <LoaderCircle className="spinning" size={16} /> : <Sparkles size={16} />}
            Learn now
          </button>
        </div>
        <p className="quality-note" style={{ padding: "0 16px" }}>
          Once a week the studio reads the activity record and proposes lessons: corrections the
          team keeps making, things to avoid for a skill, what the engines fail on. Accept a lesson
          and every later prompt follows it; dismiss what is wrong. You can also write a lesson
          yourself.
        </p>
        <div className="memory-add">
          <select
            value={newRule.scope}
            onChange={(e) => setNewRule({ ...newRule, scope: e.target.value })}
            aria-label="Scope"
          >
            <option value="global">Every skill</option>
            {[...new Set(memory.map((m) => m.scope).filter((x) => x.startsWith("skill:")))].map(
              (x) => (
                <option key={x} value={x}>
                  {x.replace("skill:", "Skill: ")}
                </option>
              ),
            )}
          </select>
          <input
            placeholder="Short title"
            value={newRule.title}
            onChange={(e) => setNewRule({ ...newRule, title: e.target.value })}
          />
          <input
            placeholder="The lesson, as an instruction the prompt writer follows"
            value={newRule.text}
            onChange={(e) => setNewRule({ ...newRule, text: e.target.value })}
          />
          <button
            type="button"
            className="secondary"
            disabled={!newRule.text.trim()}
            onClick={() => void addRule()}
          >
            Add
          </button>
        </div>
        <div className="memory-list">
          {memory.map((m) => (
            <div key={m.id} className={`memory-row status-${m.status}`}>
              <div className="memory-head">
                <span className={`memory-badge kind-${m.kind}`}>{m.kind}</span>
                <span className="memory-scope">
                  {m.scope === "global" ? "every skill" : m.scope.replace("skill:", "skill: ")}
                </span>
                <strong>{m.title || "(untitled)"}</strong>
                <span className="memory-evidence" title="Supporting events">
                  {m.evidence} events
                </span>
                <span className="memory-status">{m.status}</span>
              </div>
              <p className="memory-text">{m.text}</p>
              <div className="memory-actions">
                {m.status !== "active" && (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => void setStatus(m, "active")}
                  >
                    <Check size={13} /> Accept
                  </button>
                )}
                {m.status !== "dismissed" && (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => void setStatus(m, "dismissed")}
                  >
                    Dismiss
                  </button>
                )}
                <button
                  type="button"
                  className="text-button danger"
                  onClick={() => void removeMemory(m)}
                >
                  <Trash2 size={13} /> Delete
                </button>
              </div>
            </div>
          ))}
          {memory.length === 0 && (
            <p className="quality-note" style={{ padding: "0 16px 12px" }}>
              No lessons yet. Press "Learn now" after a few days of work, or add one yourself.
            </p>
          )}
        </div>
      </section>

      <section className="batches-page admin-settings">
        <div className="panel-heading" style={{ padding: "8px 16px 0" }}>
          <Bell size={18} />
          <h2>Workspace settings</h2>
        </div>
        <div className="admin-grid">
          <label>
            <span className="field-label">Invite code for new accounts</span>
            <input
              value={form.inviteCode ?? ""}
              onChange={(e) => setForm({ ...form, inviteCode: e.target.value })}
            />
            <small>Empty closes registration.</small>
          </label>
          <label>
            <span className="field-label">Ask before spending more than ($)</span>
            <input
              type="number"
              min={0}
              value={form.spendThreshold ?? 20}
              onChange={(e) => setForm({ ...form, spendThreshold: Number(e.target.value) })}
            />
            <small>A confirmation appears when a run's estimate exceeds this.</small>
          </label>
          <label>
            <span className="field-label">Delete batches after (days)</span>
            <input
              type="number"
              min={0}
              value={form.retentionDays ?? 90}
              onChange={(e) => setForm({ ...form, retentionDays: Number(e.target.value) })}
            />
            <small>
              Originals and results of batches untouched for this long are removed. 0 keeps
              everything.
            </small>
          </label>
          <label>
            <span className="field-label">Slack / Discord webhook URL</span>
            <input
              value={form.notifyWebhook ?? ""}
              placeholder="https://hooks.slack.com/..."
              onChange={(e) => setForm({ ...form, notifyWebhook: e.target.value })}
            />
            <small>Sent when a batch finishes or pauses with an error.</small>
          </label>
          <label>
            <span className="field-label">Notification email(s)</span>
            <input
              value={form.notifyEmail ?? ""}
              placeholder="name@company.com, other@company.com"
              onChange={(e) => setForm({ ...form, notifyEmail: e.target.value })}
            />
            <small>Needs a Resend API key below.</small>
          </label>
          <label>
            <span className="field-label">
              Resend API key {settings?.resendConfigured ? "(saved)" : ""}
            </span>
            <input
              type="password"
              autoComplete="off"
              placeholder={settings?.resendConfigured ? "•••••• (leave empty to keep)" : "re_..."}
              value={form.resendApiKey ?? ""}
              onChange={(e) => setForm({ ...form, resendApiKey: e.target.value })}
            />
            <small>Free at resend.com; used only for the emails above.</small>
          </label>
        </div>
        <div className="footer-actions" style={{ padding: "0 16px 8px" }}>
          <button className="primary" onClick={() => void save()} disabled={saving}>
            {saving ? <LoaderCircle className="spinning" size={16} /> : <Check size={16} />} Save
            settings
          </button>
          <button
            className="secondary"
            onClick={() =>
              post("/api/admin/notify/test")
                .then(() => toast.success("Test notification sent."))
                .catch((e) => toast.error(e.message))
            }
          >
            <Bell size={16} /> Send test notification
          </button>
        </div>
      </section>
    </div>
  );
}
