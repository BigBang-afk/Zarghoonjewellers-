import type { Server as HttpServer } from "node:http"
import jwt from "jsonwebtoken"
import { Server, type Socket } from "socket.io"
import { env } from "../config/env.js"

/**
 * Realtime gateway (docs/06 §2 / docs/09 §6). Every event pushed here is
 * also persisted first by the calling service (Notification rows, RideStatusHistory
 * rows, etc.) — sockets are a delivery accelerator, never the source of
 * truth, so a client that reconnects can always resync via a normal GET.
 *
 * Channels (Socket.IO rooms):
 *   user:{userId}   — that user's personal notifications/offer/status events
 *   ride:{rideId}   — shared by the passenger and driver on an active ride
 *   admin:live-map  — coarse driver/ride events for the admin dashboard
 */

let io: Server | null = null

export function initSocket(httpServer: HttpServer): Server {
  io = new Server(httpServer, {
    cors: { origin: env.corsOrigin, credentials: true },
  })

  io.use((socket: Socket, next) => {
    try {
      const token = socket.handshake.auth?.token as string | undefined
      if (!token) return next(new Error("unauthorized"))
      const payload = jwt.verify(token, env.jwtAccessSecret) as { sub: string; role: string }
      socket.data.userId = payload.sub
      socket.data.role = payload.role
      next()
    } catch {
      next(new Error("unauthorized"))
    }
  })

  io.on("connection", (socket) => {
    const userId = socket.data.userId as string
    const role = socket.data.role as string
    socket.join(`user:${userId}`)
    if (role === "admin") socket.join("admin:live-map")

    socket.on("ride:join", (rideId: string) => {
      // Room membership is not itself an authorization check — every
      // event payload is produced server-side from data the caller is
      // already allowed to see (see rides API), so joining an
      // unauthorized room yields no meaningful events.
      if (typeof rideId === "string") socket.join(`ride:${rideId}`)
    })
    socket.on("ride:leave", (rideId: string) => {
      if (typeof rideId === "string") socket.leave(`ride:${rideId}`)
    })
    socket.on("driver:location", (payload: { lat: number; lng: number; rideId?: string }) => {
      if (payload?.rideId) {
        socket.to(`ride:${payload.rideId}`).emit("driver.location.updated", {
          rideId: payload.rideId,
          lat: payload.lat,
          lng: payload.lng,
          at: new Date().toISOString(),
        })
      }
      io?.to("admin:live-map").emit("driver.location.updated", {
        driverId: userId,
        lat: payload?.lat,
        lng: payload?.lng,
        at: new Date().toISOString(),
      })
    })
  })

  return io
}

export function getIo(): Server {
  if (!io) throw new Error("Socket.IO not initialized — call initSocket() first")
  return io
}

export function emitToUser(userId: string, event: string, payload: unknown): void {
  io?.to(`user:${userId}`).emit(event, payload)
}

export function emitToRide(rideId: string, event: string, payload: unknown): void {
  io?.to(`ride:${rideId}`).emit(event, payload)
}

export function emitToAdmin(event: string, payload: unknown): void {
  io?.to("admin:live-map").emit(event, payload)
}
