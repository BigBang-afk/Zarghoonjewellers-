"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { signIn } from "next-auth/react";
import { loginSchema, type LoginInput } from "@/lib/validations";

const inputClass =
  "w-full rounded-lg border border-charcoal/15 bg-white px-4 py-2.5 text-sm text-charcoal placeholder:text-charcoal/40 focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold";
const labelClass = "mb-1.5 block text-sm font-medium text-charcoal/80";
const errorClass = "mt-1 text-xs text-red-600";

export default function LoginForm() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (data: LoginInput) => {
    setServerError(null);
    setSubmitting(true);
    const result = await signIn("credentials", {
      username: data.username,
      password: data.password,
      redirect: false,
    });

    if (result?.error) {
      setServerError("Invalid username or password.");
      setSubmitting(false);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      <div>
        <label className={labelClass} htmlFor="username">
          Username
        </label>
        <input id="username" className={inputClass} placeholder="Your username" {...register("username")} />
        {errors.username && <p className={errorClass}>{errors.username.message}</p>}
      </div>

      <div>
        <label className={labelClass} htmlFor="password">
          Password
        </label>
        <input
          id="password"
          type="password"
          className={inputClass}
          placeholder="Your password"
          {...register("password")}
        />
        {errors.password && <p className={errorClass}>{errors.password.message}</p>}
      </div>

      {serverError && <p className="text-sm text-red-600">{serverError}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-full bg-gold px-6 py-3 font-semibold text-charcoal transition hover:bg-gold-light disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? "Signing in..." : "Login"}
      </button>
    </form>
  );
}
