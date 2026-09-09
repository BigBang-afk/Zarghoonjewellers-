import request from "supertest"
import { createApp } from "../src/app.js"
import { PASSWORD } from "./fixtures.js"

export const app = createApp()

export async function loginAs(phone: string): Promise<string> {
  const res = await request(app).post("/v1/auth/login").send({ phone, password: PASSWORD })
  if (res.status !== 200) throw new Error(`login failed for ${phone}: ${JSON.stringify(res.body)}`)
  return res.body.accessToken as string
}

export function auth(token: string) {
  return { Authorization: `Bearer ${token}` }
}
