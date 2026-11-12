import type {
  Decision,
  DecisionAnswer,
  InteractionPayload,
  InteractionResponse,
} from "./contracts.js";

export function answerLabel(
  decision: Decision | undefined,
  answer: DecisionAnswer,
): string | null {
  if ("text" in answer) return answer.text.trim();
  return decision?.options[answer.option]?.label ?? null;
}

export function composeDecisionAnswer(
  payload: InteractionPayload,
  response: InteractionResponse,
): string {
  if (response.answers.length !== payload.decisions.length) {
    throw new Error(
      `Expected ${payload.decisions.length} answers, got ${response.answers.length}.`,
    );
  }
  return payload.decisions
    .map((decision, index) => {
      const answer = response.answers[index];
      const label = answer === undefined ? null : answerLabel(decision, answer);
      if (label === null || label.length === 0) {
        throw new Error(`Decision ${index + 1} has no valid answer.`);
      }
      return `Decision ${index + 1} — ${decision.question}: ${label}`;
    })
    .join("\n");
}
