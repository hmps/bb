import { composeThreadDecisionAnswer } from "@bb/core-ui";
import type { PromptInput, ThreadDecision } from "@bb/domain";

export type DecisionPicks = ReadonlyMap<number, number>;

export function withDecisionAnswer(
  input: readonly PromptInput[],
  decisions: readonly ThreadDecision[],
  picks: DecisionPicks,
): PromptInput[] {
  if (picks.size === 0) return [...input];
  const pickList = [...picks].map(([decisionIndex, optionIndex]) => ({
    decisionIndex,
    optionIndex,
  }));
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
