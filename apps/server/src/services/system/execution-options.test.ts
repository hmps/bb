import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createTestAppHarness,
  type TestAppHarness,
} from "../../../test/helpers/test-app.js";
import {
  COMMAND_TIMEOUT_MS,
  PROVIDER_MODEL_TIMEOUT_MS,
} from "../../constants.js";

const callHostRetryableOnlineRpc = vi.fn();

vi.mock("../hosts/online-rpc.js", () => ({
  callHostRetryableOnlineRpc: (
    ...args: unknown[]
  ): ReturnType<typeof callHostRetryableOnlineRpc> =>
    callHostRetryableOnlineRpc(...args),
}));

let harness: TestAppHarness | undefined;

afterEach(async () => {
  await harness?.cleanup();
  harness = undefined;
  callHostRetryableOnlineRpc.mockReset();
});

describe("PROVIDER_MODEL_TIMEOUT_MS", () => {
  it("exceeds COMMAND_TIMEOUT_MS so a daemon-side retry can still land", () => {
    // The daemon's own inner JSON-RPC timeout is 30s (COMMAND_TIMEOUT_MS
    // mirrors it here; see runtime-json-rpc.ts and bridge.ts
    // MODEL_LIST_TIMEOUT_MS in @bb/agent-runtime, not importable from the
    // server package). The outer budget must stay strictly larger, or the
    // server times out before the daemon's own retry can succeed.
    expect(PROVIDER_MODEL_TIMEOUT_MS).toBeGreaterThan(COMMAND_TIMEOUT_MS);
    expect(PROVIDER_MODEL_TIMEOUT_MS).toBeGreaterThan(30_000);
  });
});

describe("resolveSystemProviderModels", () => {
  it("issues provider.list_models with PROVIDER_MODEL_TIMEOUT_MS, not COMMAND_TIMEOUT_MS", async () => {
    callHostRetryableOnlineRpc.mockResolvedValue({
      models: [],
      selectedOnlyModels: [],
    });

    const { resolveSystemProviderModels } = await import(
      "./execution-options.js"
    );

    harness = await createTestAppHarness();

    await resolveSystemProviderModels(harness.deps, {
      hostId: "host-1",
      providerId: "acp-opencode",
    });

    expect(callHostRetryableOnlineRpc).toHaveBeenCalledTimes(1);
    const [, args] = callHostRetryableOnlineRpc.mock.calls[0] as [
      unknown,
      { timeoutMs: number; command: { type: string } },
    ];
    expect(args.command.type).toBe("provider.list_models");
    expect(args.timeoutMs).toBe(PROVIDER_MODEL_TIMEOUT_MS);
    expect(args.timeoutMs).not.toBe(COMMAND_TIMEOUT_MS);
  });
});
