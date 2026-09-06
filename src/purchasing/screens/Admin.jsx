import { useEffect, useState } from 'react'
import {
  fetchDepartmentManagers,
  fetchInvites,
  inviteStaff,
  revokeInvite,
  saveDepartment,
  saveSettings,
  saveStaff,
  saveVendor,
  setBudget,
  setDepartmentManagers,
} from '../api.js'
import { money, ROLE_LABEL, toNumber } from '../format.js'
import { ErrorNote, Field, Modal } from '../ui.jsx'

const TABS = [
  ['departments', 'Departments'],
  ['budgets', 'Budgets'],
  ['vendors', 'Stores'],
  ['people', 'People'],
  ['settings', 'Settings'],
]

export default function Admin({ me, data, onChanged, onToast }) {
  const [tab, setTab] = useState('departments')
  const [error, setError] = useState(null)

  const run = async (fn, message) => {
    setError(null)
    try {
      await fn()
      onChanged()
      if (message) onToast(message)
    } catch (e) {
      setError(e)
    }
  }

  return (
    <>
      <div className="pp-chips" style={{ marginBottom: 14 }}>
        {TABS.map(([key, label]) => (
          <button
            key={key}
            className={`pp-chip small ${tab === key ? 'selected' : ''}`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      <ErrorNote error={error} />

      {tab === 'departments' && <Departments data={data} run={run} />}
      {tab === 'budgets' && <Budgets data={data} run={run} />}
      {tab === 'vendors' && <Vendors data={data} run={run} />}
      {tab === 'people' && <People me={me} data={data} run={run} />}
      {tab === 'settings' && <Settings data={data} run={run} />}
    </>
  )
}

// --- departments -----------------------------------------------------------

function Departments({ data, run }) {
  const [editing, setEditing] = useState(null)
  const [managers, setManagers] = useState(null)

  useEffect(() => {
    fetchDepartmentManagers().then(setManagers).catch(() => setManagers([]))
  }, [data.refreshKey])

  const managersFor = (id) =>
    (managers || [])
      .filter((m) => m.department_id === id)
      .map((m) => data.staff.find((s) => s.id === m.staff_id)?.full_name)
      .filter(Boolean)

  return (
    <>
      <button
        className="pp-btn ghost"
        style={{ marginBottom: 12 }}
        onClick={() => setEditing({ name: '', emoji: '📦', code: '', sort_order: 500, active: true })}
      >
        + Add a department
      </button>

      {data.allDepartments.map((d) => (
        <div key={d.id} className="pp-card" style={{ padding: 13, opacity: d.active ? 1 : 0.55 }}>
          <div className="pp-spread">
            <div>
              <strong>
                {d.emoji} {d.name}
              </strong>
              <div className="pp-muted">
                {d.code || 'no code'}
                {!d.active && ' · hidden'}
                {managersFor(d.id).length > 0 && ` · managed by ${managersFor(d.id).join(', ')}`}
              </div>
            </div>
            <button className="pp-link" onClick={() => setEditing(d)}>
              Edit
            </button>
          </div>
        </div>
      ))}

      {editing && (
        <DepartmentEditor
          department={editing}
          staff={data.staff}
          currentManagerIds={(managers || [])
            .filter((m) => m.department_id === editing.id)
            .map((m) => m.staff_id)}
          onClose={() => setEditing(null)}
          onSave={async (dept, managerIds) => {
            await run(async () => {
              const saved = await saveDepartment(dept)
              if (managerIds) await setDepartmentManagers(saved.id, managerIds)
              const rows = await fetchDepartmentManagers()
              setManagers(rows)
            }, 'Department saved')
            setEditing(null)
          }}
        />
      )}
    </>
  )
}

function DepartmentEditor({ department, staff, currentManagerIds, onClose, onSave }) {
  const [form, setForm] = useState(department)
  const [managerIds, setManagerIds] = useState(currentManagerIds)
  const [busy, setBusy] = useState(false)
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))
  const eligible = staff.filter((s) => s.role !== 'employee')

  return (
    <Modal title={department.id ? 'Edit department' : 'New department'} onClose={onClose}>
      <div className="pp-row">
        <Field label="Emoji">
          <input
            className="pp-input"
            value={form.emoji || ''}
            onChange={(e) => set({ emoji: e.target.value })}
            style={{ textAlign: 'center' }}
          />
        </Field>
        <Field label="Name">
          <input
            className="pp-input"
            value={form.name}
            onChange={(e) => set({ name: e.target.value })}
          />
        </Field>
      </div>
      <div className="pp-row">
        <Field label="Code" hint="Shown in exports.">
          <input
            className="pp-input"
            value={form.code || ''}
            onChange={(e) => set({ code: e.target.value.toUpperCase() })}
          />
        </Field>
        <Field label="Sort order">
          <input
            className="pp-input"
            type="number"
            value={form.sort_order ?? 0}
            onChange={(e) => set({ sort_order: Number(e.target.value) })}
          />
        </Field>
      </div>

      <Field label="Managers" hint="Managers see and approve this department's purchases.">
        <div className="pp-chips">
          {eligible.length === 0 && (
            <span className="pp-muted">Give someone the manager role first, on the People tab.</span>
          )}
          {eligible.map((s) => (
            <button
              key={s.id}
              className={`pp-chip small ${managerIds.includes(s.id) ? 'selected' : ''}`}
              onClick={() =>
                setManagerIds(
                  managerIds.includes(s.id)
                    ? managerIds.filter((id) => id !== s.id)
                    : [...managerIds, s.id]
                )
              }
            >
              {s.full_name}
            </button>
          ))}
        </div>
      </Field>

      <label className="pp-row" style={{ marginBottom: 16 }}>
        <input
          type="checkbox"
          checked={form.active}
          onChange={(e) => set({ active: e.target.checked })}
        />
        <span>Available for new purchases</span>
      </label>

      <button
        className="pp-btn"
        disabled={busy || !form.name.trim()}
        onClick={async () => {
          setBusy(true)
          await onSave(form, department.id ? managerIds : null)
          setBusy(false)
        }}
      >
        {busy ? 'Saving…' : 'Save'}
      </button>
      {!department.id && (
        <p className="pp-muted" style={{ marginTop: 10 }}>
          Managers can be assigned once the department exists.
        </p>
      )}
    </Modal>
  )
}

// --- budgets ---------------------------------------------------------------

function Budgets({ data, run }) {
  const [editing, setEditing] = useState(null)

  return (
    <>
      <p className="pp-muted" style={{ marginBottom: 12 }}>
        A budget applies to the current calendar month, quarter or year. Changing one closes the
        old figure rather than overwriting it, so past periods still explain themselves.
      </p>
      {data.allDepartments
        .filter((d) => d.active)
        .map((d) => {
          const budget = data.budgets.find((b) => b.department_id === d.id)
          return (
            <div key={d.id} className="pp-card" style={{ padding: 13 }}>
              <div className="pp-spread">
                <div>
                  <strong>
                    {d.emoji} {d.name}
                  </strong>
                  <div className="pp-muted">
                    {budget
                      ? `${money(budget.amount)} per ${budget.period.replace('ly', '')} · ${money(
                          budget.spent
                        )} spent (${budget.pct}%)`
                      : 'No budget set'}
                  </div>
                </div>
                <button className="pp-link" onClick={() => setEditing({ department: d, budget })}>
                  {budget ? 'Change' : 'Set'}
                </button>
              </div>
            </div>
          )
        })}

      {editing && (
        <BudgetEditor
          {...editing}
          onClose={() => setEditing(null)}
          onSave={async (period, amount) => {
            await run(
              () => setBudget(editing.department.id, period, amount),
              amount == null ? 'Budget removed' : 'Budget saved'
            )
            setEditing(null)
          }}
        />
      )}
    </>
  )
}

function BudgetEditor({ department, budget, onClose, onSave }) {
  const [period, setPeriod] = useState(budget?.period || 'monthly')
  const [amount, setAmount] = useState(budget ? String(budget.amount) : '')
  const [busy, setBusy] = useState(false)

  return (
    <Modal title={`${department.name} budget`} onClose={onClose}>
      <Field label="Period">
        <select className="pp-select" value={period} onChange={(e) => setPeriod(e.target.value)}>
          <option value="monthly">Every month</option>
          <option value="quarterly">Every quarter</option>
          <option value="yearly">Every year</option>
        </select>
      </Field>
      <Field label="Amount">
        <input
          className="pp-input"
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="5000.00"
        />
      </Field>
      <button
        className="pp-btn"
        disabled={busy || !toNumber(amount)}
        onClick={async () => {
          setBusy(true)
          await onSave(period, toNumber(amount))
          setBusy(false)
        }}
      >
        {busy ? 'Saving…' : 'Save budget'}
      </button>
      {budget && (
        <button
          className="pp-link"
          style={{ display: 'block', margin: '10px auto 0' }}
          onClick={() => onSave(period, null)}
        >
          Remove this budget
        </button>
      )}
    </Modal>
  )
}

// --- vendors ---------------------------------------------------------------

const CHANNEL_LABEL = {
  online: 'Online',
  in_store: 'In person',
  both: 'Online or in person',
}

const INTEGRATION_LABEL = {
  manual: 'Typed in by hand',
  email: 'Order confirmation email',
  export: 'Vendor dashboard export',
  api: 'Official vendor API',
}

function Vendors({ data, run }) {
  const [editing, setEditing] = useState(null)

  return (
    <>
      <button
        className="pp-btn ghost"
        style={{ marginBottom: 12 }}
        onClick={() =>
          setEditing({
            name: '',
            url: '',
            emoji: '🛒',
            category: 'Other',
            category_order: 90,
            sort_order: 0,
            active: true,
            integration: 'manual',
            channel: 'online',
            requires_receipt: true,
          })
        }
      >
        + Add a store
      </button>

      {data.allVendors.map((v) => (
        <div key={v.id} className="pp-card" style={{ padding: 13, opacity: v.active ? 1 : 0.55 }}>
          <div className="pp-spread">
            <div style={{ minWidth: 0 }}>
              <strong>
                {v.emoji} {v.name}
              </strong>
              <div className="pp-muted">
                {CHANNEL_LABEL[v.channel] || v.channel} · {v.category}
                {v.items_in_email === false && ' · email has no items'}
                {!v.active && ' · hidden'}
              </div>
            </div>
            <button className="pp-link" onClick={() => setEditing(v)}>
              Edit
            </button>
          </div>
        </div>
      ))}

      {editing && (
        <VendorEditor
          vendor={editing}
          onClose={() => setEditing(null)}
          onSave={async (vendor) => {
            await run(() => saveVendor(vendor), 'Store saved')
            setEditing(null)
          }}
        />
      )}
    </>
  )
}

function VendorEditor({ vendor, onClose, onSave }) {
  const [form, setForm] = useState(vendor)
  const [busy, setBusy] = useState(false)
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))

  return (
    <Modal title={vendor.id ? 'Edit store' : 'New store'} onClose={onClose}>
      <div className="pp-row">
        <Field label="Icon">
          <input
            className="pp-input"
            value={form.emoji || ''}
            onChange={(e) => set({ emoji: e.target.value })}
            style={{ textAlign: 'center' }}
          />
        </Field>
        <Field label="Name">
          <input
            className="pp-input"
            value={form.name}
            onChange={(e) => set({ name: e.target.value })}
          />
        </Field>
      </div>
      <Field label="Website" hint="Where the Shop button sends people.">
        <input
          className="pp-input"
          type="url"
          value={form.url || ''}
          onChange={(e) => set({ url: e.target.value })}
          placeholder="https://"
        />
      </Field>
      <div className="pp-row">
        <Field label="Group">
          <input
            className="pp-input"
            value={form.category}
            onChange={(e) => set({ category: e.target.value })}
            placeholder="Bulk & Warehouse"
          />
        </Field>
        <Field label="Order in group">
          <input
            className="pp-input"
            type="number"
            value={form.sort_order ?? 0}
            onChange={(e) => set({ sort_order: Number(e.target.value) })}
          />
        </Field>
      </div>
      <Field
        label="How people buy here"
        hint="Decides what staff are asked for: an online order records itself from the confirmation email; a walk-in needs the receipt photographed."
      >
        <select
          className="pp-select"
          value={form.channel || 'online'}
          onChange={(e) => set({ channel: e.target.value })}
        >
          <option value="online">Online only — recorded from the email</option>
          <option value="in_store">In person only — photograph the receipt</option>
          <option value="both">Both</option>
        </select>
      </Field>
      <Field
        label="How order data reaches the portal"
        hint="Everything falls back to manual entry plus a receipt; this records what the store actually offers."
      >
        <select
          className="pp-select"
          value={form.integration}
          onChange={(e) => set({ integration: e.target.value })}
        >
          {Object.entries(INTEGRATION_LABEL).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Note for staff" hint="Shown when someone picks this store.">
        <input
          className="pp-input"
          value={form.account_hint || ''}
          onChange={(e) => set({ account_hint: e.target.value })}
          placeholder="Use the school Amazon Business account"
        />
      </Field>
      <label className="pp-row" style={{ marginBottom: 16 }}>
        <input
          type="checkbox"
          checked={form.active}
          onChange={(e) => set({ active: e.target.checked })}
        />
        <span>Show in the store list</span>
      </label>

      <button
        className="pp-btn"
        disabled={busy || !form.name.trim() || !form.url?.trim()}
        onClick={async () => {
          setBusy(true)
          await onSave(form)
          setBusy(false)
        }}
      >
        {busy ? 'Saving…' : 'Save'}
      </button>
    </Modal>
  )
}

// --- people ----------------------------------------------------------------

function People({ me, data, run }) {
  const [invites, setInvites] = useState(null)
  const [inviting, setInviting] = useState(false)
  const [editing, setEditing] = useState(null)

  const loadInvites = () => fetchInvites().then(setInvites).catch(() => setInvites([]))
  useEffect(() => {
    loadInvites()
  }, [data.refreshKey])

  const canSetSuperAdmin = me.role === 'super_admin'

  return (
    <>
      <button className="pp-btn ghost" style={{ marginBottom: 12 }} onClick={() => setInviting(true)}>
        + Invite someone
      </button>

      {invites?.length > 0 && (
        <div className="pp-card">
          <h2>Invited, not signed up yet</h2>
          {invites.map((i) => (
            <div key={i.email} className="pp-spread" style={{ marginBottom: 8 }}>
              <div>
                <strong>{i.email}</strong>
                <div className="pp-muted">
                  {ROLE_LABEL[i.role]}
                  {i.home_department?.name && ` · ${i.home_department.name}`}
                </div>
              </div>
              <button
                className="pp-link"
                onClick={async () => {
                  await run(() => revokeInvite(i.email), 'Invitation withdrawn')
                  loadInvites()
                }}
              >
                Withdraw
              </button>
            </div>
          ))}
          <p className="pp-muted">
            They get access by choosing &ldquo;Set up your account&rdquo; on the sign-in screen and
            using this exact email address.
          </p>
        </div>
      )}

      {data.staff.map((s) => (
        <div key={s.id} className="pp-card" style={{ padding: 13, opacity: s.active ? 1 : 0.55 }}>
          <div className="pp-spread">
            <div style={{ minWidth: 0 }}>
              <strong>{s.full_name}</strong>
              <div className="pp-muted">
                {ROLE_LABEL[s.role]}
                {s.home_department?.name && ` · ${s.home_department.name}`}
                {s.auto_approve_limit != null && ` · approves up to ${money(s.auto_approve_limit)}`}
                {!s.active && ' · no access'}
              </div>
            </div>
            <button className="pp-link" onClick={() => setEditing(s)}>
              Edit
            </button>
          </div>
        </div>
      ))}

      {inviting && (
        <InviteEditor
          departments={data.allDepartments}
          canSetSuperAdmin={canSetSuperAdmin}
          onClose={() => setInviting(false)}
          onSave={async (invite) => {
            await run(() => inviteStaff(invite), 'Invitation sent')
            loadInvites()
            setInviting(false)
          }}
        />
      )}

      {editing && (
        <StaffEditor
          staff={editing}
          me={me}
          departments={data.allDepartments}
          canSetSuperAdmin={canSetSuperAdmin}
          onClose={() => setEditing(null)}
          onSave={async (patch) => {
            await run(() => saveStaff(editing.id, patch), 'Saved')
            setEditing(null)
          }}
        />
      )}
    </>
  )
}

function RoleSelect({ value, onChange, canSetSuperAdmin, disabled }) {
  return (
    <Field
      label="Role"
      hint="Employees see only their own purchases. Managers see and approve their departments'. Administrators see everything."
    >
      <select
        className="pp-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      >
        {Object.entries(ROLE_LABEL)
          .filter(([key]) => canSetSuperAdmin || key !== 'super_admin')
          .map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
      </select>
    </Field>
  )
}

function InviteEditor({ departments, canSetSuperAdmin, onClose, onSave }) {
  const [form, setForm] = useState({ email: '', full_name: '', role: 'employee', home_department_id: '' })
  const [busy, setBusy] = useState(false)
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))

  return (
    <Modal title="Invite someone" onClose={onClose}>
      <Field label="School email" hint="Must match exactly what they sign up with.">
        <input
          className="pp-input"
          type="email"
          value={form.email}
          onChange={(e) => set({ email: e.target.value })}
          autoCapitalize="none"
        />
      </Field>
      <Field label="Name (optional)">
        <input
          className="pp-input"
          value={form.full_name}
          onChange={(e) => set({ full_name: e.target.value })}
        />
      </Field>
      <RoleSelect
        value={form.role}
        onChange={(role) => set({ role })}
        canSetSuperAdmin={canSetSuperAdmin}
      />
      <Field label="Home department" hint="Pre-selected when they shop.">
        <select
          className="pp-select"
          value={form.home_department_id}
          onChange={(e) => set({ home_department_id: e.target.value })}
        >
          <option value="">None</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </Field>
      <button
        className="pp-btn"
        disabled={busy || !form.email.includes('@')}
        onClick={async () => {
          setBusy(true)
          await onSave({ ...form, home_department_id: form.home_department_id || null })
          setBusy(false)
        }}
      >
        {busy ? 'Saving…' : 'Create invitation'}
      </button>
    </Modal>
  )
}

function StaffEditor({ staff, me, departments, canSetSuperAdmin, onClose, onSave }) {
  const [form, setForm] = useState({
    full_name: staff.full_name,
    role: staff.role,
    home_department_id: staff.home_department_id || '',
    auto_approve_limit: staff.auto_approve_limit != null ? String(staff.auto_approve_limit) : '',
    active: staff.active,
  })
  const [busy, setBusy] = useState(false)
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))
  const isSelf = staff.id === me.id

  return (
    <Modal title={staff.full_name} onClose={onClose}>
      {isSelf && (
        <div className="pp-notice info">
          This is your own account — you cannot remove your own access or change your own role.
        </div>
      )}
      <Field label="Name">
        <input
          className="pp-input"
          value={form.full_name}
          onChange={(e) => set({ full_name: e.target.value })}
        />
      </Field>
      <RoleSelect
        value={form.role}
        onChange={(role) => set({ role })}
        canSetSuperAdmin={canSetSuperAdmin}
        disabled={isSelf}
      />
      <Field label="Home department">
        <select
          className="pp-select"
          value={form.home_department_id}
          onChange={(e) => set({ home_department_id: e.target.value })}
        >
          <option value="">None</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </Field>
      <Field
        label="Approval limit"
        hint="Purchases above this need a manager's approval. Blank uses the school-wide limit."
      >
        <input
          className="pp-input"
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          value={form.auto_approve_limit}
          onChange={(e) => set({ auto_approve_limit: e.target.value })}
          placeholder="School default"
        />
      </Field>
      <label className="pp-row" style={{ marginBottom: 16 }}>
        <input
          type="checkbox"
          checked={form.active}
          disabled={isSelf}
          onChange={(e) => set({ active: e.target.checked })}
        />
        <span>Can sign in to the portal</span>
      </label>
      <button
        className="pp-btn"
        disabled={busy || !form.full_name.trim()}
        onClick={async () => {
          setBusy(true)
          await onSave({
            full_name: form.full_name.trim(),
            role: form.role,
            home_department_id: form.home_department_id || null,
            auto_approve_limit: toNumber(form.auto_approve_limit),
            active: form.active,
          })
          setBusy(false)
        }}
      >
        {busy ? 'Saving…' : 'Save'}
      </button>
    </Modal>
  )
}

// --- settings --------------------------------------------------------------

function Settings({ data, run }) {
  const s = data.settings
  const [form, setForm] = useState({
    school_name: s.school_name,
    approval_threshold: String(s.approval_threshold),
    budget_warn_pct: String(s.budget_warn_pct),
  })
  const [busy, setBusy] = useState(false)
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))

  return (
    <div className="pp-card">
      <h2>School-wide settings</h2>
      <Field label="School name">
        <input
          className="pp-input"
          value={form.school_name}
          onChange={(e) => set({ school_name: e.target.value })}
        />
      </Field>
      <Field
        label="Approval limit"
        hint="Purchases above this go to a department manager. Individual people can be given their own limit on the People tab."
      >
        <input
          className="pp-input"
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          value={form.approval_threshold}
          onChange={(e) => set({ approval_threshold: e.target.value })}
        />
      </Field>
      <Field label="Budget warning at" hint="Percent of a department's budget that triggers a warning.">
        <input
          className="pp-input"
          type="number"
          min="1"
          max="100"
          value={form.budget_warn_pct}
          onChange={(e) => set({ budget_warn_pct: e.target.value })}
        />
      </Field>
      <button
        className="pp-btn"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          await run(
            () =>
              saveSettings({
                school_name: form.school_name.trim(),
                approval_threshold: toNumber(form.approval_threshold) ?? 0,
                budget_warn_pct: Number(form.budget_warn_pct) || 80,
              }),
            'Settings saved'
          )
          setBusy(false)
        }}
      >
        {busy ? 'Saving…' : 'Save settings'}
      </button>
    </div>
  )
}
