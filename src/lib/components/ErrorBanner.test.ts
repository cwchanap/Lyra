import { render, screen } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import ErrorBanner from "./ErrorBanner.svelte";

describe("ErrorBanner", () => {
  it("renders the error message", () => {
    render(ErrorBanner, { message: "Something went wrong" });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });

  it("renders the ERROR tag", () => {
    render(ErrorBanner, { message: "fail" });
    expect(screen.getByText(/ERROR/)).toBeInTheDocument();
  });
});
