import { describe, expect, it } from "vitest";
import { composeDecisionAnswer } from "./answer.js";
import { interactionResponseSchema, toolInputSchema } from "./contracts.js";

const decision = {
  question: "Which database should we use?",
  context: "We need one store.",
  options: [
    { label: "Postgres", does: "Use the shared server." },
    { label: "SQLite", does: "Embed a file per host." },
  ],
};

function parseInput(overrides: Record<string, unknown>) {
  return toolInputSchema.safeParse({
    headline: "Storage",
    decisions: [{ ...decision, ...overrides }],
  });
}

describe("tool input", () => {
  it("accepts URL, absolute path, and thread links and defaults links to empty", () => {
    expect(parseInput({}).data?.decisions[0]?.links).toEqual([]);
    expect(
      parseInput({
        links: [
          { label: "Spec", href: "https://example.com/spec" },
          { label: "Plan", href: "/Users/me/plan.md" },
          { label: "Thread", href: "@thread:thr_abcdefghij#msg=4" },
        ],
      }).success,
    ).toBe(true);
  });

  it.each([
    [
      "a javascript link",
      { links: [{ label: "x", href: "javascript:alert(1)" }] },
    ],
    ["a relative path", { links: [{ label: "x", href: "docs/plan.md" }] }],
    ["one option", { options: decision.options.slice(0, 1) }],
    [
      "duplicate labels",
      { options: [decision.options[0], decision.options[0]] },
    ],
    ["a suggested index out of range", { suggested: 2 }],
  ])("rejects %s", (_name, overrides) => {
    expect(parseInput(overrides).success).toBe(false);
  });

  it("rejects more than six decisions", () => {
    expect(
      toolInputSchema.safeParse({
        headline: "Storage",
        decisions: Array.from({ length: 7 }, () => decision),
      }).success,
    ).toBe(false);
  });
});

describe("answer text", () => {
  const payload = toolInputSchema.parse({
    headline: "Storage",
    decisions: [decision, { ...decision, question: "Backups?" }],
  });

  it("writes one line per decision with the option label or own answer", () => {
    expect(
      composeDecisionAnswer(payload, {
        answers: [{ option: 0 }, { text: "Skip backups" }],
      }),
    ).toBe(
      "Decision 1 — Which database should we use?: Postgres\nDecision 2 — Backups?: Skip backups",
    );
  });

  it("rejects a missing answer or an unknown option", () => {
    expect(() =>
      composeDecisionAnswer(payload, { answers: [{ option: 0 }] }),
    ).toThrow("Expected 2 answers, got 1.");
    expect(() =>
      composeDecisionAnswer(payload, {
        answers: [{ option: 0 }, { option: 5 }],
      }),
    ).toThrow("Decision 2 has no valid answer.");
  });

  it("rejects a blank own answer in the response", () => {
    expect(
      interactionResponseSchema.safeParse({ answers: [{ text: "   " }] })
        .success,
    ).toBe(false);
  });
});
