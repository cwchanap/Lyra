// Task 6 consumes this prerequisite module; Task 5 deliberately leaves the
// live scene runtimes on their existing flat queues.
#![allow(dead_code)]

use serde::{Deserialize, Serialize};

use crate::game::schema::{
    DialogueItem, InterrogationPhaseJson, InterrogationSceneJson, InvestigationSceneJson, SceneJson,
};
use crate::game::GameError;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub(super) enum DialogueSegmentOriginV1 {
    LinearScene {
        chapter_id: String,
        scene_id: String,
    },
    InvestigationIntro {
        chapter_id: String,
        scene_id: String,
    },
    InvestigationOutro {
        chapter_id: String,
        scene_id: String,
    },
    InvestigationInteraction {
        chapter_id: String,
        scene_id: String,
        segment_id: String,
    },
    InterrogationIntro {
        chapter_id: String,
        scene_id: String,
    },
    InterrogationOutro {
        chapter_id: String,
        scene_id: String,
    },
    InterrogationPhase {
        chapter_id: String,
        scene_id: String,
        phase_id: String,
        segment_id: String,
    },
}

impl DialogueSegmentOriginV1 {
    fn chapter_id(&self) -> &str {
        match self {
            Self::LinearScene { chapter_id, .. }
            | Self::InvestigationIntro { chapter_id, .. }
            | Self::InvestigationOutro { chapter_id, .. }
            | Self::InvestigationInteraction { chapter_id, .. }
            | Self::InterrogationIntro { chapter_id, .. }
            | Self::InterrogationOutro { chapter_id, .. }
            | Self::InterrogationPhase { chapter_id, .. } => chapter_id,
        }
    }

    fn scene_id(&self) -> &str {
        match self {
            Self::LinearScene { scene_id, .. }
            | Self::InvestigationIntro { scene_id, .. }
            | Self::InvestigationOutro { scene_id, .. }
            | Self::InvestigationInteraction { scene_id, .. }
            | Self::InterrogationIntro { scene_id, .. }
            | Self::InterrogationOutro { scene_id, .. }
            | Self::InterrogationPhase { scene_id, .. } => scene_id,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct DialogueSegment {
    pub(super) origin: DialogueSegmentOriginV1,
    pub(super) items: Vec<DialogueItem>,
}

#[derive(Debug, Clone)]
pub(super) struct ActiveDialogueQueue {
    segments: Vec<DialogueSegment>,
    active_segment_index: usize,
    item_cursor: usize,
    queue_gen: u64,
}

#[allow(dead_code)]
impl ActiveDialogueQueue {
    pub(super) fn new(mut segments: Vec<DialogueSegment>, queue_gen: u64) -> Option<Self> {
        segments.retain(|segment| !segment.items.is_empty());
        (!segments.is_empty()).then_some(Self {
            segments,
            active_segment_index: 0,
            item_cursor: 0,
            queue_gen,
        })
    }

    pub(super) fn from_position(
        segments: Vec<DialogueSegment>,
        active_segment_index: usize,
        item_cursor: usize,
        queue_gen: u64,
    ) -> Result<Self, GameError> {
        validate_segments(&segments)?;
        let segment = segments.get(active_segment_index).ok_or_else(|| {
            queue_error(format!(
                "Active segment index {active_segment_index} is out of range for {} segments.",
                segments.len()
            ))
        })?;
        if item_cursor >= segment.items.len() {
            return Err(queue_error(format!(
                "Item cursor {item_cursor} is out of range for segment {active_segment_index} with {} items.",
                segment.items.len()
            )));
        }
        Ok(Self {
            segments,
            active_segment_index,
            item_cursor,
            queue_gen,
        })
    }

    pub(super) fn from_flattened_cursor(
        segments: Vec<DialogueSegment>,
        flattened_cursor: usize,
        queue_gen: u64,
    ) -> Result<Self, GameError> {
        validate_segments(&segments)?;
        let mut remaining = flattened_cursor;
        for (active_segment_index, segment) in segments.iter().enumerate() {
            if remaining < segment.items.len() {
                return Ok(Self {
                    segments,
                    active_segment_index,
                    item_cursor: remaining,
                    queue_gen,
                });
            }
            remaining -= segment.items.len();
        }
        Err(queue_error(format!(
            "Flattened cursor {flattened_cursor} is out of range."
        )))
    }

    pub(super) fn current(&self) -> Option<&DialogueItem> {
        self.segments
            .get(self.active_segment_index)?
            .items
            .get(self.item_cursor)
    }

    pub(super) fn advance(&mut self) -> bool {
        let segment = &self.segments[self.active_segment_index];
        if self.item_cursor + 1 < segment.items.len() {
            self.item_cursor += 1;
            return false;
        }
        if self.active_segment_index + 1 < self.segments.len() {
            self.active_segment_index += 1;
            self.item_cursor = 0;
            return false;
        }
        true
    }

    pub(super) fn active_coordinates(&self) -> (usize, usize) {
        (self.active_segment_index, self.item_cursor)
    }

    pub(super) fn flattened_cursor(&self) -> Result<usize, GameError> {
        let lengths: Vec<usize> = self
            .segments
            .iter()
            .map(|segment| segment.items.len())
            .collect();
        checked_flattened_cursor(&lengths, self.active_segment_index, self.item_cursor)
    }

    pub(super) fn queue_remaining(&self) -> usize {
        self.segments[self.active_segment_index].items.len() - self.item_cursor - 1
            + self.segments[self.active_segment_index + 1..]
                .iter()
                .map(|segment| segment.items.len())
                .sum::<usize>()
    }

    pub(super) fn queue_gen(&self) -> u64 {
        self.queue_gen
    }

    pub(super) fn segment_origins(&self) -> Vec<DialogueSegmentOriginV1> {
        self.segments
            .iter()
            .map(|segment| segment.origin.clone())
            .collect()
    }
}

fn validate_segments(segments: &[DialogueSegment]) -> Result<(), GameError> {
    if segments.is_empty() {
        return Err(queue_error("An active dialogue queue must have a segment."));
    }
    if let Some(index) = segments.iter().position(|segment| segment.items.is_empty()) {
        return Err(queue_error(format!(
            "Dialogue segment {index} has no items."
        )));
    }
    Ok(())
}

fn checked_flattened_cursor(
    segment_lengths: &[usize],
    active_segment_index: usize,
    item_cursor: usize,
) -> Result<usize, GameError> {
    if active_segment_index >= segment_lengths.len() {
        return Err(queue_error(format!(
            "Active segment index {active_segment_index} is out of range for {} segments.",
            segment_lengths.len()
        )));
    }
    if item_cursor >= segment_lengths[active_segment_index] {
        return Err(queue_error(format!(
            "Item cursor {item_cursor} is out of range for segment {active_segment_index}."
        )));
    }
    segment_lengths[..active_segment_index]
        .iter()
        .try_fold(0usize, |cursor, length| cursor.checked_add(*length))
        .and_then(|cursor| cursor.checked_add(item_cursor))
        .ok_or_else(|| queue_error("Flattened dialogue cursor overflowed usize."))
}

fn queue_error(detail: impl Into<String>) -> GameError {
    GameError::new("invalidDialogueQueue", detail)
}

pub(super) fn resolve_dialogue_segments(
    chapter_id: &str,
    scene: &SceneJson,
    origins: &[DialogueSegmentOriginV1],
) -> Result<Vec<DialogueSegment>, GameError> {
    if origins.is_empty() {
        return Err(resolution_error(
            "No dialogue segment origins were provided.",
        ));
    }

    origins
        .iter()
        .map(|origin| {
            if origin.chapter_id() != chapter_id {
                return Err(resolution_error(format!(
                    "Origin chapter '{}' does not match packaged chapter '{chapter_id}'.",
                    origin.chapter_id()
                )));
            }
            let packaged_scene_id = scene_id(scene);
            if origin.scene_id() != packaged_scene_id {
                return Err(resolution_error(format!(
                    "Origin scene '{}' does not match packaged scene '{packaged_scene_id}'.",
                    origin.scene_id()
                )));
            }

            let items = resolve_origin_items(scene, origin)?;
            if items.is_empty() {
                return Err(resolution_error(format!(
                    "Dialogue origin {origin:?} resolved to an empty target."
                )));
            }
            Ok(DialogueSegment {
                origin: origin.clone(),
                items: items.to_vec(),
            })
        })
        .collect()
}

fn scene_id(scene: &SceneJson) -> &str {
    match scene {
        SceneJson::Linear(scene) => &scene.id,
        SceneJson::Investigation(scene) => &scene.id,
        SceneJson::Interrogation(scene) => &scene.id,
    }
}

fn resolve_origin_items<'a>(
    scene: &'a SceneJson,
    origin: &DialogueSegmentOriginV1,
) -> Result<&'a [DialogueItem], GameError> {
    match (scene, origin) {
        (SceneJson::Linear(scene), DialogueSegmentOriginV1::LinearScene { .. }) => Ok(&scene.queue),
        (SceneJson::Investigation(scene), DialogueSegmentOriginV1::InvestigationIntro { .. }) => {
            Ok(&scene.intro)
        }
        (SceneJson::Investigation(scene), DialogueSegmentOriginV1::InvestigationOutro { .. }) => {
            Ok(&scene.outro.dialogue)
        }
        (
            SceneJson::Investigation(scene),
            DialogueSegmentOriginV1::InvestigationInteraction { segment_id, .. },
        ) => resolve_investigation_interaction(scene, segment_id),
        (SceneJson::Interrogation(scene), DialogueSegmentOriginV1::InterrogationIntro { .. }) => {
            Ok(&scene.intro)
        }
        (SceneJson::Interrogation(scene), DialogueSegmentOriginV1::InterrogationOutro { .. }) => {
            Ok(&scene.outro.dialogue)
        }
        (
            SceneJson::Interrogation(scene),
            DialogueSegmentOriginV1::InterrogationPhase {
                phase_id,
                segment_id,
                ..
            },
        ) => resolve_interrogation_phase(scene, phase_id, segment_id),
        _ => Err(resolution_error(format!(
            "Dialogue origin {origin:?} does not match packaged scene kind."
        ))),
    }
}

fn resolve_investigation_interaction<'a>(
    scene: &'a InvestigationSceneJson,
    segment_id: &str,
) -> Result<&'a [DialogueItem], GameError> {
    if let Some(id) = role_id(segment_id, "sublocation:", ":transition") {
        return scene
            .sublocations
            .iter()
            .find(|sublocation| sublocation.id == id)
            .map(|sublocation| sublocation.transition_dialogue.as_slice())
            .ok_or_else(|| unresolved_segment(segment_id));
    }

    for (suffix, reexamine) in [(":inspect", false), (":reexamine", true)] {
        if let Some(id) = role_id(segment_id, "hotspot:", suffix) {
            let hotspot = scene
                .sublocations
                .iter()
                .flat_map(|sublocation| &sublocation.hotspots)
                .find(|hotspot| hotspot.id == id)
                .ok_or_else(|| unresolved_segment(segment_id))?;
            return if reexamine {
                hotspot
                    .on_reexamine
                    .as_deref()
                    .ok_or_else(|| unresolved_segment(segment_id))
            } else {
                Ok(&hotspot.inspect_dialogue)
            };
        }
    }

    for (suffix, reexamine) in [(":dialogue", false), (":reexamine", true)] {
        if let Some(ids) = role_id(segment_id, "topic:", suffix) {
            let (character_id, topic_id) = ids
                .split_once(':')
                .filter(|(character_id, topic_id)| !character_id.is_empty() && !topic_id.is_empty())
                .ok_or_else(|| unresolved_segment(segment_id))?;
            let topic = scene
                .sublocations
                .iter()
                .flat_map(|sublocation| &sublocation.characters)
                .find(|character| character.id == character_id)
                .and_then(|character| character.topics.iter().find(|topic| topic.id == topic_id))
                .ok_or_else(|| unresolved_segment(segment_id))?;
            return if reexamine {
                topic
                    .on_reexamine
                    .as_deref()
                    .ok_or_else(|| unresolved_segment(segment_id))
            } else {
                Ok(&topic.topic_dialogue)
            };
        }
    }

    for (prefix, suffix, reexamine) in [
        ("evidence:", ":onCollect", false),
        ("evidence:", ":onReexamine", true),
    ] {
        if let Some(id) = role_id(segment_id, prefix, suffix) {
            let evidence = scene
                .evidence_manifest
                .iter()
                .find(|evidence| evidence.id == id)
                .ok_or_else(|| unresolved_segment(segment_id))?;
            return if reexamine {
                evidence
                    .on_reexamine
                    .as_deref()
                    .ok_or_else(|| unresolved_segment(segment_id))
            } else {
                Ok(&evidence.on_collect)
            };
        }
    }

    for (prefix, suffix, reexamine) in [
        ("statement:", ":onAcquire", false),
        ("statement:", ":onReexamine", true),
    ] {
        if let Some(id) = role_id(segment_id, prefix, suffix) {
            let statement = scene
                .statement_manifest
                .iter()
                .find(|statement| statement.id == id)
                .ok_or_else(|| unresolved_segment(segment_id))?;
            return if reexamine {
                statement
                    .on_reexamine
                    .as_deref()
                    .ok_or_else(|| unresolved_segment(segment_id))
            } else {
                Ok(&statement.on_acquire)
            };
        }
    }

    Err(unresolved_segment(segment_id))
}

fn resolve_interrogation_phase<'a>(
    scene: &'a InterrogationSceneJson,
    phase_id: &str,
    segment_id: &str,
) -> Result<&'a [DialogueItem], GameError> {
    if phase_id == "inventory" {
        return resolve_interrogation_inventory(scene, segment_id);
    }

    let phase = scene
        .phases
        .iter()
        .find(|phase| interrogation_phase_id(phase) == phase_id)
        .ok_or_else(|| {
            resolution_error(format!(
                "Interrogation phase '{phase_id}' does not exist in scene '{}'.",
                scene.id
            ))
        })?;
    let InterrogationPhaseJson::Inquiry {
        entry_dialogue,
        questions,
        ..
    } = phase;

    if segment_id == format!("phase:{phase_id}:entry") {
        return Ok(entry_dialogue);
    }

    let body = segment_id
        .strip_prefix("question:")
        .ok_or_else(|| unresolved_segment(segment_id))?;
    let (question_id, role) = body
        .split_once(':')
        .filter(|(question_id, role)| !question_id.is_empty() && !role.is_empty())
        .ok_or_else(|| unresolved_segment(segment_id))?;
    let question = questions
        .iter()
        .find(|question| question.id == question_id)
        .ok_or_else(|| unresolved_segment(segment_id))?;
    let testimony = &question.testimony;

    match role {
        "onLoop" => return Ok(&testimony.on_loop),
        "loopPrompt" => return Ok(&testimony.loop_prompt),
        "defaultChallenge" => return Ok(&testimony.default_challenge),
        "defaultWrong" => return Ok(&testimony.default_wrong),
        "wrongReply" => return Ok(&testimony.wrong_reply),
        _ => {}
    }

    let line_role = role
        .strip_prefix("line:")
        .ok_or_else(|| unresolved_segment(segment_id))?;
    let (line_id, role) = line_role
        .split_once(':')
        .filter(|(line_id, role)| !line_id.is_empty() && !role.is_empty())
        .ok_or_else(|| unresolved_segment(segment_id))?;
    let line = testimony
        .lines
        .iter()
        .find(|line| line.id == line_id)
        .ok_or_else(|| unresolved_segment(segment_id))?;
    match role {
        "content" => Ok(&line.content),
        "challenge" => Ok(&line.challenge),
        "onCorrect" => Ok(&line.on_correct),
        "onWrongEvidence" => Ok(&line.on_wrong_evidence),
        _ => Err(unresolved_segment(segment_id)),
    }
}

fn resolve_interrogation_inventory<'a>(
    scene: &'a InterrogationSceneJson,
    segment_id: &str,
) -> Result<&'a [DialogueItem], GameError> {
    for (prefix, suffix, reexamine) in [
        ("evidence:", ":onCollect", false),
        ("evidence:", ":onReexamine", true),
    ] {
        if let Some(id) = role_id(segment_id, prefix, suffix) {
            let evidence = scene
                .evidence_manifest
                .iter()
                .find(|evidence| evidence.id == id)
                .ok_or_else(|| unresolved_segment(segment_id))?;
            return if reexamine {
                evidence
                    .on_reexamine
                    .as_deref()
                    .ok_or_else(|| unresolved_segment(segment_id))
            } else {
                Ok(&evidence.on_collect)
            };
        }
    }
    for (prefix, suffix, reexamine) in [
        ("statement:", ":onAcquire", false),
        ("statement:", ":onReexamine", true),
    ] {
        if let Some(id) = role_id(segment_id, prefix, suffix) {
            let statement = scene
                .statement_manifest
                .iter()
                .find(|statement| statement.id == id)
                .ok_or_else(|| unresolved_segment(segment_id))?;
            return if reexamine {
                statement
                    .on_reexamine
                    .as_deref()
                    .ok_or_else(|| unresolved_segment(segment_id))
            } else {
                Ok(&statement.on_acquire)
            };
        }
    }
    Err(unresolved_segment(segment_id))
}

fn interrogation_phase_id(phase: &InterrogationPhaseJson) -> &str {
    let InterrogationPhaseJson::Inquiry { id, .. } = phase;
    id
}

fn role_id<'a>(segment_id: &'a str, prefix: &str, suffix: &str) -> Option<&'a str> {
    segment_id
        .strip_prefix(prefix)
        .and_then(|body| body.strip_suffix(suffix))
        .filter(|id| !id.is_empty())
}

fn unresolved_segment(segment_id: &str) -> GameError {
    resolution_error(format!(
        "Dialogue segment role '{segment_id}' does not resolve in the packaged scene."
    ))
}

fn resolution_error(detail: impl Into<String>) -> GameError {
    GameError::new("dialogueSegmentResolutionFailed", detail)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game::schema::{DialogueItem, SceneJson};
    use serde_json::json;

    const CHAPTER_ID: &str = "chapter_1";
    const LINEAR_SCENE_ID: &str = "scene_linear";
    const INVESTIGATION_SCENE_ID: &str = "scene_investigation";
    const INTERROGATION_SCENE_ID: &str = "scene_interrogation";
    const PHASE_ID: &str = "phase_alpha";

    fn action(text: &str) -> DialogueItem {
        DialogueItem::Action { text: text.into() }
    }

    fn action_text(items: &[DialogueItem]) -> Vec<&str> {
        items
            .iter()
            .map(|item| match item {
                DialogueItem::Action { text } => text.as_str(),
                other => panic!("expected action item, got {other:?}"),
            })
            .collect()
    }

    fn linear_scene(items: serde_json::Value) -> SceneJson {
        serde_json::from_value(json!({
            "type": "linear",
            "id": LINEAR_SCENE_ID,
            "title": "Linear",
            "queue": items,
        }))
        .expect("linear scene fixture should deserialize")
    }

    fn investigation_scene() -> SceneJson {
        serde_json::from_value(json!({
            "type": "investigation",
            "id": INVESTIGATION_SCENE_ID,
            "title": "Investigation",
            "intro": [{ "kind": "action", "text": "investigation:intro" }],
            "sublocations": [{
                "id": "lobby",
                "label": "Lobby",
                "status": "unlocked",
                "unlock": null,
                "reveals": [],
                "sceneTag": "Lobby",
                "transitionDialogue": [
                    { "kind": "action", "text": "sublocation:lobby:transition" }
                ],
                "hotspots": [{
                    "id": "desk",
                    "label": "Desk",
                    "description": "A desk.",
                    "status": "unlocked",
                    "unlock": null,
                    "reveals": [],
                    "inspectDialogue": [
                        { "kind": "action", "text": "hotspot:desk:inspect" }
                    ],
                    "onReexamine": [
                        { "kind": "action", "text": "hotspot:desk:reexamine" }
                    ]
                }],
                "characters": [{
                    "id": "witness",
                    "name": "Witness",
                    "role": "Witness",
                    "bio": "Saw something.",
                    "topics": [{
                        "id": "alibi",
                        "label": "Alibi",
                        "status": "unlocked",
                        "unlock": null,
                        "reveals": [],
                        "topicDialogue": [
                            { "kind": "action", "text": "topic:witness:alibi:dialogue" }
                        ],
                        "onReexamine": [
                            { "kind": "action", "text": "topic:witness:alibi:reexamine" }
                        ]
                    }]
                }]
            }],
            "evidenceManifest": [{
                "id": "receipt",
                "name": "Receipt",
                "description": "A receipt.",
                "details": "Timestamped.",
                "onCollect": [
                    { "kind": "action", "text": "evidence:receipt:onCollect" }
                ],
                "onReexamine": [
                    { "kind": "action", "text": "evidence:receipt:onReexamine" }
                ]
            }],
            "statementManifest": [{
                "id": "alibi_statement",
                "speaker": "Witness",
                "content": "I was elsewhere.",
                "onAcquire": [
                    { "kind": "action", "text": "statement:alibi_statement:onAcquire" }
                ],
                "onReexamine": [
                    { "kind": "action", "text": "statement:alibi_statement:onReexamine" }
                ]
            }],
            "outro": {
                "unlock": "auto",
                "dialogue": [{ "kind": "action", "text": "investigation:outro" }]
            }
        }))
        .expect("investigation scene fixture should deserialize")
    }

    fn interrogation_scene() -> SceneJson {
        let line = json!({
            "id": "timeline",
            "label": "Timeline",
            "content": [
                { "kind": "action", "text": "question:whereabouts:line:timeline:content" }
            ],
            "contradiction": null,
            "challenge": [
                { "kind": "action", "text": "question:whereabouts:line:timeline:challenge" }
            ],
            "onCorrect": [
                { "kind": "action", "text": "question:whereabouts:line:timeline:onCorrect" }
            ],
            "onWrongEvidence": [
                { "kind": "action", "text": "question:whereabouts:line:timeline:onWrongEvidence" }
            ],
            "reveals": []
        });
        let question = json!({
            "id": "whereabouts",
            "label": "Whereabouts",
            "status": "unlocked",
            "required": true,
            "unlock": null,
            "reveals": [],
            "testimony": {
                "onLoop": [
                    { "kind": "action", "text": "question:whereabouts:onLoop" }
                ],
                "loopPrompt": [
                    { "kind": "action", "text": "question:whereabouts:loopPrompt" }
                ],
                "defaultChallenge": [
                    { "kind": "action", "text": "question:whereabouts:defaultChallenge" }
                ],
                "defaultWrong": [
                    { "kind": "action", "text": "question:whereabouts:defaultWrong" }
                ],
                "wrongReply": [
                    { "kind": "action", "text": "question:whereabouts:wrongReply" }
                ],
                "lines": [line]
            }
        });
        let phase = json!({
            "kind": "inquiry",
            "id": PHASE_ID,
            "label": "Phase alpha",
            "subject": {
                "id": "suspect",
                "name": "Suspect",
                "role": "Suspect",
                "bio": "A suspect."
            },
            "required": true,
            "status": "unlocked",
            "unlock": null,
            "reveals": [],
            "sceneTag": "Interview room",
            "entryDialogue": [
                { "kind": "action", "text": "phase:phase_alpha:entry" }
            ],
            "complete": "auto",
            "questions": [question]
        });
        serde_json::from_value(json!({
            "type": "interrogation",
            "id": INTERROGATION_SCENE_ID,
            "title": "Interrogation",
            "intro": [{ "kind": "action", "text": "interrogation:intro" }],
            "phases": [phase],
            "evidenceManifest": [{
                "id": "camera",
                "name": "Camera",
                "description": "Camera footage.",
                "details": "Timestamped.",
                "onCollect": [
                    { "kind": "action", "text": "evidence:camera:onCollect" }
                ],
                "onReexamine": [
                    { "kind": "action", "text": "evidence:camera:onReexamine" }
                ]
            }],
            "statementManifest": [{
                "id": "denial",
                "speaker": "Suspect",
                "content": "I deny it.",
                "onAcquire": [
                    { "kind": "action", "text": "statement:denial:onAcquire" }
                ],
                "onReexamine": [
                    { "kind": "action", "text": "statement:denial:onReexamine" }
                ]
            }],
            "outro": {
                "unlock": "auto",
                "dialogue": [{ "kind": "action", "text": "interrogation:outro" }]
            }
        }))
        .expect("interrogation scene fixture should deserialize")
    }

    fn investigation_interaction(segment_id: &str) -> DialogueSegmentOriginV1 {
        DialogueSegmentOriginV1::InvestigationInteraction {
            chapter_id: CHAPTER_ID.into(),
            scene_id: INVESTIGATION_SCENE_ID.into(),
            segment_id: segment_id.into(),
        }
    }

    fn interrogation_phase(segment_id: &str) -> DialogueSegmentOriginV1 {
        DialogueSegmentOriginV1::InterrogationPhase {
            chapter_id: CHAPTER_ID.into(),
            scene_id: INTERROGATION_SCENE_ID.into(),
            phase_id: PHASE_ID.into(),
            segment_id: segment_id.into(),
        }
    }

    fn resolved_text(scene: &SceneJson, origin: DialogueSegmentOriginV1) -> String {
        let segments =
            resolve_dialogue_segments(CHAPTER_ID, scene, &[origin]).expect("origin should resolve");
        assert_eq!(segments.len(), 1);
        action_text(&segments[0].items)[0].to_string()
    }

    #[test]
    fn origin_serde_matches_the_compiler_wire_contract() {
        let origins = [
            DialogueSegmentOriginV1::LinearScene {
                chapter_id: "chapter_1".into(),
                scene_id: "scene_1".into(),
            },
            DialogueSegmentOriginV1::InvestigationIntro {
                chapter_id: "chapter_1".into(),
                scene_id: "scene_2".into(),
            },
            DialogueSegmentOriginV1::InvestigationOutro {
                chapter_id: "chapter_1".into(),
                scene_id: "scene_2".into(),
            },
            DialogueSegmentOriginV1::InvestigationInteraction {
                chapter_id: "chapter_1".into(),
                scene_id: "scene_2".into(),
                segment_id: "hotspot:desk:inspect".into(),
            },
            DialogueSegmentOriginV1::InterrogationIntro {
                chapter_id: "chapter_1".into(),
                scene_id: "scene_3".into(),
            },
            DialogueSegmentOriginV1::InterrogationOutro {
                chapter_id: "chapter_1".into(),
                scene_id: "scene_3".into(),
            },
            DialogueSegmentOriginV1::InterrogationPhase {
                chapter_id: "chapter_1".into(),
                scene_id: "scene_3".into(),
                phase_id: "phase_1".into(),
                segment_id: "question:q1:onLoop".into(),
            },
        ];

        let actual: Vec<serde_json::Value> = origins
            .iter()
            .map(|origin| serde_json::to_value(origin).expect("origin should serialize"))
            .collect();
        assert_eq!(
            actual,
            vec![
                json!({"type":"linearScene","chapterId":"chapter_1","sceneId":"scene_1"}),
                json!({"type":"investigationIntro","chapterId":"chapter_1","sceneId":"scene_2"}),
                json!({"type":"investigationOutro","chapterId":"chapter_1","sceneId":"scene_2"}),
                json!({"type":"investigationInteraction","chapterId":"chapter_1","sceneId":"scene_2","segmentId":"hotspot:desk:inspect"}),
                json!({"type":"interrogationIntro","chapterId":"chapter_1","sceneId":"scene_3"}),
                json!({"type":"interrogationOutro","chapterId":"chapter_1","sceneId":"scene_3"}),
                json!({"type":"interrogationPhase","chapterId":"chapter_1","sceneId":"scene_3","phaseId":"phase_1","segmentId":"question:q1:onLoop"}),
            ]
        );
        let decoded: Vec<DialogueSegmentOriginV1> = actual
            .into_iter()
            .map(|value| serde_json::from_value(value).expect("origin should deserialize"))
            .collect();
        assert_eq!(decoded, origins);
    }

    #[test]
    fn origin_deserialization_rejects_redundant_interaction_identity() {
        let value = json!({
            "type": "investigationInteraction",
            "chapterId": "chapter_1",
            "sceneId": "scene_2",
            "segmentId": "hotspot:desk:inspect",
            "interactionId": "desk"
        });

        assert!(
            serde_json::from_value::<DialogueSegmentOriginV1>(value).is_err(),
            "redundant interaction identity must not be silently accepted"
        );
    }

    #[test]
    fn origin_deserialization_rejects_revision_fields() {
        let values = [
            json!({
                "type": "linearScene",
                "chapterId": "chapter_1",
                "sceneId": "scene_1",
                "contentRevision": "sha256:stale"
            }),
            json!({
                "type": "interrogationIntro",
                "chapterId": "chapter_1",
                "sceneId": "scene_3",
                "packageRevision": "revision-2"
            }),
        ];

        for value in values {
            assert!(
                serde_json::from_value::<DialogueSegmentOriginV1>(value).is_err(),
                "revision fields must not be silently accepted"
            );
        }
    }

    #[test]
    fn origin_deserialization_rejects_structural_and_content_hash_fields() {
        let values = [
            json!({
                "type": "investigationOutro",
                "chapterId": "chapter_1",
                "sceneId": "scene_2",
                "structuralHash": "sha256:structure"
            }),
            json!({
                "type": "interrogationPhase",
                "chapterId": "chapter_1",
                "sceneId": "scene_3",
                "phaseId": "phase_1",
                "segmentId": "question:q1:onLoop",
                "contentHash": "sha256:content"
            }),
        ];

        for value in values {
            assert!(
                serde_json::from_value::<DialogueSegmentOriginV1>(value).is_err(),
                "hash fields must not be silently accepted"
            );
        }
    }

    #[test]
    fn active_queue_omits_empty_segments_and_uses_segment_coordinates() {
        let first_origin = DialogueSegmentOriginV1::LinearScene {
            chapter_id: CHAPTER_ID.into(),
            scene_id: LINEAR_SCENE_ID.into(),
        };
        let first = DialogueSegment {
            origin: first_origin.clone(),
            items: vec![action("first")],
        };
        let empty = DialogueSegment {
            origin: DialogueSegmentOriginV1::InvestigationIntro {
                chapter_id: CHAPTER_ID.into(),
                scene_id: INVESTIGATION_SCENE_ID.into(),
            },
            items: vec![],
        };
        let queue = ActiveDialogueQueue::new(vec![empty, first], 41)
            .expect("one non-empty segment should install");

        assert_eq!(queue.active_coordinates(), (0, 0));
        assert_eq!(queue.queue_gen(), 41);
        assert_eq!(
            action_text(std::slice::from_ref(queue.current().unwrap())),
            ["first"]
        );
        assert_eq!(queue.segment_origins(), [first_origin]);
    }

    #[test]
    fn active_queue_flattened_cursor_matches_the_existing_queue_token_cursor() {
        let segments: Vec<DialogueSegment> = ["a", "b", "c"]
            .into_iter()
            .map(|text| DialogueSegment {
                origin: DialogueSegmentOriginV1::LinearScene {
                    chapter_id: CHAPTER_ID.into(),
                    scene_id: format!("scene_{text}"),
                },
                items: if text == "a" {
                    vec![action("a0"), action("a1")]
                } else {
                    vec![action(text)]
                },
            })
            .collect();
        let queue = ActiveDialogueQueue::from_flattened_cursor(segments.clone(), 3, 9)
            .expect("flattened cursor should be valid");
        let restored = ActiveDialogueQueue::from_position(segments, 2, 0, 9)
            .expect("saved coordinates should be valid");

        assert_eq!(queue.active_coordinates(), (2, 0));
        assert_eq!(queue.flattened_cursor().unwrap(), 3);
        assert_eq!(queue.queue_remaining(), 0);
        assert_eq!(
            action_text(std::slice::from_ref(queue.current().unwrap())),
            ["c"]
        );
        assert_eq!(restored.active_coordinates(), (2, 0));
        assert_eq!(restored.flattened_cursor().unwrap(), 3);
        assert_eq!(restored.queue_gen(), 9);
        assert_eq!(
            action_text(std::slice::from_ref(restored.current().unwrap())),
            ["c"]
        );
    }

    #[test]
    fn active_queue_rejects_out_of_range_coordinates_and_overflow() {
        let segment = DialogueSegment {
            origin: DialogueSegmentOriginV1::LinearScene {
                chapter_id: CHAPTER_ID.into(),
                scene_id: LINEAR_SCENE_ID.into(),
            },
            items: vec![action("only")],
        };

        for result in [
            ActiveDialogueQueue::from_position(vec![segment.clone()], 1, 0, 1),
            ActiveDialogueQueue::from_position(vec![segment.clone()], 0, 1, 1),
            ActiveDialogueQueue::from_flattened_cursor(vec![segment], 1, 1),
        ] {
            let error = result.expect_err("invalid coordinates must be rejected");
            assert_eq!(error.code, "invalidDialogueQueue");
        }
        let error = checked_flattened_cursor(&[usize::MAX, 1, 1], 2, 0)
            .expect_err("flattened cursor overflow must be rejected");
        assert_eq!(error.code, "invalidDialogueQueue");
    }

    #[test]
    fn empty_segment_list_does_not_install_an_active_queue() {
        assert!(ActiveDialogueQueue::new(vec![], 1).is_none());
        assert!(ActiveDialogueQueue::new(
            vec![DialogueSegment {
                origin: DialogueSegmentOriginV1::LinearScene {
                    chapter_id: CHAPTER_ID.into(),
                    scene_id: LINEAR_SCENE_ID.into(),
                },
                items: vec![],
            }],
            1,
        )
        .is_none());
    }

    #[test]
    fn active_queue_advance_crosses_segments_and_reports_final_exhaustion() {
        let origin = DialogueSegmentOriginV1::LinearScene {
            chapter_id: CHAPTER_ID.into(),
            scene_id: LINEAR_SCENE_ID.into(),
        };
        let mut queue = ActiveDialogueQueue::new(
            vec![
                DialogueSegment {
                    origin: origin.clone(),
                    items: vec![action("a0"), action("a1")],
                },
                DialogueSegment {
                    origin,
                    items: vec![action("b0")],
                },
            ],
            5,
        )
        .unwrap();

        assert_eq!(queue.queue_remaining(), 2);
        assert!(!queue.advance());
        assert_eq!(queue.active_coordinates(), (0, 1));
        assert_eq!(queue.flattened_cursor().unwrap(), 1);
        assert_eq!(queue.queue_remaining(), 1);
        assert!(!queue.advance());
        assert_eq!(queue.active_coordinates(), (1, 0));
        assert_eq!(queue.flattened_cursor().unwrap(), 2);
        assert_eq!(queue.queue_remaining(), 0);
        assert!(queue.advance());
        assert_eq!(queue.active_coordinates(), (1, 0));
    }

    #[test]
    fn resolves_the_linear_scene_body() {
        let scene = linear_scene(json!([
            { "kind": "action", "text": "linear:first" },
            { "kind": "action", "text": "linear:second" }
        ]));
        let origin = DialogueSegmentOriginV1::LinearScene {
            chapter_id: CHAPTER_ID.into(),
            scene_id: LINEAR_SCENE_ID.into(),
        };

        let segments = resolve_dialogue_segments(CHAPTER_ID, &scene, &[origin])
            .expect("linear should resolve");
        assert_eq!(
            action_text(&segments[0].items),
            ["linear:first", "linear:second"]
        );
    }

    #[test]
    fn resolves_every_investigation_role() {
        let scene = investigation_scene();
        let cases = [
            (
                DialogueSegmentOriginV1::InvestigationIntro {
                    chapter_id: CHAPTER_ID.into(),
                    scene_id: INVESTIGATION_SCENE_ID.into(),
                },
                "investigation:intro",
            ),
            (
                DialogueSegmentOriginV1::InvestigationOutro {
                    chapter_id: CHAPTER_ID.into(),
                    scene_id: INVESTIGATION_SCENE_ID.into(),
                },
                "investigation:outro",
            ),
            (
                investigation_interaction("sublocation:lobby:transition"),
                "sublocation:lobby:transition",
            ),
            (
                investigation_interaction("hotspot:desk:inspect"),
                "hotspot:desk:inspect",
            ),
            (
                investigation_interaction("hotspot:desk:reexamine"),
                "hotspot:desk:reexamine",
            ),
            (
                investigation_interaction("topic:witness:alibi:dialogue"),
                "topic:witness:alibi:dialogue",
            ),
            (
                investigation_interaction("topic:witness:alibi:reexamine"),
                "topic:witness:alibi:reexamine",
            ),
            (
                investigation_interaction("evidence:receipt:onCollect"),
                "evidence:receipt:onCollect",
            ),
            (
                investigation_interaction("evidence:receipt:onReexamine"),
                "evidence:receipt:onReexamine",
            ),
            (
                investigation_interaction("statement:alibi_statement:onAcquire"),
                "statement:alibi_statement:onAcquire",
            ),
            (
                investigation_interaction("statement:alibi_statement:onReexamine"),
                "statement:alibi_statement:onReexamine",
            ),
        ];

        for (origin, expected) in cases {
            assert_eq!(resolved_text(&scene, origin), expected);
        }
    }

    #[test]
    fn resolves_every_interrogation_role() {
        let scene = interrogation_scene();
        let inventory_origin = |segment_id: &str| DialogueSegmentOriginV1::InterrogationPhase {
            chapter_id: CHAPTER_ID.into(),
            scene_id: INTERROGATION_SCENE_ID.into(),
            phase_id: "inventory".into(),
            segment_id: segment_id.into(),
        };
        let cases = [
            (
                DialogueSegmentOriginV1::InterrogationIntro {
                    chapter_id: CHAPTER_ID.into(),
                    scene_id: INTERROGATION_SCENE_ID.into(),
                },
                "interrogation:intro",
            ),
            (
                DialogueSegmentOriginV1::InterrogationOutro {
                    chapter_id: CHAPTER_ID.into(),
                    scene_id: INTERROGATION_SCENE_ID.into(),
                },
                "interrogation:outro",
            ),
            (
                interrogation_phase("phase:phase_alpha:entry"),
                "phase:phase_alpha:entry",
            ),
            (
                interrogation_phase("question:whereabouts:onLoop"),
                "question:whereabouts:onLoop",
            ),
            (
                interrogation_phase("question:whereabouts:loopPrompt"),
                "question:whereabouts:loopPrompt",
            ),
            (
                interrogation_phase("question:whereabouts:defaultChallenge"),
                "question:whereabouts:defaultChallenge",
            ),
            (
                interrogation_phase("question:whereabouts:defaultWrong"),
                "question:whereabouts:defaultWrong",
            ),
            (
                interrogation_phase("question:whereabouts:wrongReply"),
                "question:whereabouts:wrongReply",
            ),
            (
                interrogation_phase("question:whereabouts:line:timeline:content"),
                "question:whereabouts:line:timeline:content",
            ),
            (
                interrogation_phase("question:whereabouts:line:timeline:challenge"),
                "question:whereabouts:line:timeline:challenge",
            ),
            (
                interrogation_phase("question:whereabouts:line:timeline:onCorrect"),
                "question:whereabouts:line:timeline:onCorrect",
            ),
            (
                interrogation_phase("question:whereabouts:line:timeline:onWrongEvidence"),
                "question:whereabouts:line:timeline:onWrongEvidence",
            ),
            (
                inventory_origin("evidence:camera:onCollect"),
                "evidence:camera:onCollect",
            ),
            (
                inventory_origin("evidence:camera:onReexamine"),
                "evidence:camera:onReexamine",
            ),
            (
                inventory_origin("statement:denial:onAcquire"),
                "statement:denial:onAcquire",
            ),
            (
                inventory_origin("statement:denial:onReexamine"),
                "statement:denial:onReexamine",
            ),
        ];

        for (origin, expected) in cases {
            assert_eq!(resolved_text(&scene, origin), expected);
        }
    }

    #[test]
    fn resolving_composite_origins_preserves_their_authored_order() {
        let scene = investigation_scene();
        let origins = [
            investigation_interaction("evidence:receipt:onCollect"),
            investigation_interaction("statement:alibi_statement:onAcquire"),
            investigation_interaction("hotspot:desk:inspect"),
        ];

        let segments = resolve_dialogue_segments(CHAPTER_ID, &scene, &origins)
            .expect("composite origins should resolve");
        let actual: Vec<&str> = segments
            .iter()
            .flat_map(|segment| action_text(&segment.items))
            .collect();
        assert_eq!(
            actual,
            [
                "evidence:receipt:onCollect",
                "statement:alibi_statement:onAcquire",
                "hotspot:desk:inspect",
            ]
        );
    }

    #[test]
    fn resolver_rejects_unknown_chapter_scene_phase_and_semantic_ids() {
        let investigation = investigation_scene();
        let interrogation = interrogation_scene();
        let cases = [
            (
                &investigation,
                "chapter_unknown",
                investigation_interaction("hotspot:desk:inspect"),
            ),
            (
                &investigation,
                CHAPTER_ID,
                DialogueSegmentOriginV1::InvestigationIntro {
                    chapter_id: CHAPTER_ID.into(),
                    scene_id: "scene_unknown".into(),
                },
            ),
            (
                &investigation,
                CHAPTER_ID,
                investigation_interaction("sublocation:unknown:transition"),
            ),
            (
                &investigation,
                CHAPTER_ID,
                investigation_interaction("hotspot:unknown:inspect"),
            ),
            (
                &investigation,
                CHAPTER_ID,
                investigation_interaction("topic:unknown:alibi:dialogue"),
            ),
            (
                &investigation,
                CHAPTER_ID,
                investigation_interaction("topic:witness:unknown:dialogue"),
            ),
            (
                &investigation,
                CHAPTER_ID,
                investigation_interaction("evidence:unknown:onCollect"),
            ),
            (
                &investigation,
                CHAPTER_ID,
                investigation_interaction("statement:unknown:onAcquire"),
            ),
            (
                &investigation,
                CHAPTER_ID,
                investigation_interaction("hotspot:desk:unknownRole"),
            ),
            (
                &interrogation,
                CHAPTER_ID,
                DialogueSegmentOriginV1::InterrogationPhase {
                    chapter_id: CHAPTER_ID.into(),
                    scene_id: INTERROGATION_SCENE_ID.into(),
                    phase_id: "phase_unknown".into(),
                    segment_id: "question:whereabouts:onLoop".into(),
                },
            ),
            (
                &interrogation,
                CHAPTER_ID,
                DialogueSegmentOriginV1::InterrogationPhase {
                    chapter_id: CHAPTER_ID.into(),
                    scene_id: INTERROGATION_SCENE_ID.into(),
                    phase_id: "inventory".into(),
                    segment_id: "question:whereabouts:onLoop".into(),
                },
            ),
            (
                &interrogation,
                CHAPTER_ID,
                interrogation_phase("evidence:camera:onCollect"),
            ),
            (
                &interrogation,
                CHAPTER_ID,
                interrogation_phase("phase:phase_unknown:entry"),
            ),
            (
                &interrogation,
                CHAPTER_ID,
                interrogation_phase("question:unknown:onLoop"),
            ),
            (
                &interrogation,
                CHAPTER_ID,
                interrogation_phase("question:whereabouts:line:unknown:content"),
            ),
            (
                &interrogation,
                CHAPTER_ID,
                interrogation_phase("question:whereabouts:unknownRole"),
            ),
        ];

        for (scene, chapter_id, origin) in cases {
            let error = resolve_dialogue_segments(chapter_id, scene, &[origin])
                .expect_err("unknown semantic identity must be rejected");
            assert_eq!(error.code, "dialogueSegmentResolutionFailed");
        }
    }

    #[test]
    fn resolver_rejects_empty_targets_and_scene_kind_mismatches() {
        let empty_linear = linear_scene(json!([]));
        let linear_origin = DialogueSegmentOriginV1::LinearScene {
            chapter_id: CHAPTER_ID.into(),
            scene_id: LINEAR_SCENE_ID.into(),
        };
        let error = resolve_dialogue_segments(
            CHAPTER_ID,
            &empty_linear,
            std::slice::from_ref(&linear_origin),
        )
        .expect_err("empty dialogue target must be rejected");
        assert_eq!(error.code, "dialogueSegmentResolutionFailed");
        let error = resolve_dialogue_segments(CHAPTER_ID, &empty_linear, &[])
            .expect_err("missing dialogue origins must be rejected");
        assert_eq!(error.code, "dialogueSegmentResolutionFailed");

        let mismatches = [
            (investigation_scene(), linear_origin),
            (
                linear_scene(json!([{ "kind": "action", "text": "line" }])),
                DialogueSegmentOriginV1::InvestigationIntro {
                    chapter_id: CHAPTER_ID.into(),
                    scene_id: LINEAR_SCENE_ID.into(),
                },
            ),
            (
                investigation_scene(),
                DialogueSegmentOriginV1::InterrogationIntro {
                    chapter_id: CHAPTER_ID.into(),
                    scene_id: INVESTIGATION_SCENE_ID.into(),
                },
            ),
        ];

        for (scene, origin) in mismatches {
            let error = resolve_dialogue_segments(CHAPTER_ID, &scene, &[origin])
                .expect_err("origin kind must match packaged scene kind");
            assert_eq!(error.code, "dialogueSegmentResolutionFailed");
        }
    }
}
