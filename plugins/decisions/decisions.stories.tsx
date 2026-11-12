import type { InteractionPayload } from "./src/contracts";
import { DecisionsInteraction } from "./src/decisions-card";

export default { title: "plugins/Decisions" };

const payload: InteractionPayload = {
  headline: "Pick a storage plan for the job queue",
  decisions: [
    {
      question: "Which database should hold the job queue?",
      context:
        "The queue needs **durable** writes and one reader per host.\n\n- Postgres is already in production.\n- SQLite needs no new server, but each host gets its own file.\n\nI recommend SQLite, because the queue is host-local.",
      options: [
        { label: "Postgres", does: "Use the shared server and one table." },
        { label: "SQLite", does: "Embed one file per host." },
        { label: "Redis", does: "Add a new in-memory service." },
      ],
      suggested: 1,
      links: [
        { label: "Queue design", href: "https://example.com/queue-design" },
        { label: "Current schema", href: "/Users/me/project/db/schema.sql" },
      ],
    },
    {
      question: "Where should nightly backups go?",
      context: "Backups run at 02:00 and keep 14 days.",
      options: [
        { label: "S3", does: "Upload to the shared bucket." },
        { label: "Local disk", does: "Keep them on each host." },
      ],
      links: [],
    },
  ],
};

export function TwoDecisions() {
  return (
    <div className="mx-auto w-full max-w-3xl p-4">
      <div className="rounded-xl border border-border bg-background p-3">
        <DecisionsInteraction
          interaction={{
            id: "pint_story",
            threadId: "thr_story",
            title: payload.headline,
            payload,
            createdAt: 0,
            expiresAt: null,
          }}
          submit={async () => undefined}
          cancel={async () => undefined}
        />
      </div>
    </div>
  );
}
