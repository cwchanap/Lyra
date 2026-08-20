import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(name: string): string {
  return readFileSync(
    join(process.cwd(), `src/lib/components/${name}`),
    "utf8",
  ).replace(/\s+/g, " ");
}

describe("Interrogation handoff chrome", () => {
  it("skins the question record as the handoff spine", () => {
    const view = source("InterrogationView.svelte");

    expect(view).toContain(
      "background: linear-gradient( 180deg, rgba(14, 14, 22, 0.95), rgba(20, 13, 24, 0.97) )",
    );
    expect(view).toContain("backdrop-filter: blur(10px)");
    expect(view).toContain("border-top: 3px solid var(--crimson)");
    expect(view).toContain("box-shadow: 0 26px 64px rgba(0, 0, 0, 0.68)");
    expect(view).toContain("font-family: var(--display-jp)");
    expect(view).toContain("font-family: var(--mono)");
    expect(view).toContain(".q-dot");
    expect(view).toContain("opacity: 0.62");
    expect(view).toContain("border-style: dashed");
  });

  it("skins only the interrogation dialogue path and its object ring", () => {
    const dialogue = source("DialogueBox.svelte");

    expect(dialogue).toContain(".wrapper.interrogation-stage-dialogue .box {");
    expect(dialogue).toContain(
      "background: rgba(20, 20, 31, 0.94); border: 1px solid rgba(236, 228, 207, 0.32)",
    );
    expect(dialogue).toContain("box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6)");
    expect(dialogue).toContain(".xexam-challenge-wrap");
    expect(dialogue).toContain("conic-gradient");
    expect(dialogue).toContain(
      "radial-gradient( circle at 50% 34%, #ae1c31, var(--crimson-deep) 74% )",
    );
    expect(dialogue).toContain("OBJECT");
    expect(dialogue).toContain("長按");
    expect(dialogue).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("composes the stage HUD over the scene", () => {
    const stage = source("InterrogationStage.svelte");

    expect(stage).toContain("position: absolute");
    expect(stage).toContain("background: rgba(20, 20, 31, 0.82)");
    expect(stage).toContain("backdrop-filter: blur(6px)");
    expect(stage).toContain("border-left: 3px solid var(--crimson)");
    expect(stage).toContain("background: linear-gradient(var(--crimson)");
    expect(stage).toContain(".case-file-hud");
    expect(stage).toContain("top: 24px");
    expect(stage).toContain("right: 26px");
  });

  it("skins the evidence tray and target line", () => {
    const tray = source("InterrogationEvidenceTray.svelte");

    expect(tray).toContain(
      "background: linear-gradient( 180deg, rgba(16, 16, 25, 0.98), rgba(20, 14, 24, 0.98) )",
    );
    expect(tray).toContain("border-top: 3px solid var(--crimson)");
    expect(tray).toContain("box-shadow: 0 40px 90px rgba(0, 0, 0, 0.7)");
    expect(tray).toContain("鎖定證詞 · TARGET LINE");
    expect(tray).toContain("font-style: italic");
  });
});
