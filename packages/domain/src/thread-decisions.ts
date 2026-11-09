import { z } from "zod";
import { isAbsoluteHostPath } from "./host-path.js";

const decisionLinkSchema = z
  .object({
    label: z.string().trim().min(1).max(80),
    href: z
      .string()
      .trim()
      .min(1)
      .max(2000)
      .refine((href) => {
        if (
          isAbsoluteHostPath(href) ||
          /^@thread:thr_[23456789abcdefghijkmnpqrstuvwxyz]{10}(#msg=\d+)?$/.test(
            href,
          )
        )
          return true;
        try {
          const url = new URL(href);
          return url.protocol === "http:" || url.protocol === "https:";
        } catch {
          return false;
        }
      }, "Use an HTTP(S) URL, an absolute file path, or an @thread: reference"),
  })
  .strict();

export const threadDecisionSchema = z
  .object({
    question: z.string().trim().min(1).max(160),
    context: z.string().trim().min(1).max(4000),
    options: z
      .array(
        z
          .object({
            label: z.string().trim().min(1).max(40),
            does: z.string().trim().min(1).max(90),
          })
          .strict(),
      )
      .min(2)
      .max(4),
    suggested: z.number().int().nonnegative(),
    links: z.array(decisionLinkSchema).max(3),
  })
  .strict()
  .refine((decision) => decision.suggested < decision.options.length, {
    path: ["suggested"],
    message: "Suggested must be a zero-based index into options",
  });
export type ThreadDecision = z.infer<typeof threadDecisionSchema>;

export const requestDecisionsInputSchema = z
  .object({
    headline: z.string().trim().min(1).max(100),
    decisions: z.array(threadDecisionSchema).min(1).max(6),
  })
  .strict();
export type RequestDecisionsInput = z.infer<typeof requestDecisionsInputSchema>;

export const threadDecisionStatusSchema = z.enum([
  "open",
  "answered",
  "superseded",
  "dismissed",
]);
export type ThreadDecisionStatus = z.infer<typeof threadDecisionStatusSchema>;

export const threadDecisionSetSchema = z
  .object({
    id: z.string(),
    threadId: z.string(),
    turnId: z.string().nullable(),
    toolCallId: z.string(),
    headline: z.string(),
    decisions: z.array(threadDecisionSchema),
    status: threadDecisionStatusSchema,
    resolutionRequestId: z.string().nullable(),
    resolutionText: z.string().nullable(),
    createdAt: z.number(),
    resolvedAt: z.number().nullable(),
  })
  .strict();
export type ThreadDecisionSet = z.infer<typeof threadDecisionSetSchema>;
