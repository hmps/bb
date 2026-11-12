import { z } from "zod";

export const DECISIONS_RENDERER_ID = "decisions";

export const MAX_DECISIONS = 6;
export const MAX_OWN_ANSWER_LENGTH = 2000;

const THREAD_REF_PATTERN =
  /^@thread:thr_[23456789abcdefghijkmnpqrstuvwxyz]{10}(#msg=\d+)?$/;
const WINDOWS_DRIVE_PATH_PATTERN = /^[A-Za-z]:[\\/]/;
const WINDOWS_UNC_PATH_PATTERN = /^[\\/]{2}[^\\/]+[\\/]+[^\\/]+/;

export function isAbsolutePath(href: string): boolean {
  return (
    href.startsWith("/") ||
    WINDOWS_DRIVE_PATH_PATTERN.test(href) ||
    WINDOWS_UNC_PATH_PATTERN.test(href)
  );
}

export function isThreadRef(href: string): boolean {
  return THREAD_REF_PATTERN.test(href);
}

function isAllowedHref(href: string): boolean {
  if (isAbsolutePath(href) || isThreadRef(href)) return true;
  try {
    const url = new URL(href);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

const decisionLinkSchema = z.strictObject({
  label: z.string().trim().min(1).max(80),
  href: z
    .string()
    .trim()
    .min(1)
    .max(2000)
    .refine(
      isAllowedHref,
      "Use an HTTP(S) URL, an absolute file path, or an @thread: reference",
    ),
});

const decisionOptionSchema = z.strictObject({
  label: z.string().trim().min(1).max(40),
  does: z.string().trim().min(1).max(90),
});

export const decisionSchema = z
  .strictObject({
    question: z.string().trim().min(1).max(160),
    context: z.string().trim().min(1).max(4000),
    options: z.array(decisionOptionSchema).min(2).max(4),
    suggested: z.number().int().nonnegative().optional(),
    links: z.array(decisionLinkSchema).max(3).default([]),
  })
  .refine(
    (decision) =>
      decision.suggested === undefined ||
      decision.suggested < decision.options.length,
    {
      path: ["suggested"],
      message: "Suggested must be a zero-based index into options",
    },
  )
  .refine(
    (decision) =>
      new Set(decision.options.map((option) => option.label)).size ===
      decision.options.length,
    { path: ["options"], message: "Option labels must be unique" },
  );
export type Decision = z.infer<typeof decisionSchema>;

export const toolInputSchema = z.strictObject({
  headline: z.string().trim().min(1).max(100),
  decisions: z.array(decisionSchema).min(1).max(MAX_DECISIONS),
});
export type ToolInput = z.infer<typeof toolInputSchema>;

export const interactionPayloadSchema = toolInputSchema;
export type InteractionPayload = ToolInput;

const answerSchema = z.union([
  z.strictObject({ option: z.number().int().nonnegative() }),
  z.strictObject({
    text: z
      .string()
      .trim()
      .min(1, "An own answer cannot be blank")
      .max(MAX_OWN_ANSWER_LENGTH),
  }),
]);
export type DecisionAnswer = z.infer<typeof answerSchema>;

export const interactionResponseSchema = z.strictObject({
  answers: z.array(answerSchema).min(1).max(MAX_DECISIONS),
});
export type InteractionResponse = z.infer<typeof interactionResponseSchema>;
