import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, FolderKanban, Pencil, Plus } from "lucide-react";
import { useState } from "react";

import { CreateProjectDialog } from "@/components/cases/CreateProjectDialog";
import { EditProjectDialog } from "@/components/cases/EditProjectDialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { api } from "@/lib/api-client";
import type { components } from "@/lib/api-types";
import { cn } from "@/lib/utils";
import { useActiveProject } from "@/stores/use-active-project";

type Project = components["schemas"]["ProjectPublic"];
type ProjectsPage = { items: Project[] };

export interface ProjectPickerProps {
  /** Collapsed rail — show only the folder icon, hide the label + chevron. */
  collapsed?: boolean;
  /** Controlled popover state — owned by Sidebar so the rail stays expanded while the dropdown is open. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** When true (default), shows "+ New project" and "Edit project" controls. */
  canManage?: boolean;
}

/**
 * Project switcher — Test Cases / Test Runs / Analytics are all scoped to the
 * active project (`useActiveProject`). A workspace can hold several projects
 * (e.g. a backend + a frontend suite), so without this switcher only the first
 * project's data is ever visible. Sits under the workspace picker in the sidebar.
 */
export function ProjectPicker({
  collapsed = false,
  open: openProp,
  onOpenChange: onOpenChangeProp,
  canManage = true,
}: ProjectPickerProps = {}): React.ReactElement | null {
  const [internalOpen, setInternalOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);

  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp : internalOpen;
  const onOpenChange = isControlled ? (onOpenChangeProp ?? (() => {})) : setInternalOpen;

  const projectId = useActiveProject((s) => s.projectId);
  const setProjectId = useActiveProject((s) => s.setProjectId);
  const { data } = useQuery({
    queryKey: ["projects"] as const,
    queryFn: async () => (await api.get<ProjectsPage>("/projects")).data,
  });
  const projects = data?.items ?? [];

  if (projects.length === 0) {
    if (!canManage) return null;
    return (
      <div className="shrink-0 border-b border-border-subtle px-3 py-2">
        <button
          type="button"
          data-testid="project-picker-new-fallback"
          aria-label={collapsed ? "New project" : undefined}
          title={collapsed ? "New project" : undefined}
          onClick={() => setCreateOpen(true)}
          className={cn(
            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] font-medium text-fg-3 hover:bg-bg-elev-2 hover:text-fg-1",
            collapsed ? "md:justify-center md:px-0" : "",
          )}
        >
          <Plus className="h-3.5 w-3.5 shrink-0 text-fg-4" aria-hidden="true" />
          <span className={cn("truncate", collapsed ? "md:hidden" : "")}>New project</span>
        </button>
        <CreateProjectDialog
          open={createOpen}
          onClose={() => setCreateOpen(false)}
        />
      </div>
    );
  }

  const active = projects.find((p) => p.id === projectId) ?? projects[0];

  return (
    <>
      <div className="shrink-0 border-b border-border-subtle px-3 py-2">
        <Popover open={open} onOpenChange={onOpenChange}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={collapsed ? `Project: ${active?.name ?? "Select project"}` : undefined}
              title={collapsed ? (active?.name ?? "Select project") : undefined}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-bg-elev-2",
                collapsed ? "md:justify-center md:px-0" : "",
              )}
              data-testid="project-picker"
            >
              <FolderKanban className="h-3.5 w-3.5 shrink-0 text-fg-4" aria-hidden="true" />
              <span className={cn("flex flex-col overflow-hidden", collapsed ? "md:hidden" : "")}>
                <span className="text-[9.5px] uppercase tracking-wide text-fg-5">Project</span>
                <span className="truncate text-[12px] font-medium text-fg-1">
                  {active?.name ?? "Select project"}
                </span>
              </span>
              <ChevronDown
                className={cn("ml-auto h-3.5 w-3.5 shrink-0 text-fg-4", collapsed ? "md:hidden" : "")}
                aria-hidden="true"
              />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="w-[220px] border-border bg-bg-elev-1 p-1 text-fg-1"
          >
            {canManage && active ? (
              <div
                className="mb-1 flex items-center justify-between border-b border-border-subtle px-2 py-1 text-[11px]"
                data-testid="project-picker-action-bar"
              >
                <span className="truncate font-medium text-fg-4">Active project</span>
                <button
                  type="button"
                  data-testid="project-picker-edit-btn"
                  aria-label="Edit project"
                  title="Edit project"
                  onClick={() => {
                    onOpenChange(false);
                    setEditingProject(active);
                    setEditOpen(true);
                  }}
                  className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-fg-3 hover:bg-bg-elev-2 hover:text-fg-1"
                >
                  <Pencil className="h-3 w-3 shrink-0" aria-hidden="true" />
                  <span>Edit</span>
                </button>
              </div>
            ) : null}
            <ul className="space-y-0.5" data-testid="project-picker-list">
              {projects.map((p) => {
                const isActive = p.id === active?.id;
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      data-testid="project-picker-item"
                      data-active={isActive ? "true" : "false"}
                      onClick={() => {
                        onOpenChange(false);
                        if (!isActive) setProjectId(p.id);
                      }}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[12.5px] hover:bg-bg-elev-2",
                        isActive ? "bg-bg-elev-2 text-fg-1" : "text-fg-3",
                      )}
                    >
                      <span className="flex-1 truncate">{p.name}</span>
                      {isActive ? (
                        <Check className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden="true" />
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
            {canManage ? (
              <div className="mt-1 border-t border-border-subtle pt-1">
                <button
                  type="button"
                  data-testid="project-picker-create"
                  onClick={() => {
                    onOpenChange(false);
                    setCreateOpen(true);
                  }}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[12.5px] text-fg-3 hover:bg-bg-elev-2 hover:text-fg-1"
                >
                  <Plus className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  New project
                </button>
              </div>
            ) : null}
          </PopoverContent>
        </Popover>
      </div>

      <CreateProjectDialog
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
        }}
      />
      <EditProjectDialog
        open={editOpen}
        onClose={() => {
          setEditOpen(false);
          setEditingProject(null);
        }}
        project={editingProject}
      />
    </>
  );
}
