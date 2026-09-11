import { api } from "./client"
import type {
  AdminKpis,
  City,
  DriverAcquisitionCampaign,
  DriverFunnelStage,
  DemandMap,
  DispatchAnalytics,
  CancellationAnalytics,
  LostItemReport,
  BusinessAccount,
  BusinessDepartment,
  BusinessInvoice,
  FleetAccount,
  FleetDashboard,
  PassengerAnalytics,
  DriverAnalytics,
  MarketplaceAnalytics,
  MarketingCampaign,
  Partner,
  PartnerDetail,
  PartnerPayout,
  FeatureFlag,
  Experiment,
  ExperimentResult,
  PilotModeSettings,
  InvitationCode,
  WaitlistEntry,
  SystemIncident,
  Promotion,
  PromotionAnalytics,
  ServiceZone,
} from "../types"

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
  promotions: () => api.get<{ promotions: Promotion[] }>("/admin/promotions"),
  createPromotion: (data: Partial<Promotion>) => api.post<{ promotion: Promotion }>("/admin/promotions", data),
  updatePromotion: (id: string, data: Partial<Promotion>) => api.put<{ promotion: Promotion }>(`/admin/promotions/${id}`, data),
  promotionAnalytics: (id: string) => api.get<PromotionAnalytics>(`/admin/promotions/${id}/analytics`),
  serviceZones: (cityId?: string) => api.get<{ zones: ServiceZone[] }>("/admin/service-zones", cityId ? { cityId } : undefined),
  demandMap: (query: { cityId: string; zoneId?: string; range?: string; gridSize?: number }) =>
    api.get<DemandMap>("/admin/demand-map", query),
  dispatchAnalytics: (query?: { from?: string; to?: string; cityId?: string }) =>
    api.get<DispatchAnalytics>("/admin/dispatch/analytics", query),
  cancellationAnalytics: (query?: { from?: string; to?: string; cityId?: string }) =>
    api.get<CancellationAnalytics>("/admin/cancellations/analytics", query),
  lostItemReports: (query?: { status?: string; page?: number; pageSize?: number }) =>
    api.get<{ reports: LostItemReport[]; total: number }>("/admin/lost-item-reports", query),
  updateLostItemReport: (id: string, status: "return_arranged" | "returned" | "closed") =>
    api.patch<{ report: LostItemReport }>(`/admin/lost-item-reports/${id}`, { status }),

  // Business accounts (Phase 5 §16)
  businessAccounts: () => api.get<{ accounts: BusinessAccount[] }>("/admin/business-accounts"),
  businessDepartments: (accountId: string) => api.get<{ departments: BusinessDepartment[] }>(`/admin/business-accounts/${accountId}/departments`),
  createBusinessDepartment: (accountId: string, data: { name: string; monthlySpendLimit?: number }) =>
    api.post<{ department: BusinessDepartment }>(`/admin/business-accounts/${accountId}/departments`, data),
  businessInvoices: (accountId: string) => api.get<{ invoices: BusinessInvoice[] }>(`/admin/business-accounts/${accountId}/invoices`),
  generateBusinessInvoice: (accountId: string, data: { periodStart: string; periodEnd: string; dueAt?: string }) =>
    api.post<{ invoice: BusinessInvoice }>(`/admin/business-accounts/${accountId}/invoices/generate`, data),
  markInvoicePaid: (invoiceId: string) => api.post<{ invoice: BusinessInvoice }>(`/admin/business-invoices/${invoiceId}/mark-paid`),
  voidInvoice: (invoiceId: string) => api.post<{ invoice: BusinessInvoice }>(`/admin/business-invoices/${invoiceId}/void`),

  // Fleet accounts (Phase 5 §16)
  fleetAccounts: () => api.get<{ fleets: FleetAccount[] }>("/admin/fleet-accounts"),
  createFleetAccount: (data: { companyName: string; ownerUserId: string; cityId: string; commissionSharePct?: number }) =>
    api.post<{ fleet: FleetAccount }>("/admin/fleet-accounts", data),
  fleetDashboard: (id: string) => api.get<FleetDashboard>(`/admin/fleet-accounts/${id}/dashboard`),
  assignDriverToFleet: (fleetId: string, driverId: string) =>
    api.post<{ driver: unknown }>(`/admin/fleet-accounts/${fleetId}/drivers`, { driverId }),
  removeDriverFromFleet: (fleetId: string, driverId: string) => api.delete<void>(`/admin/fleet-accounts/${fleetId}/drivers/${driverId}`),

  // Platform analytics (Phase 3 §23, wired to a UI in Phase 5 §17)
  passengerAnalytics: (cityId?: string) => api.get<PassengerAnalytics>("/admin/analytics/passengers", cityId ? { cityId } : undefined),
  driverAnalytics: (cityId?: string) => api.get<DriverAnalytics>("/admin/analytics/drivers", cityId ? { cityId } : undefined),
  marketplaceAnalytics: (cityId?: string) => api.get<MarketplaceAnalytics>("/admin/analytics/marketplace", cityId ? { cityId } : undefined),

  // Marketing campaigns (Phase 5 §18)
  campaigns: (status?: string) => api.get<{ campaigns: MarketingCampaign[] }>("/admin/campaigns", status ? { status } : undefined),
  createCampaign: (data: {
    name: string
    title: string
    body: string
    targetRole: "passenger" | "driver"
    cityId?: string
    minDaysSinceLastRide?: number
    maxCompletedRides?: number
    acquisitionSource?: string
    promoCode?: string
    scheduledAt?: string
  }) => api.post<{ campaign: MarketingCampaign }>("/admin/campaigns", data),
  previewCampaignAudience: (segment: {
    targetRole: "passenger" | "driver"
    cityId?: string
    minDaysSinceLastRide?: number
    maxCompletedRides?: number
    acquisitionSource?: string
  }) => api.post<{ recipientCount: number }>("/admin/campaigns/preview-audience", segment),
  sendCampaign: (id: string) => api.post<{ campaign: MarketingCampaign }>(`/admin/campaigns/${id}/send`),
  cancelCampaign: (id: string) => api.post<{ campaign: MarketingCampaign }>(`/admin/campaigns/${id}/cancel`),

  // Partner program (Phase 5 §19)
  partners: () => api.get<{ partners: Partner[] }>("/admin/partners"),
  partnerDetail: (id: string) => api.get<{ partner: PartnerDetail }>(`/admin/partners/${id}`),
  createPartner: (data: {
    name: string
    contactName?: string
    contactEmail?: string
    contactPhone?: string
    code: string
    type: "individual" | "business"
    commissionType: "flat_per_referral" | "pct_of_fare"
    commissionValue: number
  }) => api.post<{ partner: Partner }>("/admin/partners", data),
  updatePartner: (id: string, data: Partial<{ isActive: boolean; commissionType: string; commissionValue: number }>) =>
    api.patch<{ partner: Partner }>(`/admin/partners/${id}`, data),
  recordPartnerPayout: (id: string, data: { amount: number; method: string; note?: string }) =>
    api.post<{ payout: PartnerPayout }>(`/admin/partners/${id}/payouts`, data),
  generatePartnerApiKey: (id: string) => api.post<{ apiKey: string }>(`/admin/partners/${id}/api-key/generate`),
  revokePartnerApiKey: (id: string) => api.post<void>(`/admin/partners/${id}/api-key/revoke`),

  // Feature flags (Phase 5 §21)
  featureFlags: () => api.get<{ flags: FeatureFlag[] }>("/admin/feature-flags"),
  createFeatureFlag: (data: {
    key: string
    name: string
    description?: string
    isEnabled?: boolean
    rolloutPct?: number
    targetRole?: "all" | "passenger" | "driver"
    cityIds?: string[]
  }) => api.post<{ flag: FeatureFlag }>("/admin/feature-flags", data),
  updateFeatureFlag: (id: string, data: Partial<{ name: string; description: string; isEnabled: boolean; rolloutPct: number; targetRole: string; cityIds: string[] }>) =>
    api.patch<{ flag: FeatureFlag }>(`/admin/feature-flags/${id}`, data),
  deleteFeatureFlag: (id: string) => api.delete<void>(`/admin/feature-flags/${id}`),

  // A/B testing (Phase 5 §22)
  experiments: () => api.get<{ experiments: Experiment[] }>("/admin/experiments"),
  experimentDetail: (id: string) =>
    api.get<{ experiment: Experiment; results: ExperimentResult[]; totalAssigned: number }>(`/admin/experiments/${id}`),
  createExperiment: (data: {
    key: string
    name: string
    description?: string
    variants: { key: string; name: string; weight: number }[]
    targetRole?: "all" | "passenger" | "driver"
    cityIds?: string[]
  }) => api.post<{ experiment: Experiment }>("/admin/experiments", data),
  updateExperiment: (
    id: string,
    data: Partial<{
      name: string
      description: string
      status: "draft" | "running" | "completed"
      targetRole: string
      cityIds: string[]
      variants: { key: string; name: string; weight: number }[]
    }>,
  ) => api.patch<{ experiment: Experiment }>(`/admin/experiments/${id}`, data),
  deleteExperiment: (id: string) => api.delete<void>(`/admin/experiments/${id}`),

  // Launch Mode: pilot mode + invitation codes + waitlist (Phase 4 §37/§38, wired to a UI in Phase 5 §23)
  pilotMode: () => api.get<{ settings: PilotModeSettings; current: { driverCount: number; passengerCount: number } }>("/admin/pilot-mode"),
  updatePilotMode: (data: Partial<PilotModeSettings>) => api.put<{ settings: PilotModeSettings }>("/admin/pilot-mode", data),
  invitationCodes: () => api.get<{ codes: InvitationCode[] }>("/admin/invitation-codes"),
  createInvitationCode: (data: { code: string; maxUses?: number; cityId?: string; expiresAt?: string }) =>
    api.post<{ invite: InvitationCode }>("/admin/invitation-codes", data),
  updateInvitationCode: (id: string, data: Partial<{ isActive: boolean; maxUses: number }>) =>
    api.patch<{ invite: InvitationCode }>(`/admin/invitation-codes/${id}`, data),
  waitlist: (query?: { cityName?: string; userType?: string }) => api.get<{ entries: WaitlistEntry[]; total: number }>("/admin/waitlist", query),
  deleteWaitlistEntry: (id: string) => api.delete<void>(`/admin/waitlist/${id}`),

  // System status page (Phase 5 §23)
  systemIncidents: (status?: string) => api.get<{ incidents: SystemIncident[] }>("/admin/system-incidents", status ? { status } : undefined),
  createSystemIncident: (data: { title: string; affectedArea?: string; severity: "minor" | "major" | "critical"; message: string }) =>
    api.post<{ incident: SystemIncident }>("/admin/system-incidents", data),
  addSystemIncidentUpdate: (id: string, data: { status: "investigating" | "identified" | "monitoring" | "resolved"; message: string }) =>
    api.post<{ incident: SystemIncident }>(`/admin/system-incidents/${id}/updates`, data),
  deleteSystemIncident: (id: string) => api.delete<void>(`/admin/system-incidents/${id}`),
}
