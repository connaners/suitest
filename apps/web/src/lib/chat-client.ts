import { useActiveWorkspace } from "@/stores/use-active-workspace";

// ---------------------------------------------------------------------------
// Agent conversation (chat) client (M3-12 / M3-13).
//
// `POST /agent/chat` streams the assistant reply as SSE token frames; axios
// buffers the whole response, so we drive it with `fetch` + a manual SSE frame
// parser (same approach as the deterministic generator client). Tool-call
// requests arrive as a `tool` frame (also mirrored on the WS gateway).
// ---------------------------------------------------------------------------

export interface ChatMessageInput {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
}

/**
 * Strip inline tool-call syntax from an assistant turn before display: the model
 * sometimes narrates its calls as bare `{"tool": …}` JSON (or `<tool_call>` /
 * ```json fences). The structured `tool` SSE frame is what drives the confirm
 * card, so the raw JSON is just noise in the bubble.
 */
export function stripToolEnvelopes(raw: string): string {
  const text = raw
    .replaceAll("<tool_call>", "")
    .replaceAll("</tool_call>", "")
    .replaceAll("```json", "")
    .replaceAll("```", "");

  let out = "";
  let i = 0;
  while (i < text.length) {
    if (text[i] === "{" && /^\{\s*"tool"\s*:/.test(text.slice(i, i + 48))) {
      // Walk to the matching close brace (string-aware) and drop the object.
      let depth = 0;
      let inStr = false;
      let esc = false;
      let j = i;
      for (; j < text.length; j += 1) {
        const ch = text[j];
        if (inStr) {
          if (esc) esc = false;
          else if (ch === "\\") esc = true;
          else if (ch === '"') inStr = false;
        } else if (ch === '"') {
          inStr = true;
        } else if (ch === "{") {
          depth += 1;
        } else if (ch === "}") {
          depth -= 1;
          if (depth === 0) {
            j += 1;
            break;
          }
        }
      }
      i = j; // an unterminated object (mid-stream) swallows the rest until it completes
    } else {
      out += text[i];
      i += 1;
    }
  }
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

export interface ChatToolEvent {
  tool: string;
  arguments: Record<string, unknown>;
  agent_session_id: string;
}

export interface ChatDoneEvent {
  agent_session_id: string;
  content: string;
  tokens_out: number;
}

export interface ChatStreamHandlers {
  onProgress?: (sessionId: string) => void;
  onToken?: (delta: string) => void;
  onTool?: (event: ChatToolEvent) => void;
  onDone?: (event: ChatDoneEvent) => void;
  onError?: (message: string) => void;
}

const isTestEnv = typeof process !== "undefined" && process.env["NODE_ENV"] === "test";
const SSE_BASE = isTestEnv ? "http://localhost/api/v1" : "/api/v1";

/** Replay a stored conversation: [{role, content}, ...] in order. */
export async function fetchChatHistory(sessionId: string): Promise<ChatMessageInput[]> {
  const wsId = useActiveWorkspace.getState().workspaceId;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (wsId) headers["X-Workspace-Id"] = wsId;
  const res = await fetch(`${SSE_BASE}/agent/chat/${sessionId}/history`, { headers });
  if (!res.ok) return [];
  const body = (await res.json()) as { role: string; content: string }[];
  return body.map((m) => ({ role: m.role as ChatMessageInput["role"], content: m.content }));
}

function streamHeaders(): HeadersInit {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const wsId = useActiveWorkspace.getState().workspaceId;
  if (wsId) headers["X-Workspace-Id"] = wsId;
  return headers;
}

function dispatchFrame(block: string, handlers: ChatStreamHandlers): void {
  let eventName = "message";
  const dataLines: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) eventName = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return;
  const data = JSON.parse(dataLines.join("\n")) as Record<string, unknown>;
  switch (eventName) {
    case "progress":
      handlers.onProgress?.(String(data["agent_session_id"] ?? ""));
      break;
    case "token":
      handlers.onToken?.(String(data["delta"] ?? ""));
      break;
    case "tool":
      handlers.onTool?.(data as unknown as ChatToolEvent);
      break;
    case "done":
      handlers.onDone?.(data as unknown as ChatDoneEvent);
      break;
    case "error":
      handlers.onError?.(String(data["message"] ?? "Chat failed."));
      break;
    default:
      break;
  }
}

/** Stream a conversation-mode reply over SSE. */
export async function streamChat(
  messages: ChatMessageInput[],
  handlers: ChatStreamHandlers,
  signal?: AbortSignal,
  options?: { approvedTool?: ChatToolEvent | null; sessionId?: string | null },
): Promise<void> {
  const body: Record<string, unknown> = { messages };
  if (options?.sessionId) body["session_id"] = options.sessionId;
  if (options?.approvedTool) {
    body["approved_tool"] = {
      tool: options.approvedTool.tool,
      arguments: options.approvedTool.arguments,
    };
  }
  const res = await fetch(`${SSE_BASE}/agent/chat`, {
    method: "POST",
    headers: streamHeaders(),
    credentials: "include",
    body: JSON.stringify(body),
    signal: signal ?? null,
  });

  if (!res.ok || res.body === null) {
    let message = `Chat request failed (${res.status})`;
    if (res.status === 409) message = "Configure an LLM in Settings → LLM to chat with the agent.";
    try {
      const parsed = (await res.json()) as { detail?: string; message?: string };
      message = parsed.detail ?? parsed.message ?? message;
    } catch {
      /* non-JSON body — keep the generic message */
    }
    handlers.onError?.(message);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep = buffer.indexOf("\n\n");
    while (sep !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      if (frame.trim().length > 0) dispatchFrame(frame, handlers);
      sep = buffer.indexOf("\n\n");
    }
  }
  if (buffer.trim().length > 0) dispatchFrame(buffer, handlers);
}
