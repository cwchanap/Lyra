import { render, screen } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import InvestigationProgressHud from "./InvestigationProgressHud.svelte";

describe("InvestigationProgressHud", () => {
  it("counts what is left and says the scene moves on by itself", () => {
    render(InvestigationProgressHud, { progress: { done: 2, total: 5 } });

    const hud = screen.getByRole("status", { name: "調查進度" });
    expect(hud).toHaveTextContent("2 / 5");
    expect(hud).toHaveTextContent("尚有 3 項未查");
    expect(hud).toHaveTextContent("全部查完後自動前進");
  });

  it("marks the investigation finished once every target is done", () => {
    render(InvestigationProgressHud, { progress: { done: 5, total: 5 } });

    const hud = screen.getByRole("status", { name: "調查進度" });
    expect(hud).toHaveTextContent("調查完畢");
    expect(hud).not.toHaveTextContent("未查");
  });

  it("renders nothing for a scene with no targets", () => {
    render(InvestigationProgressHud, { progress: { done: 0, total: 0 } });

    expect(
      screen.queryByRole("status", { name: "調查進度" }),
    ).not.toBeInTheDocument();
  });
});
