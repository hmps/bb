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
import { threads } from "../../src/schema.js";
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

describe("thread decision sets", () => {
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
