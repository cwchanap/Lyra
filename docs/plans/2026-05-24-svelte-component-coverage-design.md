# Svelte Component Testing & Coverage — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable Vitest to render Svelte 5 components in jsdom, collect coverage on `.svelte` files, and report it to Codecov alongside existing Rust coverage.

**Architecture:** Add `@testing-library/svelte` with its `svelteTesting` Vite plugin for automatic cleanup and correct browser Svelte resolution. Configure Vitest with `jsdom` environment and an `lcov` coverage reporter. Seed two component tests (ErrorBanner, DialogueBox) to validate the pipeline end-to-end.

**Tech Stack:** Vitest 4, jsdom, @testing-library/svelte, @testing-library/jest-dom, @testing-library/user-event, Svelte 5 (runes)

---

### Task 1: Install dependencies

**Files:**
- Modify: `package.json` (via `bun add`)

**Step 1: Install testing library packages**

```bash
bun add -D jsdom @testing-library/svelte @testing-library/jest-dom @testing-library/user-event
```

**Step 2: Verify packages installed**

```bash
bun pm ls | grep -E "jsdom|testing-library"
```

Expected: all four packages listed under devDependencies.

**Step 3: Commit**

```bash
git add package.json bun.lock
git commit -m "chore: add Svelte component testing dependencies"
```

---

### Task 2: Configure Vitest for Svelte component testing

**Files:**
- Modify: `vite.config.js`
- Create: `src/test-setup.ts`

**Step 1: Create test setup file**

Create `src/test-setup.ts` with:

```typescript
import "@testing-library/jest-dom/vitest";
```

**Step 2: Update `vite.config.js`**

The current config is:

```javascript
import { defineConfig } from "vitest/config";
import { sveltekit } from "@sveltejs/kit/vite";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [sveltekit()],

  test: {
    include: ["src/**/*.test.ts"],
  },

  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
```

Replace with:

```javascript
import { defineConfig } from "vitest/config";
import { sveltekit } from "@sveltejs/kit/vite";
import { svelteTesting } from "@testing-library/svelte/vite";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [sveltekit(), svelteTesting()],

  test: {
    include: ["src/**/*.test.ts"],
    environment: "jsdom",
    setupFiles: ["src/test-setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["lcov"],
      reportsDirectory: "coverage",
      include: ["src/lib/**/*.svelte", "src/lib/**/*.ts"],
    },
  },

  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
```

Key additions:
- `svelteTesting()` plugin — ensures browser Svelte build, auto-cleanup, processes STL through vite-plugin-svelte
- `environment: "jsdom"` — DOM simulation for component rendering
- `setupFiles: ["src/test-setup.ts"]` — registers jest-dom matchers
- `coverage` block — explicitly includes `.svelte` and `.ts` files under `src/lib/`

**Step 3: Verify config loads without errors**

```bash
bun run test -- --coverage.enabled 2>&1 | head -20
```

Expected: Vitest runs existing tests (mode.test.ts + compile-scenes tests) without config errors.

**Step 4: Commit**

```bash
git add vite.config.js src/test-setup.ts
git commit -m "chore: configure Vitest for Svelte component testing and coverage"
```

---

### Task 3: Write ErrorBanner component test

**Files:**
- Create: `src/lib/components/ErrorBanner.test.ts`
- Reference: `src/lib/components/ErrorBanner.svelte`

ErrorBanner is the simplest component — it takes a `message` prop and renders it in a `role="alert"` div. Good smoke test.

**Step 1: Write the test**

Create `src/lib/components/ErrorBanner.test.ts`:

```typescript
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
```

**Step 2: Run test to verify it passes**

```bash
bun run test src/lib/components/ErrorBanner.test.ts
```

Expected: 2 tests PASS.

**Step 3: Commit**

```bash
git add src/lib/components/ErrorBanner.test.ts
git commit -m "test: add ErrorBanner component test"
```

---

### Task 4: Write DialogueBox component test

**Files:**
- Create: `src/lib/components/DialogueBox.test.ts`
- Reference: `src/lib/components/DialogueBox.svelte`

DialogueBox is the main interactive component — it renders different layouts for `sceneTag`, `action`, and `line` dialogue kinds, and advances via click or keyboard.

Props needed (from the component):
```typescript
{
  current: DialogueItem;     // { kind, text, speaker? }
  queueToken: QueueToken;    // { sceneId, queueGen, cursor }
  onAdvance: (t: QueueToken) => void;
  disabled?: boolean;        // default false
}
```

**Step 1: Write the test**

Create `src/lib/components/DialogueBox.test.ts`:

```typescript
import { render, screen } from "@testing-library/svelte";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import DialogueBox from "./DialogueBox.svelte";
import type { DialogueItem, QueueToken } from "../state/types";

const token: QueueToken = { sceneId: "s1", queueGen: 1, cursor: 0 };

function renderDialogueBox(
  current: DialogueItem,
  overrides?: { disabled?: boolean },
) {
  const onAdvance = vi.fn();
  render(DialogueBox, {
    current,
    queueToken: token,
    onAdvance,
    ...overrides,
  });
  return { onAdvance };
}

describe("DialogueBox", () => {
  it("renders an action dialogue item", () => {
    renderDialogueBox({ kind: "action", text: "Found evidence." });
    expect(screen.getByText("Found evidence.")).toBeInTheDocument();
    expect(screen.getByText(/NARRATION/)).toBeInTheDocument();
  });

  it("renders a line dialogue item with speaker", () => {
    renderDialogueBox({ kind: "line", speaker: "若月", text: "你好。" });
    expect(screen.getByText("若月")).toBeInTheDocument();
    expect(screen.getByText("你好。")).toBeInTheDocument();
    expect(screen.getByText(/LINE/)).toBeInTheDocument();
  });

  it("renders a sceneTag dialogue item", () => {
    renderDialogueBox({ kind: "sceneTag", text: "cafe" });
    expect(screen.getByText(/SCENE/)).toBeInTheDocument();
  });

  it("calls onAdvance with queueToken on click", async () => {
    const user = userEvent.setup();
    const { onAdvance } = renderDialogueBox({
      kind: "action",
      text: "hello",
    });
    await user.click(screen.getByRole("button"));
    expect(onAdvance).toHaveBeenCalledWith(token);
  });

  it("does not call onAdvance when disabled", async () => {
    const user = userEvent.setup();
    const { onAdvance } = renderDialogueBox(
      { kind: "action", text: "hello" },
      { disabled: true },
    );
    await user.click(screen.getByRole("button"));
    expect(onAdvance).not.toHaveBeenCalled();
  });
});
```

**Step 2: Run test to verify it passes**

```bash
bun run test src/lib/components/DialogueBox.test.ts
```

Expected: 5 tests PASS.

**Step 3: Commit**

```bash
git add src/lib/components/DialogueBox.test.ts
git commit -m "test: add DialogueBox component test"
```

---

### Task 5: Verify full coverage pipeline

**Step 1: Run all tests with coverage**

```bash
bun run test -- --coverage.enabled
```

Expected: all tests pass, `coverage/lcov.info` generated.

**Step 2: Verify `.svelte` files appear in coverage**

```bash
grep "\.svelte" coverage/lcov.info | head -5
```

Expected: lines referencing `ErrorBanner.svelte` and `DialogueBox.svelte` in the lcov output.

**Step 3: Run type-check**

```bash
bun run check
```

Expected: no errors.

**Step 4: Commit (if any fixups needed)**

---

## Summary of files changed

| Action | Path |
|--------|------|
| Create | `src/test-setup.ts` |
| Create | `src/lib/components/ErrorBanner.test.ts` |
| Create | `src/lib/components/DialogueBox.test.ts` |
| Modify | `vite.config.js` |
| Modify | `package.json`, `bun.lock` (via `bun add`) |
