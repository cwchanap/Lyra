<script lang="ts">
  import {
    carrierOptionsForEvidence,
    evidenceAssignmentsForScene,
    type EvidenceCarrier,
    type SceneEvidenceAssignment,
  } from "./evidence-assignment";
  import { publicPathForEditorAsset } from "./editor-assets";
  import type { InvestigationSceneJson } from "./layout-types";

  type Props = {
    scene: InvestigationSceneJson;
    sublocationId?: string | null;
    disabled?: boolean;
    onAssignEvidence: (
      evidenceId: string,
      carrier: EvidenceCarrier | null,
    ) => void;
  };

  let {
    scene,
    sublocationId = null,
    disabled = false,
    onAssignEvidence,
  }: Props = $props();

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

  function carrierFromValue(value: string): EvidenceCarrier | null {
    if (value === "") return null;
    const parts = value.split(":");
    if (parts[0] === "hotspot") {
      return {
        kind: "hotspot",
        sublocationId: parts[1],
        hotspotId: parts[2],
      };
    }
    if (parts[0] === "topic") {
      return {
        kind: "topic",
        sublocationId: parts[1],
        characterId: parts[2],
        topicId: parts[3],
      };
    }
    return { kind: "standalone_hotspot", sublocationId: parts[1] };
  }

  function selectedCarrierValue(assignment: SceneEvidenceAssignment): string {
    const hotspot = assignment.hotspots[0];
    if (hotspot) {
      return carrierValue({
        kind: "hotspot",
        sublocationId: hotspot.sublocationId,
        hotspotId: hotspot.id,
      });
    }
    return selectedTopicCarrierValue(assignment.evidence.id);
  }

  function selectedTopicCarrierValue(evidenceId: string): string {
    for (const sublocation of scene.sublocations) {
      for (const character of sublocation.characters) {
        const topic = character.topics.find((candidate) =>
          candidate.reveals.some(
            (reveal) => reveal.kind === "evidence" && reveal.id === evidenceId,
          ),
        );
        if (topic) {
          return carrierValue({
            kind: "topic",
            sublocationId: sublocation.id,
            characterId: character.id,
            topicId: topic.id,
          });
        }
      }
    }
    return "";
  }

  function evidenceAssetPath(assetId: string | null): string | null {
    if (!assetId) return null;
    return publicPathForEditorAsset(assetId, "evidence");
  }

  function handleAssignmentChange(
    event: Event,
    assignment: SceneEvidenceAssignment,
  ) {
    const value = (event.currentTarget as HTMLSelectElement).value;
    onAssignEvidence(assignment.evidence.id, carrierFromValue(value));
  }
</script>

<section class="assignment-panel" aria-label="Evidence assignments">
  <div class="panel-header">
    <div>
      <p class="eyebrow">Evidence</p>
      <h3>Hotspot Correlation</h3>
    </div>
    <strong>{assignments.length}</strong>
  </div>

  <div class="assignment-list">
    {#each assignments as assignment (assignment.evidence.id)}
      <article class="assignment-row">
        <div class="thumb" aria-hidden="true">
          {#if evidenceAssetPath(assignment.evidence.imageAssetId)}
            <img
              src={evidenceAssetPath(assignment.evidence.imageAssetId)}
              alt=""
            />
          {:else}
            <span>{assignment.evidence.name.slice(0, 1)}</span>
          {/if}
        </div>
        <div class="evidence-copy">
          <strong>{assignment.evidence.name}</strong>
          <small>{assignment.evidence.id}</small>
        </div>
        <select
          aria-label={`Assign ${assignment.evidence.name}`}
          {disabled}
          value={selectedCarrierValue(assignment)}
          onchange={(event) => handleAssignmentChange(event, assignment)}
        >
          <option value="">Unassigned</option>
          {#each carrierOptionsForEvidence(scene, assignment.evidence) as option (carrierValue(option.carrier))}
            <option value={carrierValue(option.carrier)}>
              {option.label}
            </option>
          {/each}
        </select>
      </article>
    {/each}
  </div>
</section>

<style>
  .assignment-panel {
    display: grid;
    gap: 14px;
    margin: 24px 0;
    padding: 16px;
    border: 1px solid #d6dce0;
    border-radius: 8px;
    background: #f8fbfb;
  }

  .panel-header {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: 16px;
  }

  .eyebrow {
    margin: 0 0 6px;
    color: #5f6b64;
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0;
    text-transform: uppercase;
  }

  h3 {
    margin: 0;
    font-size: 1rem;
    line-height: 1.2;
    letter-spacing: 0;
  }

  .panel-header > strong {
    min-width: 32px;
    text-align: right;
    color: #405751;
    font-size: 0.95rem;
  }

  .assignment-list {
    display: grid;
    gap: 8px;
  }

  .assignment-row {
    display: grid;
    grid-template-columns: 48px minmax(130px, 1fr) minmax(180px, 280px);
    align-items: center;
    gap: 12px;
    min-width: 0;
    padding: 8px;
    border: 1px solid #e0e6e8;
    border-radius: 6px;
    background: #ffffff;
  }

  .thumb {
    display: grid;
    place-items: center;
    width: 48px;
    height: 48px;
    overflow: hidden;
    border: 1px solid #d3d9dc;
    border-radius: 6px;
    background: #eef2f2;
    color: #405751;
    font-weight: 800;
  }

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .evidence-copy {
    display: grid;
    gap: 3px;
    min-width: 0;
  }

  .evidence-copy strong,
  .evidence-copy small {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .evidence-copy small {
    color: #60706b;
    font-size: 0.75rem;
  }

  select {
    min-width: 0;
    min-height: 38px;
    border: 1px solid #bfc7bf;
    border-radius: 6px;
    background: #ffffff;
    color: #26302e;
  }

  select:disabled {
    color: #8a9490;
    background: #f1f3f2;
  }

  @media (max-width: 900px) {
    .assignment-row {
      grid-template-columns: 48px minmax(0, 1fr);
    }

    select {
      grid-column: 1 / -1;
    }
  }
</style>
