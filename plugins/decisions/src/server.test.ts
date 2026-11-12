import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createFakePluginHost,
  type FakePluginHost,
  makeMessageDispatchHookContext,
  makePluginAgentConfigurationContext,
} from "@get-bb/plugin-sdk/testing";
import plugin from "./server.js";
import { DECISIONS_RENDERER_ID } from "./contracts.js";
import {
  DISMISSED_MESSAGE,
  TOOL_NAME,
  USER_REPLIED_MESSAGE,
} from "./tool-definition.js";

const THREAD_ID = "thr_test";

const input = {
  headline: "Pick a storage plan",
  decisions: [
    {
      question: "Which database should we use?",
      context: "We need **one** store for the queue.",
      options: [
        { label: "Postgres", does: "Use the shared server." },
        { label: "SQLite", does: "Embed a file per host." },
      ],
      suggested: 1,
    },
    {
      question: "Where do backups go?",
      context: "Backups run every night.",
      options: [
        { label: "S3", does: "Upload to the shared bucket." },
        { label: "Local disk", does: "Keep them on the host." },
      ],
    },
  ],
};

function createHost(): FakePluginHost {
  const host = createFakePluginHost({ pluginId: "decisions" });
  plugin(host.bb as unknown as Parameters<typeof plugin>[0]);
  return host;
}

async function resultText(
  result: Awaited<ReturnType<FakePluginHost["harness"]["callAgentTool"]>>,
): Promise<string> {
  if (typeof result === "string") return result;
  const [part] = result.content;
  if (part?.type !== "text") throw new Error("expected a text result");
  return part.text;
}

async function openCard(host: FakePluginHost) {
  const call = host.harness.callAgentTool(TOOL_NAME, input, {
    threadId: THREAD_ID,
  });
  await vi.waitFor(() =>
    expect(host.harness.pendingInteractions).toHaveLength(1),
  );
  return { call, pending: host.harness.pendingInteractions[0]! };
}

function dispatch(
  host: FakePluginHost,
  overrides: Parameters<typeof makeMessageDispatchHookContext>[0] = {},
) {
  const handler = host.harness.registrations.hooks["message.dispatch"];
  if (handler === null || handler === undefined) {
    throw new Error("message.dispatch hook is not registered");
  }
  return handler(
    makeMessageDispatchHookContext({ thread: { id: THREAD_ID }, ...overrides }),
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe("request_decisions", () => {
  it.each([true, false])(
    "is offered to providers with native questions = %s",
    async (supportsNativeUserQuestion) => {
      const host = createHost();
      const resolved = await host.harness.resolveAgentConfiguration(
        makePluginAgentConfigurationContext({
          provider: {
            id: "claude-code",
            capabilities: { supportsNativeUserQuestion },
          },
        }),
      );
      expect(resolved.tools.map((tool) => tool.name)).toEqual([TOOL_NAME]);
    },
  );

  it("opens a decision card for seven days and returns one line per decision", async () => {
    const host = createHost();
    const { call, pending } = await openCard(host);
    expect(pending.rendererId).toBe(DECISIONS_RENDERER_ID);
    expect(pending.title).toBe("Pick a storage plan");
    expect(pending.timeoutMs).toBe(7 * 24 * 60 * 60 * 1000);

    host.harness.submitInteraction(pending.id, {
      answers: [{ option: 1 }, { text: "  Both, S3 first " }],
    });

    expect(await call).toBe(
      [
        "Decision 1 — Which database should we use?: SQLite",
        "Decision 2 — Where do backups go?: Both, S3 first",
      ].join("\n"),
    );
  });

  it("tells the agent to continue when the user dismisses the card", async () => {
    const host = createHost();
    const { call, pending } = await openCard(host);
    host.harness.cancelInteraction(pending.id);

    const result = await call;
    expect(result).toMatchObject({ isError: true });
    expect(await resultText(result)).toBe(DISMISSED_MESSAGE);
  });

  it("reports an expired card with the configured timeout", async () => {
    vi.useFakeTimers();
    const host = createHost();
    await host.harness.setSettings({ decisionTimeout: "1 hour" });
    const call = host.harness.callAgentTool(TOOL_NAME, input, {
      threadId: THREAD_ID,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(host.harness.pendingInteractions[0]?.timeoutMs).toBe(60 * 60 * 1000);
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

    expect(await resultText(await call)).toContain(
      "expired after about 1 hour",
    );
  });

  it("closes the card when the user writes in the thread", async () => {
    const host = createHost();
    const { call } = await openCard(host);

    expect(dispatch(host)).toEqual({ action: "proceed" });

    const result = await call;
    expect(result).toMatchObject({ isError: true });
    expect(await resultText(result)).toBe(USER_REPLIED_MESSAGE);
    expect(host.harness.pendingInteractions).toHaveLength(0);
  });

  it.each([
    ["an agent message", { initiator: "agent" as const }],
    ["a system message", { initiator: "system" as const }],
    ["a message from another thread", { senderThreadId: "thr_other" }],
    ["a plugin message", { origin: "plugin" as const, originPluginId: "x" }],
    ["another thread", { thread: { id: "thr_elsewhere" } }],
  ])("keeps the card open for %s", async (_name, overrides) => {
    const host = createHost();
    const { pending } = await openCard(host);

    expect(dispatch(host, overrides)).toEqual({ action: "proceed" });

    expect(host.harness.pendingInteractions).toHaveLength(1);
    host.harness.cancelInteraction(pending.id);
  });

  it("keeps the card open when the dispatch drains a message queued before it opened", async () => {
    const host = createHost();
    const { pending } = await openCard(host);
    dispatch(host, { queuedMessages: [{ createdAt: 0 }] });

    expect(host.harness.pendingInteractions).toHaveLength(1);
    host.harness.cancelInteraction(pending.id);
  });
});
