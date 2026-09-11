import { useEffect, useState } from "react"
import { Building2, ChevronDown, ChevronRight, FileText, Plus, Users } from "lucide-react"
import { Card } from "../../components/ui/Card"
import { Badge } from "../../components/ui/Badge"
import { Button } from "../../components/ui/Button"
import { LoadingState, EmptyState } from "../../components/ui/States"
import { adminApi } from "../../api/admin"
import { useToast, errorMessage } from "../../shared/Toast"
import { formatMoney } from "../../shared/money"
import type { BusinessAccount, BusinessDepartment, BusinessInvoice } from "../../types"

const INVOICE_TONE: Record<BusinessInvoice["status"], "brand" | "success" | "neutral"> = {
  issued: "brand",
  paid: "success",
  void: "neutral",
}

function AccountDetail({ account }: { account: BusinessAccount }) {
  const { push } = useToast()
  const [departments, setDepartments] = useState<BusinessDepartment[]>([])
  const [invoices, setInvoices] = useState<BusinessInvoice[]>([])
  const [loading, setLoading] = useState(true)
  const [newDeptName, setNewDeptName] = useState("")
  const [newDeptLimit, setNewDeptLimit] = useState("")
  const [invoiceFrom, setInvoiceFrom] = useState("")
  const [invoiceTo, setInvoiceTo] = useState("")
  const [busy, setBusy] = useState(false)

  function load() {
    setLoading(true)
    Promise.all([adminApi.businessDepartments(account.id), adminApi.businessInvoices(account.id)])
      .then(([d, i]) => { setDepartments(d.departments); setInvoices(i.invoices) })
      .catch((err) => push("error", errorMessage(err)))
      .finally(() => setLoading(false))
  }

  useEffect(load, [account.id])

  async function addDepartment() {
    if (!newDeptName.trim()) return
    setBusy(true)
    try {
      await adminApi.createBusinessDepartment(account.id, {
        name: newDeptName.trim(),
        monthlySpendLimit: newDeptLimit ? Number(newDeptLimit) : undefined,
      })
      setNewDeptName("")
      setNewDeptLimit("")
      load()
    } catch (err) {
      push("error", errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function generateInvoice() {
    if (!invoiceFrom || !invoiceTo) {
      push("error", "Pick both a start and end date.")
      return
    }
    setBusy(true)
    try {
      await adminApi.generateBusinessInvoice(account.id, {
        periodStart: new Date(invoiceFrom).toISOString(),
        periodEnd: new Date(invoiceTo).toISOString(),
      })
      push("success", "Invoice generated.")
      load()
    } catch (err) {
      push("error", errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function markPaid(id: string) {
    setBusy(true)
    try {
      await adminApi.markInvoicePaid(id)
      load()
    } catch (err) {
      push("error", errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <LoadingState label="Loading account details…" />

  return (
    <div className="grid gap-4 border-t border-ink-900/[0.06] p-4 pt-4 lg:grid-cols-2">
      <div>
        <div className="mb-2 flex items-center gap-2">
          <Users className="h-4 w-4 text-rivo-600" />
          <p className="text-sm font-bold">Departments</p>
        </div>
        {departments.length === 0 ? (
          <p className="text-sm text-ink-700/50">No departments yet.</p>
        ) : (
          <div className="space-y-1.5">
            {departments.map((d) => (
              <div key={d.id} className="flex items-center justify-between rounded-lg bg-ink-900/[0.03] px-3 py-2 text-sm">
                <span className="font-semibold">{d.name}</span>
                <span className="text-xs text-ink-700/50">
                  {d._count?.employees ?? 0} employees {d.monthlySpendLimit ? `· cap ${formatMoney(d.monthlySpendLimit, account.city?.currencyCode ?? null)}` : ""}
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="mt-3 flex gap-2">
          <input
            value={newDeptName}
            onChange={(e) => setNewDeptName(e.target.value)}
            placeholder="Department name"
            className="h-9 flex-1 rounded-lg border border-ink-900/10 px-2.5 text-sm outline-none focus:border-rivo-500"
          />
          <input
            value={newDeptLimit}
            onChange={(e) => setNewDeptLimit(e.target.value)}
            placeholder="Cap (optional)"
            type="number"
            className="h-9 w-28 rounded-lg border border-ink-900/10 px-2.5 text-sm outline-none focus:border-rivo-500"
          />
          <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={addDepartment} disabled={busy}>Add</Button>
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center gap-2">
          <FileText className="h-4 w-4 text-rivo-600" />
          <p className="text-sm font-bold">Invoices</p>
        </div>
        {invoices.length === 0 ? (
          <p className="text-sm text-ink-700/50">No invoices yet.</p>
        ) : (
          <div className="space-y-1.5">
            {invoices.map((inv) => (
              <div key={inv.id} className="flex items-center justify-between rounded-lg bg-ink-900/[0.03] px-3 py-2 text-sm">
                <div>
                  <p className="font-semibold">{formatMoney(inv.totalAmount, inv.currencyCode)}</p>
                  <p className="text-[11px] text-ink-700/50">
                    {new Date(inv.periodStart).toLocaleDateString()} – {new Date(inv.periodEnd).toLocaleDateString()} · {inv.rideCount} rides
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={INVOICE_TONE[inv.status]}>{inv.status}</Badge>
                  {inv.status === "issued" && (
                    <button onClick={() => markPaid(inv.id)} disabled={busy} className="text-[11px] font-bold text-success-600">Mark paid</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="mt-3 flex gap-2">
          <input type="date" value={invoiceFrom} onChange={(e) => setInvoiceFrom(e.target.value)} className="h-9 flex-1 rounded-lg border border-ink-900/10 px-2.5 text-sm outline-none focus:border-rivo-500" />
          <input type="date" value={invoiceTo} onChange={(e) => setInvoiceTo(e.target.value)} className="h-9 flex-1 rounded-lg border border-ink-900/10 px-2.5 text-sm outline-none focus:border-rivo-500" />
          <Button size="sm" onClick={generateInvoice} disabled={busy}>Generate</Button>
        </div>
      </div>
    </div>
  )
}

export function BusinessAccountsPanel() {
  const { push } = useToast()
  const [accounts, setAccounts] = useState<BusinessAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  useEffect(() => {
    adminApi
      .businessAccounts()
      .then((r) => setAccounts(r.accounts))
      .catch((err) => push("error", errorMessage(err)))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-extrabold tracking-tight">Business accounts</h1>
          <p className="text-sm text-ink-700/60">Corporate accounts, departments, and invoices</p>
        </div>
      </div>

      {loading ? (
        <LoadingState label="Loading accounts…" />
      ) : accounts.length === 0 ? (
        <EmptyState icon={Building2} title="No business accounts" description="No corporate accounts have been created yet." />
      ) : (
        <div className="space-y-3">
          {accounts.map((a) => (
            <Card key={a.id} className="overflow-hidden p-0">
              <button
                onClick={() => setExpandedId(expandedId === a.id ? null : a.id)}
                className="flex w-full items-center justify-between p-4 text-left"
              >
                <div className="flex items-center gap-3">
                  {expandedId === a.id ? <ChevronDown className="h-4 w-4 text-ink-700/50" /> : <ChevronRight className="h-4 w-4 text-ink-700/50" />}
                  <div>
                    <p className="text-sm font-bold">{a.companyName}</p>
                    <p className="text-xs text-ink-700/50">
                      {a.city?.name} · {a._count?.employees ?? 0} employees · {a._count?.rides ?? 0} rides
                    </p>
                  </div>
                </div>
                <Badge tone={a.isActive ? "success" : "neutral"}>{a.isActive ? "Active" : "Inactive"}</Badge>
              </button>
              {expandedId === a.id && <AccountDetail account={a} />}
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
