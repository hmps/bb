import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createMigratedConnection } from "../../src/testing.js";
import { noopNotifier } from "../../src/notifier.js";
import { createProject } from "../../src/data/projects.js";
import {
  createThread,
  deleteThread,
  listThreadsWithPendingInteractionState,
} from "../../src/data/threads.js";
import { upsertHost } from "../../src/data/hosts.js";
import { setExperiments } from "../../src/data/experiments.js";
import { threadDecisions, threads } from "../../src/schema.js";
import {
  claimQueuedThreadMessageGroup,
  createQueuedThreadMessage,
  deleteQueuedThreadMessage,
  type CreateQueuedThreadMessageInput,
} from "../../src/data/queued-thread-messages.js";
import {
  answerOpenThreadDecisionSets,
  createThreadDecisionSet,
  dismissAllOpenThreadDecisionSets,
  dismissThreadDecisionSet,
  hasOpenThreadDecisions,
  listOpenThreadDecisionSets,
  listThreadDecisionSets,
} from "../../src/data/thread-decisions.js";

const input = {
  headline: "Choose storage",
  turnId: "turn-1",
  toolCallId: "call-1",
  decisions: [
    {
      question: "Which storage?",
      context: "SQLite is local.",
      options: [
        { label: "SQLite", does: "Store locally." },
        { label: "Postgres", does: "Use a server." },
      ],
      suggested: 0,
      links: [],
    },
  ],
};

function setup() {
  const db = createMigratedConnection();
  setExperiments(db, { decisionCards: true });
  const host = upsertHost(db, noopNotifier, { name: "test-host" });
  const { project } = createProject(db, noopNotifier, {
    name: "test",
    source: { type: "local_path", hostId: host.id, path: "/tmp/decision-test" },
  });
  const thread = createThread(db, noopNotifier, {
    projectId: project.id,
    providerId: "codex",
  });
  return { db, thread, project };
}

function queueAnswer(
  db: ReturnType<typeof setup>["db"],
  threadId: string,
  text: string,
  overrides: Partial<CreateQueuedThreadMessageInput> = {},
) {
  return createQueuedThreadMessage(db, noopNotifier, {
    threadId,
    content: [{ type: "text", text, mentions: [] }],
    model: "gpt-5",
    reasoningLevel: "medium",
    permissionMode: "full",
    serviceTier: "default",
    waitingOn: { kind: "thread-busy" },
    sendAt: null,
    payload: { kind: "inline" },
    systemNotice: null,
    ...overrides,
  });
}

describe("thread decision sets", () => {
  it("keeps a later queued user answer when its resolution row is deleted", () => {
    const { db, thread, project } = setup();
    try {
      queueAnswer(db, thread.id, "Before the decision");
      const set = createThreadDecisionSet(db, {
        ...input,
        threadId: thread.id,
      });
      const first = queueAnswer(db, thread.id, "SQLite");
      answerOpenThreadDecisionSets(db, {
        threadId: thread.id,
        requestRef: first.id,
        text: "SQLite",
      });
      for (const overrides of [
        { senderThreadId: thread.id },
        { requestedBy: { initiator: "agent", senderThreadId: thread.id } },
        { requestedBy: { initiator: "system", senderThreadId: thread.id } },
        { origin: "plugin" },
        { originPluginId: "test-plugin" },
        {
          content: [
            {
              type: "text",
              text: "Hidden",
              mentions: [],
              visibility: "agent-only",
            },
          ],
        },
        { waitingOn: { kind: "superseded" } },
        {
          payload: {
            kind: "retry",
            retryOfTurnRequestId: "request-1",
            attempt: 2,
            reason: "Retry",
          },
        },
        { systemNotice: { kind: "child-completed", subject: null } },
      ] satisfies Partial<CreateQueuedThreadMessageInput>[]) {
        queueAnswer(db, thread.id, "Not a user answer", overrides);
      }
      const claimed = queueAnswer(db, thread.id, "Already dispatching");
      expect(
        claimQueuedThreadMessageGroup(db, noopNotifier, claimed.id, {
          kind: "explicit-send",
        }),
      ).not.toBeNull();
      const otherThread = createThread(db, noopNotifier, {
        projectId: project.id,
        providerId: "codex",
      });
      queueAnswer(db, otherThread.id, "Answer in another thread");
      const later = queueAnswer(db, thread.id, "Use Postgres instead");
      expect(deleteQueuedThreadMessage(db, noopNotifier, first.id)).toBe(true);
      expect(listThreadDecisionSets(db, { threadId: thread.id })).toMatchObject(
        [
          {
            id: set.id,
            status: "answered",
            resolutionRequestId: later.id,
            resolutionText: "Use Postgres instead",
          },
        ],
      );
      expect(hasOpenThreadDecisions(db, thread.id)).toBe(false);
      expect(deleteQueuedThreadMessage(db, noopNotifier, later.id)).toBe(true);
      expect(listOpenThreadDecisionSets(db, thread.id)).toMatchObject([
        { id: set.id, resolutionRequestId: null, resolutionText: null },
      ]);
    } finally {
      db.$client.close();
    }
  });

  it("does not reopen a deleted queued answer when decision cards are off", () => {
    const { db, thread } = setup();
    try {
      const set = createThreadDecisionSet(db, {
        ...input,
        threadId: thread.id,
      });
      const queued = queueAnswer(db, thread.id, "SQLite");
      answerOpenThreadDecisionSets(db, {
        threadId: thread.id,
        requestRef: queued.id,
        text: "SQLite",
      });
      setExperiments(db, { decisionCards: false });
      expect(deleteQueuedThreadMessage(db, noopNotifier, queued.id)).toBe(true);
      expect(listThreadDecisionSets(db, { threadId: thread.id })).toMatchObject(
        [{ id: set.id, status: "answered", resolutionRequestId: queued.id }],
      );
      expect(hasOpenThreadDecisions(db, thread.id)).toBe(false);
    } finally {
      db.$client.close();
    }
  });

  it.each([false, true])(
    "keeps deletion and decision reopening atomic (newer: %s)",
    (withNewer) => {
      const { db, thread } = setup();
      try {
        const first = createThreadDecisionSet(db, {
          ...input,
          threadId: thread.id,
        });
        const queued = queueAnswer(db, thread.id, "Yes");
        answerOpenThreadDecisionSets(db, {
          threadId: thread.id,
          requestRef: queued.id,
          text: "Yes",
        });
        if (withNewer) {
          const newer = createThreadDecisionSet(db, {
            ...input,
            threadId: thread.id,
          });
          dismissThreadDecisionSet(db, {
            threadId: thread.id,
            decisionSetId: newer.id,
          });
          db.update(threadDecisions)
            .set({ createdAt: first.createdAt })
            .where(eq(threadDecisions.threadId, thread.id))
            .run();
        }
        expect(() =>
          db.transaction(() => {
            deleteQueuedThreadMessage(db, noopNotifier, queued.id);
            throw new Error("rollback");
          }),
        ).toThrow("rollback");
        expect(
          listThreadDecisionSets(db, { threadId: thread.id }).find(
            (row) => row.id === first.id,
          )?.status,
        ).toBe("answered");
        expect(deleteQueuedThreadMessage(db, noopNotifier, queued.id)).toBe(
          true,
        );
        expect(
          listThreadDecisionSets(db, { threadId: thread.id }).find(
            (row) => row.id === first.id,
          )?.status,
        ).toBe(withNewer ? "answered" : "open");
      } finally {
        db.$client.close();
      }
    },
  );

  it("supersedes atomically, records the accepted answer, and dismisses only the requested open set", () => {
    const { db, thread } = setup();
    try {
      const first = createThreadDecisionSet(db, {
        ...input,
        threadId: thread.id,
      });
      const second = createThreadDecisionSet(db, {
        ...input,
        toolCallId: "call-2",
        threadId: thread.id,
      });
      expect(
        listThreadDecisionSets(db, { threadId: thread.id }).find(
          (row) => row.id === first.id,
        ),
      ).toMatchObject({ status: "superseded", resolutionRequestId: null });
      expect(
        listOpenThreadDecisionSets(db, thread.id).map((row) => row.id),
      ).toEqual([second.id]);
      expect(
        dismissThreadDecisionSet(db, {
          threadId: thread.id,
          decisionSetId: first.id,
        }),
      ).toBeNull();
      expect(
        answerOpenThreadDecisionSets(db, {
          threadId: thread.id,
          requestRef: "qmsg-1",
          text: "Use SQLite",
        }),
      ).toMatchObject([
        {
          id: second.id,
          status: "answered",
          resolutionRequestId: "qmsg-1",
          resolutionText: "Use SQLite",
        },
      ]);
      expect(
        answerOpenThreadDecisionSets(db, {
          threadId: thread.id,
          requestRef: "later",
          text: "Again",
        }),
      ).toEqual([]);
      const third = createThreadDecisionSet(db, {
        ...input,
        threadId: thread.id,
      });
      expect(
        dismissThreadDecisionSet(db, {
          threadId: "other",
          decisionSetId: third.id,
        }),
      ).toBeNull();
      expect(
        dismissThreadDecisionSet(db, {
          threadId: thread.id,
          decisionSetId: third.id,
        }),
      ).toMatchObject({ status: "dismissed", resolutionRequestId: null });
      expect(hasOpenThreadDecisions(db, thread.id)).toBe(false);
      deleteThread(db, noopNotifier, thread.id);
      expect(listThreadDecisionSets(db, { threadId: thread.id })).toEqual([]);
    } finally {
      db.$client.close();
    }
  });

  it("restores the previous open set when superseding or answering rolls back", () => {
    const { db, thread } = setup();
    try {
      const first = createThreadDecisionSet(db, {
        ...input,
        threadId: thread.id,
      });
      for (const action of [
        () => createThreadDecisionSet(db, { ...input, threadId: thread.id }),
        () =>
          answerOpenThreadDecisionSets(db, {
            threadId: thread.id,
            requestRef: "rejected",
            text: "Rejected",
          }),
      ]) {
        expect(() =>
          db.transaction(() => {
            action();
            throw new Error("rollback");
          }),
        ).toThrow("rollback");
        expect(
          listOpenThreadDecisionSets(db, thread.id).map((row) => row.id),
        ).toEqual([first.id]);
      }
    } finally {
      db.$client.close();
    }
  });

  it("dismisses every open set without changing answered history", () => {
    const { db, thread, project } = setup();
    try {
      const other = createThread(db, noopNotifier, {
        projectId: project.id,
        providerId: "codex",
      });
      createThreadDecisionSet(db, { ...input, threadId: thread.id });
      answerOpenThreadDecisionSets(db, {
        threadId: thread.id,
        requestRef: "accepted",
        text: "Yes",
      });
      const open = [thread, other].map((row) =>
        createThreadDecisionSet(db, { ...input, threadId: row.id }),
      );
      expect(
        dismissAllOpenThreadDecisionSets(db)
          .map((row) => row.id)
          .sort(),
      ).toEqual(open.map((row) => row.id).sort());
      expect(
        listThreadDecisionSets(db, { threadId: thread.id })
          .map((row) => row.status)
          .sort(),
      ).toEqual(["answered", "dismissed"]);
    } finally {
      db.$client.close();
    }
  });

  it.each([null, "fork"] as const)(
    "hides the list flag for running children, including %s origins",
    (originKind) => {
      const { db, thread, project } = setup();
      try {
        createThreadDecisionSet(db, { ...input, threadId: thread.id });
        const child = createThread(db, noopNotifier, {
          projectId: project.id,
          providerId: "codex",
          status: "idle",
          parentThreadId: thread.id,
        });
        db.update(threads)
          .set({ originKind, parentThreadId: thread.id })
          .where(eq(threads.id, child.id))
          .run();
        const flag = () =>
          listThreadsWithPendingInteractionState(db, {
            threadIds: [thread.id],
          })[0]?.hasOpenDecisions;
        expect(flag()).toBe(true);
        for (const status of ["starting", "active", "stopping"] as const) {
          db.update(threads)
            .set({ status })
            .where(eq(threads.id, child.id))
            .run();
          expect(flag()).toBe(false);
        }
        db.update(threads)
          .set({ status: "idle" })
          .where(eq(threads.id, child.id))
          .run();
        expect(flag()).toBe(true);
        db.update(threads)
          .set({ status: "active", archivedAt: 1 })
          .where(eq(threads.id, child.id))
          .run();
        expect(flag()).toBe(true);
        db.update(threads)
          .set({ archivedAt: null, deletedAt: 1 })
          .where(eq(threads.id, child.id))
          .run();
        expect(flag()).toBe(true);
      } finally {
        db.$client.close();
      }
    },
  );
});
