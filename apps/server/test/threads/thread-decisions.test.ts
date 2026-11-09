import {
  archiveThread,
  createThreadDecisionSet,
  deleteThread,
  getThread,
  listEvents,
  listOpenThreadDecisionSets,
  listThreadDecisionSets,
  listQueuedThreadMessages,
  setExperiments,
  updateThread,
} from "@bb/db";
import { describe, expect, it } from "vitest";
import {
  defaultAppSettings,
  type Thread,
  type ThreadChangedMessage,
} from "@bb/domain";
import { applyLoggedThreadLifecycleEvent } from "../../src/services/threads/lifecycle-outcome.js";
import { attemptDispatch } from "../../src/services/threads/dispatch-attempt.js";
import { acceptThreadSendRequest } from "../../src/services/threads/thread-send-request.js";
import {
  createQueuedMessageForThread,
  sendQueuedMessageNow,
} from "../../src/services/threads/queued-messages.js";
import { queueParentSystemMessage } from "../../src/services/threads/parent-system-messages.js";
import {
  handleRequestDecisionsToolCall,
  resolveOpenDecisionsForUserMessage,
} from "../../src/services/threads/thread-decisions.js";
import { resolveThreadRuntimeCommandConfig } from "../../src/services/threads/thread-runtime-config.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedThreadRuntimeState,
  seedTurnStarted,
} from "../helpers/seed.js";
import { textInput } from "../helpers/prompt-input.js";
import { internalAuthHeaders } from "../helpers/commands.js";
import { registerHostRpcResponder } from "../helpers/host-rpc.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const decisionInput = {
  headline: "Choose storage",
  decisions: [
    {
      question: "Which storage?",
      context: "SQLite keeps the change small.",
      options: [
        { label: "SQLite", does: "Store locally." },
        { label: "Postgres", does: "Use the server." },
      ],
      suggested: 0,
      links: [],
    },
  ],
};
const answerText = "Decision 1 — Which storage?: SQLite";
const payload = {
  input: textInput(answerText),
  mode: "queue-if-active" as const,
  model: "gpt-5",
  permissionMode: "full" as const,
  reasoningLevel: "medium" as const,
  serviceTier: "default" as const,
};

function seed(
  harness: TestAppHarness,
  status: "idle" | "active" = "idle",
  providerId = "codex",
) {
  const { host, session } = seedHostSession(harness.deps, {
    id: "host-decisions",
  });
  const { project } = seedProjectWithSource(harness.deps, { hostId: host.id });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
  });
  const thread = seedThread(harness.deps, {
    projectId: project.id,
    environmentId: environment.id,
    providerId,
    status,
  });
  seedThreadRuntimeState(harness.deps, {
    environmentId: environment.id,
    providerThreadId: "provider-decisions",
    threadId: thread.id,
  });
  return { host, session, project, environment, thread };
}

function open(harness: TestAppHarness, thread: Thread) {
  return createThreadDecisionSet(harness.db, {
    ...decisionInput,
    threadId: thread.id,
    turnId: "turn-decisions",
    toolCallId: "call-decisions",
  });
}

function current(harness: TestAppHarness, thread: Thread) {
  return listThreadDecisionSets(harness.db, { threadId: thread.id })[0]!;
}

function expectAnswered(
  harness: TestAppHarness,
  thread: Thread,
  requestRef?: string,
) {
  expect(current(harness, thread)).toMatchObject({
    status: "answered",
    resolutionText: answerText,
    ...(requestRef ? { resolutionRequestId: requestRef } : {}),
  });
  expect(current(harness, thread).resolutionRequestId).toBeTruthy();
  expect(listOpenThreadDecisionSets(harness.db, thread.id)).toEqual([]);
}

describe("decision tool and routes", () => {
  it.each([false, true])(
    "uses the effective decision experiment on unrelated updates (%s)",
    async (enabled) => {
      await withTestHarness(async (harness) => {
        const { thread } = seed(harness);
        setExperiments(harness.db, { decisionCards: enabled });
        open(harness, thread);
        const response = await harness.app.request(
          "/api/v1/settings/experiments",
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({}),
          },
        );
        expect(response.status).toBe(200);
        expect(current(harness, thread).status).toBe(
          enabled ? "open" : "dismissed",
        );
      });
    },
  );

  it.each(["codex", "claude-code"])(
    "records %s tool calls through the existing daemon endpoint and rejects retained calls when off",
    async (providerId) => {
      await withTestHarness(async (harness) => {
        const { session, thread } = seed(harness, "idle", providerId);
        const call = () =>
          harness.app.request("/internal/session/tool-call", {
            method: "POST",
            headers: internalAuthHeaders(harness),
            body: JSON.stringify({
              sessionId: session.id,
              threadId: thread.id,
              providerThreadId: "provider-decisions",
              turnId: "turn-decisions",
              callId: "call-decisions",
              tool: "request_decisions",
              arguments: decisionInput,
            }),
          });
        expect(await (await call()).json()).toMatchObject({
          success: false,
          contentItems: [
            { text: "Decision cards are off; ask in your reply." },
          ],
        });
        setExperiments(harness.db, { decisionCards: true });
        expect(await (await call()).json()).toMatchObject({ success: true });
        const set = current(harness, thread);
        expect(set).toMatchObject({
          status: "open",
          toolCallId: "call-decisions",
          headline: decisionInput.headline,
        });
        const listed = await harness.app.request(
          `/api/v1/threads/${thread.id}/decisions`,
        );
        expect(await listed.json()).toMatchObject([
          { id: set.id, status: "open" },
        ]);
        const detail = await harness.app.request(
          `/api/v1/threads/${thread.id}`,
        );
        expect(await detail.json()).toMatchObject({ hasOpenDecisions: true });
        const disabled = await harness.app.request(
          "/api/v1/settings/experiments",
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ decisionCards: false }),
          },
        );
        expect(disabled.status).toBe(200);
        expect(current(harness, thread).status).toBe("dismissed");
        expect(await (await call()).json()).toMatchObject({ success: false });
        expect(
          await (
            await harness.app.request(`/api/v1/threads/${thread.id}/decisions`)
          ).json(),
        ).toEqual([]);
      });
    },
  );

  it.each([false, true])(
    "dismisses on early-adopter disable unless explicitly enabled (%s)",
    async (explicitlyEnabled) => {
      await withTestHarness(async (harness) => {
        const { thread } = seed(harness);
        const updateEarlyAdopter = (earlyAdopter: boolean) =>
          harness.app.request("/api/v1/settings/general", {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ ...defaultAppSettings, earlyAdopter }),
          });
        expect((await updateEarlyAdopter(true)).status).toBe(200);
        if (explicitlyEnabled)
          setExperiments(harness.db, { decisionCards: true });
        open(harness, thread);
        expect((await updateEarlyAdopter(false)).status).toBe(200);
        expect(current(harness, thread).status).toBe(
          explicitlyEnabled ? "open" : "dismissed",
        );
        const detail = await harness.app.request(
          `/api/v1/threads/${thread.id}`,
        );
        expect(await detail.json()).toMatchObject({
          hasOpenDecisions: explicitlyEnabled,
        });
      });
    },
  );

  it("offers the dynamic tool only when the experiment is on", async () => {
    await withTestHarness(async (harness) => {
      const { thread, environment } = seed(harness);
      const config = () =>
        resolveThreadRuntimeCommandConfig(harness.deps, {
          thread,
          model: "gpt-5",
          environment,
        });
      expect(
        (await config()).dynamicTools.map((tool) => tool.name),
      ).not.toContain("request_decisions");
      setExperiments(harness.db, { decisionCards: true });
      expect(
        (await config()).dynamicTools.find(
          (tool) => tool.name === "request_decisions",
        ),
      ).toMatchObject({
        inputSchema: { additionalProperties: false },
        presentation: {
          label: {
            pending: "Asking for decisions",
            completed: "Asked for decisions",
          },
        },
      });
    });
  });

  it("returns a fixable input error and scopes dismissal to the requested thread", async () => {
    await withTestHarness(async (harness) => {
      const { thread, project } = seed(harness);
      setExperiments(harness.db, { decisionCards: true });
      expect(
        handleRequestDecisionsToolCall(harness.deps, {
          input: {
            ...decisionInput,
            decisions: [{ ...decisionInput.decisions[0], suggested: 2 }],
          },
          threadId: thread.id,
          turnId: "turn",
          toolCallId: "call",
        }),
      ).toMatchObject({
        success: false,
        contentItems: [{ text: expect.stringContaining("Suggested must") }],
      });
      expect(listOpenThreadDecisionSets(harness.db, thread.id)).toEqual([]);
      const set = open(harness, thread);
      const other = seedThread(harness.deps, { projectId: project.id });
      expect(
        (
          await harness.app.request(
            `/api/v1/threads/${other.id}/decisions/${set.id}/dismiss`,
            { method: "POST" },
          )
        ).status,
      ).toBe(404);
      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/decisions/${set.id}/dismiss`,
        { method: "POST" },
      );
      expect(await response.json()).toMatchObject({
        id: set.id,
        status: "dismissed",
      });
      expect(
        await (
          await harness.app.request(
            `/api/v1/threads/${thread.id}/decisions?openOnly=false`,
          )
        ).json(),
      ).toMatchObject([{ id: set.id, status: "dismissed" }]);
    });
  });
});

describe("decision resolution at acceptance", () => {
  for (const kind of [
    "immediate",
    "automatic queue",
    "explicit queue",
  ] as const) {
    const sources =
      kind === "explicit queue"
        ? (["agent-only", "composer", "mixed"] as const)
        : (["plugin", "agent-only", "composer", "mixed"] as const);
    it.each(sources)(
      `checks %s input at ${kind} acceptance`,
      async (source) => {
        await withTestHarness(async (harness) => {
          const { thread } = seed(
            harness,
            kind === "immediate" ? "idle" : "active",
          );
          const set = open(harness, thread);
          const agentOnly = textInput("Workflow finished").map((item) => ({
            ...item,
            visibility: "agent-only" as const,
          }));
          const request = {
            ...payload,
            input:
              source === "agent-only"
                ? agentOnly
                : source === "mixed"
                  ? [...agentOnly, ...payload.input]
                  : payload.input,
            ...(source === "plugin" ? { originPluginId: "workflows" } : {}),
            ...(source === "composer"
              ? {
                  pluginSubmission: {
                    pluginId: "composer",
                    data: { kind: "answer" },
                  },
                }
              : {}),
          };
          if (kind === "explicit queue") {
            await createQueuedMessageForThread(harness.deps, {
              thread,
              payload: request,
            });
          } else {
            await acceptThreadSendRequest(harness.deps, {
              thread,
              payload: request,
            });
          }
          if (source === "plugin" || source === "agent-only") {
            expect(
              listOpenThreadDecisionSets(harness.db, thread.id).map(
                (row) => row.id,
              ),
            ).toEqual([set.id]);
          } else {
            expect(current(harness, thread).status).toBe("answered");
            expect(listOpenThreadDecisionSets(harness.db, thread.id)).toEqual(
              [],
            );
          }
        });
      },
    );
  }

  it("dismisses open decisions when /clear succeeds", async () => {
    await withTestHarness(async (harness) => {
      const { thread, host, session } = seed(harness);
      open(harness, thread);
      const changes: string[] = [];
      harness.hub.onChangedMessage((message) => {
        if (message.entity === "thread") changes.push(...message.changes);
      });
      const responder = registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: async () => ({
          ok: true,
          result: { providerCheckpointId: null },
        }),
      });
      try {
        await acceptThreadSendRequest(harness.deps, {
          thread,
          payload: {
            ...payload,
            input: [
              {
                type: "text",
                text: "/clear",
                mentions: [
                  {
                    start: 0,
                    end: 6,
                    resource: {
                      kind: "command",
                      trigger: "/",
                      name: "clear",
                      source: "command",
                      origin: "builtin",
                      label: "/clear",
                      argumentHint: null,
                    },
                  },
                ],
              },
            ],
          },
        });
      } finally {
        responder.unregister();
      }
      expect(current(harness, thread).status).toBe("dismissed");
      expect(changes).toContain("decisions-changed");
    });
  });

  it.each(["none", "open", "answered", "dismissed"] as const)(
    "reopens a deleted queued answer only without a newer set (%s)",
    async (newerStatus) => {
      await withTestHarness(async (harness) => {
        setExperiments(harness.db, { decisionCards: true });
        const { thread } = seed(harness, "active");
        const set = open(harness, thread);
        const queued = await createQueuedMessageForThread(harness.deps, {
          thread,
          payload,
        });
        let newerId: string | null = null;
        if (newerStatus !== "none") {
          const newer = open(harness, thread);
          newerId = newer.id;
          if (newerStatus === "answered") {
            await createQueuedMessageForThread(harness.deps, {
              thread,
              payload,
            });
          } else if (newerStatus === "dismissed") {
            await harness.app.request(
              `/api/v1/threads/${thread.id}/decisions/${newer.id}/dismiss`,
              { method: "POST" },
            );
          }
        }
        const changes: ThreadChangedMessage[] = [];
        harness.hub.onChangedMessage((message) => {
          if (
            message.entity === "thread" &&
            message.changes.includes("decisions-changed")
          )
            changes.push(message);
        });
        const response = await harness.app.request(
          `/api/v1/threads/${thread.id}/queued-messages/${queued.id}`,
          { method: "DELETE" },
        );
        expect(response.status).toBe(200);
        const restored = listThreadDecisionSets(harness.db, {
          threadId: thread.id,
        }).find((row) => row.id === set.id)!;
        expect(restored).toMatchObject(
          newerId === null
            ? {
                status: "open",
                resolutionRequestId: null,
                resolutionText: null,
                resolvedAt: null,
              }
            : { status: "answered", resolutionRequestId: queued.id },
        );
        expect(changes).toHaveLength(newerId === null ? 1 : 0);
        if (newerId === null)
          expect(changes[0]?.metadata?.hasOpenDecisions).toBe(true);
        expect(
          listQueuedThreadMessages(harness.db, thread.id).some(
            (row) => row.id === queued.id,
          ),
        ).toBe(false);
      });
    },
  );

  it.each(["immediate", "automatic queue", "explicit queue"] as const)(
    "answers at %s acceptance and records its request reference",
    async (kind) => {
      await withTestHarness(async (harness) => {
        const { thread } = seed(
          harness,
          kind === "immediate" ? "idle" : "active",
        );
        open(harness, thread);
        if (kind === "explicit queue") {
          const queued = await createQueuedMessageForThread(harness.deps, {
            thread,
            payload,
          });
          expectAnswered(harness, thread, queued.id);
        } else {
          const result = await acceptThreadSendRequest(harness.deps, {
            thread,
            payload,
          });
          expect(result.delivery).toBe(
            kind === "immediate" ? "sent" : "queued",
          );
          const queued = listQueuedThreadMessages(harness.db, thread.id)[0];
          expectAnswered(harness, thread, queued?.id);
          if (kind === "immediate") {
            const request = listEvents(harness.db, {
              threadId: thread.id,
            })
              .reverse()
              .find((event) => event.type === "client/turn/requested");
            expect(JSON.parse(request?.data ?? "null")).toMatchObject({
              requestId: current(harness, thread).resolutionRequestId,
            });
          }
        }
      });
    },
  );

  it("answers reprovisioning acceptance with the persisted request id", async () => {
    await withTestHarness(async (harness) => {
      const { thread, project, host } = seed(harness);
      const environment = seedEnvironment(harness.deps, {
        projectId: project.id,
        hostId: host.id,
        path: "/tmp/reprovision-decisions",
        status: "error",
        environmentProviderId: "project-checkout",
      });
      updateThread(harness.db, harness.hub, thread.id, {
        environmentId: environment.id,
      });
      const updated = getThread(harness.db, thread.id)!;
      open(harness, updated);
      await acceptThreadSendRequest(harness.deps, { thread: updated, payload });
      expectAnswered(harness, updated);
      expect(
        JSON.parse(
          listEvents(harness.db, { threadId: thread.id })
            .reverse()
            .find((event) => event.type === "client/turn/requested")?.data ??
            "null",
        ),
      ).toMatchObject({
        requestId: current(harness, updated).resolutionRequestId,
      });
    });
  });

  it("keeps decisions open and emits no decision change when acceptance rolls back", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seed(harness);
      open(harness, thread);
      const changes: string[] = [];
      harness.hub.onChangedMessage((message) => {
        if (message.entity === "thread") changes.push(...message.changes);
      });
      expect(() =>
        harness.db.transaction((tx) => {
          resolveOpenDecisionsForUserMessage(
            tx,
            {
              threadId: thread.id,
              requestRef: "rejected",
              input: payload.input,
            },
            harness.hub,
          );
          throw new Error("rollback");
        }),
      ).toThrow("rollback");
      expect(current(harness, thread).status).toBe("open");
      expect(changes).not.toContain("decisions-changed");
      harness.db.$client.exec(
        "CREATE TEMP TRIGGER reject_request BEFORE INSERT ON events WHEN NEW.type = 'client/turn/requested' BEGIN SELECT RAISE(ABORT, 'reject request'); END",
      );
      await expect(
        acceptThreadSendRequest(harness.deps, { thread, payload }),
      ).rejects.toThrow();
      expect(current(harness, thread).status).toBe("open");
    });
  });

  it.each(["drain", "requeue"] as const)(
    "does not answer a newer set on queue %s",
    async (kind) => {
      await withTestHarness(async (harness) => {
        const { thread } = seed(harness, "active");
        open(harness, thread);
        const queued = await createQueuedMessageForThread(harness.deps, {
          thread,
          payload,
        });
        const newer = open(harness, thread);
        if (kind === "drain")
          seedTurnStarted(harness.deps, {
            threadId: thread.id,
            turnId: "turn-active",
            environmentId: thread.environmentId,
            providerThreadId: "provider-decisions",
          });
        await sendQueuedMessageNow(harness.deps, {
          threadId: thread.id,
          mode: "steer",
          queuedMessageId: queued.id,
        });
        expect(
          listOpenThreadDecisionSets(harness.db, thread.id).map(
            (row) => row.id,
          ),
        ).toEqual([newer.id]);
        expect(listQueuedThreadMessages(harness.db, thread.id)).toHaveLength(
          kind === "drain" ? 0 : 1,
        );
      });
    },
  );

  it.each(["automatic", "explicit"] as const)(
    "rolls back %s queue acceptance when decision resolution fails",
    async (kind) => {
      await withTestHarness(async (harness) => {
        const { thread } = seed(harness, "active");
        const set = open(harness, thread);
        harness.db.$client.exec(
          "CREATE TEMP TRIGGER reject_answer AFTER UPDATE ON thread_decisions WHEN NEW.status = 'answered' BEGIN SELECT RAISE(ABORT, 'reject answer'); END",
        );
        const send =
          kind === "automatic"
            ? acceptThreadSendRequest(harness.deps, { thread, payload })
            : createQueuedMessageForThread(harness.deps, { thread, payload });
        await expect(send).rejects.toThrow("reject answer");
        expect(listQueuedThreadMessages(harness.db, thread.id)).toEqual([]);
        expect(
          listOpenThreadDecisionSets(harness.db, thread.id).map(
            (row) => row.id,
          ),
        ).toEqual([set.id]);
      });
    },
  );

  it.each(["agent", "system", "operation"] as const)(
    "does not answer on %s dispatch",
    async (kind) => {
      await withTestHarness(async (harness) => {
        const { thread, project, environment } = seed(harness);
        const sender = seedThread(harness.deps, { projectId: project.id });
        const set = open(harness, thread);
        await attemptDispatch(harness.deps, {
          thread,
          payload: {
            ...payload,
            ...(kind === "agent" ? { senderThreadId: sender.id } : {}),
          },
          source:
            kind === "operation"
              ? { kind: "operation", environment }
              : { kind: "inline" },
          queuePayload: { kind: "inline" },
          pluginSubmission: null,
          systemNotice: null,
          origin: null,
          originPluginId: null,
          startedOnBehalfOf:
            kind === "system"
              ? { initiator: "system", senderThreadId: sender.id }
              : null,
          trigger: "user",
        });
        expect(
          listOpenThreadDecisionSets(harness.db, thread.id).map(
            (row) => row.id,
          ),
        ).toEqual([set.id]);
      });
    },
  );

  it("does not answer when a parent system notice is queued", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seed(harness, "active");
      open(harness, thread);
      await queueParentSystemMessage(harness.deps, {
        parentThreadId: thread.id,
        input: textInput("Child finished"),
        systemMessageKind: "child-completed",
        systemMessageSubject: null,
      });
      expect(current(harness, thread).status).toBe("open");
    });
  });
});

for (const parentNotifications of ["auto", "stuck", "off"] as const) {
  describe(`parent decision refresh (${parentNotifications})`, () => {
    it.each([null, "fork"] as const)(
      "refreshes old and new parents for child lifecycle changes with origin %s",
      async (originKind) => {
        await withTestHarness(async (harness) => {
          const { thread: parent, project } = seed(harness);
          const other = seedThread(harness.deps, { projectId: project.id });
          open(harness, parent);
          open(harness, other);
          const notices: ThreadChangedMessage[] = [];
          harness.hub.onChangedMessage((message) => {
            if (
              message.entity === "thread" &&
              message.changes.includes("decisions-changed")
            )
              notices.push(message);
          });
          const child = seedThread(harness.deps, {
            projectId: project.id,
            parentThreadId: parent.id,
            parentNotifications,
            originKind,
          });
          if (originKind === "fork")
            updateThread(harness.db, harness.hub, child.id, {
              parentThreadId: parent.id,
            });
          const latestFlag = (id: string) =>
            notices.filter((message) => message.id === id).at(-1)?.metadata
              ?.hasOpenDecisions;
          const change = (
            type: "run.preparing" | "run.started" | "run.succeeded",
          ) =>
            applyLoggedThreadLifecycleEvent(harness.deps, {
              threadId: child.id,
              event: { type },
            });
          change("run.preparing");
          expect(latestFlag(parent.id)).toBe(false);
          change("run.started");
          change("run.succeeded");
          expect(latestFlag(parent.id)).toBe(true);
          change("run.preparing");
          updateThread(harness.db, harness.hub, child.id, {
            parentThreadId: other.id,
          });
          expect(latestFlag(parent.id)).toBe(true);
          expect(latestFlag(other.id)).toBe(false);
          archiveThread(harness.db, harness.hub, child.id);
          expect(latestFlag(other.id)).toBe(true);
          const running = seedThread(harness.deps, {
            projectId: project.id,
            parentThreadId: parent.id,
            status: "active",
            parentNotifications,
          });
          expect(latestFlag(parent.id)).toBe(false);
          deleteThread(harness.db, harness.hub, running.id);
          expect(latestFlag(parent.id)).toBe(true);
          expect(notices.every((notice) => notice.changes.length === 1)).toBe(
            true,
          );
        });
      },
    );
  });
}
