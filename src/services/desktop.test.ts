import { describe, expect, it } from "vitest";

import {
  mergeBootstrapStatus,
  mergeRemoteMcpServers,
} from "@/services/desktop";

describe("mergeBootstrapStatus", () => {
  it("keeps defaults when no overrides are provided", () => {
    expect(mergeBootstrapStatus()).toEqual({
      aria2: "ready",
      localMcp: "ready",
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
      piAgentConfig: "generated",
    });
  });
});

describe("mergeRemoteMcpServers", () => {
  it("keeps embedded servers enabled and merges saved headers", () => {
    const merged = mergeRemoteMcpServers([
      {
        id: "magnet",
        name: "Magnet",
        enabled: false,
        transport: "streamable-http",
        url: "https://magnet.kiteyuan.info/api/v1/mcp",
        headers: { Authorization: "Bearer test" },
        isEmbedded: true,
      },
    ]);

    const magnet = merged.find((server) => server.id === "magnet");
    expect(magnet?.enabled).toBe(true);
    expect(magnet?.headers).toEqual({ Authorization: "Bearer test" });
    expect(merged.some((server) => server.id === "magnetflow")).toBe(true);
  });

  it("preserves custom servers", () => {
    const merged = mergeRemoteMcpServers([
      {
        id: "custom-1",
        name: "Custom",
        enabled: true,
        transport: "sse",
        url: "https://example.com/mcp",
        headers: {},
        isEmbedded: false,
      },
    ]);

    expect(merged.some((server) => server.id === "custom-1")).toBe(true);
  });
});
