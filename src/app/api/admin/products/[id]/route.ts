import { NextResponse } from "next/server";
import { del } from "@vercel/blob";
import { auth } from "@/lib/auth";
import { isCrossSiteRequest } from "@/lib/security/requestOrigin";
import { prisma } from "@/lib/prisma";

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (isCrossSiteRequest(req)) {
    return NextResponse.json({ error: "Request not allowed." }, { status: 403 });
  }
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const product = await prisma.product.findUnique({
    where: { id },
    include: { images: true },
  });

  if (!product) {
    return NextResponse.json({ error: "Product not found." }, { status: 404 });
  }

  await prisma.product.delete({ where: { id } });

  if (product.images.length > 0) {
    await del(product.images.map((image) => image.url)).catch(() => {});
  }

  return NextResponse.json({ success: true });
}
