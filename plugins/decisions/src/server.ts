import type {
  BbPluginApi,
  MessageDispatchHookContext,
  PluginAgentToolResult,
} from "@get-bb/plugin-sdk";
import { composeDecisionAnswer } from "./answer.js";
import {
  DECISIONS_RENDERER_ID,
  interactionResponseSchema,
  toolInputSchema,
  type InteractionPayload,
} from "./contracts.js";
import {
  DISMISSED_MESSAGE,
  TOOL_DESCRIPTION,
  TOOL_NAME,
  UNREADABLE_ANSWER_MESSAGE,
  USER_REPLIED_MESSAGE,
  timeoutMessage,
  unavailableMessage,
} from "./tool-definition.js";

const HOUR_MS = 60 * 60 * 1000;

export const DECISION_TIMEOUT_OPTIONS = new Map([
  ["1 hour", HOUR_MS],
  ["4 hours", 4 * HOUR_MS],
  ["8 hours", 8 * HOUR_MS],
  ["24 hours", 24 * HOUR_MS],
  ["3 days", 3 * 24 * HOUR_MS],
  ["7 days", 7 * 24 * HOUR_MS],
]);

interface OpenDecisionCard {
  openedAt: number;
  closeForUserReply(): void;
}

function decisionTimeoutMs(value: string): number {
  const timeoutMs = DECISION_TIMEOUT_OPTIONS.get(value);
  if (timeoutMs === undefined) {
    throw new Error(`Unsupported decision timeout: ${value}`);
  }
  return timeoutMs;
}

function errorResult(message: string): PluginAgentToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isUserReply(
  context: MessageDispatchHookContext,
  openedAt: number,
): boolean {
  return (
    context.initiator === "user" &&
    context.senderThreadId === null &&
    context.origin !== "plugin" &&
    context.originPluginId === null &&
    context.queuedMessages.every((row) => row.createdAt >= openedAt)
  );
}

function describeAnswer(payload: InteractionPayload, value: unknown) {
  const parsed = interactionResponseSchema.safeParse(value);
  if (!parsed.success) return {};
  try {
    const text = composeDecisionAnswer(payload, parsed.data);
    return {
      title: `Decided: ${payload.headline}`,
      detail: text
        .split("\n")
        .map((line) => `- ${line}`)
        .join("\n"),
    };
  } catch {
    return {};
  }
}

export default function plugin(bb: BbPluginApi) {
  const openCards = new Map<string, Set<OpenDecisionCard>>();

  const settings = bb.settings.define({
    decisionTimeout: {
      type: "select",
      label: "Decision timeout",
      description: "How long decision cards stay open waiting for your answer.",
      options: [...DECISION_TIMEOUT_OPTIONS.keys()],
      default: "7 days",
    },
  });

  bb.experimental_hooks.on("message.dispatch", (context) => {
    const cards = openCards.get(context.thread.id);
    if (cards === undefined) return { action: "proceed" };
    for (const card of [...cards]) {
      if (isUserReply(context, card.openedAt)) card.closeForUserReply();
    }
    return { action: "proceed" };
  });

  bb.agents.registerTool({
    name: TOOL_NAME,
    description: TOOL_DESCRIPTION,
    presentation: {
      label: {
        pending: "Asking for decisions",
        completed: "Asked for decisions",
      },
      icon: { glyph: "ListTodo" },
      suppress: true,
    },
    parameters: toolInputSchema,
    async execute(input, ctx) {
      const payload: InteractionPayload = input;
      const { decisionTimeout } = await settings.get();
      const userReply = new AbortController();
      const card: OpenDecisionCard = {
        openedAt: Date.now(),
        closeForUserReply: () => userReply.abort(),
      };
      const cards = openCards.get(ctx.threadId) ?? new Set();
      cards.add(card);
      openCards.set(ctx.threadId, cards);

      let result;
      try {
        result = await bb.ui.requestInput(
          {
            threadId: ctx.threadId,
            rendererId: DECISIONS_RENDERER_ID,
            title: payload.headline,
            payload,
            timeoutMs: decisionTimeoutMs(decisionTimeout),
            presentation: {
              label: {
                pending: "Waiting for decisions",
                completed: "Decided",
              },
              icon: { glyph: "ListTodo" },
            },
            describeSubmission: (value) => describeAnswer(payload, value),
          },
          { signal: AbortSignal.any([ctx.signal, userReply.signal]) },
        );
      } catch (error) {
        return errorResult(unavailableMessage(errorText(error)));
      } finally {
        cards.delete(card);
        if (cards.size === 0) openCards.delete(ctx.threadId);
      }

      if (result.outcome === "cancelled") {
        if (userReply.signal.aborted) return errorResult(USER_REPLIED_MESSAGE);
        if (result.reason === "timeout") {
          return errorResult(timeoutMessage(Date.now() - card.openedAt));
        }
        return errorResult(DISMISSED_MESSAGE);
      }

      const parsed = interactionResponseSchema.safeParse(result.value);
      if (!parsed.success) return errorResult(UNREADABLE_ANSWER_MESSAGE);
      try {
        return composeDecisionAnswer(payload, parsed.data);
      } catch (error) {
        return errorResult(
          `${UNREADABLE_ANSWER_MESSAGE} (${errorText(error)})`,
        );
      }
    },
  });

  bb.agents.configure(() => ({ tools: [TOOL_NAME], skills: [] }));
}
