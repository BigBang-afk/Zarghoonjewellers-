"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

/**
 * Renders the site's navbar and footer everywhere except the embeddable chat
 * (/embed/*), which is shown inside an iframe on other websites.
 */
export default function SiteChrome({ children }: { position: "header" | "footer"; children: ReactNode }) {
  const pathname = usePathname();
  if (pathname?.startsWith("/embed")) return null;
  // A fragment, not a wrapper element: the navbar's `sticky` positioning must keep working.
  return <>{children}</>;
}
