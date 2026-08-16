<script lang="ts">
  import AcquisitionPopup from "$lib/components/AcquisitionPopup.svelte";
  import type { PendingAcquisitionView } from "$lib/state/types";

  let {
    notification,
    onContinue,
  }: {
    notification: PendingAcquisitionView;
    onContinue: (eventId: string) => Promise<void>;
  } = $props();

  // Fine-grained busy state mirroring acquisition-controller.svelte.ts: busy is
  // its own $state field, so flipping it does NOT reassign the popup's other
  // props. This is what the production controller does in its dismissCurrent
  // finally clause, and what @testing-library/svelte's coarse rerender cannot
  // reproduce.
  let busy = $state(true);

  function goIdle() {
    busy = false;
  }
</script>

<button type="button" data-busy-harness-action="go-idle" onclick={goIdle}>
  go idle
</button>

<AcquisitionPopup {notification} {busy} {onContinue} />
