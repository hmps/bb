import {
  mutationOptions,
  type QueryClient,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import type { ThreadDecisionSet } from "@bb/domain";
import { sdk } from "@/lib/sdk";
import { forgetDismissedThreadDecisionSet } from "../cache-owners/thread-decisions-cache-owner";

interface DismissThreadDecisionsRequest {
  threadId: string;
  decisionSetId: string;
}

export function dismissThreadDecisionsMutationOptions(
  queryClient: QueryClient,
) {
  return mutationOptions({
    meta: { errorMessage: "Failed to dismiss decisions." },
    mutationFn: ({
      threadId,
      decisionSetId,
    }: DismissThreadDecisionsRequest): Promise<ThreadDecisionSet> =>
      sdk.threads.experimental_decisions.dismiss({ threadId, decisionSetId }),
    onSuccess: (_set, { threadId, decisionSetId }) =>
      forgetDismissedThreadDecisionSet({
        queryClient,
        threadId,
        decisionSetId,
      }),
  });
}

export function useDismissThreadDecisions() {
  const queryClient = useQueryClient();
  return useMutation(dismissThreadDecisionsMutationOptions(queryClient));
}
