import Image from "next/image";

type ProductCardProps = {
  name: string;
  category: string;
  quality: string;
  grossWeight: number;
  imageUrl?: string;
};

export default function ProductCard({
  name,
  category,
  quality,
  grossWeight,
  imageUrl,
}: ProductCardProps) {
  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-sm transition hover:shadow-md">
      <div className="relative aspect-square bg-cream-dark">
        {imageUrl ? (
          <Image src={imageUrl} alt={name} fill sizes="(max-width: 768px) 50vw, 25vw" className="object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-charcoal/40">
            No image
          </div>
        )}
      </div>
      <div className="p-4">
        <h3 className="font-serif text-lg text-charcoal">{name}</h3>
        <p className="text-xs uppercase tracking-wide text-gold">
          {category} &middot; {quality}
        </p>
        <p className="mt-1 text-sm text-charcoal/60">{grossWeight.toFixed(3)} g gross</p>
      </div>
    </div>
  );
}
