<script lang="ts">
  import InterrogationStage from "$lib/components/InterrogationStage.svelte";
  import type { CaseFileSection } from "$lib/case-file/types";
  import type {
    DialogueHistoryEntry,
    Inventory,
    Mode,
    SceneView,
  } from "$lib/state/types";

  let {
    active,
    scene,
    mode,
    inventory,
    history = [],
    disabled = false,
    topLayerOpen = false,
    onPresent,
    onResume,
    onOpenGameMenu,
    onOpenCaseFile,
  }: {
    active: boolean;
    scene: SceneView;
    mode: Mode;
    inventory: Inventory;
    history?: DialogueHistoryEntry[];
    disabled?: boolean;
    // Forwarded to InterrogationEvidenceTray so its Tab trap suspends while
    // an upper layer (Game Menu / Save Browser / acquisition popup) is open.
    topLayerOpen?: boolean;
    onPresent: (
      lineId: string,
      kind: "evidence" | "statement",
      itemId: string,
    ) => void | Promise<void>;
    onResume: () => void | Promise<void>;
    onOpenGameMenu: (trigger: HTMLElement) => void;
    onOpenCaseFile: (
      section: Extract<CaseFileSection, "objective" | "evidence">,
      trigger: HTMLElement,
    ) => void;
  } = $props();
</script>

<InterrogationStage
  {active}
  {scene}
  {mode}
  {inventory}
  {history}
  {disabled}
  {topLayerOpen}
  {onPresent}
  {onResume}
  {onOpenGameMenu}
  {onOpenCaseFile}
>
  <p>stage child</p>
</InterrogationStage>
