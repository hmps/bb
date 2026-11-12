import { useCallback, useMemo, useState } from "react";
import type { PromptInput, ThreadDecisionSet } from "@bb/domain";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import { useThreadDecisions } from "@/hooks/queries/thread-decisions";
import {
  withDecisionAnswer,
  type DecisionPick,
  type DecisionPicks,
} from "./decision-answer";

const NO_PICKS: DecisionPicks = new Map();

export interface ThreadDecisionAnswers {
  openSet: ThreadDecisionSet | null;
  picks: DecisionPicks;
  pick: (decisionIndex: number, pick: DecisionPick) => void;
  unpick: (decisionIndex: number) => void;
  clear: () => void;
  applyTo: (input: readonly PromptInput[]) => PromptInput[];
}

export function useThreadDecisionAnswers(
  threadId: string,
): ThreadDecisionAnswers {
  const enabled = useSystemConfig().data?.experiments.decisionCards === true;
  const decisions = useThreadDecisions(threadId, { enabled });
  const openSet = enabled
    ? (decisions.data?.find((set) => set.status === "open") ?? null)
    : null;
  const openSetId = openSet?.id ?? null;
  const [state, setState] = useState<{
    setId: string | null;
    picks: DecisionPicks;
  }>({ setId: null, picks: NO_PICKS });
  const picks = state.setId === openSetId ? state.picks : NO_PICKS;

  const pick = useCallback(
    (decisionIndex: number, pick: DecisionPick) => {
      setState((current) => {
        const next = new Map(
          current.setId === openSetId ? current.picks : NO_PICKS,
        );
        next.set(decisionIndex, pick);
        return { setId: openSetId, picks: next };
      });
    },
    [openSetId],
  );
  const unpick = useCallback(
    (decisionIndex: number) => {
      setState((current) => {
        if (current.setId !== openSetId) return current;
        const next = new Map(current.picks);
        next.delete(decisionIndex);
        return { setId: openSetId, picks: next };
      });
    },
    [openSetId],
  );
  const clear = useCallback(() => {
    setState({ setId: null, picks: NO_PICKS });
  }, []);
  const applyTo = useCallback(
    (input: readonly PromptInput[]) =>
      openSet === null
        ? [...input]
        : withDecisionAnswer(input, openSet.decisions, picks),
    [openSet, picks],
  );

  return useMemo(
    () => ({ openSet, picks, pick, unpick, clear, applyTo }),
    [applyTo, clear, openSet, pick, picks, unpick],
  );
}
