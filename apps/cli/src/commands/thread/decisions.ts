import { Command } from "commander";
import { composeThreadDecisionAnswer } from "@bb/core-ui";
import type { ThreadDecisionSet } from "@bb/domain";
import type { BbSdk } from "@bb/sdk";
import { action } from "../../action.js";
import { createCliBbSdk } from "../../client.js";
import { printBorderlessTable } from "../../table.js";
import {
  collectOption,
  outputJson,
  requireThreadIdOrSelf,
} from "../helpers.js";
import { buildPromptInputs, resolveSenderThreadId } from "./helpers.js";

interface DecisionTargetOptions {
  self?: boolean;
  json?: boolean;
}

interface DecisionListOptions extends DecisionTargetOptions {
  all?: boolean;
}

interface DecisionAnswerOptions extends DecisionTargetOptions {
  pick: string[];
  text: string;
}

async function fetchDecisionSet(
  sdk: BbSdk,
  threadId: string,
  decisionSetId: string,
): Promise<ThreadDecisionSet> {
  const sets = await sdk.threads.experimental_decisions.list({
    threadId,
    openOnly: false,
  });
  const set = sets.find((item) => item.id === decisionSetId);
  if (!set) {
    throw new Error(
      `Decision set ${decisionSetId} was not found in thread ${threadId}.`,
    );
  }
  return set;
}

function printDecisionSet(set: ThreadDecisionSet): void {
  console.log(`Decision set: ${set.id}`);
  console.log(`Thread: ${set.threadId}`);
  console.log(`Status: ${set.status}`);
  console.log(`Headline: ${set.headline}`);
  for (const [index, decision] of set.decisions.entries()) {
    console.log("");
    console.log(`Decision ${index + 1} — ${decision.question}`);
    console.log(decision.context);
    for (const [optionIndex, option] of decision.options.entries()) {
      const suggested =
        optionIndex === decision.suggested ? " (Suggested)" : "";
      console.log(
        `  ${optionIndex + 1}. ${option.label}${suggested}: ${option.does}`,
      );
    }
    for (const link of decision.links) {
      console.log(`  ${link.label}: ${link.href}`);
    }
  }
  if (set.resolutionText !== null) {
    console.log("");
    console.log(`Answer: ${set.resolutionText}`);
  }
}

function parsePick(value: string): {
  decisionIndex: number;
  optionIndex: number;
} {
  const match = /^([1-9]\d*)=([1-9]\d*)$/.exec(value);
  if (!match) {
    throw new Error(
      "Invalid --pick. Expected decision=option with one-based indexes, such as 1=2.",
    );
  }
  return {
    decisionIndex: Number(match[1]) - 1,
    optionIndex: Number(match[2]) - 1,
  };
}

export function registerDecisionCommands(
  parent: Command,
  getUrl: () => string,
): void {
  const decisions = parent
    .command("decisions")
    .description("Inspect, answer, and dismiss thread decision sets");

  decisions
    .command("list [id]")
    .description("List open decision sets for a thread")
    .option("--self", "Target the current thread (from BB_THREAD_ID)")
    .option("--all", "Include answered, superseded, and dismissed sets")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string | undefined, opts: DecisionListOptions) => {
        const threadId = requireThreadIdOrSelf(id, opts);
        const sdk = createCliBbSdk(getUrl());
        const sets = await sdk.threads.experimental_decisions.list({
          threadId,
          openOnly: !opts.all,
        });
        if (outputJson(opts, sets)) return;
        if (sets.length === 0) {
          console.log("No decision sets found");
          return;
        }
        printBorderlessTable(
          {
            head: ["ID", "Status", "Decisions", "Headline"],
            colWidths: [20, 14, 10, 70],
            trimTrailingWhitespace: true,
          },
          sets.map((set) => [
            set.id,
            set.status,
            String(set.decisions.length),
            set.headline,
          ]),
        );
      }),
    );

  decisions
    .command("show <decisionSetId> [id]")
    .description(
      "Show a decision set, including its context and suggested options",
    )
    .option("--self", "Target the current thread (from BB_THREAD_ID)")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (
          decisionSetId: string,
          id: string | undefined,
          opts: DecisionTargetOptions,
        ) => {
          const threadId = requireThreadIdOrSelf(id, opts);
          const set = await fetchDecisionSet(
            createCliBbSdk(getUrl()),
            threadId,
            decisionSetId,
          );
          if (outputJson(opts, set)) return;
          printDecisionSet(set);
        },
      ),
    );

  decisions
    .command("answer <decisionSetId> [id]")
    .description("Send decision picks and free text as a normal thread message")
    .option("--self", "Target the current thread (from BB_THREAD_ID)")
    .option(
      "--pick <decision=option>",
      "Pick one option using one-based indexes (repeatable)",
      collectOption,
      [],
    )
    .option("--text <text>", "Append free text to the answer", "")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (
          decisionSetId: string,
          id: string | undefined,
          opts: DecisionAnswerOptions,
        ) => {
          const threadId = requireThreadIdOrSelf(id, opts);
          const sdk = createCliBbSdk(getUrl());
          const set = await fetchDecisionSet(sdk, threadId, decisionSetId);
          if (set.status !== "open") {
            throw new Error(
              `Decision set ${decisionSetId} is ${set.status}; only open sets can be answered.`,
            );
          }
          const text = composeThreadDecisionAnswer({
            decisions: set.decisions,
            picks: opts.pick.map(parsePick),
            text: opts.text,
          });
          const result = await sdk.threads.send({
            threadId,
            input: buildPromptInputs({ message: text }),
            mode: "auto",
            senderThreadId: resolveSenderThreadId(threadId),
          });
          if (outputJson(opts, { threadId, ...result })) return;
          console.log(`Thread ${threadId} decision answer ${result.delivery}`);
        },
      ),
    );

  decisions
    .command("dismiss <decisionSetId> [id]")
    .description("Dismiss an open decision set without sending a message")
    .option("--self", "Target the current thread (from BB_THREAD_ID)")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (
          decisionSetId: string,
          id: string | undefined,
          opts: DecisionTargetOptions,
        ) => {
          const threadId = requireThreadIdOrSelf(id, opts);
          const set = await createCliBbSdk(
            getUrl(),
          ).threads.experimental_decisions.dismiss({ threadId, decisionSetId });
          if (outputJson(opts, set)) return;
          console.log(`Decision set ${set.id} dismissed`);
        },
      ),
    );
}
