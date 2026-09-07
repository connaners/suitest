import { FolderTree } from "lucide-react";
import { useState } from "react";

import { CreateProjectDialog } from "@/components/cases/CreateProjectDialog";
import { EmptyState } from "@/components/shared/EmptyState";

/**
 * Shared first-project bootstrap (dogfood blocker #1). A fresh ZERO install
 * has a default workspace but no projects; every project-scoped query 422s
 * without an active project, so screens short-circuit to a create-project
 * prompt before any data hook runs. Used by the Cases screen and the
 * Dashboard so neither dead-ends on a project-less workspace.
 */
export function FirstProjectBootstrap(): React.ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <>
      <EmptyState
        icon={FolderTree}
        title="Create your first project"
        subtitle="Projects hold your test suites and cases. Make one to start testing."
        action={{
          label: "New project",
          variant: "default",
          onClick: () => {
            setOpen(true);
          },
        }}
      />
      <CreateProjectDialog
        open={open}
        onClose={() => {
          setOpen(false);
        }}
      />
    </>
  );
}
