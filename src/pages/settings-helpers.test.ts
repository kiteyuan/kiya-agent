import { describe, expect, it } from "vitest";

import {
  canTestModel,
  getMcpToken,
  parseHeaders,
  updateMcpTokenHeaders,
} from "@/pages/settings-helpers";
import type { LocalConfig } from "@/types/app";

describe("settings helpers", () => {
  it("parses bearer tokens from headers", () => {
    expect(getMcpToken({ Authorization: "Bearer abc123" })).toBe("abc123");
  });

  it("updates authorization headers from token input", () => {
    expect(updateMcpTokenHeaders({ "X-Trace": "1" }, " tok ")).toEqual({
      "X-Trace": "1",
      Authorization: "Bearer tok",
    });
  });

  it("parses request header JSON", () => {
    expect(parseHeaders('{"Authorization":"Bearer x"}')).toEqual({
      Authorization: "Bearer x",
    });
  });

  it("requires api key and model name before testing", () => {
    const base: LocalConfig = {
      language: "zh-CN",
      downloadDir: "C:/Downloads",
      remoteMcpServers: [],
      localMcpPort: 1,
      aria2RpcPort: 1,
      modelProvider: "deepseek",
      modelName: "deepseek-v4-flash",
      modelApiKey: "",
      modelBaseUrl: "",
      autoApproveTools: true,
    };

    expect(canTestModel(base)).toBe(false);
    expect(canTestModel({ ...base, modelApiKey: "sk-test" })).toBe(true);
  });
});
