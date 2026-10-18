"use client";

import { useActionState, type ReactNode } from "react";
import { useToast } from "./Toaster";
import type { ActionState } from "@/lib/actions";
import { buttonClass } from "./ui";

const INITIAL: ActionState = { ok: false, message: null, error: null };

/**
 * A form bound to a Server Action, showing its success or error message.
 * Hidden values are conveniences only: the server re-validates them and
 * checks the signed-in staff member's permission for the record.
 */
export function ActionForm({
  action,
  hidden = {},
  submitLabel,
  variant = "primary",
  confirm,
  children,
  className = "",
  testId,
}: {
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  hidden?: Record<string, string>;
  submitLabel: string;
  variant?: keyof typeof buttonClass;
  confirm?: string;
  children?: ReactNode;
  className?: string;
  testId?: string;
}) {
  const toast = useToast();
  const [state, formAction, pending] = useActionState(async (prev: ActionState, form: FormData) => {
    const result = await action(prev, form);
    if (result.ok && result.message) toast(result.message);
    return result;
  }, INITIAL);
  return (
    <form
      action={formAction}
      className={`space-y-2 ${className}`}
      data-testid={testId}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {children}
      <button type="submit" disabled={pending} className={buttonClass[variant]}>
        {pending ? "Working…" : submitLabel}
      </button>
      {state.error ? (
        <p role="alert" className="text-sm text-danger" data-testid="action-error">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
