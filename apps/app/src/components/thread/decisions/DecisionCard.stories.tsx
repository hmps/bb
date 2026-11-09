import { useRef, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { defaultExperiments, type ThreadDecisionSet } from "@bb/domain";
import { AppCommandProvider } from "@/components/commands/AppCommandProvider";
import {
  systemConfigQueryKey,
  threadDecisionsQueryKey,
} from "@/hooks/queries/query-keys";
import { makeSystemConfig } from "@/test/fixtures/system-config";
import { StoryCard } from "../../../../.ladle/story-card";
import { DecisionCard } from "./DecisionCard";
import { useThreadDecisionAnswers } from "./useThreadDecisionAnswers";

export default {
  title: "thread/decisions/Decision Card",
};

const THREAD_ID = "thr_story_decisions";

const decisionSet: ThreadDecisionSet = {
  id: "tds_story",
  threadId: THREAD_ID,
  turnId: "turn_story",
  toolCallId: "call_story",
  headline: "Three choices change what goes in the PR",
  status: "open",
  resolutionRequestId: null,
  resolutionText: null,
  createdAt: 0,
  resolvedAt: null,
  decisions: [
    {
      question: "Ship the decision card behind an experiment flag?",
      context: [
        "The card changes how every thread ends, so a bad prompt makes agents call the tool too often or never. A flag lets us measure first.",
        "",
        "What the flag hides:",
        "",
        "- the `request_decisions` tool in agent sessions",
        "- the card above the composer",
        '- the "Needs you" push text',
        "",
        "Without the flag, all users get the tool on the next release, and we fix prompt problems live.",
      ].join("\n"),
      options: [
        { label: "Flag it", does: "Only you see it until we measure" },
        { label: "Ship to all", does: "Everyone gets it on the next release" },
        { label: "You decide", does: "I pick, and I note why in the PR" },
      ],
      suggested: 0,
      links: [
        {
          label: "Plan: inherited-chasing-blanket.md",
          href: "https://example.com/plan",
        },
        {
          label: "Setup guide experiment (#7172)",
          href: "https://github.com/get-bb/bb/pull/7172",
        },
      ],
    },
    {
      question: "Split the work into two PRs?",
      context: "Server and UI land separately, so each review stays small.",
      options: [
        { label: "One PR", does: "Everything lands together" },
        { label: "Two PRs", does: "Server first, then the card" },
      ],
      suggested: 1,
      links: [],
    },
    {
      question: "Add a CLI command for decisions now?",
      context: "`bb thread decisions` lists and answers open sets.",
      options: [
        { label: "Now", does: "Ship it with the card" },
        { label: "Later", does: "Leave it for a follow-up" },
      ],
      suggested: 0,
      links: [],
    },
  ],
};

function createQueryClient() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, gcTime: Infinity },
    },
  });
  queryClient.setQueryData(
    systemConfigQueryKey(),
    makeSystemConfig({
      experiments: { ...defaultExperiments, decisionCards: true },
    }),
  );
  queryClient.setQueryData(threadDecisionsQueryKey(THREAD_ID), [decisionSet]);
  return queryClient;
}

function StoryProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <AppCommandProvider>{children}</AppCommandProvider>
    </QueryClientProvider>
  );
}

function PromptStack() {
  const answers = useThreadDecisionAnswers(THREAD_ID);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  return (
    <div data-promptbox-shell="" className="flex flex-col gap-2">
      <DecisionCard
        threadId={THREAD_ID}
        answers={answers}
        onSomethingElse={() => composerRef.current?.focus()}
      />
      <textarea
        ref={composerRef}
        aria-label="Message"
        placeholder="Or say something else…"
        rows={2}
        className="w-full resize-none rounded-lg border border-border bg-popover p-3 text-sm text-foreground outline-none"
      />
    </div>
  );
}

export function PromptArea() {
  return (
    <StoryProviders>
      <StoryCard>
        <div className="mx-auto w-full max-w-3xl">
          <PromptStack />
        </div>
      </StoryCard>
    </StoryProviders>
  );
}
