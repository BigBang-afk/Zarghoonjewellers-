import ProductForm from "@/components/ProductForm";

export default function NewProductPage() {
  return (
    <div>
      <h1 className="font-serif text-3xl text-charcoal">Add Product</h1>
      <p className="mt-2 text-charcoal/60">
        Gross weight is calculated automatically as Net Weight + Wastage.
      </p>

      <div className="mt-8 max-w-2xl rounded-2xl border border-gold/20 bg-white p-8 shadow-sm">
        <ProductForm />
      </div>
    </div>
  );
}
