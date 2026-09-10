import { Router } from "express"
import { requireAuth, requireRole } from "../../middleware/auth.js"
import { adminDashboardRouter } from "./dashboard.js"
import { adminDirectoryRouter } from "./directory.js"
import { adminVerificationRouter } from "./verification.js"
import { adminFinanceRouter } from "./finance.js"
import { adminTrustRouter } from "./trust.js"
import { adminConfigRouter } from "./config.js"
import { adminSystemRouter } from "./system.js"
import { adminBusinessRouter } from "./business.js"
import { adminRiskRouter } from "./risk.js"
import { adminAnalyticsRouter } from "./analytics.js"
import { adminNotificationTemplateRouter } from "./notificationTemplates.js"
import { adminMarketingRouter } from "./marketing.js"
import { adminPrivacyRouter } from "./privacy.js"
import { adminPilotModeRouter } from "./pilotMode.js"
import { adminDriverAcquisitionRouter } from "./driverAcquisition.js"
import { adminDispatchRouter } from "./dispatch.js"
import { adminCancellationsRouter } from "./cancellations.js"

export const adminRouter = Router()
adminRouter.use(requireAuth, requireRole("admin"))

adminRouter.use(adminDashboardRouter)
adminRouter.use(adminDirectoryRouter)
adminRouter.use(adminVerificationRouter)
adminRouter.use(adminFinanceRouter)
adminRouter.use(adminTrustRouter)
adminRouter.use(adminConfigRouter)
adminRouter.use(adminSystemRouter)
adminRouter.use(adminBusinessRouter)
adminRouter.use(adminRiskRouter)
adminRouter.use(adminAnalyticsRouter)
adminRouter.use(adminNotificationTemplateRouter)
adminRouter.use(adminMarketingRouter)
adminRouter.use(adminPrivacyRouter)
adminRouter.use(adminPilotModeRouter)
adminRouter.use(adminDriverAcquisitionRouter)
adminRouter.use(adminDispatchRouter)
adminRouter.use(adminCancellationsRouter)
