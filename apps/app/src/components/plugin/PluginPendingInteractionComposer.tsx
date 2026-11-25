import {
  InlinePendingInteractionContext,
  PendingInteractionShell,
} from "@/components/thread/pending-interactions/PendingInteractionShell";
import { usePendingInteractionCancel } from "@/components/thread/pending-interactions/usePendingInteractionCancel";
import {
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Button } from "@bb/shared-ui/button";
import type { JsonValue, PendingInteraction } from "@bb/domain";
import { PluginSlotMount } from "./PluginSlotMount";
import { Skeleton } from "@bb/shared-ui/skeleton";
import { resolvePendingInteraction } from "@/lib/plugin-slot-resolvers";
import { usePluginDisplayName } from "@/lib/plugin-logos";
import {
  usePluginFrontendSettled,
  usePluginSlotKind,
} from "@/lib/plugin-slots";
import { sdk } from "@/lib/sdk";
import { useQuestionFormHost } from "@/components/thread/user-questions/question-form-host-context";
import { cn } from "@bb/shared-ui/lib/utils";

export interface PluginPendingInteractionRequest {
  pluginId: string;
  rendererId: string;
  title: string;
  data: JsonValue;
}

interface PluginPendingInteractionComposerProps {
  interaction: Pick<
    PendingInteraction,
    "id" | "threadId" | "createdAt" | "expiresAt"
  >;
  request: PluginPendingInteractionRequest;
  origin: "plugin" | "provider";
  collapsedByDefault: boolean;
}

export function PluginPendingInteractionComposer({
  interaction,
  request,
  origin,
  collapsedByDefault,
}: PluginPendingInteractionComposerProps) {
  const pendingInteractions = usePluginSlotKind("pendingInteractions");
  const pluginName = usePluginDisplayName(request.pluginId);
  const pluginSettled = usePluginFrontendSettled(request.pluginId);
  const inline = useContext(InlinePendingInteractionContext) !== null;
  const { cancel: cancelInteraction } = usePendingInteractionCancel({
    interactionId: interaction.id,
    threadId: interaction.threadId,
    origin,
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const slot = useMemo(
    () =>
      resolvePendingInteraction(
        pendingInteractions,
        request.pluginId,
        request.rendererId,
      ),
    [request.pluginId, request.rendererId, pendingInteractions],
  );
  const submit = useCallback(
    async (value: JsonValue) => {
      setSubmitting(true);
      setError(null);
      try {
        await sdk.threads.interactions.respond({
          interactionId: interaction.id,
          threadId: interaction.threadId,
          value,
        });
      } catch (cause) {
        setSubmitting(false);
        setError(cause instanceof Error ? cause.message : String(cause));
        throw cause;
      }
    },
    [interaction.id, interaction.threadId],
  );

  const cancel = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    try {
      await cancelInteraction();
    } catch (cause) {
      setSubmitting(false);
      setError(cause instanceof Error ? cause.message : String(cause));
      throw cause;
    }
  }, [cancelInteraction]);
  const dismissLabel = origin === "plugin" ? "Cancel" : "Stop turn";

  return (
    <PendingInteractionShell
      key={interaction.id}
      label={request.title}
      expandedByDefault={!collapsedByDefault}
      allowFullHeight
      errorMessage={error}
      testId="plugin-interaction-shell"
    >
      {() => (
        <>
          {inline ? null : (
            <p className="mb-4 text-xs text-muted-foreground">
              {origin === "plugin"
                ? `Requested by ${pluginName}`
                : `Asked by the agent through ${pluginName}`}
            </p>
          )}
          {slot ? (
            <PluginSlotMount
              pluginId={slot.pluginId}
              slotKind="pendingInteraction"
              slotId={slot.id}
              crashFallback={
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    The plugin form crashed. {dismissLabel} to continue.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void cancel()}
                    disabled={submitting}
                  >
                    {dismissLabel}
                  </Button>
                </div>
              }
            >
              <PluginFormFieldset disabled={submitting}>
                <slot.component
                  interaction={{
                    id: interaction.id,
                    threadId: interaction.threadId,
                    title: request.title,
                    payload: request.data,
                    createdAt: interaction.createdAt,
                    expiresAt: interaction.expiresAt ?? null,
                  }}
                  submit={submit}
                  cancel={cancel}
                />
              </PluginFormFieldset>
            </PluginSlotMount>
          ) : pluginSettled ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                The plugin form is unavailable. {dismissLabel} to continue.
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={() => void cancel()}
                disabled={submitting}
              >
                {dismissLabel}
              </Button>
            </div>
          ) : (
            <div
              className="space-y-3"
              aria-busy="true"
              aria-label={`Loading the ${pluginName} form`}
              data-testid="plugin-interaction-loading"
            >
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-9 w-full" />
            </div>
          )}
        </>
      )}
    </PendingInteractionShell>
  );
}

function PluginFormFieldset({
  disabled,
  children,
}: {
  disabled: boolean;
  children: ReactNode;
}) {
  const { fullHeight } = useQuestionFormHost();
  return (
    <fieldset
      disabled={disabled}
      className={cn("min-w-0", fullHeight && "flex grow flex-col")}
    >
      {children}
    </fieldset>
  );
}
