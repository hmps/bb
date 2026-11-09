import { z } from "zod";
import {
  afterCommit,
  answerOpenThreadDecisionSets,
  createThreadDecisionSet,
  getExperiments,
  getThread,
  hasOpenThreadDecisions,
  listOpenThreadDecisionSets,
  type DbNotifier,
  type DbQueryConnection,
  type DbTransaction,
} from "@bb/db";
import {
  requestDecisionsInputSchema,
  type DynamicTool,
  type PromptInput,
  type ThreadCreateOrigin,
  type ThreadTurnInitiator,
  type ToolCallResponse,
} from "@bb/domain";
import type { AppDeps } from "../../types.js";

export const REQUEST_DECISIONS_TOOL_NAME = "request_decisions";

export const REQUEST_DECISIONS_TOOL: DynamicTool = {
  name: REQUEST_DECISIONS_TOOL_NAME,
  description:
    "Ask the user for decisions at the end of a turn. Use this only for choices the user must make and which change your next action. Make low-risk, reversible choices yourself. Record one set of 1–6 decisions, in the user's language. Start with a short headline (100 characters maximum). Each question must be at most 160 characters. Explain only the context needed for the choice in Markdown (4000 characters maximum). Provide 2–4 distinct options. Keep each label to four words or fewer (40 characters maximum). Explain what each option does in 90 characters or fewer. Use suggested as a zero-based index into options and explain the recommendation in context. Supply links as an array of up to three labelled HTTP(S) URLs, absolute file paths, or @thread: references; use an empty array when no links help. Do not include a Something else option; the user can write an answer in the composer. A new call replaces the previous open set. After a successful call, write your normal final reply, then end the turn. The reply stays visible with the decision cards. Any user-authored message answers the open set; agent and system messages do not. If the tool reports that decision cards are off, ask in your reply.",
  inputSchema: z.toJSONSchema(requestDecisionsInputSchema),
  presentation: {
    label: {
      pending: "Asking for decisions",
      completed: "Asked for decisions",
    },
    icon: { glyph: "ListChecks" },
  },
};

type DecisionDeps = { db: DbQueryConnection; hub: DbNotifier };

export function isUserDecisionAnswer(args: {
  initiator: ThreadTurnInitiator;
  origin: ThreadCreateOrigin | null;
  originPluginId: string | null;
  input: PromptInput[];
}): boolean {
  return (
    args.initiator === "user" &&
    args.origin !== "plugin" &&
    args.originPluginId === null &&
    args.input.some((item) => item.visibility !== "agent-only")
  );
}

export function notifyThreadDecisionsChanged(
  deps: DecisionDeps,
  threadId: string,
): void {
  deps.hub.notifyThread(threadId, ["decisions-changed"], {
    hasOpenDecisions: hasOpenThreadDecisions(deps.db, threadId),
  });
}

export function resolveOpenDecisionsForUserMessage(
  tx: DbTransaction,
  args: { threadId: string; requestRef: string; input: PromptInput[] },
  hub: DbNotifier,
): void {
  const answered = answerOpenThreadDecisionSets(tx, {
    threadId: args.threadId,
    requestRef: args.requestRef,
    text: args.input
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n"),
  });
  if (answered.length > 0) {
    afterCommit(tx, () =>
      notifyThreadDecisionsChanged({ db: tx, hub }, args.threadId),
    );
  }
}

export function handleRequestDecisionsToolCall(
  deps: Pick<AppDeps, "db" | "hub">,
  args: {
    input: unknown;
    threadId: string;
    turnId: string;
    toolCallId: string;
  },
): ToolCallResponse {
  if (!getExperiments(deps.db).decisionCards) {
    return {
      success: false,
      contentItems: [
        {
          type: "inputText",
          text: "Decision cards are off; ask in your reply.",
        },
      ],
    };
  }
  const parsed = requestDecisionsInputSchema.safeParse(args.input);
  if (!parsed.success) {
    return {
      success: false,
      contentItems: [
        {
          type: "inputText",
          text: `Invalid decisions: ${z.prettifyError(parsed.error)}`,
        },
      ],
    };
  }
  const thread = getThread(deps.db, args.threadId);
  if (!thread || thread.deletedAt !== null || thread.archivedAt !== null) {
    return {
      success: false,
      contentItems: [
        {
          type: "inputText",
          text: "Cannot record decisions for an unavailable thread.",
        },
      ],
    };
  }
  createThreadDecisionSet(deps.db, {
    ...parsed.data,
    threadId: thread.id,
    turnId: args.turnId,
    toolCallId: args.toolCallId,
  });
  notifyThreadDecisionsChanged(deps, thread.id);
  return {
    success: true,
    contentItems: [
      {
        type: "inputText",
        text: `Recorded ${parsed.data.decisions.length} decisions. Now write your reply, then end the turn.`,
      },
    ],
  };
}

export function registerParentDecisionRefresh(
  deps: Pick<AppDeps, "db" | "hub">,
): void {
  deps.hub.onChangedMessage((message) => {
    if (
      message.entity !== "thread" ||
      !message.changes.some(
        (change) =>
          change === "status-changed" ||
          change === "archived-changed" ||
          change === "parent-changed" ||
          change === "thread-deleted" ||
          change === "thread-created",
      )
    )
      return;
    const parentIds = new Set([
      getThread(deps.db, message.id)?.parentThreadId,
      message.metadata?.previousParentThreadId,
    ]);
    afterCommit(deps.db, () => {
      for (const parentId of parentIds) {
        if (
          parentId &&
          listOpenThreadDecisionSets(deps.db, parentId).length > 0
        ) {
          notifyThreadDecisionsChanged(deps, parentId);
        }
      }
    });
  });
}
