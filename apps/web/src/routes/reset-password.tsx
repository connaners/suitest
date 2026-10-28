import { createFileRoute, Link } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";

interface ResetPasswordSearch {
  token?: string;
}

export function ResetPassword(): React.ReactElement {
  const { t } = useTranslation();
  const search = Route.useSearch();
  const token = search.token?.trim() ?? "";

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError(
        t("auth.passwordTooShort", "Password must be at least 8 characters."),
      );
      return;
    }

    if (password !== confirmPassword) {
      setError(t("auth.passwordsDoNotMatch", "Passwords do not match."));
      return;
    }

    setSubmitting(true);

    try {
      const res = await fetch("/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });

      if (!res.ok) {
        if (res.status === 400) {
          throw new Error("bad_token");
        }
        throw new Error("reset_failed");
      }

      setSubmitted(true);
    } catch (err) {
      if (err instanceof Error && err.message === "bad_token") {
        setError(
          t(
            "auth.resetTokenInvalid",
            "This reset link is invalid or has expired.",
          ),
        );
      } else {
        setError(
          t(
            "auth.resetGenericError",
            "Could not reset your password. Please try requesting a new link.",
          ),
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="mx-auto max-w-md space-y-6 pt-16">
      <div className="space-y-3 text-center">
        <img src="/logo.svg" alt="Suitest" className="mx-auto h-12 w-12 rounded-xl" />
        <h2 className="font-mono text-2xl font-semibold tracking-tight">
          sui<span className="text-accent">test</span>
        </h2>
        <p className="text-[13px] text-fg-3">
          {t("auth.resetPasswordDesc", "Please choose a secure password with at least 8 characters.")}
        </p>
      </div>

      {!token ? (
        <div className="space-y-4 rounded-lg border border-red/30 bg-red/10 p-6 text-center">
          <p className="text-[13px] text-red font-medium" data-testid="missing-token-warning">
            {t("auth.missingToken", "Invalid or missing reset token.")}
          </p>
          <Link
            to="/login"
            className="inline-flex items-center justify-center rounded-md border border-border bg-elev-1 px-4 py-2 text-[13px] font-medium text-fg-1 hover:bg-elev-2"
          >
            {t("auth.backToLogin", "Back to sign in")}
          </Link>
        </div>
      ) : submitted ? (
        <div className="space-y-4 rounded-lg border border-border bg-elev-1 p-6 text-center">
          <div className="space-y-2">
            <h3 className="text-[15px] font-semibold text-fg-1" data-testid="reset-password-success-title">
              {t("auth.resetPasswordSuccessTitle", "Password updated")}
            </h3>
            <p className="text-[13px] text-fg-3" data-testid="reset-password-success-desc">
              {t(
                "auth.resetPasswordSuccessDesc",
                "Your password has been reset successfully. You can now sign in.",
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
        <form
          onSubmit={(event) => {
            void onSubmit(event);
          }}
          className="space-y-4 rounded-lg border border-border bg-elev-1 p-5 text-left"
        >
          <div className="space-y-2">
            <label htmlFor="new-password" className="text-[12.5px] font-medium text-fg-1">
              {t("auth.newPasswordLabel", "New password")}
            </label>
            <input
              id="new-password"
              name="newPassword"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={8}
              className="w-full rounded-md border border-border bg-bg-base px-3 py-2 text-[13px] text-fg-1 outline-none placeholder:text-fg-5 focus:border-accent"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="confirm-password" className="text-[12.5px] font-medium text-fg-1">
              {t("auth.confirmPasswordLabel", "Confirm new password")}
            </label>
            <input
              id="confirm-password"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
              minLength={8}
              className="w-full rounded-md border border-border bg-bg-base px-3 py-2 text-[13px] text-fg-1 outline-none placeholder:text-fg-5 focus:border-accent"
            />
          </div>

          {error ? (
            <p
              role="alert"
              className="rounded-md border border-red/30 bg-red/10 px-3 py-2 text-[12.5px] text-red"
            >
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={submitting}
            className="inline-flex w-full items-center justify-center rounded-md bg-accent px-4 py-2 text-[13px] font-medium text-accent-fg hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting
              ? t("auth.resettingPassword", "Resetting…")
              : t("auth.resetPasswordSubmit", "Reset password")}
          </button>

          <div className="pt-2 text-center">
            <Link
              to="/login"
              className="text-[12.5px] text-fg-3 hover:text-accent transition-colors"
            >
              {t("auth.backToLogin", "Back to sign in")}
            </Link>
          </div>
        </form>
      )}

      <p className="pt-4 text-center text-[11px] text-fg-5">
        © 2026 Suitest contributors · Apache-2.0 · open source
      </p>
    </section>
  );
}

export const Route = createFileRoute("/reset-password")({
  validateSearch: (search: Record<string, unknown>): ResetPasswordSearch => {
    const token = search["token"];
    return typeof token === "string" ? { token } : {};
  },
  component: ResetPassword,
});
