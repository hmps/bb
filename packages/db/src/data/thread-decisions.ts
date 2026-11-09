import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";
import {
  promptInputSchema,
  type RequestDecisionsInput,
  type ThreadDecisionSet,
} from "@bb/domain";
import type { DbQueryConnection } from "../connection.js";
import { createThreadDecisionId } from "../ids.js";
import { queuedThreadMessages, threadDecisions, threads } from "../schema.js";
import { getExperiments } from "./experiments.js";

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

export function reopenThreadDecisionsForDeletedAnswer(
  db: DbQueryConnection,
  args: { threadId: string; requestRef: string },
): ThreadDecisionSet | null {
  if (!getExperiments(db).decisionCards) return null;
  const laterAnswer = db
    .select({
      id: queuedThreadMessages.id,
      content: queuedThreadMessages.content,
    })
    .from(queuedThreadMessages)
    .where(
      and(
        eq(queuedThreadMessages.threadId, args.threadId),
        sql`${queuedThreadMessages}.rowid > (SELECT deleted.rowid FROM ${queuedThreadMessages} deleted WHERE deleted.id = ${args.requestRef})`,
        ne(queuedThreadMessages.state, "claimed"),
        sql`json_extract(${queuedThreadMessages.waitingOn}, '$.kind') IS NOT 'superseded'`,
        eq(queuedThreadMessages.payloadKind, "inline"),
        isNull(queuedThreadMessages.systemNotice),
        isNull(queuedThreadMessages.senderThreadId),
        isNull(queuedThreadMessages.requestedByInitiator),
        sql`${queuedThreadMessages.origin} IS NOT 'plugin'`,
        isNull(queuedThreadMessages.originPluginId),
        sql`EXISTS (SELECT 1 FROM json_each(${queuedThreadMessages.content}) item WHERE json_extract(item.value, '$.visibility') IS NOT 'agent-only')`,
      ),
    )
    .orderBy(sql`${queuedThreadMessages}.rowid`)
    .limit(1)
    .get();
  const content = laterAnswer
    ? promptInputSchema.array().parse(JSON.parse(laterAnswer.content))
    : [];
  return (
    db
      .update(threadDecisions)
      .set({
        status: laterAnswer ? "answered" : "open",
        resolutionRequestId: laterAnswer?.id ?? null,
        resolutionText: laterAnswer
          ? content
              .filter((item) => item.type === "text")
              .map((item) => item.text)
              .join("\n")
          : null,
        resolvedAt: laterAnswer ? Date.now() : null,
      })
      .where(
        and(
          eq(threadDecisions.threadId, args.threadId),
          eq(threadDecisions.status, "answered"),
          eq(threadDecisions.resolutionRequestId, args.requestRef),
          sql`${threadDecisions.id} = (SELECT newest.id FROM ${threadDecisions} newest WHERE newest.thread_id = ${args.threadId} ORDER BY newest.rowid DESC LIMIT 1)`,
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
