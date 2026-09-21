import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";

import { useCurrentUser } from "@/hooks/use-current-user";
import { updateOwnName } from "@/lib/api-client";

function ProfileScreen(): React.ReactElement {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: user } = useCurrentUser();
  const safeUser = user ?? { email: "", name: "" };
  const [name, setName] = useState(safeUser.name);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const renameMutation = useMutation({
    mutationFn: (value: string) => updateOwnName(value),
    onSuccess: async () => {
      setSuccess(true);
      setError(null);
      // The Sidebar footer, dashboard greeting, and every other reader of
      // the signed-in name all key off this cache entry.
      await queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
    },
    onError: () => {
      setSuccess(false);
      setError(t("profile.updateError"));
    },
  });

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setSuccess(false);
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setError(t("profile.nameEmpty"));
      return;
    }
    setError(null);
    renameMutation.mutate(trimmed);
  };

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div className="space-y-1">
        <h1 className="text-[20px] font-semibold text-fg-1">{t("profile.title")}</h1>
        <p className="text-[13px] text-fg-3">{safeUser.email}</p>
      </div>

      <section className="space-y-4 rounded-lg border border-border bg-bg-elev-1 p-5">
        <h2 className="text-[15px] font-semibold text-fg-1">{t("profile.displayName")}</h2>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="profile-name" className="text-[12.5px] font-medium text-fg-1">
              {t("profile.nameLabel")}
            </label>
            <input
              id="profile-name"
              name="name"
              type="text"
              maxLength={120}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (success) setSuccess(false);
              }}
              className="w-full rounded-md border border-border bg-bg-base px-3 py-2 text-[13px] text-fg-1 outline-none focus:border-accent"
              data-testid="profile-name-input"
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

          {success ? (
            <p
              role="status"
              className="rounded-md border border-accent/30 bg-accent/10 px-3 py-2 text-[12.5px] text-accent"
            >
              {t("profile.nameUpdated")}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={renameMutation.isPending}
            className="inline-flex h-9 w-full items-center justify-center rounded-md bg-accent px-4 text-[13px] font-medium text-accent-fg hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            data-testid="profile-name-submit"
          >
            {renameMutation.isPending ? t("profile.saving") : t("profile.saveName")}
          </button>
        </form>
      </section>
    </div>
  );
}

export const Route = createFileRoute("/_app/profile")({
  component: ProfileScreen,
});
