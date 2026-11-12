import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { DECISIONS_RENDERER_ID } from "./src/contracts.js";
import { DecisionsInteraction } from "./src/decisions-card.js";

export default definePluginApp((app) => {
  app.slots.pendingInteraction({
    id: DECISIONS_RENDERER_ID,
    component: DecisionsInteraction,
  });
});
