import { describe, expect, it } from "vitest";
import { groupCompletedTurnMessages } from "../src/completed-turn-grouping.js";
import {
  createTimelineEventFactory,
  renderTimelineFixture,
} from "./timeline-test-harness.js";

const presentation = {
  label: { pending: "Asking for decisions", completed: "Asked for decisions" },
  icon: { glyph: "ListChecks" },
};

describe("decision request turns", () => {
  it.each(["before", "after"] as const)(
    "keeps the final reply terminal when the tool runs %s it",
    (order) => {
      const event = createTimelineEventFactory({
        threadId: "thread-1",
        turnId: "turn-1",
      });
      const started = event.turnStarted({});
      const narration = event.assistantCompleted({
        itemId: "narration",
        text: "I checked the storage options.",
      });
      const reply = () =>
        event.assistantCompleted({
          itemId: "reply",
          text: "The storage choice is ready.",
        });
      const tool = () =>
        event.toolCallCompleted({
          itemId: "decisions",
          tool: "request_decisions",
          presentation,
          arguments: { headline: "Choose storage" },
          result:
            "Recorded 1 decisions. Now write your reply, then end the turn.",
        });
      const messages =
        order === "before" ? [tool(), reply()] : [reply(), tool()];
      const rendered = renderTimelineFixture({
        events: [started, narration, ...messages, event.turnCompleted({})],
        projectionOptions: { turnMessageDetail: "full" },
      });
      const entry = rendered.projection.entries.find(
        (entry) => entry.kind === "turn",
      );
      if (!entry || entry.kind !== "turn")
        throw new Error("Missing completed turn");
      expect(entry.turn.terminalMessage).toMatchObject({
        kind: "assistant-text",
        text: "The storage choice is ready.",
      });
      const grouped = groupCompletedTurnMessages(entry.turn);
      expect(grouped.terminalMessages).toMatchObject([
        { kind: "assistant-text", text: "The storage choice is ready." },
      ]);
      expect(
        grouped.summaryItems.flatMap((item) =>
          item.kind === "summary" ? item.sourceMessages : [],
        ),
      ).toContainEqual(
        expect.objectContaining({
          kind: "tool-call",
          toolName: "request_decisions",
          presentation,
        }),
      );
      expect(grouped.trailingMessages).toEqual([]);
    },
  );
});
