import { io, type Socket } from "socket.io-client"
import { config } from "../config/env"
import { tokenStore } from "../auth/tokenStore"

let socket: Socket | null = null

/**
 * Real-time gateway client (mirrors backend/src/realtime/socket.ts).
 * Connects once per session; every screen subscribes to the events it
 * cares about via `getSocket()` and cleans up its own listeners.
 */
export function connectSocket(): Socket {
  const token = tokenStore.getAccessToken()
  if (socket?.connected && socket.auth && (socket.auth as { token?: string }).token === token) return socket

  if (socket) {
    socket.disconnect()
    socket = null
  }

  socket = io(config.socketUrl, {
    auth: { token },
    transports: ["websocket", "polling"],
    autoConnect: true,
  })

  return socket
}

export function getSocket(): Socket | null {
  return socket
}

export function disconnectSocket(): void {
  socket?.disconnect()
  socket = null
}
