use super::navigation::{load_chapter_scene_jsons, scene_json_identity};
use super::schema::SceneJson;
use super::state::ChapterManifest;
use super::story::StoryCatalog;
use super::GameError;
use serde::Serialize;
#[cfg(test)]
use std::cell::Cell;
use std::collections::BTreeMap;
use std::path::Path;

#[cfg(test)]
thread_local! {
    static INDEX_LOAD_COUNT: Cell<usize> = const { Cell::new(0) };
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SceneLocationContextView {
    pub(crate) chapter_id: String,
    pub(crate) chapter_title: String,
    pub(crate) scene_id: String,
    pub(crate) scene_title: String,
}

#[derive(Debug, Clone, Default)]
pub(crate) struct StoryLocationIndex {
    locations: BTreeMap<(String, String), StoryLocation>,
}

#[derive(Debug, Clone)]
struct StoryLocation {
    context: SceneLocationContextView,
    scene: SceneJson,
}

impl StoryLocationIndex {
    pub(crate) fn load(
        resources_dir: &Path,
        catalog: &StoryCatalog,
        chapters: &[ChapterManifest],
    ) -> Result<Self, GameError> {
        #[cfg(test)]
        INDEX_LOAD_COUNT.with(|count| count.set(count.get() + 1));
        let mut locations = BTreeMap::new();
        for chapter in chapters {
            for scene in load_chapter_scene_jsons(resources_dir, catalog, chapter)? {
                let (scene_id, scene_title) = scene_json_identity(&scene);
                let key = (chapter.id.clone(), scene_id.to_owned());
                if locations.contains_key(&key) {
                    return Err(GameError::duplicate_scene_target(&chapter.id, scene_id));
                }
                locations.insert(
                    key,
                    StoryLocation {
                        context: SceneLocationContextView {
                            chapter_id: chapter.id.clone(),
                            chapter_title: chapter.title.clone(),
                            scene_id: scene_id.to_owned(),
                            scene_title: scene_title.to_owned(),
                        },
                        scene,
                    },
                );
            }
        }
        Ok(Self { locations })
    }

    /// Build the index from scenes already loaded by `load_current_definitions`
    /// instead of re-reading every package file. `scenes_by_key` is already
    /// validated for duplicate-scene-target ambiguity by the caller, so this
    /// constructor only assembles the context views.
    pub(crate) fn from_loaded_scenes(
        chapters: &[ChapterManifest],
        scenes_by_key: &BTreeMap<(String, String), SceneJson>,
    ) -> Result<Self, GameError> {
        let chapter_titles: BTreeMap<&str, &str> = chapters
            .iter()
            .map(|chapter| (chapter.id.as_str(), chapter.title.as_str()))
            .collect();
        let mut locations = BTreeMap::new();
        for ((chapter_id, scene_id), scene) in scenes_by_key {
            let chapter_title = chapter_titles
                .get(chapter_id.as_str())
                .copied()
                .ok_or_else(|| GameError::story_location_missing(chapter_id, scene_id))?;
            let (_, scene_title) = scene_json_identity(scene);
            locations.insert(
                (chapter_id.clone(), scene_id.clone()),
                StoryLocation {
                    context: SceneLocationContextView {
                        chapter_id: chapter_id.clone(),
                        chapter_title: chapter_title.to_owned(),
                        scene_id: scene_id.clone(),
                        scene_title: scene_title.to_owned(),
                    },
                    scene: scene.clone(),
                },
            );
        }
        Ok(Self { locations })
    }

    #[cfg(test)]
    pub(crate) fn for_test_scenes(
        chapter_id: &str,
        chapter_title: &str,
        scenes: impl IntoIterator<Item = SceneJson>,
    ) -> Self {
        let mut locations = BTreeMap::new();
        for scene in scenes {
            let (scene_id, scene_title) = scene_json_identity(&scene);
            let scene_id = scene_id.to_owned();
            let scene_title = scene_title.to_owned();
            let key = (chapter_id.to_owned(), scene_id.clone());
            let location = StoryLocation {
                context: SceneLocationContextView {
                    chapter_id: chapter_id.to_owned(),
                    chapter_title: chapter_title.to_owned(),
                    scene_id: scene_id.clone(),
                    scene_title,
                },
                scene,
            };
            assert!(
                locations.insert(key, location).is_none(),
                "test fixture contains duplicate scene id {chapter_id}/{scene_id}"
            );
        }
        Self { locations }
    }

    #[cfg(test)]
    pub(crate) fn empty() -> Self {
        Self::default()
    }

    #[cfg(test)]
    pub(crate) fn reset_load_count_for_test() {
        INDEX_LOAD_COUNT.with(|count| count.set(0));
    }

    #[cfg(test)]
    pub(crate) fn load_count_for_test() -> usize {
        INDEX_LOAD_COUNT.with(Cell::get)
    }

    #[allow(dead_code)]
    pub(crate) fn resolve_scene(
        &self,
        chapter_id: &str,
        scene_id: &str,
    ) -> Result<SceneLocationContextView, GameError> {
        self.locations
            .get(&(chapter_id.to_owned(), scene_id.to_owned()))
            .map(|location| location.context.clone())
            .ok_or_else(|| GameError::story_location_missing(chapter_id, scene_id))
    }

    pub(in crate::game) fn resolve_scene_json(
        &self,
        chapter_id: &str,
        scene_id: &str,
    ) -> Result<SceneJson, GameError> {
        self.locations
            .get(&(chapter_id.to_owned(), scene_id.to_owned()))
            .map(|location| location.scene.clone())
            .ok_or_else(|| GameError::story_location_missing(chapter_id, scene_id))
    }
}

#[cfg(test)]
mod tests {
    use super::StoryLocationIndex;
    use crate::game::schema::{LinearSceneJson, SceneJson, SceneType};
    use crate::game::state::{ChapterManifest, SceneRef};
    use crate::game::story::StoryCatalog;

    #[test]
    fn resolves_scene_titles_without_player_facing_slugs() {
        let index = fixture_location_index();
        let location = index.resolve_scene("chapter_1", "scene_2").unwrap();
        assert_eq!(location.chapter_id, "chapter_1");
        assert_eq!(location.chapter_title, "雨鐘咖啡館殺人事件");
        assert_eq!(location.scene_id, "scene_2");
        assert_eq!(location.scene_title, "委託與程序入口 — 三宅母親求助");
    }

    #[test]
    fn rejects_duplicate_scene_ids_within_a_chapter() {
        let fixture = fixture_resources();
        write_linear_scene(
            &fixture.path().join("chapter_1/scene_1.json"),
            "scene_1",
            "First",
        );
        write_linear_scene(
            &fixture.path().join("chapter_1/scene_2.json"),
            "scene_1",
            "Second",
        );
        let chapter = ChapterManifest {
            id: "chapter_1".into(),
            title: "雨鐘咖啡館殺人事件".into(),
            summary: "summary".into(),
            scenes: vec![
                SceneRef {
                    scene_type: SceneType::Linear,
                    file: "chapter_1/scene_1.json".into(),
                },
                SceneRef {
                    scene_type: SceneType::Linear,
                    file: "chapter_1/scene_2.json".into(),
                },
            ],
        };
        let catalog = StoryCatalog::load(fixture.path()).unwrap();

        let error = StoryLocationIndex::load(fixture.path(), &catalog, &[chapter]).unwrap_err();

        assert_eq!(error.code, "duplicateSceneTarget");
    }

    #[test]
    fn missing_scene_is_a_typed_view_invariant_error() {
        let error = fixture_location_index()
            .resolve_scene("chapter_1", "missing")
            .unwrap_err();
        assert_eq!(error.code, "storyLocationMissing");
    }

    #[test]
    fn test_fixture_constructor_indexes_the_in_memory_scene_identity() {
        let index = StoryLocationIndex::for_test_scenes(
            "chapter_fixture",
            "Fixture Chapter",
            [SceneJson::Linear(LinearSceneJson {
                id: "fixture_scene".into(),
                title: "Fixture Scene".into(),
                summary: "Summary".into(),
                asset_refs: vec![],
                queue: vec![],
            })],
        );

        let location = index
            .resolve_scene("chapter_fixture", "fixture_scene")
            .unwrap();
        assert_eq!(location.chapter_id, "chapter_fixture");
        assert_eq!(location.chapter_title, "Fixture Chapter");
        assert_eq!(location.scene_id, "fixture_scene");
        assert_eq!(location.scene_title, "Fixture Scene");
    }

    #[test]
    fn new_game_loads_the_location_index_once_and_view_does_not_reload_it() {
        let fixture = engine_fixture_resources();
        StoryLocationIndex::reset_load_count_for_test();

        let engine = crate::game::GameEngine::new_started(fixture.path().to_path_buf()).unwrap();
        assert_eq!(StoryLocationIndex::load_count_for_test(), 1);

        engine.view().unwrap();
        assert_eq!(StoryLocationIndex::load_count_for_test(), 1);
    }

    #[test]
    fn cold_pending_acquisition_view_does_not_load_scene_files() {
        use crate::game::navigation::{
            chapter_scene_load_count_for_test, reset_chapter_scene_load_count_for_test,
        };
        use crate::game::save::schema::{AcquisitionEventStateV1, RecordKind};
        use crate::game::state::EvidenceRecord;
        use crate::game::test_support::packaged_acquisition_fixture_resources;

        let (_guard, resources) = packaged_acquisition_fixture_resources();
        let mut engine = crate::game::GameEngine::new_started(resources).unwrap();
        drain_dialogue(&mut engine);
        engine.inventory.evidence.push(EvidenceRecord {
            id: "receipt".into(),
            name: "Packaged Receipt".into(),
            description: "Packaged description".into(),
            details: "Packaged details".into(),
            provenance: crate::game::provenance::CaseRecordProvenance::default(),
            image_asset_id: Some("evidence.receipt".into()),
            on_reexamine: None,
            collected_in_chapter_id: "chapter_1".into(),
            collected_in_scene_id: "investigation_scene_1".into(),
        });
        engine
            .pending_acquisition_events
            .push(AcquisitionEventStateV1 {
                id: "acq:1:0".into(),
                record_kind: RecordKind::Evidence,
                record_id: "receipt".into(),
                created_by_command_id: 1,
                ordinal: 0,
            });
        engine.cached_pending_acquisition_scene.borrow_mut().take();

        reset_chapter_scene_load_count_for_test();
        let view = engine.view().unwrap();

        assert_eq!(view.pending_acquisition.unwrap().record_id, "receipt");
        assert_eq!(chapter_scene_load_count_for_test(), 0);
    }

    fn drain_dialogue(engine: &mut crate::game::GameEngine) {
        loop {
            let view = engine.view().unwrap();
            let crate::game::ModeView::Dialogue { queue_token, .. } = view.mode else {
                return;
            };
            engine.advance_dialogue(queue_token).unwrap();
        }
    }

    fn fixture_location_index() -> StoryLocationIndex {
        let fixture = fixture_resources();
        let chapters = fixture_chapters();
        let catalog = StoryCatalog::load(fixture.path()).unwrap();
        StoryLocationIndex::load(fixture.path(), &catalog, &chapters).unwrap()
    }

    fn fixture_resources() -> tempfile::TempDir {
        let fixture = tempfile::tempdir().unwrap();
        std::fs::create_dir(fixture.path().join("chapter_1")).unwrap();
        std::fs::create_dir(fixture.path().join("chapter_2")).unwrap();
        std::fs::write(
            fixture.path().join("story_catalog.json"),
            r#"{"schemaVersion":2,"facts":[],"questions":[],"objectives":[],"authorizations":[],"sourceGroups":[],"evidenceIndex":[],"statementsIndex":[]}"#,
        )
        .unwrap();
        write_linear_scene(
            &fixture.path().join("chapter_1/scene_1.json"),
            "scene_1",
            "Opening",
        );
        write_linear_scene(
            &fixture.path().join("chapter_1/scene_2.json"),
            "scene_2",
            "委託與程序入口 — 三宅母親求助",
        );
        write_linear_scene(
            &fixture.path().join("chapter_2/scene_1.json"),
            "scene_1",
            "雨中的車站",
        );
        fixture
    }

    fn engine_fixture_resources() -> tempfile::TempDir {
        let fixture = fixture_resources();
        std::fs::write(
            fixture.path().join("save_content_manifest.json"),
            r#"{"manifestVersion":1,"contentRevision":"sha256:0000000000000000000000000000000000000000000000000000000000000000"}"#,
        )
        .unwrap();
        std::fs::write(
            fixture.path().join("chapters.json"),
            r#"{
                "chapters": [
                    {"id":"chapter_1","title":"雨鐘咖啡館殺人事件","summary":"summary","scenes":[
                        {"type":"linear","file":"chapter_1/scene_1.json"},
                        {"type":"linear","file":"chapter_1/scene_2.json"}
                    ]},
                    {"id":"chapter_2","title":"車站目擊者","summary":"summary","scenes":[
                        {"type":"linear","file":"chapter_2/scene_1.json"}
                    ]}
                ]
            }"#,
        )
        .unwrap();
        fixture
    }

    fn fixture_chapters() -> Vec<ChapterManifest> {
        vec![
            ChapterManifest {
                id: "chapter_1".into(),
                title: "雨鐘咖啡館殺人事件".into(),
                summary: "summary".into(),
                scenes: vec![
                    SceneRef {
                        scene_type: SceneType::Linear,
                        file: "chapter_1/scene_1.json".into(),
                    },
                    SceneRef {
                        scene_type: SceneType::Linear,
                        file: "chapter_1/scene_2.json".into(),
                    },
                ],
            },
            ChapterManifest {
                id: "chapter_2".into(),
                title: "車站目擊者".into(),
                summary: "summary".into(),
                scenes: vec![SceneRef {
                    scene_type: SceneType::Linear,
                    file: "chapter_2/scene_1.json".into(),
                }],
            },
        ]
    }

    fn write_linear_scene(path: &std::path::Path, id: &str, title: &str) {
        std::fs::write(
            path,
            serde_json::json!({
                "type": "linear",
                "id": id,
                "title": title,
                "summary": title,
                "queue": [{"kind": "line", "speaker": "Narrator", "text": "..."}],
            })
            .to_string(),
        )
        .unwrap();
    }
}
