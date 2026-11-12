// @vitest-environment jsdom
import { cleanup, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { InteractionPayload } from "./src/contracts";

const app = await loadPluginApp(() => import("./app"));

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

afterEach(cleanup);

const payload: InteractionPayload = {
  headline: "Pick a storage plan",
  decisions: [
    {
      question: "Which database should we use?",
      context: "We need one store.",
      options: [
        { label: "Postgres", does: "Use the shared server." },
        { label: "SQLite", does: "Embed a file per host." },
      ],
      suggested: 1,
      links: [],
    },
    {
      question: "Where do backups go?",
      context: "Backups run every night.",
      options: [
        { label: "S3", does: "Upload to the shared bucket." },
        { label: "Local disk", does: "Keep them on the host." },
      ],
      links: [],
    },
  ],
};

function render(
  handlers: {
    submit?: (value: unknown) => Promise<void>;
    cancel?: () => Promise<void>;
  } = {},
) {
  return renderSlot(app.pendingInteractions[0]!, {
    interaction: {
      id: "pint_test",
      threadId: "thr_test",
      title: payload.headline,
      payload: payload as never,
      createdAt: 0,
      expiresAt: null,
    },
    submit: handlers.submit ?? (async () => undefined),
    cancel: handlers.cancel ?? (async () => undefined),
  });
}

type Slot = ReturnType<typeof render>;

function option(slot: Slot, label: string): HTMLButtonElement {
  const button = slot.getByText(label).closest("button");
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`${label} is not rendered inside a button`);
  }
  return button;
}

function ownAnswer(slot: Slot, decision: number): HTMLInputElement {
  return slot.getByLabelText(
    `Your own answer for decision ${decision}`,
  ) as HTMLInputElement;
}

function chips(slot: Slot): string[] {
  const list = slot.queryByLabelText("Picked answers");
  if (list === null) return [];
  return [...list.querySelectorAll("li")].map(
    (item) => item.querySelector("button")?.textContent ?? "",
  );
}

describe("decision card", () => {
  it("marks the recommended option and moves to the next decision after a pick", () => {
    const slot = render();
    expect(slot.getByText("Recommended")).toBeTruthy();

    fireEvent.click(option(slot, "SQLite"));

    expect(slot.getByText("Where do backups go?")).toBeTruthy();
    expect(chips(slot)).toEqual(["1 · SQLite"]);
  });

  it("submits all answers when the last decision gets a pick", () => {
    const submit = vi.fn(async (_value: unknown) => undefined);
    const slot = render({ submit });

    fireEvent.click(option(slot, "Postgres"));
    fireEvent.change(ownAnswer(slot, 2), { target: { value: "Both" } });
    expect(submit).not.toHaveBeenCalled();
    fireEvent.click(slot.getByLabelText("Use this answer"));

    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0]?.[0]).toEqual({
      answers: [{ option: 0 }, { text: "Both" }],
    });
  });

  it("uses typed text as the live pick and an option click clears it", () => {
    const slot = render();

    fireEvent.change(ownAnswer(slot, 1), { target: { value: "MySQL" } });
    expect(chips(slot)).toEqual(["1 · MySQL"]);
    expect(slot.getByText("1 of 2 picked")).toBeTruthy();

    fireEvent.click(option(slot, "Postgres"));
    fireEvent.click(slot.getByLabelText("Previous decision"));

    expect(ownAnswer(slot, 1).value).toBe("");
    expect(option(slot, "Postgres").getAttribute("aria-pressed")).toBe("true");
  });

  it("keeps an option pick on whitespace and clears a text pick on whitespace", () => {
    const slot = render();
    fireEvent.click(option(slot, "Postgres"));
    fireEvent.click(slot.getByLabelText("Previous decision"));

    fireEvent.change(ownAnswer(slot, 1), { target: { value: " " } });
    expect(chips(slot)).toEqual(["1 · Postgres"]);
    expect(ownAnswer(slot, 1).value).toBe("");

    fireEvent.change(ownAnswer(slot, 1), { target: { value: "MySQL" } });
    fireEvent.change(ownAnswer(slot, 1), { target: { value: "  " } });
    expect(chips(slot)).toEqual([]);
    expect(ownAnswer(slot, 1).value).toBe("");
  });

  it("enables Submit only when every decision has a pick and dismisses on request", () => {
    const cancel = vi.fn(async () => undefined);
    const slot = render({ cancel });
    expect(option(slot, "Submit").disabled).toBe(true);

    fireEvent.click(option(slot, "Dismiss"));
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
