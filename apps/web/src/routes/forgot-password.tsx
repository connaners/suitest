import { createFileRoute, Link } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  AuthBackToLogin,
  AuthContainer,
  AuthErrorAlert,
  AuthFooter,
  AuthForm,
  AuthHeader,
  AuthSubmitButton,
} from "@/components/shared/AuthLayout";

export function ForgotPassword(): React.ReactElement {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });

      if (!res.ok) {
        throw new Error("forgot_password_failed");
      }

      setSubmitted(true);
    } catch {
      setError(
        t(
          "auth.forgotPasswordError",
          "Could not submit password reset request. Please try again later.",
        ),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthContainer>
      <AuthHeader
        subtitle={t(
          "auth.forgotPasswordDesc",
          "Enter your email address and we'll send you instructions to reset your password.",
        )}
      />

      {submitted ? (
        <div className="space-y-4 rounded-lg border border-border bg-elev-1 p-6 text-center">
          <div className="space-y-2">
            <h3 className="text-[15px] font-semibold text-fg-1" data-testid="forgot-password-success-title">
              {t("auth.forgotPasswordSuccessTitle", "Check your email")}
            </h3>
            <p className="text-[13px] text-fg-3" data-testid="forgot-password-success-desc">
              {t(
                "auth.forgotPasswordSuccessDesc",
                "If an account exists for that email, a password reset link has been dispatched.",
              )}
            </p>
          </div>
          <Link
            to="/login"
            className="inline-flex items-center justify-center rounded-md bg-accent px-4 py-2 text-[13px] font-medium text-accent-fg hover:opacity-90"
          >
            {t("auth.backToLogin", "Back to sign in")}
          </Link>
        </div>
      ) : (
        <AuthForm onSubmit={onSubmit}>
          <div className="space-y-2">
            <label htmlFor="email" className="text-[12.5px] font-medium text-fg-1">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              placeholder="you@example.com"
              className="w-full rounded-md border border-border bg-bg-base px-3 py-2 text-[13px] text-fg-1 outline-none placeholder:text-fg-5 focus:border-accent"
            />
          </div>

          <AuthErrorAlert error={error} />

          <AuthSubmitButton
            submitting={submitting}
            label={t("auth.sendResetLink", "Send reset link")}
            loadingLabel={t("auth.sendingResetLink", "Sending…")}
          />

          <AuthBackToLogin label={t("auth.backToLogin", "Back to sign in")} />
        </AuthForm>
      )}

      <AuthFooter />
    </AuthContainer>
  );
}

export const Route = createFileRoute("/forgot-password")({
  component: ForgotPassword,
});
