import { useEffect, useState } from "react"
import { CheckCircle2, Circle, Clock, AlertTriangle, User, Car, IdCard, FileText, ShieldCheck, Camera } from "lucide-react"
import { Card } from "../../components/ui/Card"
import { Badge } from "../../components/ui/Badge"
import { Button } from "../../components/ui/Button"
import { LoadingState } from "../../components/ui/States"
import { driverApi } from "../../api/driver"
import { useToast, errorMessage } from "../../shared/Toast"
import type { DocType, DriverDocument } from "../../types"

const DOC_STEPS: { docType: DocType; label: string; hint: string; icon: typeof IdCard }[] = [
  { docType: "national_id", label: "National ID", hint: "A clear photo or scan of your government-issued ID.", icon: IdCard },
  { docType: "driving_license", label: "Driving license", hint: "Front and back, not expired.", icon: FileText },
  { docType: "vehicle_registration", label: "Vehicle registration", hint: "Registration book/certificate for the vehicle you added.", icon: Car },
  { docType: "insurance", label: "Vehicle insurance", hint: "A current, valid insurance certificate.", icon: ShieldCheck },
  { docType: "route_permit", label: "Route permit", hint: "Commercial route/operating permit, if required in your city.", icon: FileText },
  { docType: "profile_photo", label: "Profile photo", hint: "A clear photo of your face — this is what riders will see.", icon: Camera },
]

/**
 * Guided onboarding (Phase 5 §5) — 9 steps: account created, vehicle
 * added, the 6 required documents, and final admin approval. Progress
 * counts a document as "done" once submitted (pending or approved) —
 * a rejected document drops back to incomplete until re-uploaded, so
 * the percentage always reflects what still blocks approval right now.
 *
 * Uploads are a URL field, not a file picker: the platform has no file
 * storage service yet (see Phase 5 completion report, known
 * limitations) — this mirrors the same convention already used for
 * profile photos at registration, not a new gap this screen introduces.
 */
export function OnboardingPanel({ verificationStatus }: { verificationStatus: string }) {
  const { push } = useToast()
  const [documents, setDocuments] = useState<DriverDocument[] | null>(null)
  const [urlDrafts, setUrlDrafts] = useState<Record<string, string>>({})
  const [submittingType, setSubmittingType] = useState<DocType | null>(null)

  async function load() {
    try {
      const res = await driverApi.documents()
      setDocuments(res.documents)
    } catch (err) {
      push("error", errorMessage(err))
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function submit(docType: DocType) {
    const url = urlDrafts[docType]?.trim()
    if (!url) {
      push("error", "Paste a link to the document first.")
      return
    }
    setSubmittingType(docType)
    try {
      await driverApi.submitDocument(docType, url)
      push("success", "Uploaded — awaiting review.")
      setUrlDrafts((d) => ({ ...d, [docType]: "" }))
      await load()
    } catch (err) {
      push("error", errorMessage(err))
    } finally {
      setSubmittingType(null)
    }
  }

  if (!documents) return <LoadingState label="Loading your onboarding status…" />

  const latestByType = new Map<DocType, DriverDocument>()
  for (const doc of documents) {
    const existing = latestByType.get(doc.docType)
    if (!existing || new Date(doc.createdAt) > new Date(existing.createdAt)) latestByType.set(doc.docType, doc)
  }

  const docStepsDone = DOC_STEPS.filter((s) => {
    const doc = latestByType.get(s.docType)
    return doc && doc.status !== "rejected" && doc.status !== "expired"
  }).length
  const isApproved = verificationStatus === "approved"
  const completedSteps = 2 + docStepsDone + (isApproved ? 1 : 0) // account + vehicle always done by this point
  const totalSteps = 2 + DOC_STEPS.length + 1
  const progressPct = Math.round((completedSteps / totalSteps) * 100)

  return (
    <div className="flex-1 overflow-y-auto px-4 pb-24 pt-4 scrollbar-none">
      <p className="font-display text-lg font-bold">Complete your onboarding</p>
      <p className="mt-1 text-sm text-ink-700/60">Upload every document below so an admin can review and approve your account.</p>

      <Card className="mt-4 p-4">
        <div className="flex items-center justify-between text-sm">
          <span className="font-bold">{progressPct}% complete</span>
          <span className="text-ink-700/50">{completedSteps} / {totalSteps} steps</span>
        </div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-ink-900/[0.06]">
          <div className="h-full rounded-full bg-rivo-600 transition-all" style={{ width: `${progressPct}%` }} />
        </div>
      </Card>

      <div className="mt-4 space-y-2">
        <div className="flex items-center gap-2.5 rounded-xl bg-success-500/10 px-3 py-2.5">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-success-600" />
          <p className="text-sm font-medium">Account created</p>
        </div>
        <div className="flex items-center gap-2.5 rounded-xl bg-success-500/10 px-3 py-2.5">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-success-600" />
          <p className="text-sm font-medium">Vehicle added</p>
        </div>
      </div>

      <p className="mb-2 mt-5 text-xs font-bold uppercase tracking-wide text-ink-700/50">Required documents</p>
      <div className="space-y-2.5">
        {DOC_STEPS.map((step) => {
          const doc = latestByType.get(step.docType)
          const status = doc?.status
          return (
            <Card key={step.docType} className="p-3.5">
              <div className="flex items-start gap-2.5">
                {status === "approved" ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success-600" />
                ) : status === "pending" ? (
                  <Clock className="mt-0.5 h-4 w-4 shrink-0 text-warning-500" />
                ) : status === "rejected" || status === "expired" ? (
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger-600" />
                ) : (
                  <Circle className="mt-0.5 h-4 w-4 shrink-0 text-ink-700/30" />
                )}
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <step.icon className="h-3.5 w-3.5 text-ink-700/50" />
                    <p className="text-sm font-bold">{step.label}</p>
                    {status && (
                      <Badge tone={status === "approved" ? "success" : status === "pending" ? "warning" : "danger"}>
                        {status === "approved" ? "Approved" : status === "pending" ? "Under review" : status === "rejected" ? "Rejected" : "Expired"}
                      </Badge>
                    )}
                  </div>
                  <p className="mt-0.5 text-[11px] text-ink-700/55">{step.hint}</p>
                  {(status === "rejected" || status === "expired") && doc?.rejectionReason && (
                    <p className="mt-1 text-[11px] font-medium text-danger-600">Reason: {doc.rejectionReason}</p>
                  )}

                  {status !== "approved" && (status !== "pending") && (
                    <div className="mt-2 flex gap-2">
                      <input
                        type="url"
                        placeholder="Paste document link"
                        value={urlDrafts[step.docType] ?? ""}
                        onChange={(e) => setUrlDrafts((d) => ({ ...d, [step.docType]: e.target.value }))}
                        className="h-9 flex-1 rounded-lg border border-ink-900/10 bg-white px-3 text-xs outline-none focus:border-rivo-500"
                      />
                      <Button variant="secondary" size="sm" onClick={() => submit(step.docType)} disabled={submittingType === step.docType}>
                        {submittingType === step.docType ? "…" : status === "rejected" || status === "expired" ? "Re-upload" : "Upload"}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </Card>
          )
        })}
      </div>

      <Card className="mt-5 p-4 text-center">
        {isApproved ? (
          <>
            <CheckCircle2 className="mx-auto h-6 w-6 text-success-600" />
            <p className="mt-1.5 text-sm font-bold">You're verified!</p>
          </>
        ) : docStepsDone === DOC_STEPS.length ? (
          <>
            <Clock className="mx-auto h-6 w-6 text-warning-500" />
            <p className="mt-1.5 text-sm font-bold">All documents submitted</p>
            <p className="mt-0.5 text-xs text-ink-700/60">An admin is reviewing your account. You'll be notified once approved.</p>
          </>
        ) : (
          <>
            <User className="mx-auto h-6 w-6 text-ink-700/40" />
            <p className="mt-1.5 text-sm font-bold">Upload the remaining documents to move forward</p>
          </>
        )}
      </Card>
    </div>
  )
}
