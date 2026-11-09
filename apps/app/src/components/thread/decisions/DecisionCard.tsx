import { useId, useState } from "react";
import { NavLink } from "react-router-dom";
import {
  QUESTION_ACTION_APP_COMMAND_IDS,
  QUESTION_SELECT_APP_COMMAND_IDS,
  isAbsoluteHostPath,
  type ThreadDecision,
  type ThreadDecisionSet,
} from "@bb/domain";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { AnimatedBody } from "@bb/shared-ui/prompt-stack-disclosure";
import { ResponsiveDrawerShell } from "@bb/shared-ui/responsive-overlay";
import {
  useAppCommandContext,
  useIndexedAppCommandHandlers,
} from "@/components/commands/AppCommandProvider";
import {
  PROMPT_STACK_CARD_HEADER_BUTTON_CLASS,
  PROMPT_STACK_CARD_ROW_HEIGHT,
  PromptStackCard,
} from "@/components/promptbox/banner/PromptStackCard";
import { useThreadRoutePath } from "@/components/thread/ThreadTitleMentions";
import {
  useMessageLinkRouting,
  useThreadTimelineNavigation,
} from "@/components/thread/timeline/ThreadTimelineNavigationContext";
import { MarkdownPreview } from "@/components/ui/markdown-preview";
import { useDismissThreadDecisions } from "@/hooks/mutations/thread-decision-mutations";
import { isEditableKeyboardTarget } from "@/lib/app-keybindings";
import { useUrlAnchorClickHandler } from "@/lib/url-open-routing";
import { useOptionalPaneContext } from "@/views/thread-detail/PaneContext";
import type { DecisionPicks } from "./decision-answer";
import type { ThreadDecisionAnswers } from "./useThreadDecisionAnswers";

const ICON_BUTTON_CLASS =
  "inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-40";
const LINK_CLASS =
  "inline-flex min-w-0 max-w-full items-center gap-1 text-timeline-accent hover:underline";
const THREAD_REF_PATTERN = /^@thread:(thr_[a-z0-9]+)(?:#msg=(\d+))?$/;

interface DecisionCardProps {
  threadId: string;
  answers: ThreadDecisionAnswers;
  onSomethingElse: () => void;
}

export function DecisionCard({
  threadId,
  answers,
  onSomethingElse,
}: DecisionCardProps) {
  if (answers.openSet === null) return null;
  return (
    <DecisionSetCard
      key={answers.openSet.id}
      threadId={threadId}
      set={answers.openSet}
      answers={answers}
      onSomethingElse={onSomethingElse}
    />
  );
}

function nextUnpickedPage(
  count: number,
  from: number,
  picks: DecisionPicks,
): number | null {
  for (let offset = 1; offset < count; offset += 1) {
    const index = (from + offset) % count;
    if (!picks.has(index)) return index;
  }
  return null;
}

function DecisionSetCard({
  threadId,
  set,
  answers,
  onSomethingElse,
}: DecisionCardProps & { set: ThreadDecisionSet }) {
  const count = set.decisions.length;
  const [requestedPage, setPage] = useState(0);
  const page = Math.min(requestedPage, count - 1);
  const [isExpanded, setIsExpanded] = useState(true);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const isCompact = useIsCompactViewport();
  const isFocusedPane = useOptionalPaneContext()?.isFocused ?? true;
  const dismiss = useDismissThreadDecisions();
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const bodyId = `${baseId}-body`;
  const decision = set.decisions[page];
  const pickedCount = answers.picks.size;

  const goTo = (index: number) => {
    setPage(Math.max(0, Math.min(count - 1, index)));
  };
  const choose = (optionIndex: number) => {
    if (answers.picks.get(page) === optionIndex) {
      answers.unpick(page);
      return;
    }
    answers.pick(page, optionIndex);
    const next = nextUnpickedPage(
      count,
      page,
      new Map(answers.picks).set(page, optionIndex),
    );
    if (next === null) {
      setIsDrawerOpen(false);
      return;
    }
    setPage(next);
  };
  const showPage = (index: number) => {
    goTo(index);
    if (isCompact) setIsDrawerOpen(true);
    else setIsExpanded(true);
  };
  const somethingElse = () => {
    setIsDrawerOpen(false);
    onSomethingElse();
  };

  const keysEnabled = isFocusedPane && (isCompact ? isDrawerOpen : isExpanded);
  useAppCommandContext("questionOpen", keysEnabled);
  useIndexedAppCommandHandlers(
    QUESTION_SELECT_APP_COMMAND_IDS,
    (index, invocation) => {
      if (isEditableKeyboardTarget(invocation.target)) return false;
      if (decision === undefined || index >= decision.options.length) {
        return false;
      }
      choose(index);
      return true;
    },
    100,
    keysEnabled,
  );
  useIndexedAppCommandHandlers(
    QUESTION_ACTION_APP_COMMAND_IDS,
    (index) => {
      const command = QUESTION_ACTION_APP_COMMAND_IDS[index];
      if (command === "question.previous" && page > 0) {
        goTo(page - 1);
        return true;
      }
      if (command === "question.next" && page < count - 1) {
        goTo(page + 1);
        return true;
      }
      return false;
    },
    100,
    keysEnabled,
  );

  if (decision === undefined) return null;

  const pager = <DecisionPager page={page} count={count} onGoTo={goTo} />;
  const decisionPage = (
    <DecisionPage
      threadId={threadId}
      decision={decision}
      decisionIndex={page}
      pickedOption={answers.picks.get(page) ?? null}
      isCompact={isCompact}
      onChoose={choose}
      onSomethingElse={somethingElse}
    />
  );
  const showSummary = isCompact || !isExpanded;

  return (
    <PromptStackCard
      ariaLabel="Decisions needed"
      className="overflow-hidden"
      style={{ minHeight: PROMPT_STACK_CARD_ROW_HEIGHT }}
    >
      <div data-question-form="">
        <div className="flex items-center gap-1 pr-1.5">
          <button
            type="button"
            id={titleId}
            {...(isCompact
              ? { "aria-haspopup": "dialog" as const }
              : { "aria-expanded": isExpanded, "aria-controls": bodyId })}
            onClick={() =>
              isCompact
                ? setIsDrawerOpen(true)
                : setIsExpanded((value) => !value)
            }
            className={cn(
              PROMPT_STACK_CARD_HEADER_BUTTON_CLASS,
              "flex-1 gap-2 text-sm",
            )}
          >
            <span
              aria-hidden="true"
              className="size-2 shrink-0 rounded-full bg-attention"
            />
            <span className="shrink-0">Decisions needed</span>
            {showSummary ? (
              <span className="min-w-0 truncate text-xs text-muted-foreground">
                {`${pickedCount} of ${count} picked`}
              </span>
            ) : null}
          </button>
          {!isCompact && isExpanded ? pager : null}
          <button
            type="button"
            aria-label="Dismiss decisions"
            disabled={dismiss.isPending}
            onClick={() => dismiss.mutate({ threadId, decisionSetId: set.id })}
            className={ICON_BUTTON_CLASS}
          >
            <Icon name="X" className="size-3.5" aria-hidden="true" />
          </button>
          {isCompact ? null : (
            <button
              type="button"
              aria-label={
                isExpanded ? "Collapse decisions" : "Expand decisions"
              }
              aria-expanded={isExpanded}
              aria-controls={bodyId}
              onClick={() => setIsExpanded((value) => !value)}
              className={ICON_BUTTON_CLASS}
            >
              <Icon
                name="ChevronDown"
                className={cn(
                  "size-3.5 transition-transform",
                  isExpanded && "rotate-180",
                )}
                aria-hidden="true"
              />
            </button>
          )}
        </div>
        {isCompact ? null : (
          <AnimatedBody
            id={bodyId}
            labelledBy={titleId}
            isExpanded={isExpanded}
            collapsedBorder="none"
          >
            {decisionPage}
          </AnimatedBody>
        )}
        <DecisionChips
          set={set}
          picks={answers.picks}
          onShow={showPage}
          onRemove={answers.unpick}
        />
      </div>
      {isCompact ? (
        <ResponsiveDrawerShell
          open={isDrawerOpen}
          onOpenChange={setIsDrawerOpen}
          srLabel="Decisions needed"
        >
          <div
            data-question-form=""
            className="flex max-h-[80dvh] flex-col overflow-y-auto pb-2"
          >
            <div className="flex items-center gap-2 px-3 pt-1">
              <span
                aria-hidden="true"
                className="size-2 shrink-0 rounded-full bg-attention"
              />
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                {set.headline}
              </span>
              {pager}
            </div>
            {decisionPage}
          </div>
        </ResponsiveDrawerShell>
      ) : null}
    </PromptStackCard>
  );
}

function DecisionPager({
  page,
  count,
  onGoTo,
}: {
  page: number;
  count: number;
  onGoTo: (index: number) => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground">
      <button
        type="button"
        aria-label="Previous decision"
        disabled={page === 0}
        onClick={() => onGoTo(page - 1)}
        className={ICON_BUTTON_CLASS}
      >
        <Icon name="ChevronLeft" className="size-3.5" aria-hidden="true" />
      </button>
      <span className="tabular-nums" aria-live="polite">
        {`${page + 1} of ${count}`}
      </span>
      <button
        type="button"
        aria-label="Next decision"
        disabled={page === count - 1}
        onClick={() => onGoTo(page + 1)}
        className={ICON_BUTTON_CLASS}
      >
        <Icon name="ChevronRight" className="size-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}

function DecisionPage({
  threadId,
  decision,
  decisionIndex,
  pickedOption,
  isCompact,
  onChoose,
  onSomethingElse,
}: {
  threadId: string;
  decision: ThreadDecision;
  decisionIndex: number;
  pickedOption: number | null;
  isCompact: boolean;
  onChoose: (optionIndex: number) => void;
  onSomethingElse: () => void;
}) {
  const linkRouting = useMessageLinkRouting(threadId);
  return (
    <div className="flex flex-col gap-2.5 px-3 pt-2.5 pb-3">
      <h3 className="text-base text-foreground">{decision.question}</h3>
      <div
        data-decision-context=""
        className="max-h-48 overflow-y-auto rounded-lg bg-surface-recessed px-3 py-2"
      >
        <MarkdownPreview
          content={decision.context}
          className="text-sm text-foreground"
          imagePolicy="alt-text"
          linkRouting={linkRouting}
        />
      </div>
      {decision.links.length > 0 ? (
        <ul className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
          {decision.links.map((link) => (
            <li key={link.href} className="min-w-0 max-w-full">
              <DecisionLink label={link.label} href={link.href} />
            </li>
          ))}
        </ul>
      ) : null}
      <div
        role="group"
        aria-label={`Options for decision ${decisionIndex + 1}`}
        className="flex flex-col gap-1.5"
      >
        {decision.options.map((option, optionIndex) => {
          const isPicked = pickedOption === optionIndex;
          const isSuggested = decision.suggested === optionIndex;
          return (
            <button
              key={optionIndex}
              type="button"
              aria-pressed={isPicked}
              onClick={() => onChoose(optionIndex)}
              className={cn(
                "flex min-h-9 w-full min-w-0 cursor-pointer gap-3 rounded-lg border px-3 py-1.5 text-left text-sm transition-colors",
                isCompact ? "items-start" : "items-center",
                isPicked
                  ? "border-timeline-accent bg-timeline-accent/15"
                  : isSuggested
                    ? "border-timeline-accent/40 bg-timeline-accent/10 hover:bg-timeline-accent/15"
                    : "border-transparent bg-surface-recessed hover:bg-state-hover",
              )}
            >
              <span className="flex w-3 shrink-0 justify-center text-xs tabular-nums text-muted-foreground">
                {isPicked ? (
                  <Icon
                    name="Check"
                    className="size-3.5 text-timeline-accent"
                    aria-hidden="true"
                  />
                ) : (
                  optionIndex + 1
                )}
              </span>
              <span
                className={cn(
                  "flex min-w-0 flex-1",
                  isCompact ? "flex-col" : "items-center gap-3",
                )}
              >
                <span className="shrink-0 text-foreground">{option.label}</span>
                <span
                  className={cn(
                    "min-w-0 text-muted-foreground",
                    !isCompact && "truncate",
                  )}
                >
                  {option.does}
                </span>
              </span>
              {isSuggested ? (
                <span className="shrink-0 text-xs text-timeline-accent">
                  Recommended
                </span>
              ) : null}
            </button>
          );
        })}
        <button
          type="button"
          onClick={onSomethingElse}
          className="flex min-h-9 w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground"
        >
          <span aria-hidden="true" className="w-3 shrink-0" />
          Something else…
        </button>
      </div>
    </div>
  );
}

function DecisionChips({
  set,
  picks,
  onShow,
  onRemove,
}: {
  set: ThreadDecisionSet;
  picks: DecisionPicks;
  onShow: (decisionIndex: number) => void;
  onRemove: (decisionIndex: number) => void;
}) {
  if (picks.size === 0) return null;
  const entries = [...picks].sort(([left], [right]) => left - right);
  return (
    <ul
      aria-label="Picked answers"
      className="flex flex-wrap gap-1.5 border-t border-border px-3 py-2"
    >
      {entries.map(([decisionIndex, optionIndex]) => {
        const label =
          set.decisions[decisionIndex]?.options[optionIndex]?.label ?? "";
        return (
          <li
            key={decisionIndex}
            className="inline-flex min-w-0 max-w-full items-center rounded-full bg-surface-recessed text-xs"
          >
            <button
              type="button"
              onClick={() => onShow(decisionIndex)}
              className="min-w-0 cursor-pointer truncate py-0.5 pr-1 pl-2.5 text-foreground"
            >
              {`${decisionIndex + 1} · ${label}`}
            </button>
            <button
              type="button"
              aria-label={`Remove pick for decision ${decisionIndex + 1}`}
              onClick={() => onRemove(decisionIndex)}
              className="mr-0.5 inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground hover:bg-state-hover hover:text-foreground"
            >
              <Icon name="X" className="size-3" aria-hidden="true" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function DecisionLink({ label, href }: { label: string; href: string }) {
  const threadRef = THREAD_REF_PATTERN.exec(href);
  if (threadRef?.[1] !== undefined) {
    return (
      <ThreadDecisionLink
        label={label}
        threadId={threadRef[1]}
        messageSeq={threadRef[2] === undefined ? null : Number(threadRef[2])}
      />
    );
  }
  if (isAbsoluteHostPath(href)) {
    return <FileDecisionLink label={label} path={href} />;
  }
  return <UrlDecisionLink label={label} href={href} />;
}

function LinkLabel({ label }: { label: string }) {
  return (
    <>
      <Icon
        name="ArrowUpRight"
        className="size-3 shrink-0"
        aria-hidden="true"
      />
      <span className="min-w-0 truncate">{label}</span>
    </>
  );
}

function ThreadDecisionLink({
  label,
  threadId,
  messageSeq,
}: {
  label: string;
  threadId: string;
  messageSeq: number | null;
}) {
  const threadRoutePath = useThreadRoutePath();
  return (
    <NavLink
      to={threadRoutePath(threadId, undefined, messageSeq)}
      className={LINK_CLASS}
    >
      <LinkLabel label={label} />
    </NavLink>
  );
}

function FileDecisionLink({ label, path }: { label: string; path: string }) {
  const navigation = useThreadTimelineNavigation();
  if (navigation === null) {
    return (
      <span
        className="inline-flex min-w-0 max-w-full items-center gap-1 text-muted-foreground"
        title={path}
      >
        <LinkLabel label={label} />
      </span>
    );
  }
  return (
    <button
      type="button"
      title={path}
      onClick={() =>
        navigation.onOpenLocalFileLink({
          path,
          lineRange: null,
          openTargetId: null,
        })
      }
      className={cn(LINK_CLASS, "cursor-pointer")}
    >
      <LinkLabel label={label} />
    </button>
  );
}

function UrlDecisionLink({ label, href }: { label: string; href: string }) {
  const onClick = useUrlAnchorClickHandler(href);
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      onClick={onClick}
      className={LINK_CLASS}
    >
      <LinkLabel label={label} />
    </a>
  );
}
