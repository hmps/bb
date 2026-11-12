import { describe, expect, it } from "vitest";
import type { PromptInput, ThreadDecision } from "@bb/domain";
import { withDecisionAnswer } from "./decision-answer";

const decisions: ThreadDecision[] = [
  {
    question: "Ship behind a flag?",
    context: "Context.",
    options: [
      { label: "Flag it", does: "Only you see it" },
      { label: "Ship to all", does: "Everyone gets it" },
    ],
    suggested: 0,
    links: [],
  },
];

describe("withDecisionAnswer", () => {
  it("moves mentions past the decision lines and the trimmed space", () => {
    const text = "  ask @thr ";
    const input: PromptInput[] = [
      {
        type: "text",
        text,
        mentions: [
          {
            start: 6,
            end: 10,
            resource: { kind: "thread", threadId: "thr_2", label: "thr" },
          },
        ],
      },
    ];
    const [first] = withDecisionAnswer(
      input,
      decisions,
      new Map([[0, { optionIndex: 1 }]]),
    );
    if (first?.type !== "text") throw new Error("expected text input");
    expect(first.text).toBe(
      "Decision 1 — Ship behind a flag?: Ship to all\nask @thr",
    );
    const mention = first.mentions[0];
    expect(mention && first.text.slice(mention.start, mention.end)).toBe(
      "@thr",
    );
  });

  it("adds a text part when the composer is empty", () => {
    expect(
      withDecisionAnswer([], decisions, new Map([[0, { optionIndex: 0 }]])),
    ).toEqual([
      {
        type: "text",
        text: "Decision 1 — Ship behind a flag?: Flag it",
        mentions: [],
      },
    ]);
  });

  it("leaves the input unchanged without picks", () => {
    const input: PromptInput[] = [{ type: "text", text: " hi ", mentions: [] }];
    expect(withDecisionAnswer(input, decisions, new Map())).toEqual(input);
  });
});
