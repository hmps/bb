import { and, desc, eq, sql } from "drizzle-orm";
import type { RequestDecisionsInput, ThreadDecisionSet } from "@bb/domain";
import type { DbQueryConnection } from "../connection.js";
import { createThreadDecisionId } from "../ids.js";
import { threadDecisions, threads } from "../schema.js";

export function createThreadDecisionSet(
  db: DbQueryConnection,
  input: RequestDecisionsInput & {
    threadId: string;
    turnId: string | null;
    toolCallId: string;
  },
): ThreadDecisionSet {
  return db.transaction((tx) => {
    tx.update(threadDecisions)
      .set({ status: "superseded", resolvedAt: Date.now() })
      .where(
        and(
          eq(threadDecisions.threadId, input.threadId),
          eq(threadDecisions.status, "open"),
        ),
      )
      .run();
    return tx
      .insert(threadDecisions)
      .values({
        ...input,
        id: createThreadDecisionId(),
        status: "open",
        createdAt: Date.now(),
        resolutionRequestId: null,
        resolutionText: null,
        resolvedAt: null,
      })
      .returning()
      .get();
  });
}

export function listThreadDecisionSets(
  db: DbQueryConnection,
  args: { threadId: string; openOnly?: boolean },
): ThreadDecisionSet[] {
  return db
    .select()
    .from(threadDecisions)
    .where(
      and(
        eq(threadDecisions.threadId, args.threadId),
        args.openOnly ? eq(threadDecisions.status, "open") : undefined,
      ),
    )
    .orderBy(desc(threadDecisions.createdAt), desc(threadDecisions.id))
    .all();
}

export function listOpenThreadDecisionSets(
  db: DbQueryConnection,
  threadId: string,
): ThreadDecisionSet[] {
  return listThreadDecisionSets(db, { threadId, openOnly: true });
}

export function answerOpenThreadDecisionSets(
  db: DbQueryConnection,
  args: { threadId: string; requestRef: string; text: string },
): ThreadDecisionSet[] {
  return db
    .update(threadDecisions)
    .set({
      status: "answered",
      resolutionRequestId: args.requestRef,
      resolutionText: args.text,
      resolvedAt: Date.now(),
    })
    .where(
      and(
        eq(threadDecisions.threadId, args.threadId),
        eq(threadDecisions.status, "open"),
      ),
    )
    .returning()
    .all();
}

export function dismissThreadDecisionSet(
  db: DbQueryConnection,
  args: { threadId: string; decisionSetId: string },
): ThreadDecisionSet | null {
  return (
    db
      .update(threadDecisions)
      .set({ status: "dismissed", resolvedAt: Date.now() })
      .where(
        and(
          eq(threadDecisions.threadId, args.threadId),
          eq(threadDecisions.id, args.decisionSetId),
          eq(threadDecisions.status, "open"),
        ),
      )
      .returning()
      .get() ?? null
  );
}

export function dismissAllOpenThreadDecisionSets(
  db: DbQueryConnection,
): ThreadDecisionSet[] {
  return db
    .update(threadDecisions)
    .set({ status: "dismissed", resolvedAt: Date.now() })
    .where(eq(threadDecisions.status, "open"))
    .returning()
    .all();
}

export function threadHasOpenDecisionsSql() {
  return sql<number>`EXISTS (SELECT 1 FROM ${threadDecisions} WHERE ${threadDecisions.threadId} = threads.id AND ${threadDecisions.status} = 'open')
    AND NOT EXISTS (SELECT 1 FROM threads child WHERE child.parent_thread_id = threads.id AND child.archived_at IS NULL AND child.deleted_at IS NULL AND child.status IN ('starting', 'active', 'stopping'))`;
}

export function hasOpenThreadDecisions(
  db: DbQueryConnection,
  threadId: string,
): boolean {
  return (
    (db
      .select({ value: threadHasOpenDecisionsSql() })
      .from(threads)
      .where(eq(threads.id, threadId))
      .get()?.value ?? 0) > 0
  );
}
