import { Bike, Car, CarTaxiFront, Crown } from "lucide-react"
import type { VehicleTypeId } from "../data/mock"

export function VehicleIcon({ type, className = "h-5 w-5" }: { type: VehicleTypeId; className?: string }) {
  switch (type) {
    case "bike":
      return <Bike className={className} />
    case "rickshaw":
      return <CarTaxiFront className={className} />
    case "premium":
      return <Crown className={className} />
    default:
      return <Car className={className} />
  }
}
