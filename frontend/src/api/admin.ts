import { api } from "./client"
import type { AdminKpis, City, DriverAcquisitionCampaign, DriverFunnelStage } from "../types"

export const adminApi = {
  kpis: (cityId?: string) => api.get<AdminKpis>("/admin/dashboard/kpis", cityId ? { cityId } : undefined),
  liveMap: (cityId?: string) =>
    api.get<{ drivers: { id: string; status: string; lat: number; lng: number }[]; activeRides: unknown[]; pendingRequestsCount: number }>(
      "/admin/live-map",
      cityId ? { cityId } : undefined,
    ),
  cities: () => api.get<{ cities: (City & { country: unknown; _count: { driverProfiles: number; serviceZones: number } })[] }>("/admin/cities"),
  rides: (query?: { status?: string; page?: number; pageSize?: number }) => api.get<{ rides: unknown[]; total: number }>("/admin/rides", query),
  passengers: (query?: { search?: string; page?: number; pageSize?: number }) =>
    api.get<{ passengers: unknown[]; total: number }>("/admin/passengers", query),
  drivers: (query?: { search?: string; verificationStatus?: string; page?: number; pageSize?: number }) =>
    api.get<{ drivers: unknown[]; total: number }>("/admin/drivers", query),
  verificationQueue: () => api.get<{ drivers: unknown[] }>("/admin/drivers/verification-queue"),
  verifyDriver: (driverId: string, decision: "approve" | "reject", reason?: string) =>
    api.post<{ driverProfile: unknown }>(`/admin/drivers/${driverId}/verify`, { decision, reason }),
  reviewDriverDocument: (documentId: string, decision: "approve" | "reject", reason?: string) =>
    api.post<{ document: unknown }>(`/admin/driver-documents/${documentId}/review`, { decision, reason }),
  auditLogs: (query?: { page?: number; pageSize?: number }) => api.get<{ logs: unknown[]; total: number }>("/admin/audit-logs", query),
  settings: () => api.get<{ settings: Record<string, unknown>; defaults: Record<string, unknown> }>("/admin/settings"),
  liveOpsSummary: (cityId?: string) =>
    api.get<{
      activeRides: number
      pendingRequests: number
      onlineDrivers: number
      staleLocationDrivers: number
      cancellationsInWindow: number
      openSafetyIncidents: number
      openDisputes: number
      openSupportTickets: number
    }>("/admin/live-ops/summary", cityId ? { cityId } : undefined),
  supplyDashboard: (cityId?: string) =>
    api.get<{
      onlineDrivers: number
      availableDrivers: number
      busyDrivers: number
      offlineDrivers: number
      staleGpsDrivers: number
      driversAwaitingVerification: number
      openRequestsCount: number
      alerts: string[]
    }>("/admin/supply/dashboard", cityId ? { cityId } : undefined),
  driverAcquisitionCampaigns: (query?: { status?: string; cityId?: string }) =>
    api.get<{ campaigns: DriverAcquisitionCampaign[] }>("/admin/driver-acquisition/campaigns", query),
  createDriverAcquisitionCampaign: (data: {
    name: string
    code: string
    description?: string
    cityId?: string
    vehicleTypeId?: string
    targetDriverCount: number
    incentiveAmount?: number
    startDate: string
    endDate: string
    status?: string
  }) => api.post<{ campaign: DriverAcquisitionCampaign }>("/admin/driver-acquisition/campaigns", data),
  updateDriverAcquisitionCampaign: (id: string, data: Partial<{ status: string; targetDriverCount: number; incentiveAmount: number; startDate: string; endDate: string; description: string }>) =>
    api.patch<{ campaign: DriverAcquisitionCampaign }>(`/admin/driver-acquisition/campaigns/${id}`, data),
  driverFunnel: (cityId?: string) => api.get<{ stages: DriverFunnelStage[] }>("/admin/driver-acquisition/funnel", cityId ? { cityId } : undefined),
  campaignFunnel: (id: string) =>
    api.get<{ campaign: DriverAcquisitionCampaign; stages: DriverFunnelStage[] }>(`/admin/driver-acquisition/campaigns/${id}/funnel`),
}
