import type { ZarghoonCore } from "../../index.js";
import { NotFoundError } from "../../lib/errors.js";
import { MoneyDecimal } from "../../lib/money.js";
import type { StockStatus } from "../../schemas/product.js";

/**
 * Product cards for the website chat, built directly from the core
 * catalogue — never from model output. The model only chooses WHICH products
 * to show (ids it obtained from tools); every displayed value is read here
 * from the database. Unknown values are labelled, never filled in.
 */

export const NEEDS_CONFIRMATION = "Needs confirmation";
export const ASK_FOR_DETAILS = "Ask for details";

export interface ChatProductCard {
  productId: string;
  sku: string;
  name: string;
  /** e.g. "22K", or "Ask for details". */
  karatLabel: string;
  /** e.g. "62.5 g", or "Ask for details". */
  weightLabel: string;
  /** e.g. "PKR 485,000", or "Needs confirmation". */
  priceLabel: string;
  priceConfirmed: boolean;
  availabilityLabel: string;
  availability: StockStatus | "unknown" | "not_listed";
  /** Verified catalogue image, or null (no stock photos are substituted). */
  imageUrl: string | null;
  /** Product page from the catalogue, or null. */
  viewUrl: string | null;
}

const AVAILABILITY_LABELS: Record<ChatProductCard["availability"], string> = {
  available: "In stock",
  low_stock: "Limited availability",
  out_of_stock: "Out of stock",
  reserved: "Reserved — ask for details",
  made_to_order: "Made to order",
  discontinued: "Discontinued",
  unknown: NEEDS_CONFIRMATION,
  not_listed: "Not currently listed",
};

export function formatPrice(amount: string, currency: string): string {
  const d = new MoneyDecimal(amount);
  // Group the integer part exactly (no float conversion); keep paisa only when present.
  const [whole, fraction] = d.toFixed(2).split(".") as [string, string];
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${currency} ${fraction === "00" ? grouped : `${grouped}.${fraction}`}`;
}

export function formatWeight(grams: string): string {
  return `${new MoneyDecimal(grams).toFixed()} g`;
}

export async function buildProductCards(core: ZarghoonCore, productIds: readonly string[]): Promise<ChatProductCard[]> {
  const cards: ChatProductCard[] = [];
  for (const id of [...new Set(productIds)].slice(0, 6)) {
    try {
      const [product, inventory, imageUrl] = await Promise.all([
        core.products.getProductById(id),
        core.products.checkInventory({ id }),
        core.products.getPrimaryImageUrl(id),
      ]);
      cards.push({
        productId: product.id,
        sku: product.sku,
        name: product.name,
        karatLabel: product.karat !== null ? `${product.karat}K` : ASK_FOR_DETAILS,
        weightLabel: product.weightGrams !== null ? formatWeight(product.weightGrams) : ASK_FOR_DETAILS,
        priceLabel: product.approvedPrice !== null ? formatPrice(product.approvedPrice, product.currency) : NEEDS_CONFIRMATION,
        priceConfirmed: product.approvedPrice !== null,
        availability: inventory.availability,
        availabilityLabel: AVAILABILITY_LABELS[inventory.availability],
        imageUrl,
        viewUrl: product.websiteUrl,
      });
    } catch (error) {
      // A product removed since the message was written is simply not shown.
      if (!(error instanceof NotFoundError)) throw error;
    }
  }
  return cards;
}
