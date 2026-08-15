<script lang="ts">
  import InterrogationStage from "$lib/components/InterrogationStage.svelte";
  import type { Inventory, Mode, SceneView } from "$lib/state/types";

  let {
    active,
    scene,
    mode,
    inventory,
    disabled = false,
    onPresent,
    onResume,
    onOpenGameMenu,
    onOpenCaseFile,
  }: {
    active: boolean;
    scene: SceneView;
    mode: Mode;
    inventory: Inventory;
    disabled?: boolean;
    onPresent: (
      lineId: string,
      kind: "evidence" | "statement",
      itemId: string,
    ) => void | Promise<void>;
    onResume: () => void | Promise<void>;
    onOpenGameMenu: (trigger: HTMLElement) => void;
    onOpenCaseFile: (trigger: HTMLElement) => void;
  } = $props();
</script>

<InterrogationStage
  {active}
  {scene}
  {mode}
  {inventory}
  {disabled}
  {onPresent}
  {onResume}
  {onOpenGameMenu}
  {onOpenCaseFile}
>
  <p>stage child</p>
</InterrogationStage>
