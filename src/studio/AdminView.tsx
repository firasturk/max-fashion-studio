import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Bell, Check, LoaderCircle, ShieldCheck, UserX, UserCheck } from "lucide-react";
import { get, post } from "@/api";

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
