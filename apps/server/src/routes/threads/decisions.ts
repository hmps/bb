import { dismissThreadDecisionSet, listThreadDecisionSets } from "@bb/db";
import {
  publicApiRoutes,
  typedRoutes,
  type PublicApiSchema,
} from "@bb/server-contract";
import type { Hono } from "hono";
import type { AppDeps } from "../../types.js";
import { ApiError } from "../../errors.js";
import { requirePublicThread } from "../../services/lib/entity-lookup.js";
import { notifyThreadDecisionsChanged } from "../../services/threads/thread-decisions.js";

export function registerThreadDecisionRoutes(app: Hono, deps: AppDeps): void {
  const { get, post } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (message) =>
      new ApiError(400, "invalid_request", message),
  });
  get(publicApiRoutes.threads.decisions, (context, query) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    return context.json(
      listThreadDecisionSets(deps.db, {
        threadId: thread.id,
        openOnly: query.openOnly !== "false",
      }),
    );
  });
  post(publicApiRoutes.threads.dismissDecision, (context) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    const dismissed = dismissThreadDecisionSet(deps.db, {
      threadId: thread.id,
      decisionSetId: context.req.param("decisionSetId"),
    });
    if (!dismissed)
      throw new ApiError(
        404,
        "decision_set_not_found",
        "Open decision set not found",
      );
    notifyThreadDecisionsChanged(deps, thread.id);
    return context.json(dismissed);
  });
}
