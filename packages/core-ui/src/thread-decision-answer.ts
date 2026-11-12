import type { ThreadDecision } from "@bb/domain";

export type ThreadDecisionAnswerPick =
  | { decisionIndex: number; optionIndex: number }
  | { decisionIndex: number; text: string };

export function composeThreadDecisionAnswer({
  decisions,
  picks,
  text,
}: {
  decisions: readonly ThreadDecision[];
  picks: readonly ThreadDecisionAnswerPick[];
  text: string;
}): string {
  const selected = new Map<number, string>();
  for (const pick of picks) {
    const { decisionIndex } = pick;
    const decision = decisions[decisionIndex];
    if (!Number.isInteger(decisionIndex) || !decision) {
      throw new Error(`Invalid decision index: ${decisionIndex + 1}.`);
    }
    if (selected.has(decisionIndex)) {
      throw new Error(`Decision ${decisionIndex + 1} has multiple picks.`);
    }
    if ("text" in pick) {
      const answer = pick.text.trim();
      if (!answer) {
        throw new Error(`Decision ${decisionIndex + 1} has an empty answer.`);
      }
      selected.set(decisionIndex, answer);
      continue;
    }
    const option = decision.options[pick.optionIndex];
    if (!Number.isInteger(pick.optionIndex) || !option) {
      throw new Error(
        `Invalid option index for decision ${decisionIndex + 1}: ${pick.optionIndex + 1}.`,
      );
    }
    selected.set(decisionIndex, option.label);
  }

  const lines = decisions.flatMap((decision, decisionIndex) => {
    const answer = selected.get(decisionIndex);
    return answer === undefined
      ? []
      : [`Decision ${decisionIndex + 1} — ${decision.question}: ${answer}`];
  });
  const freeText = text.trim();
  if (freeText) lines.push(freeText);
  if (lines.length === 0) {
    throw new Error("Select an option or provide non-empty text.");
  }
  return lines.join("\n");
}
