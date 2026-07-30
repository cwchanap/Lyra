use serde::{Deserialize, Serialize};
use std::collections::{hash_map::Entry, HashMap};

use crate::game::schema::{
    DialogueItem, InterrogationPhaseJson, InterrogationSceneJson, InvestigationSceneJson, SceneJson,
};
use crate::game::state::ChapterManifest;
use crate::game::GameError;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub(crate) enum DialogueSegmentOriginV1 {
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[allow(dead_code)] // Task 7 exposes this wire boundary before the full save schema consumes it.
pub(crate) struct ActiveDialogueStateV1 {
    pub(crate) segment_origins: Vec<DialogueSegmentOriginV1>,
    pub(crate) active_segment_index: usize,
    pub(crate) item_cursor: usize,
    pub(crate) queue_gen: u64,
}

#[cfg(test)]
mod persistence_adapter_tests {
    use super::*;
    use crate::game::scenes::SceneRuntime;
    use crate::game::GameEngine;
    use serde_json::json;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU64, Ordering};

    const CONTENT_REVISION: &str =
        "sha256:1111111111111111111111111111111111111111111111111111111111111111";
    const SOURCE_CHAPTER_ID: &str = "chapter_source";
    const SOURCE_SCENE_ID: &str = "source_investigation";
    const CURRENT_CHAPTER_ID: &str = "chapter_current";
    const CURRENT_SCENE_ID: &str = "current_linear";

    fn action(text: &str) -> DialogueItem {
        DialogueItem::Action { text: text.into() }
    }

    fn linear_origin() -> DialogueSegmentOriginV1 {
        DialogueSegmentOriginV1::LinearScene {
            chapter_id: CURRENT_CHAPTER_ID.into(),
            scene_id: CURRENT_SCENE_ID.into(),
        }
    }

    fn source_interaction(segment_id: &str) -> DialogueSegmentOriginV1 {
        DialogueSegmentOriginV1::InvestigationInteraction {
            chapter_id: SOURCE_CHAPTER_ID.into(),
            scene_id: SOURCE_SCENE_ID.into(),
            segment_id: segment_id.into(),
        }
    }

    fn state(
        segment_origins: Vec<DialogueSegmentOriginV1>,
        active_segment_index: usize,
        item_cursor: usize,
        queue_gen: u64,
    ) -> ActiveDialogueStateV1 {
        ActiveDialogueStateV1 {
            segment_origins,
            active_segment_index,
            item_cursor,
            queue_gen,
        }
    }

    struct TestDir(PathBuf);

    impl TestDir {
        fn new() -> Self {
            static SEQ: AtomicU64 = AtomicU64::new(0);
            let sequence = SEQ.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "lyra-active-dialogue-persistence-{}-{sequence}",
                std::process::id()
            ));
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn fixture() -> (TestDir, GameEngine) {
        let resources = TestDir::new();
        let source_dir = resources.path().join(SOURCE_CHAPTER_ID);
        let current_dir = resources.path().join(CURRENT_CHAPTER_ID);
        std::fs::create_dir_all(&source_dir).unwrap();
        std::fs::create_dir_all(&current_dir).unwrap();
        std::fs::write(
            resources.path().join("save_content_manifest.json"),
            format!(r#"{{"manifestVersion":1,"contentRevision":"{CONTENT_REVISION}"}}"#),
        )
        .unwrap();
        std::fs::write(
            resources.path().join("story_catalog.json"),
            r#"{
                "schemaVersion": 2,
                "facts": [],
                "questions": [],
                "objectives": [],
                "authorizations": [],
                "sourceGroups": [],
                "evidenceIndex": [],
                "statementsIndex": []
            }"#,
        )
        .unwrap();
        crate::game::test_support::write_neutral_story_catalog(
            resources.path(),
            &[("note", SOURCE_CHAPTER_ID, SOURCE_SCENE_ID)],
            &[],
        );
        std::fs::write(
            resources.path().join("chapters.json"),
            format!(
                r#"{{
                    "chapters": [
                        {{
                            "id": "{SOURCE_CHAPTER_ID}",
                            "title": "Source",
                            "summary": "Source chapter",
                            "scenes": [
                                {{
                                    "type": "investigation",
                                    "file": "{SOURCE_CHAPTER_ID}/{SOURCE_SCENE_ID}.json"
                                }}
                            ]
                        }},
                        {{
                            "id": "{CURRENT_CHAPTER_ID}",
                            "title": "Current",
                            "summary": "Current chapter",
                            "scenes": [
                                {{
                                    "type": "linear",
                                    "file": "{CURRENT_CHAPTER_ID}/{CURRENT_SCENE_ID}.json"
                                }}
                            ]
                        }}
                    ]
                }}"#
            ),
        )
        .unwrap();
        std::fs::write(
            source_dir.join(format!("{SOURCE_SCENE_ID}.json")),
            format!(
                r#"{{
                    "type": "investigation",
                    "id": "{SOURCE_SCENE_ID}",
                    "title": "Source investigation",
                    "intro": [],
                    "sublocations": [
                        {{
                            "id": "room",
                            "label": "Room",
                            "status": "unlocked",
                            "unlock": null,
                            "reveals": [],
                            "sceneTag": "Room",
                            "transitionDialogue": [],
                            "hotspots": [
                                {{
                                    "id": "desk",
                                    "label": "Desk",
                                    "description": "A desk.",
                                    "status": "unlocked",
                                    "unlock": null,
                                    "reveals": [],
                                    "inspectDialogue": [
                                        {{"kind":"action","text":"inspect-0"}},
                                        {{"kind":"action","text":"inspect-1"}}
                                    ],
                                    "onReexamine": [
                                        {{"kind":"action","text":"（沒有新發現。）"}}
                                    ]
                                }}
                            ],
                            "characters": []
                        }}
                    ],
                    "evidenceManifest": [
                        {{
                            "id": "note",
                            "name": "Note",
                            "description": "A note.",
                            "details": "Details.",
                            "onCollect": [
                                {{"kind":"action","text":"collect-0"}},
                                {{"kind":"action","text":"collect-1"}}
                            ],
                            "onReexamine": [
                                {{"kind":"action","text":"（沒有新發現。）"}}
                            ]
                        }}
                    ],
                    "statementManifest": [],
                    "outro": {{"unlock":"auto","dialogue":[]}}
                }}"#
            ),
        )
        .unwrap();
        std::fs::write(
            current_dir.join(format!("{CURRENT_SCENE_ID}.json")),
            format!(
                r#"{{
                    "type": "linear",
                    "id": "{CURRENT_SCENE_ID}",
                    "title": "Current linear",
                    "queue": [
                        {{"kind":"action","text":"current-0"}},
                        {{"kind":"action","text":"current-1"}}
                    ]
                }}"#
            ),
        )
        .unwrap();

        let engine = GameEngine::new_started(resources.path().to_path_buf()).unwrap();
        (resources, engine)
    }

    fn assert_action(item: Option<&DialogueItem>, expected: &str) {
        assert_eq!(item, Some(&action(expected)));
    }

    fn assert_restore_error_preserves_live_dialogue(
        engine: &GameEngine,
        revision: &str,
        saved: &ActiveDialogueStateV1,
        expected_code: &str,
    ) {
        let before_token = engine.current_queue_token();
        let before_item = engine.current_dialogue_item();

        let error = engine
            .restore_active_dialogue_queue(revision, saved)
            .expect_err("invalid active dialogue must be rejected");

        assert_eq!(error.code, expected_code);
        assert_eq!(engine.current_queue_token(), before_token);
        assert_eq!(engine.current_dialogue_item(), before_item);
    }

    #[test]
    fn active_dialogue_state_has_the_exact_origin_and_coordinate_wire_shape() {
        let saved = state(vec![source_interaction("hotspot:desk:inspect")], 0, 1, 41);

        let encoded = serde_json::to_value(&saved).unwrap();

        assert_eq!(
            encoded,
            json!({
                "segmentOrigins": [{
                    "type": "investigationInteraction",
                    "chapterId": SOURCE_CHAPTER_ID,
                    "sceneId": SOURCE_SCENE_ID,
                    "segmentId": "hotspot:desk:inspect"
                }],
                "activeSegmentIndex": 0,
                "itemCursor": 1,
                "queueGen": 41
            })
        );
        assert_eq!(
            serde_json::from_value::<ActiveDialogueStateV1>(encoded).unwrap(),
            saved
        );
    }

    #[test]
    fn capture_preserves_composite_origin_order_and_segment_coordinates() {
        let (_resources, mut engine) = fixture();
        let origins = vec![
            source_interaction("hotspot:desk:inspect"),
            source_interaction("evidence:note:onCollect"),
        ];
        let segments = vec![
            DialogueSegment::new(
                origins[0].clone(),
                vec![action("inspect-0"), action("inspect-1")],
            )
            .unwrap(),
            DialogueSegment::new(
                origins[1].clone(),
                vec![action("collect-0"), action("collect-1")],
            )
            .unwrap(),
        ];
        let queue = ActiveDialogueQueue::from_position(segments, 1, 1, 41).unwrap();
        let SceneRuntime::Investigation(scene) = &mut engine.scene else {
            panic!("fixture must start in its source investigation");
        };
        scene.pending_queue = Some(queue);

        let captured = engine.capture_active_dialogue().unwrap().unwrap();

        assert_eq!(captured, state(origins, 1, 1, 41));
    }

    #[test]
    fn restore_resolves_each_origin_from_its_own_scene_and_preserves_the_queue_token() {
        let (_resources, mut engine) = fixture();
        engine
            .jump_to_scene(CURRENT_CHAPTER_ID, CURRENT_SCENE_ID)
            .unwrap();
        assert_eq!(engine.content_revision(), CONTENT_REVISION);
        let saved = state(
            vec![
                linear_origin(),
                source_interaction("hotspot:desk:reexamine"),
            ],
            1,
            0,
            77,
        );

        let restored = engine
            .restore_active_dialogue_queue(CONTENT_REVISION, &saved)
            .unwrap();

        assert_eq!(
            restored.segment_origins(),
            [
                linear_origin(),
                source_interaction("hotspot:desk:reexamine"),
            ]
        );
        assert_eq!(restored.active_coordinates(), (1, 0));
        assert_eq!(restored.queue_gen(), 77);
        assert_eq!(restored.flattened_cursor().unwrap(), 2);
        assert_action(restored.current(), "（沒有新發現。）");
    }

    #[test]
    fn revision_mismatch_is_rejected_before_any_packaged_scene_read() {
        let (resources, engine) = fixture();
        std::fs::remove_file(
            resources
                .path()
                .join(SOURCE_CHAPTER_ID)
                .join(format!("{SOURCE_SCENE_ID}.json")),
        )
        .unwrap();
        let saved = state(vec![source_interaction("hotspot:desk:inspect")], 0, 0, 9);

        assert_restore_error_preserves_live_dialogue(
            &engine,
            "sha256:2222222222222222222222222222222222222222222222222222222222222222",
            &saved,
            "incompatibleContentRevision",
        );
    }

    #[test]
    fn restore_rejects_unknown_mixed_empty_and_out_of_bounds_state_without_mutation() {
        let (_resources, mut engine) = fixture();
        engine
            .jump_to_scene(CURRENT_CHAPTER_ID, CURRENT_SCENE_ID)
            .unwrap();
        let cases = [
            (
                state(
                    vec![DialogueSegmentOriginV1::LinearScene {
                        chapter_id: "chapter_unknown".into(),
                        scene_id: CURRENT_SCENE_ID.into(),
                    }],
                    0,
                    0,
                    1,
                ),
                "unknownChapter",
            ),
            (
                state(
                    vec![DialogueSegmentOriginV1::LinearScene {
                        chapter_id: CURRENT_CHAPTER_ID.into(),
                        scene_id: "scene_unknown".into(),
                    }],
                    0,
                    0,
                    1,
                ),
                "unknownScene",
            ),
            (
                state(
                    vec![DialogueSegmentOriginV1::LinearScene {
                        chapter_id: SOURCE_CHAPTER_ID.into(),
                        scene_id: SOURCE_SCENE_ID.into(),
                    }],
                    0,
                    0,
                    1,
                ),
                "dialogueSegmentResolutionFailed",
            ),
            (
                state(
                    vec![DialogueSegmentOriginV1::InvestigationIntro {
                        chapter_id: SOURCE_CHAPTER_ID.into(),
                        scene_id: SOURCE_SCENE_ID.into(),
                    }],
                    0,
                    0,
                    1,
                ),
                "dialogueSegmentResolutionFailed",
            ),
            (
                state(vec![linear_origin()], 0, 2, 1),
                "invalidDialogueQueue",
            ),
            (state(vec![], 0, 0, 1), "invalidDialogueQueue"),
        ];

        for (saved, expected_code) in cases {
            assert_restore_error_preserves_live_dialogue(
                &engine,
                CONTENT_REVISION,
                &saved,
                expected_code,
            );
        }
    }

    #[test]
    fn restore_rejects_missing_packaged_scene_files_without_mutation() {
        let (resources, mut engine) = fixture();
        engine
            .jump_to_scene(CURRENT_CHAPTER_ID, CURRENT_SCENE_ID)
            .unwrap();
        std::fs::remove_file(
            resources
                .path()
                .join(SOURCE_CHAPTER_ID)
                .join(format!("{SOURCE_SCENE_ID}.json")),
        )
        .unwrap();
        let saved = state(vec![source_interaction("hotspot:desk:inspect")], 0, 0, 9);

        assert_restore_error_preserves_live_dialogue(
            &engine,
            CONTENT_REVISION,
            &saved,
            "sceneLoadFailed",
        );
    }

    #[test]
    fn repeated_origins_load_their_packaged_scene_definition_once() {
        let (resources, engine) = fixture();
        let definition = crate::game::loader::decode_scene_json_without_catalog_for_test(
            resources.path(),
            &format!("{CURRENT_CHAPTER_ID}/{CURRENT_SCENE_ID}.json"),
        )
        .unwrap();
        let saved = state(vec![linear_origin(), linear_origin()], 1, 0, 15);
        let mut load_calls = 0;

        let restored = engine
            .restore_active_dialogue_queue_with_loader(CONTENT_REVISION, &saved, |chapter| {
                load_calls += 1;
                assert_eq!(chapter.id, CURRENT_CHAPTER_ID);
                Ok(vec![definition.clone()])
            })
            .unwrap();

        assert_eq!(load_calls, 1);
        assert_eq!(
            restored.segment_origins(),
            [linear_origin(), linear_origin()]
        );
    }

    #[test]
    fn distinct_origin_scenes_load_once_each_and_keep_saved_order() {
        let (resources, engine) = fixture();
        let source_definition = crate::game::loader::decode_scene_json_without_catalog_for_test(
            resources.path(),
            &format!("{SOURCE_CHAPTER_ID}/{SOURCE_SCENE_ID}.json"),
        )
        .unwrap();
        let current_definition = crate::game::loader::decode_scene_json_without_catalog_for_test(
            resources.path(),
            &format!("{CURRENT_CHAPTER_ID}/{CURRENT_SCENE_ID}.json"),
        )
        .unwrap();
        let origins = vec![
            source_interaction("hotspot:desk:inspect"),
            linear_origin(),
            source_interaction("hotspot:desk:reexamine"),
        ];
        let saved = state(origins.clone(), 2, 0, 16);
        let mut loaded_scene_ids = Vec::new();

        let restored = engine
            .restore_active_dialogue_queue_with_loader(CONTENT_REVISION, &saved, |chapter| {
                match chapter.id.as_str() {
                    SOURCE_CHAPTER_ID => {
                        loaded_scene_ids.push(SOURCE_SCENE_ID.to_string());
                        Ok(vec![source_definition.clone()])
                    }
                    CURRENT_CHAPTER_ID => {
                        loaded_scene_ids.push(CURRENT_SCENE_ID.to_string());
                        Ok(vec![current_definition.clone()])
                    }
                    other => panic!("unexpected chapter load: {other}"),
                }
            })
            .unwrap();

        assert_eq!(
            loaded_scene_ids,
            [SOURCE_SCENE_ID.to_string(), CURRENT_SCENE_ID.to_string()]
        );
        assert_eq!(restored.segment_origins(), origins);
        assert_action(restored.current(), "（沒有新發現。）");
    }

    #[test]
    fn a_second_same_scene_loader_value_cannot_mix_the_candidate() {
        let (resources, engine) = fixture();
        let stable_definition = crate::game::loader::decode_scene_json_without_catalog_for_test(
            resources.path(),
            &format!("{CURRENT_CHAPTER_ID}/{CURRENT_SCENE_ID}.json"),
        )
        .unwrap();
        let mut changed_definition = stable_definition.clone();
        let SceneJson::Linear(scene) = &mut changed_definition else {
            panic!("fixture current scene must be linear");
        };
        scene.queue = vec![action("changed-on-second-load")];
        let saved = state(vec![linear_origin(), linear_origin()], 1, 0, 17);
        let mut load_calls = 0;

        let restored = engine
            .restore_active_dialogue_queue_with_loader(CONTENT_REVISION, &saved, |_chapter| {
                load_calls += 1;
                Ok(vec![if load_calls == 1 {
                    stable_definition.clone()
                } else {
                    changed_definition.clone()
                }])
            })
            .unwrap();

        assert_eq!(load_calls, 1);
        assert_action(restored.current(), "current-0");
        assert_eq!(restored.flattened_cursor().unwrap(), 2);
    }

    #[test]
    fn revision_mismatch_performs_zero_injected_definition_loads() {
        let (_resources, engine) = fixture();
        let saved = state(vec![linear_origin()], 0, 0, 18);
        let mut load_calls = 0;

        let error = engine
            .restore_active_dialogue_queue_with_loader(
                "sha256:2222222222222222222222222222222222222222222222222222222222222222",
                &saved,
                |_chapter| {
                    load_calls += 1;
                    panic!("revision mismatch must return before definition loading")
                },
            )
            .expect_err("revision mismatch must be rejected");

        assert_eq!(error.code, "incompatibleContentRevision");
        assert_eq!(load_calls, 0);
    }
}

impl DialogueSegmentOriginV1 {
    pub(super) fn chapter_id(&self) -> &str {
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

    pub(super) fn scene_id(&self) -> &str {
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

impl DialogueSegment {
    /// Builds one live/static segment while keeping empty authored carriers out
    /// of the active queue. Semantic re-examination defaults are materialized
    /// by the compiler before JSON reaches this runtime boundary.
    pub(super) fn new(origin: DialogueSegmentOriginV1, items: Vec<DialogueItem>) -> Option<Self> {
        (!items.is_empty()).then_some(Self { origin, items })
    }

    pub(super) fn len(&self) -> usize {
        self.items.len()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ActiveDialogueQueue {
    segments: Vec<DialogueSegment>,
    active_segment_index: usize,
    item_cursor: usize,
    queue_gen: u64,
}

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

    #[allow(dead_code)] // Task 7 restores the exact segmented queue coordinates.
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

    #[allow(dead_code)] // Task 7 migrates the legacy flattened cursor through this constructor.
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

    #[allow(dead_code)] // Task 7 persists segmented active coordinates.
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

    pub(super) fn same_persisted_shape(&self, other: &Self) -> bool {
        self == other
    }

    #[allow(dead_code)] // Task 7 persists the closed ordered origin list.
    pub(super) fn segment_origins(&self) -> Vec<DialogueSegmentOriginV1> {
        self.segments
            .iter()
            .map(|segment| segment.origin.clone())
            .collect()
    }

    pub(super) fn flattened_segment_start(
        segments: &[DialogueSegment],
        segment_index: usize,
    ) -> Result<usize, GameError> {
        if segment_index > segments.len() {
            return Err(queue_error(format!(
                "Segment boundary index {segment_index} is out of range for {} segments.",
                segments.len()
            )));
        }
        segments[..segment_index]
            .iter()
            .try_fold(0usize, |cursor, segment| cursor.checked_add(segment.len()))
            .ok_or_else(|| queue_error("Flattened dialogue boundary overflowed usize."))
    }

    pub(crate) fn segment_index_at_flattened_boundary(
        &self,
        flattened_boundary: usize,
    ) -> Result<usize, GameError> {
        for segment_index in 0..=self.segments.len() {
            if Self::flattened_segment_start(&self.segments, segment_index)? == flattened_boundary {
                return Ok(segment_index);
            }
        }
        Err(queue_error(format!(
            "Flattened dialogue boundary {flattened_boundary} does not name a segment boundary."
        )))
    }

    pub(crate) fn flattened_segment_boundary(
        &self,
        segment_index: usize,
    ) -> Result<usize, GameError> {
        Self::flattened_segment_start(&self.segments, segment_index)
    }

    pub(crate) fn flattened_len(&self) -> Result<usize, GameError> {
        Self::flattened_segment_start(&self.segments, self.segments.len())
    }

    #[allow(dead_code)] // Used by Task 7's crate-private capture adapter.
    fn capture_state(&self) -> Result<ActiveDialogueStateV1, GameError> {
        // Validate the public flattened cursor as part of capture so overflow
        // or a broken live coordinate cannot be persisted silently.
        self.flattened_cursor()?;
        let (active_segment_index, item_cursor) = self.active_coordinates();
        Ok(ActiveDialogueStateV1 {
            segment_origins: self.segment_origins(),
            active_segment_index,
            item_cursor,
            queue_gen: self.queue_gen,
        })
    }
}

impl crate::game::GameEngine {
    #[allow(dead_code)] // Future full save capture records the retained package revision.
    pub(super) fn content_revision(&self) -> &str {
        self.content_manifest.content_revision()
    }

    #[allow(dead_code)] // Future full save capture owns the enclosing optional field.
    pub(super) fn capture_active_dialogue(
        &self,
    ) -> Result<Option<ActiveDialogueStateV1>, GameError> {
        self.active_dialogue_queue()
            .map(ActiveDialogueQueue::capture_state)
            .transpose()
    }

    /// Reconstructs a candidate queue without installing it into the live
    /// engine. The future full save restore can validate its complete
    /// candidate first and swap engines only after every field succeeds.
    #[allow(dead_code)] // Future full save restore installs only a fully validated candidate.
    pub(super) fn restore_active_dialogue_queue(
        &self,
        content_revision: &str,
        saved: &ActiveDialogueStateV1,
    ) -> Result<ActiveDialogueQueue, GameError> {
        self.restore_active_dialogue_queue_with_loader(content_revision, saved, |chapter| {
            crate::game::navigation::load_chapter_scene_jsons(
                &self.resources_dir,
                &self.story_catalog,
                chapter,
            )
        })
    }

    fn restore_active_dialogue_queue_with_loader<F>(
        &self,
        content_revision: &str,
        saved: &ActiveDialogueStateV1,
        mut load_chapter_scenes: F,
    ) -> Result<ActiveDialogueQueue, GameError>
    where
        F: FnMut(&ChapterManifest) -> Result<Vec<SceneJson>, GameError>,
    {
        let packaged_revision = self.content_revision();
        if content_revision != packaged_revision {
            return Err(GameError::incompatible_content_revision(
                content_revision,
                packaged_revision,
            ));
        }

        let mut segments = Vec::with_capacity(saved.segment_origins.len());
        let mut loaded_chapters: HashMap<String, Vec<SceneJson>> = HashMap::new();
        for origin in &saved.segment_origins {
            let chapter_id = origin.chapter_id();
            let target_scene_id = origin.scene_id();
            let mut matching_chapters = self
                .chapters
                .iter()
                .filter(|chapter| chapter.id == chapter_id);
            let chapter = matching_chapters
                .next()
                .ok_or_else(|| GameError::unknown_chapter(chapter_id))?;
            if matching_chapters.next().is_some() {
                return Err(GameError::duplicate_chapter_target(chapter_id));
            }

            let chapter_scenes = match loaded_chapters.entry(chapter_id.to_owned()) {
                Entry::Occupied(entry) => entry.into_mut(),
                Entry::Vacant(entry) => entry.insert(load_chapter_scenes(chapter)?),
            };
            let mut matching_scenes = chapter_scenes
                .iter()
                .filter(|scene| scene_id(scene) == target_scene_id);
            let scene = matching_scenes
                .next()
                .ok_or_else(|| GameError::unknown_scene(chapter_id, target_scene_id))?;
            if matching_scenes.next().is_some() {
                return Err(GameError::duplicate_scene_target(
                    chapter_id,
                    target_scene_id,
                ));
            }

            let mut resolved =
                resolve_dialogue_segments(chapter_id, scene, std::slice::from_ref(origin))?;
            segments.append(&mut resolved);
        }

        ActiveDialogueQueue::from_position(
            segments,
            saved.active_segment_index,
            saved.item_cursor,
            saved.queue_gen,
        )
    }

    #[allow(dead_code)] // Used by Task 7's crate-private capture adapter.
    pub(super) fn active_dialogue_queue(&self) -> Option<&ActiveDialogueQueue> {
        match &self.scene {
            crate::game::scenes::SceneRuntime::Linear(scene) => scene.queue.as_ref(),
            crate::game::scenes::SceneRuntime::Investigation(scene) => scene.pending_queue.as_ref(),
            crate::game::scenes::SceneRuntime::Interrogation(scene) => scene.pending_queue.as_ref(),
        }
    }
}

#[allow(dead_code)] // Task 7 validates restored segment lists before activation.
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

#[allow(dead_code)] // Task 7 reconstructs static items from these closed origins.
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

            let items = resolve_origin_items(scene, origin)?.to_vec();
            DialogueSegment::new(origin.clone(), items).ok_or_else(|| {
                resolution_error(format!(
                    "Dialogue origin {origin:?} resolved to an empty target."
                ))
            })
        })
        .collect()
}

#[allow(dead_code)] // Used by Task 7's closed origin resolver.
fn scene_id(scene: &SceneJson) -> &str {
    match scene {
        SceneJson::Linear(scene) => &scene.id,
        SceneJson::Investigation(scene) => &scene.id,
        SceneJson::Interrogation(scene) => &scene.id,
    }
}

#[allow(dead_code)] // Used by Task 7's closed origin resolver.
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

#[allow(dead_code)] // Used by Task 7's closed origin resolver.
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
                Ok(hotspot.on_reexamine.as_deref().unwrap_or_default())
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
            let mut matching_topics = scene
                .sublocations
                .iter()
                .flat_map(|sublocation| &sublocation.characters)
                .filter(|character| character.id == character_id)
                .flat_map(|character| &character.topics)
                .filter(|topic| topic.id == topic_id);
            let topic = matching_topics
                .next()
                .ok_or_else(|| unresolved_segment(segment_id))?;
            if matching_topics.next().is_some() {
                return Err(resolution_error(format!(
                    "Dialogue segment role '{segment_id}' ambiguously resolves to more than one packaged topic."
                )));
            }
            return if reexamine {
                Ok(topic.on_reexamine.as_deref().unwrap_or_default())
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
                Ok(evidence.on_reexamine.as_deref().unwrap_or_default())
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
                Ok(statement.on_reexamine.as_deref().unwrap_or_default())
            } else {
                Ok(&statement.on_acquire)
            };
        }
    }

    Err(unresolved_segment(segment_id))
}

#[allow(dead_code)] // Used by Task 7's closed origin resolver.
fn resolve_interrogation_phase<'a>(
    scene: &'a InterrogationSceneJson,
    phase_id: &str,
    segment_id: &str,
) -> Result<&'a [DialogueItem], GameError> {
    if phase_id == "inventory" && is_interrogation_inventory_role(segment_id) {
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

#[allow(dead_code)] // Used by Task 7's closed origin resolver.
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
                Ok(evidence.on_reexamine.as_deref().unwrap_or_default())
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
                Ok(statement.on_reexamine.as_deref().unwrap_or_default())
            } else {
                Ok(&statement.on_acquire)
            };
        }
    }
    Err(unresolved_segment(segment_id))
}

fn is_interrogation_inventory_role(segment_id: &str) -> bool {
    [
        ("evidence:", ":onCollect"),
        ("evidence:", ":onReexamine"),
        ("statement:", ":onAcquire"),
        ("statement:", ":onReexamine"),
    ]
    .into_iter()
    .any(|(prefix, suffix)| role_id(segment_id, prefix, suffix).is_some())
}

#[allow(dead_code)] // Used by Task 7's closed origin resolver.
fn interrogation_phase_id(phase: &InterrogationPhaseJson) -> &str {
    let InterrogationPhaseJson::Inquiry { id, .. } = phase;
    id
}

#[allow(dead_code)] // Used by Task 7's closed origin resolver and fallback classifier.
fn role_id<'a>(segment_id: &'a str, prefix: &str, suffix: &str) -> Option<&'a str> {
    segment_id
        .strip_prefix(prefix)
        .and_then(|body| body.strip_suffix(suffix))
        .filter(|id| !id.is_empty())
}

#[allow(dead_code)] // Used by Task 7's closed origin resolver.
fn unresolved_segment(segment_id: &str) -> GameError {
    resolution_error(format!(
        "Dialogue segment role '{segment_id}' does not resolve in the packaged scene."
    ))
}

#[allow(dead_code)] // Used by Task 7's closed origin resolver.
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
    fn investigation_topic_resolution_finds_the_matching_pair_in_a_later_sublocation() {
        let mut scene = investigation_scene();
        let SceneJson::Investigation(scene_json) = &mut scene else {
            panic!("expected investigation scene");
        };
        let mut later = scene_json.sublocations[0].clone();
        later.id = "hallway".into();
        later.characters[0].topics[0].topic_dialogue = vec![action("topic:witness:alibi:later")];
        scene_json.sublocations[0].characters[0].topics[0].id = "weather".into();
        scene_json.sublocations.push(later);

        assert_eq!(
            resolved_text(
                &scene,
                investigation_interaction("topic:witness:alibi:dialogue"),
            ),
            "topic:witness:alibi:later"
        );
    }

    #[test]
    fn investigation_topic_resolution_rejects_a_missing_pair_across_sublocations() {
        let mut scene = investigation_scene();
        let SceneJson::Investigation(scene_json) = &mut scene else {
            panic!("expected investigation scene");
        };
        let mut later = scene_json.sublocations[0].clone();
        later.id = "hallway".into();
        later.characters[0].topics[0].id = "motive".into();
        scene_json.sublocations[0].characters[0].topics[0].id = "weather".into();
        scene_json.sublocations.push(later);

        let error = resolve_dialogue_segments(
            CHAPTER_ID,
            &scene,
            &[investigation_interaction("topic:witness:alibi:dialogue")],
        )
        .expect_err("a missing character/topic pair must be rejected");

        assert_eq!(error.code, "dialogueSegmentResolutionFailed");
    }

    #[test]
    fn investigation_topic_resolution_rejects_an_ambiguous_pair_across_sublocations() {
        let mut scene = investigation_scene();
        let SceneJson::Investigation(scene_json) = &mut scene else {
            panic!("expected investigation scene");
        };
        let mut duplicate = scene_json.sublocations[0].clone();
        duplicate.id = "hallway".into();
        duplicate.characters[0].topics[0].topic_dialogue =
            vec![action("topic:witness:alibi:duplicate")];
        scene_json.sublocations.push(duplicate);

        let error = resolve_dialogue_segments(
            CHAPTER_ID,
            &scene,
            &[investigation_interaction("topic:witness:alibi:dialogue")],
        )
        .expect_err("an ambiguous character/topic pair must be rejected");

        assert_eq!(error.code, "dialogueSegmentResolutionFailed");
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
    fn authored_inventory_phase_and_synthetic_inventory_carriers_resolve_by_role() {
        let mut scene = interrogation_scene();
        let SceneJson::Interrogation(scene_json) = &mut scene else {
            panic!("expected interrogation scene");
        };
        let InterrogationPhaseJson::Inquiry {
            id, entry_dialogue, ..
        } = &mut scene_json.phases[0];
        *id = "inventory".into();
        *entry_dialogue = vec![action("phase:inventory:entry")];
        let authored_entry = DialogueSegmentOriginV1::InterrogationPhase {
            chapter_id: CHAPTER_ID.into(),
            scene_id: INTERROGATION_SCENE_ID.into(),
            phase_id: "inventory".into(),
            segment_id: "phase:inventory:entry".into(),
        };
        let authored_question = DialogueSegmentOriginV1::InterrogationPhase {
            chapter_id: CHAPTER_ID.into(),
            scene_id: INTERROGATION_SCENE_ID.into(),
            phase_id: "inventory".into(),
            segment_id: "question:whereabouts:onLoop".into(),
        };
        let synthetic_evidence = DialogueSegmentOriginV1::InterrogationPhase {
            chapter_id: CHAPTER_ID.into(),
            scene_id: INTERROGATION_SCENE_ID.into(),
            phase_id: "inventory".into(),
            segment_id: "evidence:camera:onCollect".into(),
        };
        let synthetic_statement = DialogueSegmentOriginV1::InterrogationPhase {
            chapter_id: CHAPTER_ID.into(),
            scene_id: INTERROGATION_SCENE_ID.into(),
            phase_id: "inventory".into(),
            segment_id: "statement:denial:onAcquire".into(),
        };

        for (origin, expected) in [
            (authored_entry, "phase:inventory:entry"),
            (authored_question, "question:whereabouts:onLoop"),
            (synthetic_evidence, "evidence:camera:onCollect"),
            (synthetic_statement, "statement:denial:onAcquire"),
        ] {
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
    fn empty_reexamine_segments_are_rejected_while_explicit_compiler_defaults_resolve() {
        assert!(
            DialogueSegment::new(investigation_interaction("hotspot:desk:reexamine"), vec![],)
                .is_none(),
            "all empty dialogue segments must remain absent from the runtime queue"
        );

        let mut investigation = investigation_scene();
        let SceneJson::Investigation(scene) = &mut investigation else {
            panic!("expected investigation scene");
        };
        scene.sublocations[0].hotspots[0].on_reexamine = Some(vec![action("（沒有新發現。）")]);
        scene.sublocations[0].characters[0].topics[0].on_reexamine =
            Some(vec![action("（沒有新發現。）")]);
        scene.evidence_manifest[0].on_reexamine = Some(vec![action("（沒有新發現。）")]);
        scene.statement_manifest[0].on_reexamine = Some(vec![action("（沒有新發現。）")]);

        let investigation_segments = resolve_dialogue_segments(
            CHAPTER_ID,
            &investigation,
            &[
                investigation_interaction("hotspot:desk:reexamine"),
                investigation_interaction("topic:witness:alibi:reexamine"),
                investigation_interaction("evidence:receipt:onReexamine"),
                investigation_interaction("statement:alibi_statement:onReexamine"),
            ],
        )
        .expect("compiler-materialized reexamine roles should resolve by their stable origins");
        assert_eq!(
            investigation_segments
                .iter()
                .flat_map(|segment| action_text(&segment.items))
                .collect::<Vec<_>>(),
            vec![
                "（沒有新發現。）",
                "（沒有新發現。）",
                "（沒有新發現。）",
                "（沒有新發現。）",
            ]
        );

        let mut interrogation = interrogation_scene();
        let SceneJson::Interrogation(scene) = &mut interrogation else {
            panic!("expected interrogation scene");
        };
        scene.evidence_manifest[0].on_reexamine = Some(vec![action("（沒有新發現。）")]);
        scene.statement_manifest[0].on_reexamine = Some(vec![action("（沒有新發現。）")]);
        let interrogation_segments = resolve_dialogue_segments(
            CHAPTER_ID,
            &interrogation,
            &[
                DialogueSegmentOriginV1::InterrogationPhase {
                    chapter_id: CHAPTER_ID.into(),
                    scene_id: INTERROGATION_SCENE_ID.into(),
                    phase_id: "inventory".into(),
                    segment_id: "evidence:camera:onReexamine".into(),
                },
                DialogueSegmentOriginV1::InterrogationPhase {
                    chapter_id: CHAPTER_ID.into(),
                    scene_id: INTERROGATION_SCENE_ID.into(),
                    phase_id: "inventory".into(),
                    segment_id: "statement:denial:onReexamine".into(),
                },
            ],
        )
        .expect(
            "compiler-materialized interrogation inventory roles should resolve by stable origin",
        );
        assert_eq!(
            interrogation_segments
                .iter()
                .flat_map(|segment| action_text(&segment.items))
                .collect::<Vec<_>>(),
            vec!["（沒有新發現。）", "（沒有新發現。）"]
        );
    }

    #[test]
    fn empty_non_reexamine_targets_remain_rejected() {
        let mut investigation = investigation_scene();
        let SceneJson::Investigation(scene) = &mut investigation else {
            panic!("expected investigation scene");
        };
        scene.intro.clear();
        let error = resolve_dialogue_segments(
            CHAPTER_ID,
            &investigation,
            &[DialogueSegmentOriginV1::InvestigationIntro {
                chapter_id: CHAPTER_ID.into(),
                scene_id: INVESTIGATION_SCENE_ID.into(),
            }],
        )
        .expect_err("an empty authored intro must not become a segment");
        assert_eq!(error.code, "dialogueSegmentResolutionFailed");

        let mut interrogation = interrogation_scene();
        let SceneJson::Interrogation(scene) = &mut interrogation else {
            panic!("expected interrogation scene");
        };
        let InterrogationPhaseJson::Inquiry { questions, .. } = &mut scene.phases[0];
        questions[0].testimony.lines[0].content.clear();
        let error = resolve_dialogue_segments(
            CHAPTER_ID,
            &interrogation,
            &[interrogation_phase(
                "question:whereabouts:line:timeline:content",
            )],
        )
        .expect_err("empty testimony line content must not become a segment");
        assert_eq!(error.code, "dialogueSegmentResolutionFailed");

        assert!(
            DialogueSegment::new(
                DialogueSegmentOriginV1::InvestigationInteraction {
                    chapter_id: CHAPTER_ID.into(),
                    scene_id: INVESTIGATION_SCENE_ID.into(),
                    segment_id: "storyEvent:fake:onReexamine".into(),
                },
                vec![],
            )
            .is_none(),
            "an arbitrary role ending in onReexamine must not receive the closed-role fallback"
        );
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

    #[test]
    fn flattened_len_and_segment_boundary_report_total_items_and_starts() {
        let segments = vec![
            DialogueSegment::new(
                investigation_interaction("hotspot:desk:inspect"),
                vec![action("a"), action("b")],
            )
            .unwrap(),
            DialogueSegment::new(
                investigation_interaction("hotspot:desk:reexamine"),
                vec![action("c")],
            )
            .unwrap(),
        ];
        let queue = ActiveDialogueQueue::from_position(segments, 0, 0, 1).unwrap();
        assert_eq!(queue.flattened_len().unwrap(), 3);
        assert_eq!(queue.flattened_segment_boundary(0).unwrap(), 0);
        assert_eq!(queue.flattened_segment_boundary(1).unwrap(), 2);
        assert_eq!(queue.flattened_segment_boundary(2).unwrap(), 3);
    }
}
