<script lang="ts">
  import {
    carrierOptionsForEvidence,
    evidenceAssignmentsForScene,
    generatedStandaloneHotspotId,
    hotspotCarrierLabel,
    type EvidenceCarrier,
    type SceneEvidenceAssignment,
  } from "./evidence-assignment";
  import { publicPathForEditorAsset } from "./editor-assets";
  import type { InvestigationSceneJson } from "./layout-types";

  type Props = {
    scene: InvestigationSceneJson;
    sublocationId?: string | null;
  };

  let { scene, sublocationId = null }: Props = $props();

  const assignments = $derived(
    evidenceAssignmentsForScene(scene).filter(
      (assignment) =>
        !sublocationId ||
        assignment.evidence.sourceSublocationId === sublocationId,
    ),
  );

  function carrierValue(carrier: EvidenceCarrier): string {
    if (carrier.kind === "hotspot") {
      return `hotspot:${carrier.sublocationId}:${carrier.hotspotId}`;
    }
    if (carrier.kind === "topic") {
      return `topic:${carrier.sublocationId}:${carrier.characterId}:${carrier.topicId}`;
    }
    return `standalone:${carrier.sublocationId}`;
  }

  function selectedCarrier(
    assignment: SceneEvidenceAssignment,
  ): EvidenceCarrier | null {
    const standaloneHotspotId = generatedStandaloneHotspotId(
      assignment.evidence.id,
    );
    const standaloneHotspot = assignment.hotspots.find(
      (hotspot) => hotspot.id === standaloneHotspotId,
    );
    if (standaloneHotspot) {
      return {
        kind: "standalone_hotspot",
        sublocationId: standaloneHotspot.sublocationId,
      };
    }

    const hotspot = assignment.hotspots.find(
      (candidate) => candidate.id !== standaloneHotspotId,
    );
    if (hotspot) {
      return {
        kind: "hotspot",
        sublocationId: hotspot.sublocationId,
        hotspotId: hotspot.id,
      };
    }
    return selectedTopicCarrier(assignment.evidence.id);
  }

  function selectedStandaloneHotspot(
    assignment: SceneEvidenceAssignment,
  ): SceneEvidenceAssignment["hotspots"][number] | null {
    const standaloneHotspotId = generatedStandaloneHotspotId(
      assignment.evidence.id,
    );
    return (
      assignment.hotspots.find(
        (hotspot) => hotspot.id === standaloneHotspotId,
      ) ?? null
    );
  }

  function selectedTopicCarrier(evidenceId: string): EvidenceCarrier | null {
    for (const sublocation of scene.sublocations) {
      for (const character of sublocation.characters) {
        const topic = character.topics.find((candidate) =>
          candidate.reveals.some(
            (reveal) => reveal.kind === "evidence" && reveal.id === evidenceId,
          ),
        );
        if (topic) {
          return {
            kind: "topic",
            sublocationId: sublocation.id,
            characterId: character.id,
            topicId: topic.id,
          };
        }
      }
    }
    return null;
  }

  function carrierLabelForAssignment(
    assignment: SceneEvidenceAssignment,
    carrier: EvidenceCarrier | null,
  ): string {
    if (!carrier) return "Unassigned";
    if (carrier.kind === "standalone_hotspot") {
      const standaloneHotspot = selectedStandaloneHotspot(assignment);
      return standaloneHotspot
        ? `${standaloneHotspot.sublocationLabel} / ${standaloneHotspot.label}`
        : "Standalone evidence source";
    }
    if (carrier.kind === "hotspot") {
      // Look up the hotspot directly so we still label carriers that lack
      // evidenceSource metadata (the audit-flagged case).
      // carrierOptionsForEvidence filters those out, which would hide the
      // actual carrier behind "Unassigned" and leave the user unable to see
      // what to tag.
      return (
        hotspotCarrierLabel(scene, carrier.sublocationId, carrier.hotspotId) ??
        "Unassigned"
      );
    }
    const selectedValue = carrierValue(carrier);
    return (
      carrierOptionsForEvidence(scene, assignment.evidence).find(
        (option) => carrierValue(option.carrier) === selectedValue,
      )?.label ?? "Unassigned"
    );
  }

  function evidenceAssetPath(assetId: string | null): string | null {
    if (!assetId) return null;
    return publicPathForEditorAsset(assetId, "evidence");
  }
</script>

<section
  class="assignment-panel my-6 grid gap-3.5 rounded-lg border border-[#d6dce0] bg-[#f8fbfb] p-4"
  aria-label="Evidence sources"
>
  <div class="panel-header flex items-end justify-between gap-4">
    <div>
      <p
        class="eyebrow m-0 mb-1.5 text-[0.72rem] font-bold tracking-normal text-[#5f6b64] uppercase"
      >
        Evidence
      </p>
      <h3 class="m-0 text-base leading-[1.2] tracking-normal">
        Evidence Sources
      </h3>
    </div>
    <strong class="min-w-8 text-right text-[0.95rem] text-[#405751]"
      >{assignments.length}</strong
    >
  </div>

  <div class="assignment-list grid gap-2">
    {#each assignments as assignment (assignment.evidence.id)}
      {@const currentCarrier = selectedCarrier(assignment)}
      {@const carrierLabel = carrierLabelForAssignment(
        assignment,
        currentCarrier,
      )}
      <article
        class="assignment-row grid min-w-0 grid-cols-[48px_minmax(130px,1fr)_minmax(180px,280px)] items-center gap-3 rounded-md border border-[#e0e6e8] bg-white p-2 max-[900px]:grid-cols-[48px_minmax(0,1fr)]"
      >
        <div
          class="thumb grid h-12 w-12 place-items-center overflow-hidden rounded-md border border-[#d3d9dc] bg-[#eef2f2] font-extrabold text-[#405751]"
          aria-hidden="true"
        >
          {#if evidenceAssetPath(assignment.evidence.imageAssetId)}
            <img
              class="h-full w-full object-cover"
              src={evidenceAssetPath(assignment.evidence.imageAssetId)}
              alt=""
            />
          {:else}
            <span>{assignment.evidence.name.slice(0, 1)}</span>
          {/if}
        </div>
        <div class="evidence-copy grid min-w-0 gap-[3px]">
          <strong class="min-w-0 break-words">{assignment.evidence.name}</strong
          >
          <small class="min-w-0 break-words text-xs text-[#60706b]"
            >{assignment.evidence.id}</small
          >
        </div>
        <span
          class={[
            "carrier-badge min-w-0 rounded-md border px-2.5 py-[7px] text-center text-[0.82rem] font-bold break-words max-[900px]:col-span-full",
            currentCarrier
              ? "border-[#bfcfc8] bg-[#edf4f0] text-[#26302e]"
              : "unassigned border-[#d8dedb] bg-[#f3f5f4] text-[#69746f]",
          ].join(" ")}
          aria-label={`Current source for ${assignment.evidence.name}`}
        >
          {carrierLabel}
        </span>
      </article>
    {/each}
  </div>
</section>
