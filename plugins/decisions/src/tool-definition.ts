export const TOOL_NAME = "request_decisions";

export const TOOL_DESCRIPTION =
  "Ask the user for decisions. Use this only for choices the user must make and which change your next action. Make low-risk, reversible choices yourself. Ask one set of 1–6 decisions, in the user's language. Start with a short headline (100 characters maximum). Each question must be at most 160 characters. Explain only the context needed for the choice in Markdown (4000 characters maximum). Provide 2–4 distinct options. Keep each label to four words or fewer (40 characters maximum). Explain what each option does in 90 characters or fewer. Set suggested to the zero-based index of the option you recommend, and explain the recommendation in context; omit it when you have no recommendation. Supply links as an array of up to three labelled HTTP(S) URLs, absolute file paths, or @thread: references; use an empty array when no links help. Do not include a Something else option; the card has a field where the user can type an own answer. The cards stay open after your turn ends. After the call, say briefly what you are waiting for, then end the turn. The answers arrive later as one line per decision: `Decision N — <question>: <answer>`. If the user writes in the thread instead, the cards close and their message is the answer. If the cards are dismissed or expire, continue with your best judgement or ask again.";

export const DISMISSED_MESSAGE =
  "The user dismissed the decisions without answering. Continue with your best judgement, or ask again in your reply.";

export const USER_REPLIED_MESSAGE =
  "The user wrote in the thread instead of answering the decision cards, so the cards are closed. Treat their message as the answer; ask again only if you still need the decisions.";

export const UNREADABLE_ANSWER_MESSAGE =
  "The decision answers could not be read. Ask again in your reply instead.";

export function timeoutMessage(elapsedMs: number): string {
  const hours = Math.max(1, Math.round(elapsedMs / (60 * 60 * 1000)));
  return `The decisions expired after about ${hours} hour${hours === 1 ? "" : "s"} with no answer. Continue with your best judgement, or ask again if the decisions still matter.`;
}

export function unavailableMessage(reason: string): string {
  return `The decision cards could not be shown (${reason}). Ask in your reply instead.`;
}
