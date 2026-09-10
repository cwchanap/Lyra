import { describe, expect, it } from "vitest";
import {
  AI_REVIEW_PREAMBLE,
  AI_REVIEW_RESULT_SCHEMA,
  aiReviewInstructions,
  buildAiReviewTransportPayload,
  validateAiReviewResult,
  type AiReviewProviderRequest,
  type AiReviewResult,
} from "./ai-review";

const request: AiReviewProviderRequest = {
  lens: "dialogue",
  selectedSourceRef:
    "docs/stories_plan/chapter_1/scene_2.md#reader:dialogue:intro:0",
  selectedText: "相馬律：先不要急著判斷。",
  context: [
    {
      ref: "voice-soma",
      sourceRef: "docs/stories_plan/characters.md#相馬律",
      kind: "characterVoice",
      content: "台詞風格：結論偏短。",
    },
  ],
  missingContext: [],
  replacementTargetRef: "reader:dialogue:intro:0",
};

const SELECTED_REF = request.selectedSourceRef;
const VOICE_REF = "docs/stories_plan/characters.md#相馬律";

function result(overrides: Partial<AiReviewResult>): AiReviewResult {
  return {
    lens: "dialogue",
    reviewedSourceRefs: [SELECTED_REF],
    findings: [],
    uncertainty: [],
    impact: null,
    replacement: null,
    noChange: true,
    ...overrides,
  };
}

function groundedFinding(): AiReviewResult["findings"][number] {
  return {
    severity: "Important",
    summary: "語氣與角色聲音不符",
    explanation: "供給的 voice 上下文指出結論偏短。",
    supportingSourceRefs: [VOICE_REF],
  };
}

function finding(
  overrides: Partial<AiReviewResult["findings"][number]> = {},
): AiReviewResult["findings"][number] {
  return { ...groundedFinding(), ...overrides };
}

function replacement(): NonNullable<AiReviewResult["replacement"]> {
  return {
    targetRef: "reader:dialogue:intro:0",
    replacementText: "先別急著下結論。",
    rationale: "更貼近角色聲音。",
  };
}

function openResult(overrides: Partial<AiReviewResult> = {}): AiReviewResult {
  return result({
    findings: [groundedFinding()],
    noChange: false,
    ...overrides,
  });
}

describe("lens instructions", () => {
  it("composes every lens from the one shared preamble", () => {
    expect(aiReviewInstructions("storyConsistency")).toContain(
      AI_REVIEW_PREAMBLE,
    );
    expect(aiReviewInstructions("dialogue")).toContain(AI_REVIEW_PREAMBLE);
    expect(aiReviewInstructions("promptRefinement")).toContain(
      AI_REVIEW_PREAMBLE,
    );
  });

  it("keeps the three lens instructions pairwise distinct", () => {
    expect(aiReviewInstructions("storyConsistency")).not.toBe(
      aiReviewInstructions("dialogue"),
    );
    expect(aiReviewInstructions("dialogue")).not.toBe(
      aiReviewInstructions("promptRefinement"),
    );
    expect(aiReviewInstructions("storyConsistency")).not.toBe(
      aiReviewInstructions("promptRefinement"),
    );
  });

  it("appends exactly the lens table row", () => {
    expect(aiReviewInstructions("dialogue")).toBe(
      `${AI_REVIEW_PREAMBLE}\n\nReview only character voice against supplied voice context, repeated exposition, and local pacing/readability. Keep any replacement local to the selected line/action.`,
    );
  });
});

describe("AI_REVIEW_RESULT_SCHEMA", () => {
  it("is one strict closed object schema", () => {
    expect(AI_REVIEW_RESULT_SCHEMA.type).toBe("object");
    expect(AI_REVIEW_RESULT_SCHEMA.additionalProperties).toBe(false);
    expect(AI_REVIEW_RESULT_SCHEMA.required).toEqual([
      "lens",
      "reviewedSourceRefs",
      "findings",
      "uncertainty",
      "impact",
      "replacement",
      "noChange",
    ]);
  });

  it("caps findings at six and closes every nested object", () => {
    const findings = AI_REVIEW_RESULT_SCHEMA.properties.findings;
    expect(findings.maxItems).toBe(6);
    const item = findings.items;
    expect(item.additionalProperties).toBe(false);
    expect(item.required).toEqual([
      "severity",
      "summary",
      "explanation",
      "supportingSourceRefs",
    ]);
    expect(AI_REVIEW_RESULT_SCHEMA.properties.impact.anyOf).toBeDefined();
    expect(AI_REVIEW_RESULT_SCHEMA.properties.replacement.anyOf).toBeDefined();
  });
});

describe("validateAiReviewResult", () => {
  it("accepts a valid no-change result", () => {
    const candidate = result({});
    expect(validateAiReviewResult(request, candidate)).toEqual({
      ok: true,
      result: candidate,
    });
  });

  it("accepts a grounded finding", () => {
    const candidate = openResult({ uncertainty: ["無法確認後續章節呼應。"] });
    expect(validateAiReviewResult(request, candidate)).toEqual({
      ok: true,
      result: candidate,
    });
  });

  it("accepts a single replacement targeted at replacementTargetRef", () => {
    const candidate = openResult({ replacement: replacement() });
    expect(validateAiReviewResult(request, candidate)).toEqual({
      ok: true,
      result: candidate,
    });
  });

  it("accepts six findings but rejects more than six", () => {
    const six = Array.from({ length: 6 }, () => groundedFinding());
    expect(
      validateAiReviewResult(request, openResult({ findings: six })).ok,
    ).toBe(true);
    const seven = Array.from({ length: 7 }, () => groundedFinding());
    expect(
      validateAiReviewResult(request, openResult({ findings: seven })).ok,
    ).toBe(false);
  });

  it("rejects a wrong or unknown lens", () => {
    expect(
      validateAiReviewResult(request, result({ lens: "storyConsistency" })).ok,
    ).toBe(false);
    expect(
      validateAiReviewResult(request, result({ lens: "nope" as "dialogue" }))
        .ok,
    ).toBe(false);
  });

  it("rejects unknown reviewed refs", () => {
    expect(
      validateAiReviewResult(
        request,
        result({
          reviewedSourceRefs: [
            SELECTED_REF,
            "docs/stories_plan/elsewhere.md#x",
          ],
        }),
      ).ok,
    ).toBe(false);
  });

  it("rejects empty reviewedSourceRefs", () => {
    expect(
      validateAiReviewResult(request, result({ reviewedSourceRefs: [] })).ok,
    ).toBe(false);
  });

  it("rejects reviewedSourceRefs missing the selected source ref", () => {
    expect(
      validateAiReviewResult(
        request,
        result({ reviewedSourceRefs: [VOICE_REF] }),
      ).ok,
    ).toBe(false);
  });

  it("rejects unknown supporting refs", () => {
    expect(
      validateAiReviewResult(
        request,
        openResult({ findings: [finding({ supportingSourceRefs: ["nope"] })] }),
      ).ok,
    ).toBe(false);
  });

  it("rejects unknown impact refs", () => {
    expect(
      validateAiReviewResult(
        request,
        openResult({
          impact: { sourceRefs: ["nope"], shared: false, note: "n" },
        }),
      ).ok,
    ).toBe(false);
  });

  it("rejects a finding with no supporting source ref", () => {
    expect(
      validateAiReviewResult(
        request,
        openResult({ findings: [finding({ supportingSourceRefs: [] })] }),
      ).ok,
    ).toBe(false);
  });

  it("rejects a replacement when the request target is null", () => {
    const findingsOnlyRequest: AiReviewProviderRequest = {
      ...request,
      replacementTargetRef: null,
    };
    expect(
      validateAiReviewResult(
        findingsOnlyRequest,
        openResult({ replacement: replacement() }),
      ).ok,
    ).toBe(false);
  });

  it("rejects a mismatched replacement target", () => {
    expect(
      validateAiReviewResult(
        request,
        openResult({
          replacement: {
            ...replacement(),
            targetRef: "reader:dialogue:other:1",
          },
        }),
      ).ok,
    ).toBe(false);
  });

  it("rejects CR/LF inside replacement text", () => {
    expect(
      validateAiReviewResult(
        request,
        openResult({
          replacement: {
            ...replacement(),
            replacementText: "先別\n急著下結論。",
          },
        }),
      ).ok,
    ).toBe(false);
    expect(
      validateAiReviewResult(
        request,
        openResult({
          replacement: {
            ...replacement(),
            replacementText: "先別\r急著下結論。",
          },
        }),
      ).ok,
    ).toBe(false);
  });

  it("rejects noChange:true carrying a finding or a replacement", () => {
    expect(
      validateAiReviewResult(request, result({ findings: [groundedFinding()] }))
        .ok,
    ).toBe(false);
    expect(
      validateAiReviewResult(request, result({ replacement: replacement() }))
        .ok,
    ).toBe(false);
  });

  it("rejects noChange:false without findings", () => {
    expect(
      validateAiReviewResult(request, result({ noChange: false })).ok,
    ).toBe(false);
  });

  it("rejects malformed result shapes", () => {
    const candidates: unknown[] = [
      null,
      "noChange",
      [],
      result({ extra: true } as Partial<AiReviewResult>),
      { lens: "dialogue" } as unknown as AiReviewResult,
      result({ reviewedSourceRefs: "x" as unknown as string[] }),
      result({ findings: "x" as unknown as AiReviewResult["findings"] }),
      result({
        findings: [finding({ severity: "Fatal" as "Important" })],
        noChange: false,
      }),
      result({
        findings: [finding({ summary: 3 as unknown as string })],
        noChange: false,
      }),
      result({ uncertainty: [1] as unknown as string[] }),
      result({
        impact: { shared: false } as unknown as AiReviewResult["impact"],
      }),
      result({
        replacement: {
          targetRef: "x",
        } as unknown as AiReviewResult["replacement"],
      }),
      result({ noChange: "yes" as unknown as boolean }),
    ];
    for (const candidate of candidates) {
      expect(validateAiReviewResult(request, candidate).ok).toBe(false);
    }
  });
});

describe("buildAiReviewTransportPayload", () => {
  const payload = buildAiReviewTransportPayload(request);

  it("composes lens-specific instructions and the one schema", () => {
    expect(payload.instructions).toBe(aiReviewInstructions("dialogue"));
    expect(payload.text.format.schema).toBe(AI_REVIEW_RESULT_SCHEMA);
    expect(payload.text.format).toMatchObject({
      type: "json_schema",
      name: "lyra_story_review",
      strict: true,
    });
    expect(payload.text.verbosity).toBe("low");
  });

  it("carries exactly the bounded request as input", () => {
    expect(JSON.parse(payload.input)).toEqual(request);
  });

  it("adds no transport, conversation, tool, or API configuration fields", () => {
    expect(Object.keys(payload).sort()).toEqual([
      "input",
      "instructions",
      "text",
    ]);
    expect(Object.keys(payload.text).sort()).toEqual(["format", "verbosity"]);
    for (const forbidden of [
      "tools",
      "conversation",
      "previous_response_id",
      "stream",
      "background",
      "model",
      "store",
      "max_output_tokens",
    ]) {
      expect(payload).not.toHaveProperty(forbidden);
    }
    expect(payload.input).not.toContain("api.openai.com");
    expect(payload.input).not.toContain("OPENAI_API_KEY");
  });
});
