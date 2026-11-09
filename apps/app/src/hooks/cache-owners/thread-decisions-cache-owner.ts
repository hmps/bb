import type { ThreadDecisionSet } from "@bb/domain";
import type { ThreadArg } from "../cache-effect-types";
import { threadDecisionsQueryKey } from "../queries/query-keys";

export function forgetDismissedThreadDecisionSet({
  queryClient,
  threadId,
  decisionSetId,
}: ThreadArg & { decisionSetId: string }): Promise<void> {
  queryClient.setQueryData<ThreadDecisionSet[]>(
    threadDecisionsQueryKey(threadId),
    (sets) => sets?.filter((set) => set.id !== decisionSetId),
  );
  return queryClient.invalidateQueries({
    queryKey: threadDecisionsQueryKey(threadId),
  });
}
