// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PromptInput, ThreadDecisionSet } from "@bb/domain";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import { AppCommandProvider } from "@/components/commands/AppCommandProvider";
import { getMessageLinkPath } from "@bb/client-core";
import { getThreadRoutePath } from "@/lib/route-paths";
import { makeThreadResponse } from "@/test/fixtures/thread-responses";
import { DecisionCard } from "./DecisionCard";
import { useThreadDecisionAnswers } from "./useThreadDecisionAnswers";

const mocks = vi.hoisted(() => ({
  decisionCards: true,
  list: vi.fn(),
  dismiss: vi.fn(),
  getThread: vi.fn(),
}));

vi.mock("@/hooks/queries/system-queries", async () => {
  const base = await import("@/test/question-shortcuts-system-queries-mock");
  return {
    useSystemConfig: () => {
      const config = base.useSystemConfig();
      return {
        data: {
          ...config.data,
          experiments: { decisionCards: mocks.decisionCards },
        },
      };
    },
  };
});

vi.mock("@/lib/bb-desktop", () => ({
  getBbDesktopInfo: () => null,
}));

vi.mock("@/lib/ws", () => ({
  wsManager: { subscribe: vi.fn(), unsubscribe: vi.fn() },
}));

vi.mock("@/lib/sdk", () => ({
  sdk: {
    threads: {
      get: mocks.getThread,
      experimental_decisions: { list: mocks.list, dismiss: mocks.dismiss },
    },
  },
}));

const decisionSet: ThreadDecisionSet = {
  id: "tds_1",
  threadId: "thr_1",
  turnId: "turn_1",
  toolCallId: "call_1",
  headline: "Three choices before the PR",
  status: "open",
  resolutionRequestId: null,
  resolutionText: null,
  createdAt: 1,
  resolvedAt: null,
  decisions: [
    {
      question: "Ship behind a flag?",
      context: "The card changes how **every** thread ends.",
      options: [
        { label: "Flag it", does: "Only you see it until we measure" },
        { label: "Ship to all", does: "Everyone gets it on the next release" },
        { label: "You decide", does: "I pick, and I note why in the PR" },
      ],
      suggested: 0,
      links: [
        { label: "Plan", href: "https://example.com/plan" },
        { label: "Earlier thread", href: "@thread:thr_2222222222" },
        { label: "Earlier message", href: "@thread:thr_3333333333#msg=7" },
      ],
    },
    {
      question: "Split the PR?",
      context: "Two PRs are easier to review.",
      options: [
        { label: "One PR", does: "Everything together" },
        { label: "Two PRs", does: "Server first, then UI" },
      ],
      suggested: 1,
      links: [],
    },
    {
      question: "Add a CLI command?",
      context: "The CLI can answer decisions too.",
      options: [
        { label: "Yes", does: "Add bb thread decisions" },
        { label: "Later", does: "Leave it for a follow-up" },
      ],
      suggested: 0,
      links: [],
    },
  ],
};

function Harness({
  onSend,
  onAllPicked,
}: {
  onSend: (input: PromptInput[]) => void;
  onAllPicked: () => void;
}) {
  const answers = useThreadDecisionAnswers("thr_1");
  const [message, setMessage] = useState("");
  const composerRef = useRef<HTMLTextAreaElement>(null);
  return (
    <>
      <DecisionCard
        threadId="thr_1"
        answers={answers}
        onAllPicked={onAllPicked}
      />
      <textarea
        ref={composerRef}
        aria-label="Message"
        value={message}
        onChange={(event) => setMessage(event.target.value)}
      />
      <button
        type="button"
        onClick={() =>
          onSend(
            answers.applyTo(
              message.length === 0
                ? []
                : [{ type: "text", text: message, mentions: [] }],
            ),
          )
        }
      >
        Send
      </button>
    </>
  );
}

function renderCard({ compact = false } = {}) {
  const onSend = vi.fn<(input: PromptInput[]) => void>();
  const onAllPicked = vi.fn<() => void>();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AppCommandProvider>
          <CompactViewportOverrideProvider isCompactViewport={compact}>
            <Harness onSend={onSend} onAllPicked={onAllPicked} />
          </CompactViewportOverrideProvider>
        </AppCommandProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { onSend, onAllPicked };
}

function pressKey(key: string, target: EventTarget = window) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

function option(name: RegExp) {
  return within(
    screen.getByRole("group", { name: /^Options for decision/ }),
  ).getByRole("button", { name });
}

function sentText(onSend: ReturnType<typeof renderCard>["onSend"]) {
  const input = onSend.mock.calls.at(-1)?.[0];
  const first = input?.[0];
  return first?.type === "text" ? first.text : null;
}

beforeEach(() => {
  mocks.decisionCards = true;
  mocks.list.mockReset().mockResolvedValue([decisionSet]);
  mocks.getThread
    .mockReset()
    .mockImplementation(({ threadId }: { threadId: string }) =>
      Promise.resolve(
        makeThreadResponse({ id: threadId, projectId: "proj_archive" }),
      ),
    );
  mocks.dismiss.mockReset().mockResolvedValue({
    ...decisionSet,
    status: "dismissed",
  });
});

afterEach(() => {
  cleanup();
});

describe("DecisionCard", () => {
  it("pages through decisions with the pager", async () => {
    renderCard();
    expect(await screen.findByText("Ship behind a flag?")).toBeTruthy();
    expect(screen.getByText("1 of 3")).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Previous decision",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Next decision" }));
    expect(screen.getByText("Split the PR?")).toBeTruthy();
    expect(screen.getByText("2 of 3")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Next decision" }));
    expect(
      (
        screen.getByRole("button", {
          name: "Next decision",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Previous decision" }));
    expect(screen.getByText("Split the PR?")).toBeTruthy();
  });

  it("renders context, links, and the recommended option", async () => {
    renderCard();
    await screen.findByText("Ship behind a flag?");
    expect(screen.getByText("every").tagName).toBe("STRONG");
    expect(
      screen.getByRole("link", { name: /Plan/ }).getAttribute("href"),
    ).toBe("https://example.com/plan");
    expect(within(option(/Flag it/)).getByText("Recommended")).toBeTruthy();
    expect(within(option(/Ship to all/)).queryByText("Recommended")).toBeNull();
  });

  it("routes thread and message links to the target's project when the sidebar lacks it", async () => {
    renderCard();
    await screen.findByText("Ship behind a flag?");

    expect(
      (
        await screen.findByRole("link", { name: /Earlier thread/ })
      ).getAttribute("href"),
    ).toBe(
      getThreadRoutePath({
        projectId: "proj_archive",
        threadId: "thr_2222222222",
      }),
    );
    expect(
      (
        await screen.findByRole("link", { name: /Earlier message/ })
      ).getAttribute("href"),
    ).toBe(
      getMessageLinkPath({
        projectId: "proj_archive",
        threadId: "thr_3333333333",
        seq: 7,
      }),
    );
    expect(mocks.getThread).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: "thr_2222222222" }),
    );
    expect(mocks.getThread).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: "thr_3333333333" }),
    );
  });

  it("shows a thread link as plain text until its project resolves", async () => {
    mocks.getThread.mockReset().mockReturnValue(new Promise(() => {}));
    renderCard();
    await screen.findByText("Ship behind a flag?");

    expect(screen.getByText("Earlier thread")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Earlier thread/ })).toBeNull();
  });

  it("adds a chip per pick, moves to the next page, and removes chips", async () => {
    renderCard();
    await screen.findByText("Ship behind a flag?");

    fireEvent.click(option(/Ship to all/));
    expect(screen.getByText("Split the PR?")).toBeTruthy();
    const chips = screen.getByRole("list", { name: "Picked answers" });
    expect(within(chips).getByText("1 · Ship to all")).toBeTruthy();

    fireEvent.click(option(/Two PRs/));
    expect(screen.getByText("Add a CLI command?")).toBeTruthy();
    expect(within(chips).getByText("2 · Two PRs")).toBeTruthy();

    fireEvent.click(within(chips).getByText("1 · Ship to all"));
    expect(screen.getByText("Ship behind a flag?")).toBeTruthy();
    expect(option(/Ship to all/).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(
      screen.getByRole("button", { name: "Remove pick for decision 1" }),
    );
    expect(within(chips).queryByText("1 · Ship to all")).toBeNull();
    expect(option(/Ship to all/).getAttribute("aria-pressed")).toBe("false");
  });

  it("reports all picked only after the last open decision gets a pick", async () => {
    const { onAllPicked } = renderCard();
    await screen.findByText("Ship behind a flag?");
    fireEvent.click(option(/Ship to all/));
    fireEvent.click(option(/Two PRs/));
    expect(onAllPicked).not.toHaveBeenCalled();
    fireEvent.click(option(/Later/));
    expect(onAllPicked).toHaveBeenCalledTimes(1);
  });

  it("composes one message from the picks and the free text", async () => {
    const { onSend } = renderCard();
    await screen.findByText("Ship behind a flag?");
    fireEvent.click(option(/Flag it/));
    fireEvent.click(option(/One PR/));
    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
      target: { value: "Also update the guide." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(sentText(onSend)).toBe(
      [
        "Decision 1 — Ship behind a flag?: Flag it",
        "Decision 2 — Split the PR?: One PR",
        "Also update the guide.",
      ].join("\n"),
    );
  });

  it("composes a message from picks alone", async () => {
    const { onSend } = renderCard();
    await screen.findByText("Ship behind a flag?");
    fireEvent.click(screen.getByRole("button", { name: "Next decision" }));
    fireEvent.click(screen.getByRole("button", { name: "Next decision" }));
    fireEvent.click(option(/Later/));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onSend.mock.calls.at(-1)?.[0]).toEqual([
      {
        type: "text",
        text: "Decision 3 — Add a CLI command?: Later",
        mentions: [],
      },
    ]);
  });

  it("uses a typed answer as the pick and moves to the next decision", async () => {
    const { onSend } = renderCard();
    await screen.findByText("Ship behind a flag?");
    const field = screen.getByRole("textbox", {
      name: "Your own answer for decision 1",
    });
    fireEvent.change(field, { target: { value: "  Flag it for staff  " } });
    fireEvent.click(screen.getByRole("button", { name: "Use this answer" }));
    expect(screen.getByText("Split the PR?")).toBeTruthy();
    const chips = screen.getByRole("list", { name: "Picked answers" });
    expect(within(chips).getByText("1 · Flag it for staff")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(sentText(onSend)).toBe(
      "Decision 1 — Ship behind a flag?: Flag it for staff",
    );

    fireEvent.click(within(chips).getByText("1 · Flag it for staff"));
    const revisited = screen.getByRole("textbox", {
      name: "Your own answer for decision 1",
    });
    expect((revisited as HTMLInputElement).value).toBe("Flag it for staff");
    fireEvent.click(option(/Ship to all/));
    expect(within(chips).getByText("1 · Ship to all")).toBeTruthy();
  });

  it("reports all picked when Enter submits the last typed answer", async () => {
    const { onAllPicked } = renderCard();
    await screen.findByText("Ship behind a flag?");
    fireEvent.click(option(/Flag it/));
    fireEvent.click(option(/One PR/));
    const field = screen.getByRole("textbox", {
      name: "Your own answer for decision 3",
    });
    fireEvent.change(field, { target: { value: "Only a flag" } });
    fireEvent.submit(field);
    expect(onAllPicked).toHaveBeenCalledTimes(1);
  });

  it("does not page or pick while the user types an answer", async () => {
    renderCard();
    await screen.findByText("Ship behind a flag?");
    const field = screen.getByRole("textbox", {
      name: "Your own answer for decision 1",
    });
    field.focus();
    pressKey("ArrowRight", field);
    pressKey("1", field);
    expect(screen.getByText("Ship behind a flag?")).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Picked answers" })).toBeNull();
  });

  it("focuses the answer field with the number after the last option", async () => {
    renderCard();
    await screen.findByText("Ship behind a flag?");
    fireEvent.click(screen.getByRole("button", { name: "Next decision" }));
    pressKey("3");
    expect(document.activeElement).toBe(
      screen.getByRole("textbox", { name: "Your own answer for decision 2" }),
    );
    expect(screen.queryByRole("list", { name: "Picked answers" })).toBeNull();
  });

  it("collapses to the header and chips, and expands again", async () => {
    renderCard();
    await screen.findByText("Ship behind a flag?");
    fireEvent.click(option(/Flag it/));

    fireEvent.click(screen.getByRole("button", { name: "Collapse decisions" }));
    expect(screen.queryByRole("button", { name: "Next decision" })).toBeNull();
    expect(screen.getByText("1 of 3 picked")).toBeTruthy();
    expect(screen.getByText("1 · Flag it")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Two PRs/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Expand decisions" }));
    expect(screen.getByRole("button", { name: /Two PRs/ })).toBeTruthy();
  });

  it("picks with number keys and pages with arrow keys inside the card", async () => {
    renderCard();
    await screen.findByText("Ship behind a flag?");

    pressKey("3");
    expect(screen.getByText("Split the PR?")).toBeTruthy();
    expect(screen.getByText("1 · You decide")).toBeTruthy();

    pressKey("4");
    expect(screen.queryByText(/^2 · /)).toBeNull();

    const nextButton = screen.getByRole("button", { name: "Next decision" });
    nextButton.focus();
    pressKey("ArrowLeft", nextButton);
    expect(screen.getByText("Ship behind a flag?")).toBeTruthy();
    pressKey("ArrowRight", document.activeElement ?? window);
    expect(screen.getByText("Split the PR?")).toBeTruthy();
  });

  it("ignores number keys while the user types in the composer", async () => {
    renderCard();
    await screen.findByText("Ship behind a flag?");
    const composer = screen.getByRole("textbox", { name: "Message" });
    composer.focus();
    pressKey("1", composer);
    expect(screen.queryByRole("list", { name: "Picked answers" })).toBeNull();
    expect(screen.getByText("Ship behind a flag?")).toBeTruthy();
  });

  it("dismisses the set through the decisions API", async () => {
    renderCard();
    await screen.findByText("Ship behind a flag?");
    mocks.list.mockResolvedValue([]);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss decisions" }));
    await waitFor(() =>
      expect(mocks.dismiss).toHaveBeenCalledWith({
        threadId: "thr_1",
        decisionSetId: "tds_1",
      }),
    );
    await waitFor(() =>
      expect(screen.queryByText("Decisions needed")).toBeNull(),
    );
  });

  it("opens the page in a drawer on compact screens", async () => {
    renderCard({ compact: true });
    const title = await screen.findByRole("button", {
      name: /Decisions needed/,
    });
    expect(screen.queryByText("Ship behind a flag?")).toBeNull();
    expect(screen.getByText("0 of 3 picked")).toBeTruthy();

    fireEvent.click(title);
    fireEvent.click(await screen.findByRole("button", { name: /Flag it/ }));
    expect(await screen.findByText("Split the PR?")).toBeTruthy();
    expect(screen.getByText("1 · Flag it")).toBeTruthy();
  });

  it("shows nothing and makes no request when the experiment is off", async () => {
    mocks.decisionCards = false;
    renderCard();
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByText("Decisions needed")).toBeNull();
    expect(mocks.list).not.toHaveBeenCalled();
  });
});
