import type { ThreadListEntry } from "@bb/domain";
import { isSidebarProjectThread } from "@bb/client-core";
import { isThreadRead, type ThreadReadState } from "@bb/client-core";

type FaviconSidebarThread = ThreadReadState &
  Pick<
    ThreadListEntry,
    | "hasPendingInteraction"
    | "hasOpenDecisions"
    | "id"
    | "originKind"
    | "parentThreadId"
    | "visibility"
  >;

interface ShouldShowFaviconAttentionDotArgs {
  currentThreadHasPendingInteraction: boolean;
  currentThreadHasOpenDecisions: boolean;
  currentThreadId?: string | null;
  isThreadView: boolean;
  sidebarThreads: readonly FaviconSidebarThread[];
  thread: ThreadReadState | null | undefined;
}

function isUnreadSidebarThread(thread: FaviconSidebarThread): boolean {
  return isSidebarProjectThread(thread) && !isThreadRead(thread);
}

function isPendingSidebarThread(thread: FaviconSidebarThread): boolean {
  return (
    isSidebarProjectThread(thread) &&
    (thread.hasPendingInteraction || thread.hasOpenDecisions)
  );
}

function isPendingDelegatedChildOfCurrentThread(
  thread: FaviconSidebarThread,
  currentThreadId: string,
): boolean {
  return (
    thread.parentThreadId === currentThreadId &&
    thread.originKind === null &&
    (thread.hasPendingInteraction || thread.hasOpenDecisions)
  );
}

export function shouldShowFaviconAttentionDot({
  currentThreadHasPendingInteraction,
  currentThreadHasOpenDecisions,
  currentThreadId,
  isThreadView,
  sidebarThreads,
  thread,
}: ShouldShowFaviconAttentionDotArgs): boolean {
  if (isThreadView) {
    const childNeedsAttention =
      currentThreadId != null &&
      sidebarThreads.some((candidate) =>
        isPendingDelegatedChildOfCurrentThread(candidate, currentThreadId),
      );
    return (
      currentThreadHasPendingInteraction ||
      currentThreadHasOpenDecisions ||
      childNeedsAttention ||
      Boolean(thread && !isThreadRead(thread))
    );
  }

  return sidebarThreads.some(
    (candidate) =>
      isPendingSidebarThread(candidate) || isUnreadSidebarThread(candidate),
  );
}

export function desktopAttentionThreads(
  sidebarThreads: readonly FaviconSidebarThread[],
): { pendingThreadIds: string[]; unreadThreadIds: string[] } {
  return {
    pendingThreadIds: sidebarThreads
      .filter(isPendingSidebarThread)
      .map((thread) => thread.id),
    unreadThreadIds: sidebarThreads
      .filter(
        (thread) =>
          !isPendingSidebarThread(thread) && isUnreadSidebarThread(thread),
      )
      .map((thread) => thread.id),
  };
}
