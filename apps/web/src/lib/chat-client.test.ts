import { describe, expect, it } from "vitest";

import { stripToolEnvelopes } from "@/lib/chat-client";

describe("stripToolEnvelopes", () => {
  it("drops inline tool JSON but keeps the prose around it", () => {
    const raw =
      'Here is the update:\n{"tool":"case.update_meta","arguments":{"case_id":"TC-1","title":"x"}}\nApprove it please.';
    expect(stripToolEnvelopes(raw)).toBe("Here is the update:\n\nApprove it please.");
  });

  it("handles nested braces and multiple envelopes", () => {
    const raw =
      '{"tool":"case.set_steps","arguments":{"steps":[{"action":"a"},{"action":"b"}]}} done';
    expect(stripToolEnvelopes(raw)).toBe("done");
  });

  it("strips <tool_call> and json fences", () => {
    const raw = '<tool_call>```json\n{"tool":"case.get","arguments":{}}\n```</tool_call>ok';
    expect(stripToolEnvelopes(raw)).toBe("ok");
  });

  it("passes plain prose through untouched", () => {
    expect(stripToolEnvelopes("just a normal answer")).toBe("just a normal answer");
  });

  it("leaves a string that merely mentions a brace alone", () => {
    expect(stripToolEnvelopes("use { and } carefully")).toBe("use { and } carefully");
  });
});
