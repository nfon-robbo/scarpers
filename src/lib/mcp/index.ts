import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listActivities from "./tools/list-activities";
import getActivity from "./tools/get-activity";
import getCurrentPlan from "./tools/get-current-plan";
import listSleep from "./tools/list-sleep";
import getReadiness from "./tools/get-readiness";
import logNutrition from "./tools/log-nutrition";

// The OAuth issuer MUST be the direct Supabase host, built from the project ref
// (SUPABASE_URL may be a .lovable.cloud proxy; mcp-js rejects a mismatched issuer).
// import.meta.env.VITE_SUPABASE_PROJECT_ID is inlined by Vite at build time so this
// stays import-safe. The fallback keeps the string well-formed during the manifest
// extract eval — a token never verifies against the sentinel.
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "scarpers-mcp",
  title: "Scarpers",
  version: "0.1.0",
  instructions:
    "Scarpers running coach tools. Read the signed-in user's recent activities, sleep, readiness and current training plan, and log nutrition entries on their behalf. All tools act as the signed-in Scarpers user.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listActivities, getActivity, getCurrentPlan, listSleep, getReadiness, logNutrition],
});
