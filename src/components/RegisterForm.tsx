"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { signIn } from "next-auth/react";
import { registerSchema, type RegisterInput } from "@/lib/validations";

const inputClass =
  "w-full rounded-lg border border-charcoal/15 bg-white px-4 py-2.5 text-sm text-charcoal placeholder:text-charcoal/40 focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold";
const labelClass = "mb-1.5 block text-sm font-medium text-charcoal/80";
const errorClass = "mt-1 text-xs text-red-600";

export default function RegisterForm() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
  });

  const onSubmit = async (data: RegisterInput) => {
    setServerError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const json = await res.json();

      if (!res.ok) {
        setServerError(json.error ?? "Something went wrong. Please try again.");
        setSubmitting(false);
        return;
      }

      const result = await signIn("credentials", {
        username: data.username,
        password: data.password,
        redirect: false,
      });

      if (result?.error) {
        router.push("/login");
        return;
      }

      router.push("/dashboard");
      router.refresh();
    } catch {
      setServerError("Something went wrong. Please try again.");
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      <div>
        <label className={labelClass} htmlFor="fullName">
          Full Name
        </label>
        <input id="fullName" className={inputClass} placeholder="Your full name" {...register("fullName")} />
        {errors.fullName && <p className={errorClass}>{errors.fullName.message}</p>}
      </div>

      <div>
        <label className={labelClass} htmlFor="username">
          Username
        </label>
        <input id="username" className={inputClass} placeholder="Choose a username" {...register("username")} />
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
          placeholder="At least 6 characters"
          {...register("password")}
        />
        {errors.password && <p className={errorClass}>{errors.password.message}</p>}
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="dob">
            Date of Birth
          </label>
          <input id="dob" type="date" className={inputClass} {...register("dob")} />
          {errors.dob && <p className={errorClass}>{errors.dob.message}</p>}
        </div>

        <div>
          <label className={labelClass} htmlFor="anniversary">
            Anniversary Date <span className="text-charcoal/40">(optional)</span>
          </label>
          <input id="anniversary" type="date" className={inputClass} {...register("anniversary")} />
          {errors.anniversary && <p className={errorClass}>{errors.anniversary.message}</p>}
        </div>
      </div>

      <div>
        <label className={labelClass} htmlFor="mobile">
          Mobile Number
        </label>
        <input id="mobile" className={inputClass} placeholder="e.g. 03001234567" {...register("mobile")} />
        {errors.mobile && <p className={errorClass}>{errors.mobile.message}</p>}
      </div>

      {serverError && <p className="text-sm text-red-600">{serverError}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-full bg-gold px-6 py-3 font-semibold text-charcoal transition hover:bg-gold-light disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? "Creating your account..." : "Join the Zarghoon Family"}
      </button>
    </form>
  );
}
