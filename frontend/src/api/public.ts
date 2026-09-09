import { api } from "./client"
import type { City, VehicleType } from "../types"

export const publicApi = {
  cities: () => api.get<{ cities: City[] }>("/public/cities", undefined),
  vehicleTypes: (cityId?: string) => api.get<{ vehicleTypes: VehicleType[] }>("/public/vehicle-types", cityId ? { cityId } : undefined),
}
