import Link from "next/link";
import LoginForm from "@/components/LoginForm";

export default function LoginPage() {
  return (
    <div className="mx-auto flex max-w-md flex-col px-6 py-16">
      <div className="text-center">
        <p className="text-sm uppercase tracking-[0.3em] text-gold">Welcome back</p>
        <h1 className="mt-3 font-serif text-3xl text-charcoal">Login</h1>
        <p className="mt-2 text-sm text-charcoal/60">
          Sign in to your Zarghoon Jewellers account.
        </p>
      </div>

      <div className="mt-10 rounded-2xl border border-gold/20 bg-white/60 p-8 shadow-sm">
        <LoginForm />
      </div>

      <p className="mt-6 text-center text-sm text-charcoal/60">
        New to Zarghoon Jewellers?{" "}
        <Link href="/register" className="font-medium text-gold hover:text-gold-dark">
          Join the Family
        </Link>
      </p>
    </div>
  );
}
