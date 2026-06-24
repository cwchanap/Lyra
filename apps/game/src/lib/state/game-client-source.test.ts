import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source() {
  return readFileSync(
    join(process.cwd(), "src/lib/state/game-client.svelte.ts"),
    "utf8",
  );
}

describe("game client audio events", () => {
  it("infers SFX events after successful game commands", () => {
    const text = source();
    expect(text).toContain("inferGameplaySfxEvents");
    expect(text).toContain("playGameplaySfxEvent");
    expect(text).toContain("const previous = gameState.value;");
    expect(text).toContain(
      "for (const event of inferGameplaySfxEvents(previous, v, command))",
    );
  });
});
