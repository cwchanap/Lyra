import { render, screen, within } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import PrimaryObjectiveHud from "./PrimaryObjectiveHud.svelte";
import type { ObjectiveView } from "../state/types";

const activePrimaryObjective: ObjectiveView = {
  id: "objective_follow_witness",
  label: "追查雨夜目擊者",
  summary: "找出目擊者隱瞞的證詞。",
  kind: "primary",
  sortOrder: 10,
  completed: false,
  activePrimary: true,
};

describe("PrimaryObjectiveHud", () => {
  it("announces the active primary label without exposing its full summary", () => {
    render(PrimaryObjectiveHud, { objective: activePrimaryObjective });

    const hud = screen.getByRole("status", { name: "主要目標" });
    expect(
      within(hud).getByText("主要目標 / PRIMARY OBJECTIVE"),
    ).toBeInTheDocument();
    expect(within(hud).getByText("追查雨夜目擊者")).toBeInTheDocument();
    expect(within(hud).queryByText("找出目擊者隱瞞的證詞。")).toBeNull();
    expect(within(hud).queryByRole("button")).toBeNull();
    expect(within(hud).queryByRole("link")).toBeNull();
  });

  it("renders nothing when no active primary objective is available", () => {
    render(PrimaryObjectiveHud, { objective: null });

    expect(
      screen.queryByRole("status", { name: "主要目標" }),
    ).not.toBeInTheDocument();
  });

  it("keeps an exceptionally long compact objective complete and keyboard reachable", async () => {
    const label = "追查雨夜目擊者".repeat(40);
    render(PrimaryObjectiveHud, {
      objective: { ...activePrimaryObjective, label },
      compact: true,
    });

    const content = screen.getByRole("region", { name: "主要目標內容" });
    expect(content).toHaveTextContent(label);
    expect(content).toHaveAttribute("tabindex", "0");
    await userEvent.setup().tab();
    expect(content).toHaveFocus();
    const source = readFileSync(
      "src/lib/components/PrimaryObjectiveHud.svelte",
      "utf8",
    );
    expect(source).toMatch(
      /\.primary-objective-hud\.compact\s*\{[^}]*box-sizing:\s*border-box;[^}]*grid-template-rows:\s*auto minmax\(0, 1fr\);[^}]*max-height:\s*74px;/,
    );
    expect(source).toMatch(
      /\.compact \.label-scroll\s*\{[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;[^}]*overflow-wrap:\s*anywhere;[^}]*pointer-events:\s*auto;/,
    );
  });
});
