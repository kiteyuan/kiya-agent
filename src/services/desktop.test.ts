import { describe, expect, it } from "vitest";

import { mergeBootstrapStatus } from "@/services/desktop";

describe("mergeBootstrapStatus", () => {
  it("keeps defaults when no overrides are provided", () => {
    expect(mergeBootstrapStatus()).toEqual({
      aria2: "ready",
      localMcp: "ready",
      oauthCallback: "ready",
      piAgentConfig: "generated",
    });
  });

  it("overrides only the provided fields", () => {
    expect(
      mergeBootstrapStatus({
        aria2: "error",
      }),
    ).toEqual({
      aria2: "error",
      localMcp: "ready",
      oauthCallback: "ready",
      piAgentConfig: "generated",
    });
  });
});
