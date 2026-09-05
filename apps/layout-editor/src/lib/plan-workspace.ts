import type { CompileError } from "@lyra/scripts/compile-scenes/types";
import { Parser, Renderer, lexer } from "marked";
import type { Token, Tokens, TokensList } from "marked";
import type {
  WorkbenchPlanDocument,
  WorkbenchPlanWorkspacePayload,
} from "./workbench-types";

// ----- Exact source constants (no fallback search) -----------------------------

const CHAPTER_HEADING = "10. 章節總覽";
const CHAPTER_HEADERS = ["章節", "標題", "案件類型", "變體", "主線誤導"];
const EXPECTED_CHAPTERS = ["1", "2", "3", "4", "5", "6", "7", "8"];
const AOBA_ADDENDUM_HEADING =
  "18. Canon Addendum：第一幕青葉提問契約（2026-08-23）";
const AOBA_18_1_HEADING = "18.1 為什麼需要這個更新";
const AOBA_HEADING = "18.5 第一幕 reveal ladder";
const AOBA_HEADERS = ["章節", "必須建立", "絕對不能建立"];

// ----- Public model -------------------------------------------------------------

export type PlanDiagnosticCode =
  | "chapterOverviewMissing"
  | "chapterOverviewInvalid"
  | "chapterOverviewUnexpectedRows"
  | "aobaRevealLadderMissing"
  | "aobaRevealLadderInvalid";

export type PlanDiagnostic = CompileError & { code: PlanDiagnosticCode };

export type PlanHeading = {
  level: number;
  text: string;
  anchor: string;
};

export type ParsedPlanDocument = WorkbenchPlanDocument & {
  renderedHtml: string;
  headings: PlanHeading[];
};

export type PlanChapterOverviewRow = {
  chapter: string;
  title: string;
  caseType: string;
  variant: string;
  mainMisdirection: string;
};

export type PlanAobaRevealStage = {
  chapterLabel: string;
  mustEstablish: string;
  mustNotEstablish: string;
};

export type PlanChapterOverview = {
  anchor: string;
  rows: PlanChapterOverviewRow[];
} | null;

export type PlanAobaReveal = {
  anchor: string;
  stages: PlanAobaRevealStage[];
} | null;

export type PlanOverrideNotice = {
  anchor: string;
  text: string;
} | null;

export type PlanWorkspace = {
  documents: ParsedPlanDocument[];
  chapterOverview: PlanChapterOverview;
  aobaReveal: PlanAobaReveal;
  aobaOverrideNotice: PlanOverrideNotice;
  diagnostics: PlanDiagnostic[];
};

// ----- Anchors ------------------------------------------------------------------

/**
 * Derives a bare DOM id from heading text. MUTATES the per-document `seen`
 * map to pin duplicates; because the counter lives in insertion order, the
 * `-1`/`-2` suffixes can shift to a different heading after content edits.
 */
export function planAnchor(text: string, seen: Map<string, number>): string {
  const base = text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_\-\s]/gu, "")
    .replace(/\s+/g, "-");
  const count = seen.get(base) ?? 0;
  seen.set(base, count + 1);
  return count === 0 ? base : `${base}-${count}`;
}

/** Composes a source link; anchors are bare DOM ids (no leading `#`). */
export function planSourceRef(path: string, anchor: string | null): string {
  return anchor ? `${path}#${anchor}` : path;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// ----- URL sanitization ---------------------------------------------------------

/** Schemes permitted in authored Plan Markdown links/images. */
const SAFE_URL_SCHEMES = new Set(["http", "https", "mailto"]);

/**
 * Accepts http/https/mailto, anchors (`#…`), relative paths, and
 * protocol-relative (`//host`) URLs. Rejects `javascript:`, `data:`,
 * `vbscript:`, `file:`, and any other scheme — authored Markdown is untrusted
 * content rendered via `{@html}` in the workbench UI.
 */
function isSafeUrl(href: string): boolean {
  const trimmed = href.trim();
  if (trimmed === "") return true;
  const schemeMatch = /^([a-z][a-z0-9+.-]*):/i.exec(trimmed);
  if (schemeMatch) {
    return SAFE_URL_SCHEMES.has(schemeMatch[1]!.toLowerCase());
  }
  return true;
}

/**
 * Encodes (mirroring marked's `encodeURI` cleaner) then HTML-escapes a href for
 * safe attribute embedding. Returns `null` when the scheme is unsafe or the URI
 * is malformed, so the caller falls back to plain text.
 */
function cleanHref(href: string): string | null {
  if (!isSafeUrl(href)) return null;
  try {
    const encoded = encodeURI(href).replace(/%25/g, "%");
    return escapeHtml(encoded);
  } catch {
    return null;
  }
}

// ----- Token walk ---------------------------------------------------------------

/** Flattened document-order block sequence (spaces skipped; blockquote and list-item children inlined). */
type BlockHit =
  | {
      kind: "heading";
      heading: Tokens.Heading;
      text: string;
      anchor: string;
      line: number;
    }
  | { kind: "table"; table: Tokens.Table; line: number }
  | { kind: "blockquote"; blockquote: Tokens.Blockquote; line: number }
  | { kind: "block"; line: number };

type DocumentWalk = {
  seen: Map<string, number>;
  anchorByToken: WeakMap<Tokens.Heading, string>;
  blocks: BlockHit[];
};

function plainInlineText(tokens: Token[]): string {
  let out = "";
  for (const token of tokens) {
    if ("tokens" in token && Array.isArray(token.tokens)) {
      out += plainInlineText(token.tokens);
    } else if ("text" in token && typeof token.text === "string") {
      out += token.text;
    }
  }
  return out;
}

function lineAt(content: string, offset: number): number {
  return offset >= 0 ? content.slice(0, offset).split("\n").length : 1;
}

function walkDocumentBlocks(
  tokens: readonly Token[],
  content: string,
  searchFrom: number,
  walk: DocumentWalk,
): void {
  let from = searchFrom;
  for (const token of tokens) {
    if (token.type === "space") continue;
    // Tokens arrive in document order; cursor-anchored indexOf stays correct
    // even for repeated raw text. Blockquote children are searched from inside
    // the blockquote's own raw span.
    const offset = content.indexOf(token.raw, from);
    if (offset >= 0) from = offset + token.raw.length;
    const line = lineAt(content, offset);
    if (token.type === "heading") {
      const heading = token as Tokens.Heading;
      const text = plainInlineText(heading.tokens);
      const anchor = planAnchor(text, walk.seen);
      walk.anchorByToken.set(heading, anchor);
      walk.blocks.push({ kind: "heading", heading, text, anchor, line });
    } else if (token.type === "table") {
      walk.blocks.push({
        kind: "table",
        table: token as Tokens.Table,
        line,
      });
    } else if (token.type === "blockquote") {
      const blockquote = token as Tokens.Blockquote;
      walk.blocks.push({ kind: "blockquote", blockquote, line });
      walkDocumentBlocks(
        blockquote.tokens,
        content,
        offset >= 0 ? offset + 1 : 0,
        walk,
      );
    } else if (token.type === "list") {
      walk.blocks.push({ kind: "block", line });
      for (const item of (token as Tokens.List).items) {
        walkDocumentBlocks(
          item.tokens,
          content,
          offset >= 0 ? offset + 1 : 0,
          walk,
        );
      }
    } else {
      walk.blocks.push({ kind: "block", line });
    }
  }
}

// ----- Rendering ------------------------------------------------------------------

function renderDocument(
  tokens: TokensList,
  anchorByToken: WeakMap<Tokens.Heading, string>,
): string {
  const renderer = new Renderer();
  renderer.heading = function (this: Renderer, token: Tokens.Heading): string {
    const anchor = anchorByToken.get(token);
    if (anchor === undefined) {
      throw new Error("Plan heading token missing anchor");
    }
    return `<h${token.depth} id="${escapeHtml(anchor)}">${this.parser.parseInline(token.tokens)}</h${token.depth}>`;
  };
  // Authored raw HTML is untrusted content for the workbench UI: escape it.
  renderer.html = ({ text }: Tokens.HTML | Tokens.Tag) => escapeHtml(text);
  // Links/images carry authored hrefs: validate the scheme before emitting any
  // URL attribute. Unsafe schemes (javascript:, data:, …) collapse to plain
  // text/alt, mirroring marked's own null-href fallback.
  renderer.link = function (this: Renderer, token: Tokens.Link): string {
    const text = this.parser.parseInline(token.tokens);
    const href = cleanHref(token.href);
    if (href === null) return text;
    let tag = `<a href="${href}"`;
    if (token.title) tag += ` title="${escapeHtml(token.title)}"`;
    return `${tag}>${text}</a>`;
  };
  renderer.image = function (this: Renderer, token: Tokens.Image): string {
    // The textRenderer returns inline HTML tokens verbatim (e.g. alt text
    // containing `<svg onload=...>`), so the fallback must be escaped before
    // it re-enters renderedHtml and the workbench UI injects it via `{@html}`.
    const altText = token.tokens
      ? this.parser.parseInline(token.tokens, this.parser.textRenderer)
      : token.text;
    const href = cleanHref(token.href);
    if (href === null) return escapeHtml(altText);
    let tag = `<img src="${href}" alt="${escapeHtml(token.text)}"`;
    if (token.title) tag += ` title="${escapeHtml(token.title)}"`;
    return `${tag}>`;
  };
  return Parser.parse(tokens, { renderer });
}

// ----- Strict extractors -----------------------------------------------------------

function findExactHeading(
  blocks: BlockHit[],
  text: string,
): Extract<BlockHit, { kind: "heading" }> | null {
  return (
    blocks.find(
      (block): block is Extract<BlockHit, { kind: "heading" }> =>
        block.kind === "heading" && block.text === text,
    ) ?? null
  );
}

/** The table token immediately following the heading hit (no fallback search). */
function tableAfterHeading(
  blocks: BlockHit[],
  hit: Extract<BlockHit, { kind: "heading" }>,
): Tokens.Table | null {
  const index = blocks.indexOf(hit);
  const next = blocks[index + 1];
  return next?.kind === "table" ? next.table : null;
}

// Marked keeps TableCell.text as the raw source cell text (with Markdown
// syntax intact, e.g. backticks around `ZW_A16.lock`). Project from the
// inline tokens instead so the overview/timeline/boundary UI shows clean
// display text while preserving the strict authored value.
function cellText(cell: Tokens.TableCell): string {
  return plainInlineText(cell.tokens);
}

function headerRow(table: Tokens.Table): string[] {
  return table.header.map(cellText);
}

function rowCells(table: Tokens.Table): string[][] {
  return table.rows.map((row) => row.map(cellText));
}

function headersMatch(table: Tokens.Table | null, expected: string[]): boolean {
  const header = table === null ? [] : headerRow(table);
  return (
    header.length === expected.length &&
    header.every((cell, index) => cell === expected[index])
  );
}

function extractChapterOverview(
  blocks: BlockHit[],
  path: string,
  diagnostics: PlanDiagnostic[],
): PlanChapterOverview {
  const hit = findExactHeading(blocks, CHAPTER_HEADING);
  if (!hit) return null;
  const table = tableAfterHeading(blocks, hit);
  const malformed =
    table === null ||
    !headersMatch(table, CHAPTER_HEADERS) ||
    rowCells(table).some((row) => row.length !== CHAPTER_HEADERS.length);
  if (malformed) {
    diagnostics.push({
      code: "chapterOverviewInvalid",
      message: `「${CHAPTER_HEADING}」之後必須緊接欄位為「${CHAPTER_HEADERS.join("、")}」的表格。`,
      sourceFile: path,
      line: hit.line,
    });
    return null;
  }
  const rows = rowCells(table).map(
    ([chapter, title, caseType, variant, mainMisdirection]) => ({
      chapter,
      title,
      caseType,
      variant,
      mainMisdirection,
    }),
  );
  const chapters = rows.map((row) => row.chapter).join(",");
  if (chapters !== EXPECTED_CHAPTERS.join(",")) {
    diagnostics.push({
      code: "chapterOverviewUnexpectedRows",
      message: `章節總覽章節欄應為 ${EXPECTED_CHAPTERS.join("、")}，實際為 ${rows.map((row) => row.chapter).join("、")}。`,
      sourceFile: path,
      line: hit.line,
    });
  }
  return { anchor: hit.anchor, rows };
}

function extractAobaReveal(
  blocks: BlockHit[],
  path: string,
  diagnostics: PlanDiagnostic[],
): PlanAobaReveal {
  const hit = findExactHeading(blocks, AOBA_HEADING);
  if (!hit) return null;
  const table = tableAfterHeading(blocks, hit);
  const malformed =
    table === null ||
    !headersMatch(table, AOBA_HEADERS) ||
    rowCells(table).some((row) => row.length !== AOBA_HEADERS.length);
  if (malformed) {
    diagnostics.push({
      code: "aobaRevealLadderInvalid",
      message: `「${AOBA_HEADING}」之後必須緊接欄位為「${AOBA_HEADERS.join("、")}」的表格。`,
      sourceFile: path,
      line: hit.line,
    });
    return null;
  }
  const stages = rowCells(table).map(
    ([chapterLabel, mustEstablish, mustNotEstablish]) => ({
      chapterLabel,
      mustEstablish,
      mustNotEstablish,
    }),
  );
  return { anchor: hit.anchor, stages };
}

function blockquoteText(quote: Tokens.Blockquote): string {
  const parts: string[] = [];
  for (const token of quote.tokens) {
    if (token.type === "blockquote") {
      parts.push(blockquoteText(token as Tokens.Blockquote));
    } else if ("tokens" in token && Array.isArray(token.tokens)) {
      parts.push(plainInlineText(token.tokens));
    }
  }
  return parts.join("\n\n");
}

function extractOverrideNotice(blocks: BlockHit[]): PlanOverrideNotice {
  const addendumIndex = blocks.findIndex(
    (block) => block.kind === "heading" && block.text === AOBA_ADDENDUM_HEADING,
  );
  if (addendumIndex === -1) return null;
  const addendum = blocks[addendumIndex]!;
  if (addendum.kind !== "heading") return null;
  const closingIndex = blocks.findIndex(
    (block, index) =>
      index > addendumIndex &&
      block.kind === "heading" &&
      block.text === AOBA_18_1_HEADING,
  );
  if (closingIndex === -1) return null;
  const firstQuote = blocks
    .slice(addendumIndex + 1, closingIndex)
    .find((block) => block.kind === "blockquote");
  if (firstQuote?.kind !== "blockquote") return null;
  return {
    anchor: addendum.anchor,
    text: blockquoteText(firstQuote.blockquote),
  };
}

// ----- Projection -------------------------------------------------------------------

type DocumentProjection = {
  parsed: ParsedPlanDocument;
  blocks: BlockHit[];
};

function projectDocument(document: WorkbenchPlanDocument): DocumentProjection {
  const content = document.content;
  // Lex exactly once; anchors, extraction, and rendering share this token tree.
  const tokens = lexer(content);
  const walk: DocumentWalk = {
    seen: new Map(),
    anchorByToken: new WeakMap(),
    blocks: [],
  };
  walkDocumentBlocks(tokens, content, 0, walk);
  return {
    parsed: {
      ...document,
      renderedHtml: renderDocument(tokens, walk.anchorByToken),
      headings: walk.blocks
        .filter(
          (block): block is Extract<BlockHit, { kind: "heading" }> =>
            block.kind === "heading",
        )
        .map((block) => ({
          level: block.heading.depth,
          text: block.text,
          anchor: block.anchor,
        })),
    },
    blocks: walk.blocks,
  };
}

export function projectPlanWorkspace(
  payload: WorkbenchPlanWorkspacePayload,
): PlanWorkspace {
  const projections = payload.documents.map(projectDocument);
  const diagnostics: PlanDiagnostic[] = [];

  // The derived views are bound to the Story Bible document only: a matching
  // heading inside a chapter plan must never satisfy or produce them.
  const bible = projections.find(
    (projection) => projection.parsed.kind === "storyBible",
  );

  const chapterSource =
    bible && findExactHeading(bible.blocks, CHAPTER_HEADING)
      ? { blocks: bible.blocks, path: bible.parsed.path }
      : null;
  // Both Missing diagnostics are Story-Bible-bound: point them at the Bible
  // path when available, falling back to the first document only when no Bible
  // is present at all.
  const missingSourceFile =
    bible?.parsed.path ?? payload.documents[0]?.path ?? "";

  const chapterOverview = chapterSource
    ? extractChapterOverview(
        chapterSource.blocks,
        chapterSource.path,
        diagnostics,
      )
    : null;
  if (!chapterSource) {
    diagnostics.push({
      code: "chapterOverviewMissing",
      message: `找不到「${CHAPTER_HEADING}」標題。`,
      sourceFile: missingSourceFile,
      line: 1,
    });
  }

  const aobaSource =
    bible && findExactHeading(bible.blocks, AOBA_HEADING)
      ? { blocks: bible.blocks, path: bible.parsed.path }
      : null;
  const aobaReveal = aobaSource
    ? extractAobaReveal(aobaSource.blocks, aobaSource.path, diagnostics)
    : null;
  if (!aobaSource) {
    diagnostics.push({
      code: "aobaRevealLadderMissing",
      message: `找不到「${AOBA_HEADING}」標題。`,
      sourceFile: missingSourceFile,
      line: 1,
    });
  }

  const aobaOverrideNotice = bible ? extractOverrideNotice(bible.blocks) : null;

  return {
    documents: projections.map((projection) => projection.parsed),
    chapterOverview,
    aobaReveal,
    aobaOverrideNotice,
    diagnostics,
  };
}
