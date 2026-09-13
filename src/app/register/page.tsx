import Link from "next/link";
import RegisterForm from "@/components/RegisterForm";

export default function RegisterPage() {
  return (
    <div className="mx-auto flex max-w-md flex-col px-6 py-16">
      <div className="text-center">
        <p className="text-sm uppercase tracking-[0.3em] text-gold">Zarghoon Jewellers Family</p>
        <h1 className="mt-3 font-serif text-3xl text-charcoal">Create Your Account</h1>
        <p className="mt-2 text-sm text-charcoal/60">
          Join the family and enjoy exclusive updates, offers and personal touches.
        </p>
      </div>

      <div className="mt-10 rounded-2xl border border-gold/20 bg-white/60 p-8 shadow-sm">
        <RegisterForm />
      </div>

      <p className="mt-6 text-center text-sm text-charcoal/60">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-gold hover:text-gold-dark">
          Login here
        </Link>
      </p>
    </div>
  );
}
