import { NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import type { NextRequest } from "next/server";
import { embedFrameAncestors, isServicePathAllowed } from "@/lib/zarghoon/embedConfig";

export default async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // When deployed as the Zarghoon AI chat service for an existing website,
  // serve only the chat surfaces — this app must not become a second website.
  if (process.env.ZARGHOON_AI_SERVICE_ONLY === "true" && !isServicePathAllowed(pathname)) {
    return new NextResponse("Not found", { status: 404 });
  }
  // The embeddable chat may only be framed by the sites in ZARGHOON_EMBED_ALLOWED_ORIGINS
  // (clickjacking protection). Read per request so configuration needs no rebuild.
  if (pathname.startsWith("/embed")) {
    const res = NextResponse.next();
    res.headers.set("Content-Security-Policy", `frame-ancestors ${embedFrameAncestors(process.env)}`);
    res.headers.set("X-Robots-Tag", "noindex");
    res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    return res;
  }
  if (!pathname.startsWith("/admin") && !pathname.startsWith("/dashboard")) return;

  const token = await getToken({ req, secret: process.env.AUTH_SECRET });
  const role = token?.role;

  if (pathname.startsWith("/admin") && role !== "ADMIN") {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (pathname.startsWith("/dashboard") && !token) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
}

export const config = {
  // All pages (for the optional service-only gate); static assets are excluded.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
