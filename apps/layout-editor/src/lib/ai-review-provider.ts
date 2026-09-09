// =============================================================================
// apps/layout-editor/src/lib/ai-review-provider.ts
//
// HPA-136 production adapter: routes AiReviewProviderRequest through the
// native secret-bearing Tauri transport. This adapter owns no schema or
// instruction copies — everything model-semantic is built in ai-review.ts.
// =============================================================================

import {
  buildAiReviewTransportPayload,
  type AiReviewProvider,
} from "./ai-review";
import { runAiReview } from "./workbench-api";

export const tauriAiReviewProvider: AiReviewProvider = async (request) =>
  runAiReview(buildAiReviewTransportPayload(request));
