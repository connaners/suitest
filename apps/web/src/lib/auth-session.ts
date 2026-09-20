import { useActiveProject } from "@/stores/use-active-project";
import { useActiveWorkspace } from "@/stores/use-active-workspace";

export type LogoutReason = "removed" | "left" | "expired";

export type AuthBroadcastMessage =
  | { type: "logout"; reason?: LogoutReason }
  | { type: "workspace_switched"; newWorkspaceId: string };

const BROADCAST_CHANNEL_NAME = "suitest_auth_channel";

let isLoggingOut = false;

/**
 * Broadcasts a workspace switch event to all other open tabs in the browser.
 */
export function broadcastWorkspaceSwitch(newWorkspaceId: string): void {
  try {
    if (typeof window !== "undefined" && typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
      channel.postMessage({
        type: "workspace_switched",
        newWorkspaceId,
      } satisfies AuthBroadcastMessage);
      channel.close();
    }
  } catch {
    // Ignore BroadcastChannel errors in environments that don't support it
  }
}

/**
 * Cleanly terminates the current workspace/auth session across all open tabs,
 * clears local active workspace and active project stores, and redirects to /login.
 */
export async function logoutAndRedirect(reason?: LogoutReason): Promise<void> {
  if (isLoggingOut) return;
  isLoggingOut = true;

  // Broadcast to other tabs so they synchronize and redirect immediately
  try {
    if (typeof window !== "undefined" && typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
      channel.postMessage({ type: "logout", ...(reason !== undefined ? { reason } : {}) } satisfies AuthBroadcastMessage);
      channel.close();
    }
  } catch {
    // Ignore BroadcastChannel errors in environments that don't support it
  }

  // Clear local stores
  try {
    useActiveWorkspace.getState().setWorkspaceId(null);
    useActiveProject.getState().setProjectId(null);
  } catch {
    // Ignore store reset errors
  }

  // fastapi-users cookie backend: POST clears the HTTP-only session cookie
  try {
    await fetch("/auth/cookie/logout", {
      method: "POST",
      credentials: "include",
    });
  } catch {
    // Network or server error on logout shouldn't prevent client redirect
  }

  if (typeof window !== "undefined") {
    const query = reason ? `?reason=${encodeURIComponent(reason)}` : "";
    try {
      window.location.assign(`/login${query}`);
    } catch {
      // jsdom in tests does not implement navigation
    }
  }
}

/**
 * Initializes multi-tab authentication broadcast sync.
 * Listens for logout and workspace switch events triggered from other tabs.
 */
export function initAuthBroadcastSync(
  onWorkspaceSwitched?: (newWorkspaceId: string) => void,
): () => void {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") {
    return () => {};
  }

  const channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
  channel.onmessage = (event: MessageEvent<AuthBroadcastMessage>) => {
    if (event.data?.type === "logout") {
      try {
        useActiveWorkspace.getState().setWorkspaceId(null);
        useActiveProject.getState().setProjectId(null);
      } catch {
        // Ignore store reset errors
      }
      const query = event.data.reason ? `?reason=${encodeURIComponent(event.data.reason)}` : "";
      try {
        window.location.assign(`/login${query}`);
      } catch {
        // jsdom in tests
      }
    } else if (event.data?.type === "workspace_switched") {
      const newWsId = event.data.newWorkspaceId;
      try {
        useActiveWorkspace.getState().setWorkspaceId(newWsId);
        useActiveProject.getState().setProjectId(null);
      } catch {
        // Ignore store reset errors
      }
      if (onWorkspaceSwitched) {
        onWorkspaceSwitched(newWsId);
      } else {
        try {
          window.location.assign("/dashboard");
        } catch {
          // jsdom in tests
        }
      }
    }
  };

  return () => {
    channel.close();
  };
}
