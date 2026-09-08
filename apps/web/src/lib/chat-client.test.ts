import { describe, expect, it } from "vitest";

import { stripToolEnvelopes } from "@/lib/chat-client";

describe("stripToolEnvelopes", () => {
  it("drops a tool-envelope line but keeps the prose around it", () => {
    const raw = [
      "Here is the update:",
      '{"tool":"case.update_meta","arguments":{"case_id":"TC-1","title":"x"}}',
      "Approve it please.",
    ].join("\n");
    expect(stripToolEnvelopes(raw)).toBe("Here is the update:\nApprove it please.");
  });

  it("drops an envelope line with nested braces", () => {
    const raw = [
      "steps:",
      '{"tool":"case.set_steps","arguments":{"steps":[{"action":"a"},{"action":"b"}]}}',
      "done",
    ].join("\n");
    expect(stripToolEnvelopes(raw)).toBe("steps:\ndone");
  });

  it("strips <tool_call> and json fences", () => {
    const raw = '<tool_call>```json\n{"tool":"case.get","arguments":{}}\n```</tool_call>ok';
    expect(stripToolEnvelopes(raw)).toBe("ok");
  });

  it("passes plain prose through untouched", () => {
    expect(stripToolEnvelopes("just a normal answer")).toBe("just a normal answer");
  });

  it("leaves a line that merely mentions a brace alone", () => {
    expect(stripToolEnvelopes("use { and } carefully")).toBe("use { and } carefully");
  });
});
