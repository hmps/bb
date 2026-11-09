import { queryOptions, useQuery } from "@tanstack/react-query";
import { sdk } from "@/lib/sdk";
import { useThreadDetailRealtimeSubscription } from "@/hooks/useRealtimeSubscription";
import { threadDecisionsQueryKey } from "./query-keys";
import { requireThreadId } from "./query-helpers";
import { REALTIME_OWNED_NO_FOCUS_QUERY_POLICY } from "./query-policies";

export function threadDecisionsQueryOptions(threadId: string) {
  return queryOptions({
    queryKey: threadDecisionsQueryKey(threadId),
    queryFn: ({ signal }) =>
      sdk.threads.experimental_decisions.list({
        threadId: requireThreadId(threadId, "useThreadDecisions"),
        signal,
      }),
    enabled: Boolean(threadId),
    ...REALTIME_OWNED_NO_FOCUS_QUERY_POLICY,
  });
}

export function useThreadDecisions(threadId: string) {
  useThreadDetailRealtimeSubscription(threadId, { enabled: Boolean(threadId) });
  return useQuery(threadDecisionsQueryOptions(threadId));
}
