import { render, screen, within } from "@testing-library/svelte";
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
});
