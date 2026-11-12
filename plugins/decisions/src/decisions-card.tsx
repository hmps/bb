import {
  type RefObject,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Markdown,
  experimental_useQuestionFormHost,
  type PluginPendingInteractionProps,
} from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { answerLabel } from "./answer.js";
import {
  interactionPayloadSchema,
  isThreadRef,
  type Decision,
  type DecisionAnswer,
  type InteractionPayload,
  type InteractionResponse,
} from "./contracts.js";

type DecisionPick = { option: number } | { text: string };
type Picks = ReadonlyArray<DecisionPick | undefined>;

const ICON_BUTTON_CLASS =
  "inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-40";

function nextUnpickedPage(picks: Picks, from: number): number | null {
  const count = picks.length;
  for (let offset = 1; offset < count; offset += 1) {
    const index = (from + offset) % count;
    if (picks[index] === undefined) return index;
  }
  return null;
}

function isEditableElement(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false;
  return (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element.isContentEditable
  );
}

function toAnswer(pick: DecisionPick): DecisionAnswer {
  return "option" in pick
    ? { option: pick.option }
    : { text: pick.text.trim() };
}

function toResponse(picks: Picks): InteractionResponse | null {
  const answers: DecisionAnswer[] = [];
  for (const pick of picks) {
    if (pick === undefined) return null;
    answers.push(toAnswer(pick));
  }
  return { answers };
}

function escapeLinkLabel(label: string): string {
  return label.replace(/[\\[\]]/g, (char) => `\\${char}`);
}

function linkMarkdown(link: Decision["links"][number]): string {
  const label = escapeLinkLabel(link.label);
  if (isThreadRef(link.href)) return `${label}: ${link.href}`;
  return `[${label}](<${link.href}>)`;
}

export function DecisionsInteraction({
  interaction,
  submit,
  cancel,
}: PluginPendingInteractionProps) {
  const parsed = useMemo(
    () => interactionPayloadSchema.safeParse(interaction.payload),
    [interaction.payload],
  );
  const handleCancel = () => {
    void cancel().catch(() => {});
  };
  if (!parsed.success) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          These decisions could not be displayed.
        </p>
        <Button type="button" variant="outline" onClick={handleCancel}>
          Dismiss
        </Button>
      </div>
    );
  }
  return (
    <DecisionsForm
      key={interaction.id}
      payload={parsed.data}
      submit={submit}
      cancel={cancel}
    />
  );
}

function DecisionsForm({
  payload,
  submit,
  cancel,
}: {
  payload: InteractionPayload;
  submit: PluginPendingInteractionProps["submit"];
  cancel: PluginPendingInteractionProps["cancel"];
}) {
  const count = payload.decisions.length;
  const [picks, setPicks] = useState<Picks>(() =>
    Array.from({ length: count }, () => undefined),
  );
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);
  const ownAnswerRef = useRef<HTMLInputElement>(null);
  const {
    shortcuts,
    actionShortcuts,
    registerChoiceHandler,
    registerActionHandler,
  } = experimental_useQuestionFormHost();
  const decision = payload.decisions[page];
  const pickedCount = picks.filter((pick) => pick !== undefined).length;
  const response = toResponse(picks);

  const send = (value: InteractionResponse) => {
    if (busy) return;
    setBusy(true);
    void submit(value)
      .catch(() => {})
      .finally(() => setBusy(false));
  };
  const dismiss = () => {
    if (busy) return;
    void cancel().catch(() => {});
  };
  const goTo = (index: number) => {
    setPage(Math.max(0, Math.min(count - 1, index)));
  };
  const setPick = (index: number, pick: DecisionPick | undefined) => {
    const next = picks.map((current, at) => (at === index ? pick : current));
    setPicks(next);
    return next;
  };
  const choose = (pick: DecisionPick) => {
    const current = picks[page];
    if (
      "option" in pick &&
      current !== undefined &&
      "option" in current &&
      current.option === pick.option
    ) {
      setPick(page, undefined);
      return;
    }
    const next = setPick(page, pick);
    const nextPage = nextUnpickedPage(next, page);
    if (nextPage !== null) {
      setPage(nextPage);
      return;
    }
    const value = toResponse(next);
    if (value !== null) send(value);
  };
  const type = (text: string) => {
    if (text.trim().length > 0) {
      setPick(page, { text });
      return;
    }
    const current = picks[page];
    if (current !== undefined && "text" in current) setPick(page, undefined);
  };
  const showPage = (index: number) => {
    goTo(index);
    formRef.current?.focus();
  };

  const runAction = (action: string): boolean => {
    if (action === "cancel") {
      dismiss();
      return true;
    }
    if (busy) return false;
    if (action === "submit") {
      if (response === null) return false;
      send(response);
      return true;
    }
    if (isEditableElement(document.activeElement)) return false;
    if (action === "previous" && page > 0) {
      goTo(page - 1);
      return true;
    }
    if (action === "next" && page < count - 1) {
      goTo(page + 1);
      return true;
    }
    return false;
  };
  const runChoice = (index: number): boolean => {
    if (busy || decision === undefined) return false;
    if (index < decision.options.length) {
      choose({ option: index });
      return true;
    }
    if (index === decision.options.length && ownAnswerRef.current !== null) {
      ownAnswerRef.current.focus();
      return true;
    }
    return false;
  };
  const runActionRef = useRef(runAction);
  const runChoiceRef = useRef(runChoice);
  useLayoutEffect(() => {
    runActionRef.current = runAction;
    runChoiceRef.current = runChoice;
  });
  useEffect(
    () => registerActionHandler((action) => runActionRef.current(action)),
    [registerActionHandler],
  );
  useEffect(
    () => registerChoiceHandler((index) => runChoiceRef.current(index)),
    [registerChoiceHandler],
  );

  if (decision === undefined) return null;
  const pick = picks[page];

  return (
    <div
      ref={formRef}
      tabIndex={-1}
      data-question-form
      className="-m-1 flex min-h-0 flex-col gap-2.5 rounded-md p-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
    >
      {count > 1 ? (
        <DecisionPager
          page={page}
          count={count}
          previousShortcut={actionShortcuts.get("previous")?.ariaKeyshortcuts}
          nextShortcut={actionShortcuts.get("next")?.ariaKeyshortcuts}
          onGoTo={goTo}
        />
      ) : null}
      <DecisionPage
        key={page}
        decision={decision}
        decisionIndex={page}
        pick={pick}
        shortcuts={shortcuts}
        ownAnswerRef={ownAnswerRef}
        onChoose={choose}
        onType={type}
      />
      <DecisionChips
        decisions={payload.decisions}
        picks={picks}
        onShow={showPage}
        onRemove={(index) => setPick(index, undefined)}
      />
      <div className="flex shrink-0 items-center justify-between gap-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-keyshortcuts={actionShortcuts.get("cancel")?.ariaKeyshortcuts}
          disabled={busy}
          onClick={dismiss}
        >
          Dismiss
        </Button>
        <div className="flex items-center gap-2">
          <span className="text-xs tabular-nums text-muted-foreground">
            {`${pickedCount} of ${count} picked`}
          </span>
          <Button
            type="button"
            size="sm"
            aria-keyshortcuts={actionShortcuts.get("submit")?.ariaKeyshortcuts}
            disabled={busy || response === null}
            onClick={() => {
              if (response !== null) send(response);
            }}
          >
            {busy ? (
              <Icon name="Spinner" className="size-3 animate-spin" />
            ) : null}
            Submit
          </Button>
        </div>
      </div>
    </div>
  );
}

function DecisionPager({
  page,
  count,
  previousShortcut,
  nextShortcut,
  onGoTo,
}: {
  page: number;
  count: number;
  previousShortcut: string | undefined;
  nextShortcut: string | undefined;
  onGoTo: (index: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
      <span className="tabular-nums" aria-live="polite">
        {`Decision ${page + 1} of ${count}`}
      </span>
      <div className="flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          aria-label="Previous decision"
          aria-keyshortcuts={previousShortcut}
          disabled={page === 0}
          onClick={() => onGoTo(page - 1)}
          className={ICON_BUTTON_CLASS}
        >
          <Icon name="ChevronLeft" className="size-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="Next decision"
          aria-keyshortcuts={nextShortcut}
          disabled={page === count - 1}
          onClick={() => onGoTo(page + 1)}
          className={ICON_BUTTON_CLASS}
        >
          <Icon name="ChevronRight" className="size-3.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function DecisionPage({
  decision,
  decisionIndex,
  pick,
  shortcuts,
  ownAnswerRef,
  onChoose,
  onType,
}: {
  decision: Decision;
  decisionIndex: number;
  pick: DecisionPick | undefined;
  shortcuts: ReadonlyMap<string, { label: string; ariaKeyshortcuts: string }>;
  ownAnswerRef: RefObject<HTMLInputElement | null>;
  onChoose: (pick: DecisionPick) => void;
  onType: (text: string) => void;
}) {
  const pickedOption =
    pick !== undefined && "option" in pick ? pick.option : null;
  return (
    <div className="flex flex-col gap-2.5">
      <h3 className="text-base text-foreground">{decision.question}</h3>
      <div className="max-h-48 overflow-y-auto rounded-lg bg-surface-recessed px-3 py-2">
        <Markdown
          content={decision.context}
          className="text-sm text-foreground"
        />
      </div>
      {decision.links.length > 0 ? (
        <ul aria-label="Links" className="flex flex-wrap gap-x-5 gap-y-1">
          {decision.links.map((link) => (
            <li key={link.href} className="min-w-0 max-w-full">
              <Markdown content={linkMarkdown(link)} className="text-xs" />
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
              key={option.label}
              type="button"
              aria-pressed={isPicked}
              aria-keyshortcuts={
                shortcuts.get(String(optionIndex))?.ariaKeyshortcuts
              }
              onClick={() => onChoose({ option: optionIndex })}
              className={cn(
                "flex min-h-9 w-full min-w-0 cursor-pointer items-center gap-3 rounded-lg border px-3 py-1.5 text-left text-sm transition-colors",
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
              <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3">
                <span className="shrink-0 text-foreground">{option.label}</span>
                <span className="min-w-0 text-muted-foreground">
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
        <OwnAnswer
          decisionIndex={decisionIndex}
          optionNumber={decision.options.length + 1}
          text={pick !== undefined && "text" in pick ? pick.text : ""}
          inputRef={ownAnswerRef}
          onType={onType}
          onSubmit={(text) => onChoose({ text })}
        />
      </div>
    </div>
  );
}

function OwnAnswer({
  decisionIndex,
  optionNumber,
  text,
  inputRef,
  onType,
  onSubmit,
}: {
  decisionIndex: number;
  optionNumber: number;
  text: string;
  inputRef: RefObject<HTMLInputElement | null>;
  onType: (text: string) => void;
  onSubmit: (text: string) => void;
}) {
  const isPicked = text.length > 0;
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (isPicked) onSubmit(text);
      }}
      className={cn(
        "flex min-h-9 w-full min-w-0 items-center gap-3 rounded-lg border py-0.5 pr-1 pl-3 text-sm transition-colors focus-within:border-timeline-accent/60",
        isPicked
          ? "border-timeline-accent bg-timeline-accent/15"
          : "border-transparent bg-surface-recessed",
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
          optionNumber
        )}
      </span>
      <input
        ref={inputRef}
        type="text"
        value={text}
        onChange={(event) => onType(event.target.value)}
        placeholder="Something else…"
        aria-label={`Your own answer for decision ${decisionIndex + 1}`}
        enterKeyHint="next"
        className="min-w-0 flex-1 bg-transparent py-1 text-foreground outline-none placeholder:text-muted-foreground"
      />
      {isPicked ? (
        <button
          type="submit"
          aria-label="Use this answer"
          className={ICON_BUTTON_CLASS}
        >
          <Icon name="CornerDownLeft" className="size-3.5" aria-hidden="true" />
        </button>
      ) : null}
    </form>
  );
}

function DecisionChips({
  decisions,
  picks,
  onShow,
  onRemove,
}: {
  decisions: readonly Decision[];
  picks: Picks;
  onShow: (index: number) => void;
  onRemove: (index: number) => void;
}) {
  const entries = picks.flatMap((pick, index) =>
    pick === undefined ? [] : [{ index, pick }],
  );
  if (entries.length === 0) return null;
  return (
    <ul
      aria-label="Picked answers"
      className="flex flex-wrap gap-1.5 border-t border-border pt-2"
    >
      {entries.map(({ index, pick }) => (
        <li
          key={index}
          className="inline-flex min-w-0 max-w-full items-center rounded-full bg-surface-recessed text-xs"
        >
          <button
            type="button"
            onClick={() => onShow(index)}
            className="min-w-0 cursor-pointer truncate py-0.5 pr-1 pl-2.5 text-foreground"
          >
            {`${index + 1} · ${answerLabel(decisions[index], toAnswer(pick)) ?? ""}`}
          </button>
          <button
            type="button"
            aria-label={`Remove pick for decision ${index + 1}`}
            onClick={() => onRemove(index)}
            className="mr-0.5 inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground hover:bg-state-hover hover:text-foreground"
          >
            <Icon name="X" className="size-3" aria-hidden="true" />
          </button>
        </li>
      ))}
    </ul>
  );
}
