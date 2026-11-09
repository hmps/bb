import { describe, expect, it } from "vitest";
import { requestDecisionsInputSchema } from "../src/thread-decisions.js";

const decision = {
  question: "Which storage should we use?",
  context: "SQLite keeps the change small.",
  options: [
    { label: "SQLite", does: "Store data locally." },
    { label: "Postgres", does: "Use the shared server." },
  ],
  suggested: 0,
  links: [],
};
const input = { headline: "Choose storage", decisions: [decision] };

describe("decision input", () => {
  it.each([
    { headline: "x".repeat(101) },
    { headline: " " },
    { decisions: [] },
    { decisions: Array(7).fill(decision) },
    { decisions: [{ ...decision, question: "x".repeat(161) }] },
    { decisions: [{ ...decision, context: "x".repeat(4001) }] },
    { decisions: [{ ...decision, options: [decision.options[0]] }] },
    {
      decisions: [{ ...decision, options: Array(5).fill(decision.options[0]) }],
    },
    {
      decisions: [
        {
          ...decision,
          options: [
            { label: "x".repeat(41), does: "Do it" },
            decision.options[1],
          ],
        },
      ],
    },
    {
      decisions: [
        {
          ...decision,
          options: [
            { label: "One", does: "x".repeat(91) },
            decision.options[1],
          ],
        },
      ],
    },
    { decisions: [{ ...decision, suggested: 2 }] },
    { decisions: [{ ...decision, suggested: -1 }] },
    { decisions: [{ ...decision, suggested: 0.5 }] },
    {
      decisions: [
        {
          ...decision,
          links: Array(4).fill({ label: "Doc", href: "https://example.com" }),
        },
      ],
    },
    {
      decisions: [
        { ...decision, links: [{ label: "Doc", href: "javascript:alert(1)" }] },
      ],
    },
    {
      decisions: [
        { ...decision, links: [{ label: "Doc", href: "relative/file.ts" }] },
      ],
    },
    { extra: "ignored" },
    { decisions: [{ ...decision, extra: "ignored" }] },
    {
      decisions: [
        {
          ...decision,
          options: [
            { ...decision.options[0], extra: "ignored" },
            decision.options[1],
          ],
        },
      ],
    },
  ])("rejects invalid input %#", (invalid) => {
    expect(
      requestDecisionsInputSchema.safeParse({ ...input, ...invalid }).success,
    ).toBe(false);
  });

  it("accepts bounded content and links on supported hosts", () => {
    const parsed = requestDecisionsInputSchema.parse({
      headline: "x".repeat(100),
      decisions: Array.from({ length: 6 }, () => ({
        ...decision,
        question: "x".repeat(160),
        context: "x".repeat(4000),
        suggested: 1,
        links: [
          { label: "Web", href: "https://example.com" },
          { label: "File", href: "C:\\repo\\file.ts" },
          { label: "Thread", href: "@thread:thr_23456789ab#msg=12" },
        ],
      })),
    });
    expect(parsed.decisions).toHaveLength(6);
    expect(
      requestDecisionsInputSchema.safeParse({
        ...input,
        decisions: [
          { ...decision, links: [{ label: "File", href: "/repo/file.ts:12" }] },
        ],
      }).success,
    ).toBe(true);
  });
});
