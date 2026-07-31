use super::navigation::{load_chapter_scene_jsons, scene_json_identity};
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
    // Tasks 2–3 expose these package-derived entries through public views.
    #[allow(dead_code)]
    locations: BTreeMap<(String, String), SceneLocationContextView>,
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
                    SceneLocationContextView {
                        chapter_id: chapter.id.clone(),
                        chapter_title: chapter.title.clone(),
                        scene_id: scene_id.to_owned(),
                        scene_title: scene_title.to_owned(),
                    },
                );
            }
        }
        Ok(Self { locations })
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
            .cloned()
            .ok_or_else(|| GameError::story_location_missing(chapter_id, scene_id))
    }
}

#[cfg(test)]
mod tests {
    use super::StoryLocationIndex;
    use crate::game::schema::SceneType;
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
    fn new_game_loads_the_location_index_once_and_view_does_not_reload_it() {
        let fixture = engine_fixture_resources();
        StoryLocationIndex::reset_load_count_for_test();

        let engine = crate::game::GameEngine::new_started(fixture.path().to_path_buf()).unwrap();
        assert_eq!(StoryLocationIndex::load_count_for_test(), 1);

        engine.view().unwrap();
        assert_eq!(StoryLocationIndex::load_count_for_test(), 1);
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
                "queue": [{"kind": "line", "speaker": "Narrator", "text": "..."}],
            })
            .to_string(),
        )
        .unwrap();
    }
}
