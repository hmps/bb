import { describe, expect, it, vi } from "vitest";
import type { ThreadDecisionSet } from "@bb/domain";
import {
  collectLogLines,
  getHelpOutput,
  runCommand,
  setupCommandOutputTestEnvironment,
  stubServerApi,
  type CommandRegistrar,
} from "../helpers/command-output-harness.js";
import { registerThreadCommands } from "../../commands/thread/index.js";

function makeDecisionSet(
  overrides: Partial<ThreadDecisionSet> = {},
): ThreadDecisionSet {
  return {
    id: "tds_1",
    threadId: "thr_1",
    turnId: null,
    toolCallId: "call_1",
    headline: "Choose the storage and release",
    decisions: [
      {
        question: "Where should records live?",
        context: "Keep **local records** for this prototype.",
        options: [
          { label: "SQLite", does: "Store records locally." },
          { label: "Postgres", does: "Use a shared server." },
        ],
        suggested: 0,
        links: [{ label: "Design", href: "/tmp/design.md" }],
      },
      {
        question: "When should we release?",
        context: "The preview passes its checks.",
        options: [
          { label: "Now", does: "Release the preview." },
          { label: "Later", does: "Wait for more feedback." },
        ],
        suggested: 1,
        links: [],
      },
    ],
    status: "open",
    resolutionRequestId: null,
    resolutionText: null,
    createdAt: 1,
    resolvedAt: null,
    ...overrides,
  };
}

describe("bb thread decisions", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerThreadCommands(program, () => "http://server");

  it("lists open sets by default and prints their IDs, status, count, and headline", async () => {
    const list = vi.fn(async () => [makeDecisionSet()]);
    stubServerApi({ "v1.threads.:id.decisions.$get": list });

    await runCommand(["thread", "decisions", "list", "thr_1"], register);

    expect(list).toHaveBeenCalledWith({
      param: { id: "thr_1" },
      query: { openOnly: "true" },
    });
    const output = collectLogLines(vi.mocked(console.log)).join("\n");
    expect(output).toContain("tds_1");
    expect(output).toContain("open");
    expect(output).toContain("2");
    expect(output).toContain("Choose the storage and release");
  });

  it("lists history as JSON with --all and --self", async () => {
    vi.stubEnv("BB_THREAD_ID", "thr_1");
    const sets = [makeDecisionSet({ status: "dismissed", resolvedAt: 2 })];
    const list = vi.fn(async () => sets);
    stubServerApi({ "v1.threads.:id.decisions.$get": list });

    await runCommand(
      ["thread", "decisions", "list", "--self", "--all", "--json"],
      register,
    );

    expect(list).toHaveBeenCalledWith({
      param: { id: "thr_1" },
      query: { openOnly: "false" },
    });
    expect(JSON.parse(collectLogLines(vi.mocked(console.log))[0])).toEqual(
      sets,
    );
  });

  it("reports an empty list", async () => {
    stubServerApi({ "v1.threads.:id.decisions.$get": async () => [] });
    await runCommand(["thread", "decisions", "list", "thr_1"], register);
    expect(collectLogLines(vi.mocked(console.log))).toEqual([
      "No decision sets found",
    ]);
  });

  it.each([false, true])(
    "shows a closed set, including history (JSON: %s)",
    async (json) => {
      const set = makeDecisionSet({
        status: "answered",
        resolutionText: "Use SQLite.",
        resolvedAt: 2,
      });
      const list = vi.fn(async () => [set]);
      stubServerApi({ "v1.threads.:id.decisions.$get": list });

      await runCommand(
        [
          "thread",
          "decisions",
          "show",
          "tds_1",
          "thr_1",
          ...(json ? ["--json"] : []),
        ],
        register,
      );

      expect(list).toHaveBeenCalledWith({
        param: { id: "thr_1" },
        query: { openOnly: "false" },
      });
      const lines = collectLogLines(vi.mocked(console.log));
      if (json) {
        expect(JSON.parse(lines[0])).toEqual(set);
      } else {
        expect(lines).toEqual([
          "Decision set: tds_1",
          "Thread: thr_1",
          "Status: answered",
          "Headline: Choose the storage and release",
          "",
          "Decision 1 — Where should records live?",
          "Keep **local records** for this prototype.",
          "  1. SQLite (Suggested): Store records locally.",
          "  2. Postgres: Use a shared server.",
          "  Design: /tmp/design.md",
          "",
          "Decision 2 — When should we release?",
          "The preview passes its checks.",
          "  1. Now: Release the preview.",
          "  2. Later (Suggested): Wait for more feedback.",
          "",
          "Answer: Use SQLite.",
        ]);
      }
    },
  );

  it("sends ordered picks and free text with the agent sender through the normal message route", async () => {
    vi.stubEnv("BB_THREAD_ID", "thr_agent");
    const send = vi.fn(async () => ({ ok: true, delivery: "sent" }));
    stubServerApi({
      "v1.threads.:id.decisions.$get": async () => [makeDecisionSet()],
      "v1.threads.:id.send.$post": send,
    });

    await runCommand(
      [
        "thread",
        "decisions",
        "answer",
        "tds_1",
        "thr_1",
        "--pick",
        "2=1",
        "--pick",
        "1=2",
        "--text",
        "  Keep the preview private.  ",
      ],
      register,
    );

    expect(send).toHaveBeenCalledWith({
      param: { id: "thr_1" },
      json: {
        input: [
          {
            type: "text",
            text: "Decision 1 — Where should records live?: Postgres\nDecision 2 — When should we release?: Now\nKeep the preview private.",
            mentions: [],
          },
        ],
        mode: "auto",
        senderThreadId: "thr_agent",
      },
    });
    expect(collectLogLines(vi.mocked(console.log))).toEqual([
      "Thread thr_1 decision answer sent",
    ]);
  });

  it("sends user answers without agent attribution outside a thread", async () => {
    vi.stubEnv("BB_THREAD_ID", "");
    const send = vi.fn(async () => ({ ok: true, delivery: "sent" }));
    stubServerApi({
      "v1.threads.:id.decisions.$get": async () => [makeDecisionSet()],
      "v1.threads.:id.send.$post": send,
    });
    await runCommand(
      [
        "thread",
        "decisions",
        "answer",
        "tds_1",
        "thr_1",
        "--text",
        "Use SQLite.",
      ],
      register,
    );
    expect(send).toHaveBeenCalledWith({
      param: { id: "thr_1" },
      json: {
        input: [{ type: "text", text: "Use SQLite.", mentions: [] }],
        mode: "auto",
      },
    });
  });

  it.each([
    [
      "a partial pick",
      ["--pick", "2=2"],
      "Decision 2 — When should we release?: Later",
    ],
    [
      "an own answer for one decision",
      ["--answer", "1=  Use a file  "],
      "Decision 1 — Where should records live?: Use a file",
    ],
    [
      "free text only",
      ["--text", "Use a file instead."],
      "Use a file instead.",
    ],
  ])(
    "accepts %s and preserves queued delivery in JSON",
    async (_name, flags, text) => {
      vi.stubEnv("BB_THREAD_ID", "thr_1");
      const result = {
        ok: true,
        delivery: "queued",
        queuedMessage: { id: "qm_1", waitingOn: { kind: "thread-busy" } },
      };
      const send = vi.fn(async () => result);
      stubServerApi({
        "v1.threads.:id.decisions.$get": async () => [makeDecisionSet()],
        "v1.threads.:id.send.$post": send,
      });

      await runCommand(
        [
          "thread",
          "decisions",
          "answer",
          "tds_1",
          "--self",
          "--json",
          ...flags,
        ],
        register,
      );

      expect(send).toHaveBeenCalledWith({
        param: { id: "thr_1" },
        json: { input: [{ type: "text", text, mentions: [] }], mode: "auto" },
      });
      expect(JSON.parse(collectLogLines(vi.mocked(console.log))[0])).toEqual({
        threadId: "thr_1",
        ...result,
      });
    },
  );

  it.each([
    [[], "Select an option or provide non-empty text"],
    [["--text", "   "], "Select an option or provide non-empty text"],
    [["--pick", "0=1"], "Invalid --pick"],
    [["--pick", "1=0"], "Invalid --pick"],
    [["--pick", "1.5=2"], "Invalid --pick"],
    [["--pick", "1=2=3"], "Invalid --pick"],
    [["--pick", "3=1"], "Invalid decision index: 3"],
    [["--pick", "1=3"], "Invalid option index for decision 1: 3"],
    [["--pick", "1=1", "--pick", "1=2"], "Decision 1 has multiple picks"],
    [["--answer", "1"], "Invalid --answer"],
    [["--answer", "0=Use a file"], "Invalid --answer"],
    [["--answer", "1=  "], "Decision 1 has an empty answer"],
    [["--answer", "3=Use a file"], "Invalid decision index: 3"],
    [
      ["--pick", "1=1", "--answer", "1=Use a file"],
      "Decision 1 has multiple picks",
    ],
  ])("rejects invalid answers %j before sending", async (flags, error) => {
    const send = vi.fn();
    stubServerApi({
      "v1.threads.:id.decisions.$get": async () => [makeDecisionSet()],
      "v1.threads.:id.send.$post": send,
    });

    await expect(
      runCommand(
        ["thread", "decisions", "answer", "tds_1", "thr_1", ...flags],
        register,
      ),
    ).rejects.toThrow("process.exit:1");
    expect(collectLogLines(vi.mocked(console.error)).join("\n")).toContain(
      error,
    );
    expect(send).not.toHaveBeenCalled();
  });

  it.each(["answered", "superseded", "dismissed"] as const)(
    "rejects an answer to a %s set",
    async (status) => {
      const send = vi.fn();
      stubServerApi({
        "v1.threads.:id.decisions.$get": async () => [
          makeDecisionSet({ status }),
        ],
        "v1.threads.:id.send.$post": send,
      });
      await expect(
        runCommand(
          ["thread", "decisions", "answer", "tds_1", "thr_1", "--pick", "1=1"],
          register,
        ),
      ).rejects.toThrow("process.exit:1");
      expect(collectLogLines(vi.mocked(console.error)).join("\n")).toContain(
        `is ${status}; only open sets can be answered`,
      );
      expect(send).not.toHaveBeenCalled();
    },
  );

  it.each(["show", "answer"])(
    "rejects a missing set in %s",
    async (command) => {
      const send = vi.fn();
      stubServerApi({
        "v1.threads.:id.decisions.$get": async () => [],
        "v1.threads.:id.send.$post": send,
      });
      await expect(
        runCommand(
          ["thread", "decisions", command, "tds_missing", "thr_1"],
          register,
        ),
      ).rejects.toThrow("process.exit:1");
      expect(collectLogLines(vi.mocked(console.error)).join("\n")).toContain(
        "was not found in thread thr_1",
      );
      expect(send).not.toHaveBeenCalled();
    },
  );

  it("dismisses through the SDK and prints the updated set as JSON", async () => {
    const set = makeDecisionSet({ status: "dismissed", resolvedAt: 2 });
    const dismiss = vi.fn(async () => set);
    stubServerApi({
      "v1.threads.:id.decisions.:decisionSetId.dismiss.$post": dismiss,
    });
    await runCommand(
      ["thread", "decisions", "dismiss", "tds_1", "thr_1", "--json"],
      register,
    );
    expect(dismiss).toHaveBeenCalledWith({
      param: { id: "thr_1", decisionSetId: "tds_1" },
    });
    expect(JSON.parse(collectLogLines(vi.mocked(console.log))[0])).toEqual(set);
  });

  it("reports a failed dismissal without claiming success", async () => {
    stubServerApi({
      "v1.threads.:id.decisions.:decisionSetId.dismiss.$post": async () =>
        Response.json({ error: "Decision set not found" }, { status: 404 }),
    });
    await expect(
      runCommand(
        ["thread", "decisions", "dismiss", "tds_1", "thr_1"],
        register,
      ),
    ).rejects.toThrow("process.exit:1");
    expect(collectLogLines(vi.mocked(console.error)).join("\n")).toContain(
      "Decision set not found",
    );
    expect(collectLogLines(vi.mocked(console.log))).toEqual([]);
  });

  it("documents the group and answer flags in help", async () => {
    const group = await getHelpOutput(["thread", "decisions"], register);
    for (const command of ["list", "show", "answer", "dismiss"])
      expect(group).toContain(command);
    const answer = await getHelpOutput(
      ["thread", "decisions", "answer"],
      register,
    );
    for (const flag of [
      "--pick <decision=option>",
      "--answer <decision=text>",
      "--text <text>",
      "--self",
      "--json",
    ])
      expect(answer).toContain(flag);
  });
});
