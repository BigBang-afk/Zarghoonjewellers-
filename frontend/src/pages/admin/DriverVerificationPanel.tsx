import { useEffect, useState } from "react"
import { CheckCircle2, ShieldAlert, XCircle } from "lucide-react"
import { Card } from "../../components/ui/Card"
import { Badge } from "../../components/ui/Badge"
import { Button } from "../../components/ui/Button"
import { EmptyState, LoadingState } from "../../components/ui/States"
import { api } from "../../api/client"
import { adminApi } from "../../api/admin"
import { useToast, errorMessage } from "../../shared/Toast"

interface QueueDriver {
  id: string
  user: { fullName: string; phone: string; email: string | null }
  city: { name: string }
  vehicles: { make: string; model: string; plateNumber: string; vehicleType: { name: string } }[]
  documents: { docType: string; status: string }[]
}

export function DriverVerificationPanel() {
  const [drivers, setDrivers] = useState<QueueDriver[] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
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
              <div className="mt-2 flex flex-wrap gap-1.5">
                {d.documents.map((doc) => (
                  <Badge key={doc.docType} tone={doc.status === "approved" ? "success" : "warning"}>
                    {doc.docType.replace(/_/g, " ")}
                  </Badge>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="danger" size="sm" icon={<XCircle className="h-4 w-4" />} disabled={busyId === d.id} onClick={() => decide(d.id, "reject")}>
                Reject
              </Button>
              <Button variant="primary" size="sm" icon={<CheckCircle2 className="h-4 w-4" />} disabled={busyId === d.id} onClick={() => decide(d.id, "approve")}>
                Approve
              </Button>
            </div>
          </div>
        </Card>
      ))}
    </div>
  )
}
