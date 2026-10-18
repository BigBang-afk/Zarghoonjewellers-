import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { randomUUID } from "crypto";
import { auth } from "@/lib/auth";
import { isCrossSiteRequest } from "@/lib/security/requestOrigin";
import { prisma } from "@/lib/prisma";
import { productSchema } from "@/lib/validations";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

export async function GET() {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const products = await prisma.product.findMany({
    include: { images: true },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(products);
}

export async function POST(req: Request) {
  if (isCrossSiteRequest(req)) {
    return NextResponse.json({ error: "Request not allowed." }, { status: 403 });
  }
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await req.formData();

  const parsed = productSchema.safeParse({
    name: formData.get("name"),
    category: formData.get("category"),
    quality: formData.get("quality"),
    netWeight: formData.get("netWeight"),
    wastagePercent: formData.get("wastagePercent"),
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid product data." },
      { status: 400 },
    );
  }

  const { name, category, quality, netWeight, wastagePercent } = parsed.data;
  const grossWeight = netWeight + netWeight * (wastagePercent / 100);

  const files = formData
    .getAll("images")
    .filter((entry): entry is File => entry instanceof File && entry.size > 0);

  if (files.length === 0) {
    return NextResponse.json(
      { error: "Please add at least one product image." },
      { status: 400 },
    );
  }

  for (const file of files) {
    if (!MIME_EXTENSIONS[file.type]) {
      return NextResponse.json(
        { error: `Unsupported image format: ${file.type || "unknown"}.` },
        { status: 400 },
      );
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `Image "${file.name}" exceeds the 5MB size limit.` },
        { status: 400 },
      );
    }
  }

  const imageUrls: string[] = [];
  for (const file of files) {
    const extension = MIME_EXTENSIONS[file.type];
    const filename = `products/${randomUUID()}${extension}`;
    const blob = await put(filename, file, {
      access: "public",
      contentType: file.type,
    });
    imageUrls.push(blob.url);
  }

  const product = await prisma.product.create({
    data: {
      name,
      category,
      quality,
      netWeight,
      wastagePercent,
      grossWeight,
      images: { create: imageUrls.map((url) => ({ url })) },
    },
    include: { images: true },
  });

  return NextResponse.json({ success: true, product });
}
