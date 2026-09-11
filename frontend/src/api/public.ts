import { api } from "./client"
import type { City, VehicleType, PublicSystemStatus } from "../types"

export const publicApi = {
  cities: () => api.get<{ cities: City[] }>("/public/cities", undefined),
  vehicleTypes: (cityId?: string) => api.get<{ vehicleTypes: VehicleType[] }>("/public/vehicle-types", cityId ? { cityId } : undefined),
  systemStatus: () => api.get<PublicSystemStatus>("/public/system-status", undefined),
}
