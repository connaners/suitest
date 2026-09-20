import { Link } from "@tanstack/react-router";
import {
  BarChart3,
  Bell,
  BookOpen,
  Bug,
  Check,
  ChevronDown,
  FileCode2,
  FlaskConical,
  Inbox,
  LayoutDashboard,
  LogOut,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Plug,
  Plus,
  Settings,
  Shield,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";

import { ProjectPicker } from "@/components/shell/ProjectPicker";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface NavItem {
  label: string;
  icon: LucideIcon;
  to: string;
  badgeCount?: number;
  liveDot?: boolean;
  disabled?: boolean;
}

interface NavGroup {
  eyebrow: string;
  items: NavItem[];
}

export interface SidebarProps {
  /** Display name of the active workspace. */
  workspaceName?: string;
  /** Display name of the signed-in user. */
  userName?: string;
  /** Role label shown next to the user name in the footer. */
  userRole?: string;
  /** Number of unread notifications. >0 renders a red dot over the bell. */
  unreadCount?: number;
  /** Inbox unread item count. >0 renders a badge next to "Inbox". */
  inboxCount?: number;
  /** Active test runs count. >0 renders a pulsing live dot next to "Test Runs". */
  activeRunsCount?: number;
  /** Read-only list of workspaces for the picker popover. */
  workspaces?: ReadonlyArray<{ id: string; name: string }>;
  /** Id of the active workspace (for the checkmark in the picker). */
  activeWorkspaceId?: string;
  /** Switch the active workspace. No-op affordance when omitted. */
  onSelectWorkspace?: (id: string) => void;
  /** Open the create-workspace flow (bootstrap blocker #1). */
  onCreateWorkspace?: () => void;
  /** Show the super-admin "Admin" nav item (M1e). */
  isSuperuser?: boolean;
  /** Below `md:` the sidebar is an overlay drawer — this opens it. */
  mobileOpen?: boolean;
  /** Close the mobile drawer (backdrop click / nav click). */
  onMobileClose?: () => void;
}

/**
 * Persistent left rail (224px). Brand + workspace + nav + user footer.
 *
 * Capability-agnostic — every nav target is deterministic-first, so the
 * sidebar renders identically in ZERO / LOCAL / CLOUD tiers. AI surfaces
 * are gated inside the AiPanel + per-screen feature flags, not here.
 *
 * Collapsible (compact 64px rail) with hover-to-expand — mirrors OPLDebitur's
 * "Small Hover" interaction: a compact rail temporarily opens while the cursor
 * is over it, and the collapse preference is persisted to localStorage. The
 * active item's accent stays on its icon while compact.
 */
export function Sidebar({
  workspaceName = "Acme QA",
  userName = "Maya",
  userRole = "Owner",
  unreadCount = 0,
  inboxCount = 0,
  activeRunsCount = 0,
  workspaces = [{ id: "default", name: "Acme QA" }],
  activeWorkspaceId,
  onSelectWorkspace,
  onCreateWorkspace,
  isSuperuser = false,
  mobileOpen = false,
  onMobileClose,
}: SidebarProps): React.ReactElement {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem("suitest.sidebarCollapsed") === "1";
    } catch {
      return false;
    }
  });
  const persistCollapsed = (value: boolean): void => {
    setCollapsed(value);
    try {
      localStorage.setItem("suitest.sidebarCollapsed", value ? "1" : "0");
    } catch {
      /* private-mode storage unavailable — keep in-memory state */
    }
  };
  // Temporarily open the compact rail while the cursor is over it or focus is
  // inside it (keyboard users tabbing through), and keep it open while either
  // popover is up — otherwise the rail collapses under the open dropdown the
  // moment the cursor leaves the aside (the dropdown ends up floating detached
  // over the content, out of the 64px rail).
  const isOpen = !collapsed || hovered || focused || pickerOpen || projectPickerOpen;

  const normalizedRole = userRole?.trim().toUpperCase();
  const canManageProjects = normalizedRole === "OWNER" || normalizedRole === "ADMIN";

  const configItems: NavItem[] = [
    { label: "Integrations", icon: Plug, to: "/integrations" },
    { label: "Docs", icon: BookOpen, to: "/docs" },
    { label: "Settings", icon: Settings, to: "/settings" },
  ];
  if (isSuperuser) {
    configItems.push({ label: "Admin", icon: Shield, to: "/admin" });
  }

  const groups: NavGroup[] = [
    {
      eyebrow: "Workspace",
      items: [
        { label: "Dashboard", icon: LayoutDashboard, to: "/dashboard" },
        { label: "Inbox", icon: Inbox, to: "/inbox", badgeCount: inboxCount },
      ],
    },
    {
      eyebrow: "Testing",
      items: [
        { label: "Test Cases", icon: FileCode2, to: "/cases" },
        {
          label: "Test Runs",
          icon: Play,
          to: "/runs",
          liveDot: activeRunsCount > 0,
        },
        { label: "Defects", icon: Bug, to: "/defects" },
      ],
    },
    {
      eyebrow: "Insights",
      items: [
        { label: "Analytics", icon: BarChart3, to: "/analytics" },
        { label: "Traceability", icon: Network, to: "/trace" },
        { label: "Eval", icon: FlaskConical, to: "/eval" },
      ],
    },
    {
      eyebrow: "Config",
      items: configItems,
    },
  ];

  return (
    <>
      {mobileOpen ? (
        <div
          className="fixed inset-0 z-40 bg-black/60 md:hidden"
          onClick={onMobileClose}
          aria-hidden="true"
          data-testid="sidebar-backdrop"
        />
      ) : null}
      <aside
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocusCapture={() => setFocused(true)}
        onBlurCapture={() => setFocused(false)}
        className={cn(
          "flex h-full shrink-0 flex-col border-r border-border-subtle bg-bg-elev-1 transition-[width] duration-200",
          !isOpen ? "w-[224px] md:w-[64px]" : "w-[224px]",
          // < md: overlay drawer, slides in from the left.
          "max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-50 max-md:transition-transform max-md:duration-200",
          mobileOpen ? "max-md:translate-x-0" : "max-md:-translate-x-full",
        )}
        data-testid="sidebar"
      >
        {/* Section 1 — Brand. Compact rail: center the logo, drop the
            secondary actions (bell) — a 64px rail is too tight for them. */}
        <div className={cn("flex h-[47px] shrink-0 items-center border-b border-border-subtle px-4", !isOpen ? "md:justify-center md:px-0" : "justify-between")}>
          <span className="flex select-none items-center gap-2">
            <img src="/logo.svg" alt="" aria-hidden="true" className="h-6 w-6 rounded-md" />
            <span className={cn("font-mono text-[15px] font-bold tracking-tight", !isOpen ? "md:hidden" : "")}>
              sui<span className="text-accent">test</span>
            </span>
          </span>
          <button
            type="button"
            aria-label="Notifications"
            className={cn("relative flex h-7 w-7 items-center justify-center rounded-md text-fg-3 hover:bg-bg-elev-2 hover:text-fg-1", !isOpen ? "md:hidden" : "")}
            data-testid="sidebar-bell"
          >
            <Bell className="h-4 w-4" aria-hidden="true" />
            {unreadCount > 0 ? (
              <span
                data-testid="sidebar-bell-unread"
                className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-red"
                aria-label={`${unreadCount} unread`}
              />
            ) : null}
          </button>
        </div>

        {/* Section 2 — Workspace picker */}
        <div className="shrink-0 border-b border-border-subtle px-3 py-3">
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-bg-elev-2",
                  !isOpen ? "md:justify-center md:px-0" : "",
                )}
                data-testid="workspace-picker"
              >
                <span
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-bg-elev-3 font-mono text-[11px] font-semibold text-fg-1"
                  aria-hidden="true"
                >
                  {workspaceName.slice(0, 2).toUpperCase()}
                </span>
                <span className={cn("flex-1 truncate text-[12.5px] font-medium text-fg-1", !isOpen ? "md:hidden" : "")}>
                  {workspaceName}
                </span>
                <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-fg-4", !isOpen ? "md:hidden" : "")} aria-hidden="true" />
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              className="w-[220px] border-border bg-bg-elev-1 p-1 text-fg-1"
            >
              <ul className="space-y-0.5" data-testid="workspace-picker-list">
                {workspaces.map((ws) => {
                  const isActive =
                    activeWorkspaceId !== undefined
                      ? ws.id === activeWorkspaceId
                      : ws.name === workspaceName;
                  return (
                    <li key={ws.id}>
                      <button
                        type="button"
                        data-testid="workspace-picker-item"
                        data-active={isActive ? "true" : "false"}
                        onClick={() => {
                          setPickerOpen(false);
                          if (!isActive) onSelectWorkspace?.(ws.id);
                        }}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[12.5px] hover:bg-bg-elev-2",
                          isActive ? "bg-bg-elev-2 text-fg-1" : "text-fg-3",
                        )}
                      >
                        <span className="flex-1 truncate">{ws.name}</span>
                        {isActive ? (
                          <Check className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden="true" />
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
              <div className="mt-1 border-t border-border-subtle pt-1">
                <button
                  type="button"
                  data-testid="workspace-picker-create"
                  onClick={() => {
                    setPickerOpen(false);
                    onCreateWorkspace?.();
                  }}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[12.5px] text-fg-3 hover:bg-bg-elev-2 hover:text-fg-1"
                >
                  <Plus className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  New workspace
                </button>
              </div>
            </PopoverContent>
          </Popover>
        </div>

        {/* Section 2b — Project picker (Test Cases / Runs are project-scoped) */}
        <ProjectPicker
          collapsed={!isOpen}
          open={projectPickerOpen}
          onOpenChange={setProjectPickerOpen}
          canManage={canManageProjects}
        />

        {/* Section 3 — Nav. min-h-0 is load-bearing: a flex child keeps
            min-height:auto, so flex-1 alone let the nav grow to its content
            height and push the rows below it out of the rail instead of
            scrolling. Visible as soon as the page is zoomed in. */}
        <ScrollArea className="min-h-0 flex-1">
          <nav className="px-2 py-3" aria-label="Primary">
            {groups.map((group) => (
              <div key={group.eyebrow} className="mb-4 last:mb-0">
                <div className={cn("mb-1.5 px-2 text-[11px] font-medium uppercase tracking-[0.07em] text-fg-5", !isOpen ? "md:hidden" : "")}>
                  {group.eyebrow}
                </div>
                <ul className="space-y-0.5">
                  {group.items.map((item) => (
                    <li key={item.label}>
                      <SidebarItem item={item} collapsed={!isOpen} onNavigate={onMobileClose} onExpand={() => persistCollapsed(false)} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </ScrollArea>

        {/* Section 4 — User footer. Compact rail keeps only the toggle so the
            row fits 64px (previously 4 icons overflowed and pushed the toggle
            out of the rail, making it unclickable). */}
        <div className="flex shrink-0 items-center gap-2 border-t border-border-subtle px-3 py-3">
          <div className={cn("flex items-center gap-2", !isOpen ? "md:hidden" : "")}>
            <Link
              to="/profile"
              aria-label="Profile"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-bg-elev-3 font-mono text-[11px] font-semibold text-fg-1 hover:opacity-80"
              data-testid="user-avatar-link"
            >
              {userName.slice(0, 2).toUpperCase()}
            </Link>
            <div className="flex-1 overflow-hidden">
              <div className="truncate text-[12.5px] font-medium text-fg-1">{userName}</div>
              <div
                className="mt-0.5 inline-flex h-[15px] items-center rounded-sm bg-bg-elev-3 px-1.5 text-[10px] font-medium uppercase tracking-wide text-fg-3"
                data-testid="user-role-pill"
              >
                {userRole}
              </div>
            </div>
            <Link
              to="/settings"
              aria-label="Settings"
              className="flex h-7 w-7 items-center justify-center rounded-md text-fg-3 hover:bg-bg-elev-2 hover:text-fg-1"
              data-testid="user-settings-link"
            >
              <Settings className="h-4 w-4" aria-hidden="true" />
            </Link>
            <button
              type="button"
              aria-label="Log out"
              title="Log out"
              data-testid="user-logout-button"
              className="flex h-7 w-7 items-center justify-center rounded-md text-fg-3 hover:bg-bg-elev-2 hover:text-red"
              onClick={() => {
                // fastapi-users cookie backend: POST clears the session cookie.
                // NOTE: raw fetch, NOT `api.post` — the client prepends /api/v1
                // and the cookie routes live at /auth/* (unprefixed), so the
                // prefixed call 404s and the session cookie never clears.
                void fetch("/auth/cookie/logout", {
                  method: "POST",
                  credentials: "include",
                }).finally(() => {
                  window.location.assign("/login");
                });
              }}
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <button
            type="button"
            aria-label={isOpen ? "Collapse sidebar" : "Expand sidebar"}
            title={isOpen ? "Collapse sidebar" : "Expand sidebar"}
            data-testid="sidebar-collapse-toggle"
            className={cn(
              "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-fg-3 hover:bg-bg-elev-2 hover:text-fg-1",
              !isOpen ? "md:mx-auto" : "",
            )}
            onClick={() => persistCollapsed(!collapsed)}
          >
            {collapsed ? (
              <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
            ) : (
              <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        </div>
        <div className={cn("shrink-0 border-t border-border-subtle px-4 py-2 text-center text-[10px] text-fg-5", !isOpen ? "md:hidden" : "")}>
          © 2026 Suitest contributors · Apache-2.0
        </div>
      </aside>
    </>
  );
}

function SidebarItem({
  item,
  onNavigate,
  collapsed = false,
  onExpand,
}: {
  item: NavItem;
  /** Called after navigating — closes the mobile drawer. */
  onNavigate?: (() => void) | undefined;
  /** Collapsed rail — center the icon, hide the label + badge. */
  collapsed?: boolean;
  /** Re-expand a collapsed rail when a nav item is clicked. */
  onExpand?: (() => void) | undefined;
}): React.ReactElement {
  const Icon = item.icon;
  const baseCls =
    "group flex items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px] text-fg-3 transition-colors hover:bg-bg-elev-2 hover:text-fg-1";
  const collapsedCls = collapsed ? "md:justify-center" : "";
  const labelCls = collapsed ? "md:hidden" : "";

  if (item.disabled) {
    return (
      <div
        aria-disabled="true"
        aria-label={item.label}
        title={collapsed ? item.label : undefined}
        className={cn(baseCls, collapsedCls, "cursor-not-allowed text-fg-5 hover:bg-transparent hover:text-fg-5")}
        data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
        data-disabled="true"
      >
        <Icon className="h-3.5 w-3.5 shrink-0 text-fg-5" aria-hidden="true" />
        <span className={cn("flex-1 truncate", labelCls)}>{item.label}</span>
      </div>
    );
  }
  return (
    <Link
      to={item.to}
      aria-label={item.label}
      title={collapsed ? item.label : undefined}
      className={cn(baseCls, collapsedCls)}
      activeProps={{
        className: cn(baseCls, collapsedCls, "bg-bg-elev-2 text-fg-1 [&_svg]:text-accent"),
      }}
      onClick={() => {
        onNavigate?.();
        // Always lock the rail open on a nav click, even when it was only
        // temporarily open via hover. persistCollapsed(false) is a no-op when
        // already expanded.
        onExpand?.();
      }}
      data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0 text-fg-4" aria-hidden="true" />
      <span className={cn("flex-1 truncate", labelCls)}>{item.label}</span>
      {item.badgeCount !== undefined && item.badgeCount > 0 ? (
        <span
          className={cn("flex h-4 min-w-[16px] items-center justify-center rounded-full bg-bg-elev-3 px-1 font-mono text-[10px] font-semibold text-fg-3", labelCls)}
          data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, "-")}-badge`}
        >
          {item.badgeCount}
        </span>
      ) : null}
      {item.liveDot ? (
        <span
          className="h-1.5 w-1.5 rounded-full bg-accent suitest-pulse"
          data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, "-")}-live-dot`}
          aria-label="active runs"
        />
      ) : null}
    </Link>
  );
}
