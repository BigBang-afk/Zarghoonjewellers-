"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PRODUCT_CATEGORIES, PRODUCT_QUALITIES } from "@/lib/validations";

const inputClass =
  "w-full rounded-lg border border-charcoal/15 bg-white px-4 py-2.5 text-sm text-charcoal placeholder:text-charcoal/40 focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold";
const labelClass = "mb-1.5 block text-sm font-medium text-charcoal/80";

export default function ProductForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [category, setCategory] = useState<string>(PRODUCT_CATEGORIES[0]);
  const [quality, setQuality] = useState<string>(PRODUCT_QUALITIES[0]);
  const [netWeight, setNetWeight] = useState("");
  const [wastagePercent, setWastagePercent] = useState("");
  const [images, setImages] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const grossWeight = useMemo(() => {
    const net = parseFloat(netWeight);
    const wastage = parseFloat(wastagePercent);
    if (Number.isNaN(net) || Number.isNaN(wastage)) return null;
    return net + net * (wastage / 100);
  }, [netWeight, wastagePercent]);

  const handleImagesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    setImages(files);
    previews.forEach((url) => URL.revokeObjectURL(url));
    setPreviews(files.map((file) => URL.createObjectURL(file)));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (images.length === 0) {
      setError("Please add at least one product image.");
      return;
    }

    setSubmitting(true);

    const formData = new FormData();
    formData.set("name", name);
    formData.set("category", category);
    formData.set("quality", quality);
    formData.set("netWeight", netWeight);
    formData.set("wastagePercent", wastagePercent);
    images.forEach((file) => formData.append("images", file));

    try {
      const res = await fetch("/api/admin/products", { method: "POST", body: formData });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Failed to add product. Please try again.");
        setSubmitting(false);
        return;
      }
      router.push("/admin/products");
      router.refresh();
    } catch {
      setError("Failed to add product. Please try again.");
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <label className={labelClass} htmlFor="name">
          Product Name
        </label>
        <input
          id="name"
          className={inputClass}
          placeholder="e.g. Bridal Gold Necklace Set"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="category">
            Category
          </label>
          <select
            id="category"
            className={inputClass}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {PRODUCT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass} htmlFor="quality">
            Quality
          </label>
          <select
            id="quality"
            className={inputClass}
            value={quality}
            onChange={(e) => setQuality(e.target.value)}
          >
            {PRODUCT_QUALITIES.map((q) => (
              <option key={q} value={q}>
                {q}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-5 sm:grid-cols-3">
        <div>
          <label className={labelClass} htmlFor="netWeight">
            Net Weight (g)
          </label>
          <input
            id="netWeight"
            type="number"
            step="0.001"
            min="0"
            className={inputClass}
            placeholder="0.000"
            value={netWeight}
            onChange={(e) => setNetWeight(e.target.value)}
            required
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="wastagePercent">
            Wastage %
          </label>
          <input
            id="wastagePercent"
            type="number"
            step="0.01"
            min="0"
            className={inputClass}
            placeholder="0.00"
            value={wastagePercent}
            onChange={(e) => setWastagePercent(e.target.value)}
            required
          />
        </div>

        <div>
          <label className={labelClass}>Gross Weight (g)</label>
          <div className="w-full rounded-lg border border-charcoal/15 bg-cream-dark/50 px-4 py-2.5 text-sm font-medium text-charcoal">
            {grossWeight !== null ? grossWeight.toFixed(3) : "—"}
          </div>
        </div>
      </div>

      <div>
        <label className={labelClass} htmlFor="images">
          Product Images (multiple allowed)
        </label>
        <input
          id="images"
          type="file"
          accept="image/*"
          multiple
          onChange={handleImagesChange}
          className="block w-full text-sm text-charcoal/70 file:mr-4 file:rounded-full file:border-0 file:bg-gold file:px-4 file:py-2 file:text-sm file:font-semibold file:text-charcoal hover:file:bg-gold-light"
        />
        {previews.length > 0 && (
          <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-4">
            {previews.map((src, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={src}
                src={src}
                alt={`Preview ${i + 1}`}
                className="h-24 w-full rounded-lg object-cover"
              />
            ))}
          </div>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-full bg-gold px-6 py-3 font-semibold text-charcoal transition hover:bg-gold-light disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
      >
        {submitting ? "Saving..." : "Save Product"}
      </button>
    </form>
  );
}
