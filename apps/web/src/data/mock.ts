// Realistic demo/mock data for Phase 1 UI. No live backend — clearly static.

export type VehicleTypeId = "bike" | "rickshaw" | "economy" | "standard" | "premium"

export const vehicleTypes: {
  id: VehicleTypeId
  name: string
  capacity: number
  eta: string
  suggestedFare: number
  icon: "bike" | "rickshaw" | "car"
}[] = [
  { id: "bike", name: "Bike", capacity: 1, eta: "3 min", suggestedFare: 180, icon: "bike" },
  { id: "rickshaw", name: "Rickshaw", capacity: 3, eta: "4 min", suggestedFare: 260, icon: "rickshaw" },
  { id: "economy", name: "Economy", capacity: 4, eta: "5 min", suggestedFare: 420, icon: "car" },
  { id: "standard", name: "Standard", capacity: 4, eta: "6 min", suggestedFare: 560, icon: "car" },
  { id: "premium", name: "Premium", capacity: 4, eta: "8 min", suggestedFare: 890, icon: "car" },
]

export const savedPlaces = [
  { id: "home", label: "Home", address: "House 14, Street 7, F-8/3, Islamabad", icon: "home" as const },
  { id: "work", label: "Work", address: "Blue Area, Jinnah Avenue, Islamabad", icon: "work" as const },
]

export const recentDestinations = [
  { id: "r1", title: "Centaurus Mall", subtitle: "F-8, Islamabad", distanceKm: 4.2 },
  { id: "r2", title: "Islamabad International Airport", subtitle: "Fateh Jang Rd", distanceKm: 26.8 },
  { id: "r3", title: "Faisal Mosque", subtitle: "Shah Faisal Ave", distanceKm: 7.1 },
  { id: "r4", title: "G-9 Markaz", subtitle: "G-9, Islamabad", distanceKm: 5.6 },
]

export const currentCity = {
  name: "Islamabad",
  country: "Pakistan",
  currency: "Rs",
}

export type DriverOffer = {
  id: string
  name: string
  photoInitials: string
  rating: number
  completedRides: number
  verified: boolean
  vehicleModel: string
  vehicleColor: string
  plate: string
  offerPrice: number
  etaMin: number
  distanceKm: number
  cancellationRate: number
  type: "accepted" | "counter"
  vehicleType: VehicleTypeId
}

export const driverOffers: DriverOffer[] = [
  {
    id: "d1",
    name: "Ahmed Raza",
    photoInitials: "AR",
    rating: 4.92,
    completedRides: 3140,
    verified: true,
    vehicleModel: "Toyota Corolla",
    vehicleColor: "White",
    plate: "ICT-4471",
    offerPrice: 700,
    etaMin: 4,
    distanceKm: 1.2,
    cancellationRate: 1.1,
    type: "accepted",
    vehicleType: "economy",
  },
  {
    id: "d2",
    name: "Bilal Hussain",
    photoInitials: "BH",
    rating: 4.87,
    completedRides: 1876,
    verified: true,
    vehicleModel: "Honda City",
    vehicleColor: "Silver",
    plate: "LEA-9021",
    offerPrice: 750,
    etaMin: 6,
    distanceKm: 2.4,
    cancellationRate: 2.3,
    type: "counter",
    vehicleType: "economy",
  },
  {
    id: "d3",
    name: "Zainab Khan",
    photoInitials: "ZK",
    rating: 4.98,
    completedRides: 5420,
    verified: true,
    vehicleModel: "Suzuki Cultus",
    vehicleColor: "Blue",
    plate: "ISB-2210",
    offerPrice: 720,
    etaMin: 5,
    distanceKm: 1.8,
    cancellationRate: 0.6,
    type: "counter",
    vehicleType: "economy",
  },
]

export const driverIncomingRequest = {
  passengerName: "Sara Malik",
  passengerRating: 4.79,
  pickup: "F-10 Markaz, Islamabad",
  destination: "Centaurus Mall, F-8",
  distanceKm: 4.2,
  estMinutes: 13,
  proposedFare: 700,
  suggestedFare: 650,
  vehicleRequirement: "Economy",
  paymentMethod: "Cash",
}

export const driverEarningsToday = {
  totalRs: 6840,
  rides: 11,
  onlineHours: 6.4,
  acceptanceRate: 92,
  rating: 4.9,
}

export const driverWeekly = [
  { day: "Mon", rs: 5200 },
  { day: "Tue", rs: 6100 },
  { day: "Wed", rs: 4300 },
  { day: "Thu", rs: 7200 },
  { day: "Fri", rs: 8100 },
  { day: "Sat", rs: 9450 },
  { day: "Sun", rs: 6840 },
]

// ---- Admin dashboard mock data ----

export const adminKpis = {
  totalPassengers: 284_910,
  activePassengers: 41_205,
  totalDrivers: 18_340,
  onlineDrivers: 2_614,
  ridesToday: 9_842,
  completedToday: 8_915,
  cancelledToday: 612,
  activeRides: 315,
  grossBookingValueRs: 6_248_300,
  platformRevenueRs: 937_245,
  driverEarningsRs: 5_311_055,
  avgFareRs: 635,
  avgEtaMin: 5.4,
  avgDurationMin: 18.2,
  driverAcceptanceRate: 88.4,
  driverCancellationRate: 3.1,
  passengerCancellationRate: 4.6,
  repeatPassengerRate: 61.2,
}

export const adminRecentRides = [
  { id: "RVO-88213", passenger: "Hina Shah", driver: "Ahmed Raza", city: "Islamabad", fareRs: 700, status: "completed" as const, vehicle: "Economy", mode: "Competitive" as const },
  { id: "RVO-88214", passenger: "Usman Tariq", driver: "Zainab Khan", city: "Islamabad", fareRs: 420, status: "in_progress" as const, vehicle: "Economy", mode: "Quick Match" as const },
  { id: "RVO-88215", passenger: "Ayesha Noor", driver: "—", city: "Islamabad", fareRs: 260, status: "requested" as const, vehicle: "Rickshaw", mode: "Competitive" as const },
  { id: "RVO-88216", passenger: "Danish Iqbal", driver: "Bilal Hussain", city: "Islamabad", fareRs: 890, status: "completed" as const, vehicle: "Premium", mode: "Quick Match" as const },
  { id: "RVO-88217", passenger: "Mahnoor Ali", driver: "Ahmed Raza", city: "Islamabad", fareRs: 560, status: "cancelled" as const, vehicle: "Standard", mode: "Competitive" as const },
  { id: "RVO-88218", passenger: "Fahad Sheikh", driver: "—", city: "Islamabad", fareRs: 180, status: "requested" as const, vehicle: "Bike", mode: "Quick Match" as const },
]

export const adminMapDrivers = [
  { id: "m1", x: 22, y: 34, status: "online" as const },
  { id: "m2", x: 40, y: 20, status: "on_trip" as const },
  { id: "m3", x: 58, y: 44, status: "online" as const },
  { id: "m4", x: 71, y: 62, status: "on_trip" as const },
  { id: "m5", x: 30, y: 66, status: "online" as const },
  { id: "m6", x: 82, y: 28, status: "offline_pending" as const },
  { id: "m7", x: 49, y: 78, status: "online" as const },
  { id: "m8", x: 15, y: 55, status: "on_trip" as const },
]

export const adminPendingVerifications = 47

export const adminCities = [
  { id: "isb", name: "Islamabad", country: "Pakistan", status: "live" as const, drivers: 6120, zones: 14 },
  { id: "lhe", name: "Lahore", country: "Pakistan", status: "live" as const, drivers: 8940, zones: 22 },
  { id: "khi", name: "Karachi", country: "Pakistan", status: "launching" as const, drivers: 2210, zones: 9 },
  { id: "dxb", name: "Dubai", country: "UAE", status: "planned" as const, drivers: 0, zones: 0 },
]
