import {
  composeThreadDecisionAnswer,
  type ThreadDecisionAnswerPick,
} from "@bb/core-ui";
import type { PromptInput, ThreadDecision } from "@bb/domain";

export type DecisionPick = { optionIndex: number } | { text: string };
export type DecisionPicks = ReadonlyMap<number, DecisionPick>;

export function decisionPickLabel(
  decision: ThreadDecision | undefined,
  pick: DecisionPick,
): string {
  if ("text" in pick) return pick.text;
  return decision?.options[pick.optionIndex]?.label ?? "";
}

export function withDecisionAnswer(
  input: readonly PromptInput[],
  decisions: readonly ThreadDecision[],
  picks: DecisionPicks,
): PromptInput[] {
  if (picks.size === 0) return [...input];
  const pickList = [...picks].map(
    ([decisionIndex, pick]): ThreadDecisionAnswerPick => ({
      decisionIndex,
      ...pick,
    }),
  );
  const [first, ...rest] = input;
  if (first?.type === "text") {
    const freeText = first.text.trim();
    const text = composeThreadDecisionAnswer({
      decisions,
      picks: pickList,
      text: freeText,
    });
    const trimmedStart = first.text.length - first.text.trimStart().length;
    const offset = text.length - freeText.length - trimmedStart;
    return [
      {
        ...first,
        text,
        mentions: first.mentions.map((mention) => ({
          ...mention,
          start: mention.start + offset,
          end: mention.end + offset,
        })),
      },
      ...rest,
    ];
  }
  return [
    {
      type: "text",
      text: composeThreadDecisionAnswer({
        decisions,
        picks: pickList,
        text: "",
      }),
      mentions: [],
    },
    ...input,
  ];
}
