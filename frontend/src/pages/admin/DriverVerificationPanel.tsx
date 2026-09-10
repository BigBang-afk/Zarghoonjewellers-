import { useEffect, useState } from "react"
import { CheckCircle2, ShieldAlert, XCircle } from "lucide-react"
import { Card } from "../../components/ui/Card"
import { Badge } from "../../components/ui/Badge"
import { Button } from "../../components/ui/Button"
import { EmptyState, LoadingState } from "../../components/ui/States"
import { api } from "../../api/client"
import { adminApi } from "../../api/admin"
import { useToast, errorMessage } from "../../shared/Toast"

interface QueueDoc {
  id: string
  docType: string
  status: string
  fileUrl: string
  rejectionReason: string | null
}
interface QueueDriver {
  id: string
  user: { fullName: string; phone: string; email: string | null }
  city: { name: string }
  vehicles: { make: string; model: string; plateNumber: string; vehicleType: { name: string } }[]
  documents: QueueDoc[]
}

export function DriverVerificationPanel() {
  const [drivers, setDrivers] = useState<QueueDriver[] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [busyDocId, setBusyDocId] = useState<string | null>(null)
  const { push } = useToast()

  async function load() {
    try {
      const res = await api.get<{ drivers: QueueDriver[] }>("/admin/drivers/verification-queue")
      setDrivers(res.drivers)
    } catch (err) {
      push("error", errorMessage(err))
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function decide(id: string, decision: "approve" | "reject") {
    setBusyId(id)
    try {
      await adminApi.verifyDriver(id, decision)
      push("success", decision === "approve" ? "Driver approved." : "Driver rejected.")
      setDrivers((list) => list?.filter((d) => d.id !== id) ?? null)
    } catch (err) {
      push("error", errorMessage(err))
    } finally {
      setBusyId(null)
    }
  }

  async function decideDocument(driverId: string, doc: QueueDoc, decision: "approve" | "reject") {
    const reason = decision === "reject" ? window.prompt(`Why is this ${doc.docType.replace(/_/g, " ")} being rejected?`) : undefined
    if (decision === "reject" && !reason) return
    setBusyDocId(doc.id)
    try {
      await adminApi.reviewDriverDocument(doc.id, decision, reason ?? undefined)
      push("success", decision === "approve" ? "Document approved." : "Document rejected — driver will be asked to re-upload.")
      setDrivers((list) =>
        list?.map((d) =>
          d.id === driverId
            ? { ...d, documents: d.documents.map((x) => (x.id === doc.id ? { ...x, status: decision === "approve" ? "approved" : "rejected", rejectionReason: reason ?? null } : x)) }
            : d,
        ) ?? null,
      )
    } catch (err) {
      push("error", errorMessage(err))
    } finally {
      setBusyDocId(null)
    }
  }

  if (drivers === null) return <LoadingState label="Loading verification queue…" />
  if (drivers.length === 0) return <EmptyState icon={ShieldAlert} title="Queue is clear" description="No drivers are currently awaiting document verification." />

  return (
    <div className="space-y-3">
      <h1 className="font-display text-2xl font-extrabold tracking-tight">Driver verification</h1>
      {drivers.map((d) => (
        <Card key={d.id} className="p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-bold">{d.user.fullName}</p>
              <p className="text-xs text-ink-700/60">{d.user.phone} · {d.city.name}</p>
              {d.vehicles[0] && (
                <p className="mt-1 text-xs text-ink-700/60">
                  {d.vehicles[0].make} {d.vehicles[0].model} · {d.vehicles[0].plateNumber} · {d.vehicles[0].vehicleType.name}
                </p>
              )}
              <div className="mt-2 space-y-1.5">
                {d.documents.map((doc) => (
                  <div key={doc.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-ink-900/[0.03] px-2.5 py-1.5">
                    <Badge tone={doc.status === "approved" ? "success" : doc.status === "rejected" ? "danger" : "warning"}>
                      {doc.docType.replace(/_/g, " ")}
                    </Badge>
                    <a href={doc.fileUrl} target="_blank" rel="noreferrer" className="text-[11px] text-rivo-600 underline">
                      View
                    </a>
                    {doc.status === "rejected" && doc.rejectionReason && (
                      <span className="text-[11px] text-danger-600">{doc.rejectionReason}</span>
                    )}
                    <div className="ml-auto flex gap-1">
                      {doc.status !== "approved" && (
                        <Button variant="ghost" size="sm" disabled={busyDocId === doc.id} onClick={() => decideDocument(d.id, doc, "approve")}>
                          Approve
                        </Button>
                      )}
                      {doc.status !== "rejected" && (
                        <Button variant="ghost" size="sm" disabled={busyDocId === doc.id} onClick={() => decideDocument(d.id, doc, "reject")}>
                          Reject
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="danger" size="sm" icon={<XCircle className="h-4 w-4" />} disabled={busyId === d.id} onClick={() => decide(d.id, "reject")}>
                Reject driver
              </Button>
              <Button variant="primary" size="sm" icon={<CheckCircle2 className="h-4 w-4" />} disabled={busyId === d.id} onClick={() => decide(d.id, "approve")}>
                Approve driver
              </Button>
            </div>
          </div>
        </Card>
      ))}
    </div>
  )
}
