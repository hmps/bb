Any agent can stop and ask you for one or more decisions. Each decision shows as a card in the thread with context, links, and a recommended option. You pick an option or type your own answer, and the agent continues with your choices.

## What you get

- One card with 1–6 decisions. Use the arrows or the shortcut keys to go between them.
- Markdown context for each decision, with up to three links to web pages, files, or other threads.
- Two to four options per decision. The agent can mark one option as Recommended.
- A "Something else…" field on every decision for your own answer.
- Chips that show your picks. Click a chip to go back to that decision.

## How it works

The `request_decisions` tool is available to every provider. The card stays open after the agent ends its turn. When every decision has a pick, the answers go to the agent as one line per decision: `Decision N — <question>: <answer>`.

If you write a message in the thread instead, the card closes and the agent reads your message as the answer. Dismissing a card or letting it expire does not restart an idle agent. Cards expire after 7 days by default; choose a shorter time with the Decision timeout setting.

## Answer from the CLI

Find the open card with `bb thread interactions list <thread-id>`, or `bb thread interactions show <interaction-id> <thread-id>` to see the decisions. Then send one answer per decision, in order:

```sh
bb thread interactions respond <interaction-id> <thread-id> --value '{"answers":[{"option":0},{"text":"Keep both"}]}'
```

`{"option": N}` picks the option with the zero-based index N. `{"text": "..."}` sends your own answer; it cannot be blank. To dismiss the card without answering, write a message in the thread.
