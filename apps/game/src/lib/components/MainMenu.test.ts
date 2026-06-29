import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import MainMenu from "./MainMenu.svelte";

describe("MainMenu", () => {
  afterEach(() => {
    cleanup();
  });

  it("does not render sound volume controls on the start screen", () => {
    render(MainMenu, { onNewGame: vi.fn(), onExit: vi.fn() });

    expect(
      screen.queryByRole("region", { name: "音訊設定" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("BGM")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("BGS")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("SFX")).not.toBeInTheDocument();
  });
});
