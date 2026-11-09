import type { ThreadDecision } from "@bb/domain";

export function composeThreadDecisionAnswer({
  decisions,
  picks,
  text,
}: {
  decisions: readonly ThreadDecision[];
  picks: readonly { decisionIndex: number; optionIndex: number }[];
  text: string;
}): string {
  const selected = new Map<number, number>();
  for (const { decisionIndex, optionIndex } of picks) {
    const decision = decisions[decisionIndex];
    if (!Number.isInteger(decisionIndex) || !decision) {
      throw new Error(`Invalid decision index: ${decisionIndex + 1}.`);
    }
    if (!Number.isInteger(optionIndex) || !decision.options[optionIndex]) {
      throw new Error(
        `Invalid option index for decision ${decisionIndex + 1}: ${optionIndex + 1}.`,
      );
    }
    if (selected.has(decisionIndex)) {
      throw new Error(`Decision ${decisionIndex + 1} has multiple picks.`);
    }
    selected.set(decisionIndex, optionIndex);
  }

  const lines = decisions.flatMap((decision, decisionIndex) => {
    const optionIndex = selected.get(decisionIndex);
    return optionIndex === undefined
      ? []
      : [
          `Decision ${decisionIndex + 1} — ${decision.question}: ${decision.options[optionIndex].label}`,
        ];
  });
  const freeText = text.trim();
  if (freeText) lines.push(freeText);
  if (lines.length === 0) {
    throw new Error("Select an option or provide non-empty text.");
  }
  return lines.join("\n");
}
