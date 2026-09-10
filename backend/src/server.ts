import { createServer } from "node:http"
import { createApp } from "./app.js"
import { env } from "./config/env.js"
import { initSocket } from "./realtime/socket.js"
import { startBackgroundJobs } from "./jobs/index.js"
import { logger } from "./utils/logger.js"

const app = createApp()
const httpServer = createServer(app)
initSocket(httpServer)

startBackgroundJobs()

httpServer.listen(env.port, () => {
  logger.info("server_started", { port: env.port, env: env.nodeEnv })
})
