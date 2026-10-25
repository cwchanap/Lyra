import {
  parseVisualAssetCue,
  rejectUnknownAssetMetadata,
  VISUAL_ASSET_METADATA_KEYS,
} from "./parser-assets";
import { tokenize, type Token } from "./tokenizer";
import type {
  CompileError,
  DialogueItem,
  PromptOption,
  FeedbackLine,
} from "./types";

type CursorLike = {
  readonly sourceFile: string;
  peek(): Token | undefined;
  next(): Token | undefined;
};

type DialogueResult =
  | { ok: true; value: DialogueItem[] }
  | { ok: false; error: CompileError };

export function consumeMetadata(cur: CursorLike):
  | {
      ok: true;
      value: Record<string, string>;
      /** Key → authored physical line of the metadata token. */
      lines: Record<string, number>;
    }
  | { ok: false; error: CompileError } {
  const out: Record<string, string> = {};
  const lines: Record<string, number> = {};
  while (true) {
    const next = cur.peek();
    if (!next || next.kind !== "metadata")
      return { ok: true, value: out, lines };
    cur.next();
    out[next.key] = next.value;
    lines[next.key] = next.line;
  }
}

export function consumeDialogueUntilHeading(
  cur: CursorLike,
  _atOrAboveLevel: number,
): DialogueResult {
  // Stops at ANY heading regardless of level. Every dialogue body in this
  // grammar terminates at the next heading (the next structural block or an
  // optional sub-block like On Reexamine), so a level-aware check would
  // silently swallow headings whose level exceeds the cutoff. The level
  // parameter is kept for documentation but no longer affects behavior.
  //
  // Unknown/metadata tokens inside a dialogue body are a hard error — they
  // indicate authoring mistakes (typo'd dialogue line, stray metadata) that
  // would otherwise be silently lost.
  const out: DialogueItem[] = [];
  while (true) {
    const next = cur.peek();
    if (!next) break;
    if (next.kind === "heading") break;
    cur.next();
    if (next.kind === "sceneTag") {
      const meta: Record<string, string> = {};
      const metadataLines: Record<string, number> = {};
      while (cur.peek()?.kind === "metadata") {
        const metadata = cur.next()!;
        if (metadata.kind === "metadata") {
          meta[metadata.key] = metadata.value;
          metadataLines[metadata.key] = metadata.line;
        }
      }
      const bad = rejectUnknownAssetMetadata(
        meta,
        VISUAL_ASSET_METADATA_KEYS,
        cur.sourceFile,
        next.line,
        metadataLines,
      );
      if (bad) return { ok: false, error: bad };
      out.push({
        kind: "sceneTag",
        text: next.text,
        assetCue:
          Object.keys(meta).length > 0
            ? parseVisualAssetCue(meta, metadataLines)
            : null,
        sourceLine: next.line,
      });
    } else if (next.kind === "action")
      out.push({ kind: "action", text: next.text, sourceLine: next.line });
    else if (next.kind === "dialogue") {
      out.push({
        kind: "line",
        speaker: next.speaker,
        text: next.text,
        expression: next.expression,
        portrait: null,
        sourceLine: next.line,
      });
    } else if (next.kind === "prompt") {
      const prompt = parsePromptToken(next);
      if (!prompt.ok) return prompt;
      out.push(prompt.value);
    } else if (next.kind === "metadata") {
      return parseFailure(
        cur.sourceFile,
        next.line,
        "strayMetadataInDialogueBody",
        `Stray metadata in dialogue body: ${next.key}.`,
      );
    } else if (next.kind === "unknown") {
      return parseFailure(
        cur.sourceFile,
        next.line,
        "unrecognizedDialogueLine",
        `Unrecognized line in dialogue body: ${next.text}.`,
      );
    }
  }
  return { ok: true, value: out };
}

export function describeToken(tok: Token): string {
  switch (tok.kind) {
    case "heading":
      return `H${tok.level} "${tok.text}"`;
    case "metadata":
      return `metadata ${tok.key}`;
    case "sceneTag":
      return `[場景：${tok.text}]`;
    case "action":
      return `[${tok.text}]`;
    case "dialogue":
      return `**${tok.speaker}**：${tok.text}`;
    case "prompt":
      return `> 推理：${tok.question}`;
    case "unknown":
      return `unknown(${tok.text})`;
    default: {
      // Exhaustiveness guard: adding a new Token kind is a compile error here
      // instead of silently returning undefined at runtime.
      const _exhaustive: never = tok;
      return String((_exhaustive as Token).kind);
    }
  }
}

const PROMPT_MIN_OPTIONS = 2;
const PROMPT_MAX_OPTIONS = 4;
const PROMPT_OPTION_RE = /^\[( |x)\]\s+(.+?)(?:\s+→\s+(.+))?$/;

/**
 * Builds an inline deduction prompt from its tokenizer block:
 *
 *   > 推理：那 89.7 秒說明了什麼？
 *   > - [x] 摘要把合併的時間當成了事件時間
 *   > - [ ] 三宅說了謊 → **早坂茜**：他的小謊和這段時間無關。
 *
 * Exactly one option is correct and carries no reply; the lines after the
 * prompt say the conclusion. Every wrong option needs a one-line reply (a
 * `**Name**：` line or a `[narration]`), shown before the prompt asks again.
 */
export function parsePromptToken(
  tok: Extract<Token, { kind: "prompt" }>,
): { ok: true; value: DialogueItem } | { ok: false; error: CompileError } {
  if (
    tok.options.length < PROMPT_MIN_OPTIONS ||
    tok.options.length > PROMPT_MAX_OPTIONS
  ) {
    return parseFailure(
      tok.sourceFile,
      tok.line,
      "promptOptionCount",
      `A 推理 prompt needs ${PROMPT_MIN_OPTIONS}-${PROMPT_MAX_OPTIONS} \`> - \` options; found ${tok.options.length}.`,
    );
  }
  const options: PromptOption[] = [];
  for (const raw of tok.options) {
    const match = PROMPT_OPTION_RE.exec(raw.text);
    if (!match) {
      return parseFailure(
        tok.sourceFile,
        raw.line,
        "promptOptionMalformed",
        `A 推理 option must read \`> - [x] answer\` or \`> - [ ] answer → reply\`. Got: ${raw.text}`,
      );
    }
    const correct = match[1] === "x";
    const label = (match[2] ?? "").trim();
    const rawReply = match[3]?.trim() ?? null;
    if (options.some((option) => option.label === label)) {
      return parseFailure(
        tok.sourceFile,
        raw.line,
        "promptDuplicateOption",
        `A 推理 prompt repeats the option "${label}".`,
      );
    }
    if (correct && rawReply !== null) {
      return parseFailure(
        tok.sourceFile,
        raw.line,
        "promptCorrectOptionHasReply",
        "The correct 推理 option takes no reply; write the conclusion as the dialogue after the prompt.",
      );
    }
    if (!correct && rawReply === null) {
      return parseFailure(
        tok.sourceFile,
        raw.line,
        "promptWrongOptionMissingReply",
        `The wrong 推理 option "${label}" needs a reply after →, e.g. → **早坂茜**：……`,
      );
    }
    let reply: FeedbackLine | null = null;
    if (rawReply !== null) {
      const parsed = parseFeedbackLine(
        rawReply,
        tok.sourceFile,
        raw.line,
        "promptReplyMalformed",
        "A 推理 reply",
      );
      if (!parsed.ok) return parsed;
      reply = parsed.value;
    }
    options.push({ label, correct, reply });
  }
  const correctCount = options.filter((option) => option.correct).length;
  if (correctCount !== 1) {
    return parseFailure(
      tok.sourceFile,
      tok.line,
      "promptCorrectOptionCount",
      `A 推理 prompt needs exactly one [x] option; found ${correctCount}.`,
    );
  }
  return {
    ok: true,
    value: {
      kind: "prompt",
      question: tok.question,
      options,
      sourceLine: tok.line,
    },
  };
}

/**
 * Parses a one-line reply (a wrong 推理 option's reply, a character's
 * Wrong Present line): one `**Name**：line` with no expression or line ID,
 * or one `[narration]`.
 */
export function parseFeedbackLine(
  raw: string,
  sourceFile: string,
  line: number,
  code: string,
  what: string,
): { ok: true; value: FeedbackLine } | { ok: false; error: CompileError } {
  // Reuse the tokenizer's dialogue/action recognition on the single reply.
  const tokens = tokenize(raw, sourceFile);
  const only = tokens.length === 1 ? tokens[0] : undefined;
  if (only?.kind === "dialogue" && only.expression === null && !only.lineId) {
    return { ok: true, value: { speaker: only.speaker, text: only.text } };
  }
  if (only?.kind === "action") {
    return { ok: true, value: { speaker: null, text: only.text } };
  }
  return parseFailure(
    sourceFile,
    line,
    code,
    `${what} must be one **Name**：line (no expression or line ID) or one [narration]. Got: ${raw}`,
  );
}

export function parseFailure(
  sourceFile: string,
  line: number,
  code: string,
  message: string,
): { ok: false; error: CompileError } {
  return { ok: false, error: { code, message, sourceFile, line } };
}
