import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useUpdateProject } from "@/hooks/use-projects";
import { ApiError } from "@/lib/api-client";
import type { components } from "@/lib/api-types";

type ProjectPublic = components["schemas"]["ProjectPublic"];

export interface EditProjectDialogProps {
  open: boolean;
  onClose: () => void;
  project: (Pick<ProjectPublic, "id" | "name" | "slug"> & { description?: string | null }) | null;
}

/**
 * Edit project details (name and description).
 *
 * Slugs are strictly immutable in the backend. Gated to OWNER and ADMIN roles.
 */
export function EditProjectDialog({
  open,
  onClose,
  project,
}: EditProjectDialogProps): React.ReactElement {
  const [name, setName] = useState(project?.name ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const updateProject = useUpdateProject();

  useEffect(() => {
    if (project) {
      setName(project.name);
      setDescription(project.description ?? "");
    }
  }, [project]);

  const reset = (): void => {
    if (project) {
      setName(project.name);
      setDescription(project.description ?? "");
    } else {
      setName("");
      setDescription("");
    }
    updateProject.reset();
  };

  const close = (): void => {
    reset();
    onClose();
  };

  const handleSubmit = (event: React.FormEvent): void => {
    event.preventDefault();
    if (!project) return;
    const trimmedName = name.trim();
    if (trimmedName.length === 0) return;

    const trimmedDescription = description.trim();
    updateProject.mutate(
      {
        projectId: project.id,
        name: trimmedName,
        description: trimmedDescription.length > 0 ? trimmedDescription : undefined,
      },
      {
        onSuccess: () => {
          toast.success("Project updated successfully");
          close();
        },
      },
    );
  };

  const errorMessage = updateProject.isError
    ? updateProject.error instanceof ApiError && updateProject.error.status === 403
      ? "You don't have permission to edit this project."
      : updateProject.error instanceof ApiError && updateProject.error.status === 409
        ? "A project with that name already exists. Try another."
        : "Couldn't update the project. Please try again."
    : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <DialogContent data-testid="edit-project-dialog">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Edit project</DialogTitle>
            <DialogDescription>
              Update your project name and description. Project slugs cannot be changed once created.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-project-name">Project name</Label>
            <Input
              id="edit-project-name"
              data-testid="edit-project-name"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
              placeholder="e.g. Swag Labs"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="edit-project-slug">Project slug</Label>
              <span className="text-[11px] text-fg-5">Slug is immutable</span>
            </div>
            <Input
              id="edit-project-slug"
              data-testid="edit-project-slug"
              value={project?.slug ?? ""}
              disabled
              readOnly
              className="cursor-not-allowed bg-bg-elev-2 text-fg-4"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-project-description">Description</Label>
            <Textarea
              id="edit-project-description"
              data-testid="edit-project-description"
              value={description}
              onChange={(event) => {
                setDescription(event.target.value);
              }}
              placeholder="Optional project description"
              rows={3}
            />
          </div>

          {errorMessage ? (
            <p data-testid="edit-project-error" className="text-[12.5px] text-red">
              {errorMessage}
            </p>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={close}
              data-testid="edit-project-cancel"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              data-testid="edit-project-submit"
              disabled={name.trim().length === 0 || updateProject.isPending}
            >
              {updateProject.isPending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
