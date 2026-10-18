"use client";

import { useActionState } from "react";
import { loginAction, type ActionState } from "@/lib/actions";
import { buttonClass, inputClass } from "./ui";

export function LoginForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(loginAction, { ok: false, message: null, error: null });
  return (
    <form action={action} className="space-y-4" data-testid="login-form">
      <div>
        <label htmlFor="username" className="mb-1 block text-sm font-medium text-ink">
          Username
        </label>
        <input id="username" name="username" autoComplete="username" required maxLength={40} className={inputClass} />
      </div>
      <div>
        <label htmlFor="password" className="mb-1 block text-sm font-medium text-ink">
          Password
        </label>
        <input id="password" name="password" type="password" autoComplete="current-password" required maxLength={200} className={inputClass} />
      </div>
      {state.error ? (
        <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      ) : null}
      <button type="submit" disabled={pending} className={`${buttonClass.primary} w-full py-2.5`}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
