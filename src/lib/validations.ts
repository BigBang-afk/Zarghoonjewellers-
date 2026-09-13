import { z } from "zod";

export const registerSchema = z
  .object({
    fullName: z.string().trim().min(2, "Please enter your full name."),
    username: z
      .string()
      .trim()
      .min(3, "Username must be at least 3 characters.")
      .max(30, "Username must be under 30 characters.")
      .regex(
        /^[a-zA-Z0-9_.]+$/,
        "Username can only contain letters, numbers, '.' and '_'.",
      ),
    password: z.string().min(6, "Password must be at least 6 characters."),
    dob: z.string().min(1, "Date of birth is required."),
    anniversary: z.string().optional().or(z.literal("")),
    mobile: z
      .string()
      .trim()
      .min(7, "Please enter a valid mobile number.")
      .max(15, "Please enter a valid mobile number.")
      .regex(/^[0-9+\-\s]+$/, "Please enter a valid mobile number."),
  })
  .refine(
    (data) => {
      const dob = new Date(data.dob);
      return !Number.isNaN(dob.getTime()) && dob <= new Date();
    },
    { message: "Please enter a valid date of birth.", path: ["dob"] },
  )
  .refine(
    (data) => {
      if (!data.anniversary) return true;
      const anniversary = new Date(data.anniversary);
      return !Number.isNaN(anniversary.getTime());
    },
    { message: "Please enter a valid anniversary date.", path: ["anniversary"] },
  );

export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  username: z.string().trim().min(1, "Username is required."),
  password: z.string().min(1, "Password is required."),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const PRODUCT_CATEGORIES = [
  "Ring",
  "Necklace",
  "Earrings",
  "Bangle",
  "Bracelet",
  "Chain",
  "Pendant",
  "Nose Pin",
  "Anklet",
  "Other",
] as const;

export const PRODUCT_QUALITIES = [
  "24K Gold (999)",
  "22K Gold (916)",
  "18K Gold (750)",
  "14K Gold (585)",
  "Silver (925)",
  "Platinum (950)",
  "Other",
] as const;

export const productSchema = z.object({
  name: z.string().trim().min(2, "Product name is required."),
  category: z.string().trim().min(1, "Please select a category."),
  quality: z.string().trim().min(1, "Please select a quality."),
  netWeight: z.coerce
    .number({ error: "Net weight is required." })
    .positive("Net weight must be greater than 0."),
  wastagePercent: z.coerce
    .number({ error: "Wastage % is required." })
    .min(0, "Wastage % cannot be negative."),
});

export type ProductInput = z.infer<typeof productSchema>;
