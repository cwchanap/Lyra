use serde::de::Error as _;
use serde::ser::SerializeStruct;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::collections::BTreeSet;

use crate::game::schema::{InventoryTarget, SceneJson};
use crate::game::story::StoryCatalog;
use crate::game::GameError;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SourceKind {
    Physical,
    Testimony,
    Digital,
    Subjective,
    #[default]
    Unspecified,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RepresentationLayer {
    Raw,
    Sync,
    Summary,
    Composite,
    #[default]
    None,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProceduralStatus {
    #[default]
    Unspecified,
    Lead,
    Reacquired,
    Exhibit,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Completeness {
    Complete,
    Partial,
    Cropped,
    #[default]
    Unspecified,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Confidence {
    Unverified,
    Corroborated,
    Disputed,
    #[default]
    Unspecified,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProofCapability {
    Time,
    Order,
    Route,
    Identity,
    Access,
    Motive,
    Source,
    Credibility,
    Procedure,
    Causation,
}

const CANONICAL_PROOF_CAPABILITIES: [ProofCapability; 10] = [
    ProofCapability::Time,
    ProofCapability::Order,
    ProofCapability::Route,
    ProofCapability::Identity,
    ProofCapability::Access,
    ProofCapability::Motive,
    ProofCapability::Source,
    ProofCapability::Credibility,
    ProofCapability::Procedure,
    ProofCapability::Causation,
];

fn proof_capability_rank(capability: ProofCapability) -> usize {
    match capability {
        ProofCapability::Time => 0,
        ProofCapability::Order => 1,
        ProofCapability::Route => 2,
        ProofCapability::Identity => 3,
        ProofCapability::Access => 4,
        ProofCapability::Motive => 5,
        ProofCapability::Source => 6,
        ProofCapability::Credibility => 7,
        ProofCapability::Procedure => 8,
        ProofCapability::Causation => 9,
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct CaseRecordProvenance {
    pub source_kind: SourceKind,
    pub representation_layer: RepresentationLayer,
    pub procedural_status: ProceduralStatus,
    pub completeness: Completeness,
    pub confidence: Confidence,
    pub source_group_id: Option<String>,
    pub source_label: Option<String>,
    pub proof_capabilities: BTreeSet<ProofCapability>,
    pub supersedes_record_id: Option<String>,
}

pub(in crate::game) fn validate_scene_record_against_catalog(
    catalog: &StoryCatalog,
    chapter_id: &str,
    scene_id: &str,
    target: &InventoryTarget,
    scene_provenance: &CaseRecordProvenance,
) -> Result<(), GameError> {
    let matches = catalog.case_record(target).is_some_and(|definition| {
        definition.chapter_id == chapter_id
            && definition.scene_id == scene_id
            && definition.provenance == *scene_provenance
    });
    if matches {
        Ok(())
    } else {
        Err(GameError::case_record_definition_mismatch())
    }
}

pub(in crate::game) fn validate_inventory_record_against_catalog(
    catalog: &StoryCatalog,
    chapter_id: &str,
    scene_id: &str,
    target: &InventoryTarget,
    inventory_provenance: &CaseRecordProvenance,
) -> Result<(), GameError> {
    let matches = catalog.case_record(target).is_some_and(|definition| {
        definition.chapter_id == chapter_id
            && definition.scene_id == scene_id
            && definition.provenance == *inventory_provenance
    });
    if matches {
        Ok(())
    } else {
        Err(GameError::inventory_record_definition_mismatch())
    }
}

pub(in crate::game) fn validate_scene_records_against_catalog(
    catalog: &StoryCatalog,
    chapter_id: &str,
    scene: &SceneJson,
) -> Result<(), GameError> {
    let (scene_id, evidence, statements) = match scene {
        SceneJson::Linear(_) => return Ok(()),
        SceneJson::Investigation(scene) => (
            scene.id.as_str(),
            &scene.evidence_manifest,
            &scene.statement_manifest,
        ),
        SceneJson::Interrogation(scene) => (
            scene.id.as_str(),
            &scene.evidence_manifest,
            &scene.statement_manifest,
        ),
    };
    for definition in evidence {
        validate_scene_record_against_catalog(
            catalog,
            chapter_id,
            scene_id,
            &InventoryTarget::Evidence {
                id: definition.id.clone(),
            },
            &definition.provenance,
        )?;
    }
    for definition in statements {
        validate_scene_record_against_catalog(
            catalog,
            chapter_id,
            scene_id,
            &InventoryTarget::Statement {
                id: definition.id.clone(),
            },
            &definition.provenance,
        )?;
    }
    Ok(())
}

struct RequiredNullable<T>(Option<T>);

// A field-level deserializer distinguishes an omitted key from explicit null;
// delegating `Deserialize` on the wrapper itself would let Option accept both.
fn deserialize_required_nullable<'de, D, T>(
    deserializer: D,
) -> Result<RequiredNullable<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer).map(RequiredNullable)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CaseRecordProvenanceWire {
    source_kind: SourceKind,
    representation_layer: RepresentationLayer,
    procedural_status: ProceduralStatus,
    completeness: Completeness,
    confidence: Confidence,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    source_group_id: RequiredNullable<String>,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    source_label: RequiredNullable<String>,
    proof_capabilities: Vec<ProofCapability>,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    supersedes_record_id: RequiredNullable<String>,
}

impl<'de> Deserialize<'de> for CaseRecordProvenance {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let wire = CaseRecordProvenanceWire::deserialize(deserializer)?;
        validate_optional_slug::<D::Error>("sourceGroupId", wire.source_group_id.0.as_deref())?;
        validate_optional_nonblank::<D::Error>("sourceLabel", wire.source_label.0.as_deref())?;
        validate_optional_typed_record_id::<D::Error>(
            "supersedesRecordId",
            wire.supersedes_record_id.0.as_deref(),
        )?;

        let mut proof_capabilities = BTreeSet::new();
        let mut previous_rank = None;
        for capability in wire.proof_capabilities {
            if !proof_capabilities.insert(capability) {
                return Err(D::Error::custom(format!(
                    "duplicate proof capability `{}`",
                    proof_capability_name(capability)
                )));
            }
            let rank = proof_capability_rank(capability);
            if previous_rank.is_some_and(|previous| previous >= rank) {
                return Err(D::Error::custom(
                    "proofCapabilities must use canonical order",
                ));
            }
            previous_rank = Some(rank);
        }

        Ok(Self {
            source_kind: wire.source_kind,
            representation_layer: wire.representation_layer,
            procedural_status: wire.procedural_status,
            completeness: wire.completeness,
            confidence: wire.confidence,
            source_group_id: wire.source_group_id.0,
            source_label: wire.source_label.0,
            proof_capabilities,
            supersedes_record_id: wire.supersedes_record_id.0,
        })
    }
}

impl Serialize for CaseRecordProvenance {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let proof_capabilities: Vec<ProofCapability> = CANONICAL_PROOF_CAPABILITIES
            .iter()
            .copied()
            .filter(|capability| self.proof_capabilities.contains(capability))
            .collect();
        let mut state = serializer.serialize_struct("CaseRecordProvenance", 9)?;
        state.serialize_field("sourceKind", &self.source_kind)?;
        state.serialize_field("representationLayer", &self.representation_layer)?;
        state.serialize_field("proceduralStatus", &self.procedural_status)?;
        state.serialize_field("completeness", &self.completeness)?;
        state.serialize_field("confidence", &self.confidence)?;
        state.serialize_field("sourceGroupId", &self.source_group_id)?;
        state.serialize_field("sourceLabel", &self.source_label)?;
        state.serialize_field("proofCapabilities", &proof_capabilities)?;
        state.serialize_field("supersedesRecordId", &self.supersedes_record_id)?;
        state.end()
    }
}

fn validate_optional_nonblank<E>(field: &str, value: Option<&str>) -> Result<(), E>
where
    E: serde::de::Error,
{
    if value.is_some_and(|value| value.trim().is_empty()) {
        return Err(E::custom(format!("{field} must not be blank")));
    }
    Ok(())
}

fn validate_optional_slug<E>(field: &str, value: Option<&str>) -> Result<(), E>
where
    E: serde::de::Error,
{
    validate_optional_nonblank::<E>(field, value)?;
    if value.is_some_and(|value| !is_slug(value)) {
        return Err(E::custom(format!("{field} must match ^[a-z0-9_]+$")));
    }
    Ok(())
}

fn validate_optional_typed_record_id<E>(field: &str, value: Option<&str>) -> Result<(), E>
where
    E: serde::de::Error,
{
    let Some(value) = value else {
        return Ok(());
    };
    let valid = value
        .split_once(':')
        .is_some_and(|(kind, id)| matches!(kind, "evidence" | "statement") && is_slug(id));
    if !valid {
        return Err(E::custom(format!(
            "{field} must match ^(evidence|statement):[a-z0-9_]+$"
        )));
    }
    Ok(())
}

fn is_slug(value: &str) -> bool {
    !value.is_empty()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
}

fn proof_capability_name(capability: ProofCapability) -> &'static str {
    match capability {
        ProofCapability::Time => "time",
        ProofCapability::Order => "order",
        ProofCapability::Route => "route",
        ProofCapability::Identity => "identity",
        ProofCapability::Access => "access",
        ProofCapability::Motive => "motive",
        ProofCapability::Source => "source",
        ProofCapability::Credibility => "credibility",
        ProofCapability::Procedure => "procedure",
        ProofCapability::Causation => "causation",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Map, Value};
    use std::collections::BTreeSet;

    fn full_wire_value() -> Value {
        json!({
            "sourceKind": "physical",
            "representationLayer": "raw",
            "proceduralStatus": "exhibit",
            "completeness": "complete",
            "confidence": "corroborated",
            "sourceGroupId": "platform_clock",
            "sourceLabel": "Platform clock",
            "proofCapabilities": [
                "time",
                "order",
                "route",
                "identity",
                "access",
                "motive",
                "source",
                "credibility",
                "procedure",
                "causation"
            ],
            "supersedesRecordId": "evidence:platform_clock_lead"
        })
    }

    fn deserialize(value: Value) -> Result<CaseRecordProvenance, serde_json::Error> {
        serde_json::from_value(value)
    }

    #[test]
    fn enum_defaults_are_the_designated_neutral_variants() {
        assert_eq!(SourceKind::default(), SourceKind::Unspecified);
        assert_eq!(RepresentationLayer::default(), RepresentationLayer::None);
        assert_eq!(ProceduralStatus::default(), ProceduralStatus::Unspecified);
        assert_eq!(Completeness::default(), Completeness::Unspecified);
        assert_eq!(Confidence::default(), Confidence::Unspecified);
    }

    #[test]
    fn case_record_default_serializes_as_the_exact_neutral_wire_object() {
        let provenance = CaseRecordProvenance::default();

        assert_eq!(provenance.source_kind, SourceKind::Unspecified);
        assert_eq!(provenance.representation_layer, RepresentationLayer::None);
        assert_eq!(provenance.procedural_status, ProceduralStatus::Unspecified);
        assert_eq!(provenance.completeness, Completeness::Unspecified);
        assert_eq!(provenance.confidence, Confidence::Unspecified);
        assert_eq!(provenance.source_group_id, None);
        assert_eq!(provenance.source_label, None);
        assert!(provenance.proof_capabilities.is_empty());
        assert_eq!(provenance.supersedes_record_id, None);
        assert_eq!(
            serde_json::to_value(provenance).unwrap(),
            json!({
                "sourceKind": "unspecified",
                "representationLayer": "none",
                "proceduralStatus": "unspecified",
                "completeness": "unspecified",
                "confidence": "unspecified",
                "sourceGroupId": null,
                "sourceLabel": null,
                "proofCapabilities": [],
                "supersedesRecordId": null
            })
        );
    }

    #[test]
    fn enum_wire_values_cover_the_exact_vocabulary() {
        let source_kinds = [
            SourceKind::Physical,
            SourceKind::Testimony,
            SourceKind::Digital,
            SourceKind::Subjective,
            SourceKind::Unspecified,
        ];
        let representation_layers = [
            RepresentationLayer::Raw,
            RepresentationLayer::Sync,
            RepresentationLayer::Summary,
            RepresentationLayer::Composite,
            RepresentationLayer::None,
        ];
        let procedural_statuses = [
            ProceduralStatus::Unspecified,
            ProceduralStatus::Lead,
            ProceduralStatus::Reacquired,
            ProceduralStatus::Exhibit,
        ];
        let completenesses = [
            Completeness::Complete,
            Completeness::Partial,
            Completeness::Cropped,
            Completeness::Unspecified,
        ];
        let confidences = [
            Confidence::Unverified,
            Confidence::Corroborated,
            Confidence::Disputed,
            Confidence::Unspecified,
        ];
        let capabilities = [
            ProofCapability::Time,
            ProofCapability::Order,
            ProofCapability::Route,
            ProofCapability::Identity,
            ProofCapability::Access,
            ProofCapability::Motive,
            ProofCapability::Source,
            ProofCapability::Credibility,
            ProofCapability::Procedure,
            ProofCapability::Causation,
        ];

        assert_eq!(
            serde_json::to_value(source_kinds).unwrap(),
            json!([
                "physical",
                "testimony",
                "digital",
                "subjective",
                "unspecified"
            ])
        );
        assert_eq!(
            serde_json::from_value::<[SourceKind; 5]>(json!([
                "physical",
                "testimony",
                "digital",
                "subjective",
                "unspecified"
            ]))
            .unwrap(),
            source_kinds
        );
        assert_eq!(
            serde_json::to_value(representation_layers).unwrap(),
            json!(["raw", "sync", "summary", "composite", "none"])
        );
        assert_eq!(
            serde_json::from_value::<[RepresentationLayer; 5]>(json!([
                "raw",
                "sync",
                "summary",
                "composite",
                "none"
            ]))
            .unwrap(),
            representation_layers
        );
        assert_eq!(
            serde_json::to_value(procedural_statuses).unwrap(),
            json!(["unspecified", "lead", "reacquired", "exhibit"])
        );
        assert_eq!(
            serde_json::from_value::<[ProceduralStatus; 4]>(json!([
                "unspecified",
                "lead",
                "reacquired",
                "exhibit"
            ]))
            .unwrap(),
            procedural_statuses
        );
        assert_eq!(
            serde_json::to_value(completenesses).unwrap(),
            json!(["complete", "partial", "cropped", "unspecified"])
        );
        assert_eq!(
            serde_json::from_value::<[Completeness; 4]>(json!([
                "complete",
                "partial",
                "cropped",
                "unspecified"
            ]))
            .unwrap(),
            completenesses
        );
        assert_eq!(
            serde_json::to_value(confidences).unwrap(),
            json!(["unverified", "corroborated", "disputed", "unspecified"])
        );
        assert_eq!(
            serde_json::from_value::<[Confidence; 4]>(json!([
                "unverified",
                "corroborated",
                "disputed",
                "unspecified"
            ]))
            .unwrap(),
            confidences
        );
        assert_eq!(
            serde_json::to_value(capabilities).unwrap(),
            json!([
                "time",
                "order",
                "route",
                "identity",
                "access",
                "motive",
                "source",
                "credibility",
                "procedure",
                "causation"
            ])
        );
        assert_eq!(
            serde_json::from_value::<[ProofCapability; 10]>(json!([
                "time",
                "order",
                "route",
                "identity",
                "access",
                "motive",
                "source",
                "credibility",
                "procedure",
                "causation"
            ]))
            .unwrap(),
            capabilities
        );
    }

    #[test]
    fn present_provenance_requires_every_wire_field_including_nullable_fields() {
        let Value::Object(full) = full_wire_value() else {
            unreachable!()
        };

        for field in [
            "sourceKind",
            "representationLayer",
            "proceduralStatus",
            "completeness",
            "confidence",
            "sourceGroupId",
            "sourceLabel",
            "proofCapabilities",
            "supersedesRecordId",
        ] {
            let mut missing = full.clone();
            missing.remove(field);
            let error = deserialize(Value::Object(missing)).unwrap_err();
            assert!(
                error
                    .to_string()
                    .contains(&format!("missing field `{field}`")),
                "unexpected error for {field}: {error}"
            );
        }

        let explicit_nulls = json!({
            "sourceKind": "unspecified",
            "representationLayer": "none",
            "proceduralStatus": "unspecified",
            "completeness": "unspecified",
            "confidence": "unspecified",
            "sourceGroupId": null,
            "sourceLabel": null,
            "proofCapabilities": [],
            "supersedesRecordId": null
        });
        assert_eq!(
            deserialize(explicit_nulls).unwrap(),
            CaseRecordProvenance::default()
        );
    }

    #[test]
    fn present_provenance_rejects_unknown_or_non_camel_case_fields() {
        let mut unknown = full_wire_value();
        unknown
            .as_object_mut()
            .unwrap()
            .insert("unexpected".into(), json!(true));
        assert!(deserialize(unknown)
            .unwrap_err()
            .to_string()
            .contains("unknown field `unexpected`"));

        let mut snake_case = Map::new();
        snake_case.insert("source_kind".into(), json!("physical"));
        for (key, value) in full_wire_value().as_object().unwrap() {
            if key != "sourceKind" {
                snake_case.insert(key.clone(), value.clone());
            }
        }
        let error = deserialize(Value::Object(snake_case)).unwrap_err();
        assert!(error.to_string().contains("unknown field `source_kind`"));
    }

    #[test]
    fn present_provenance_rejects_blank_optional_strings_and_invalid_slugs() {
        for (field, invalid) in [
            ("sourceGroupId", " "),
            ("sourceLabel", "\t"),
            ("sourceGroupId", "Platform-Clock"),
        ] {
            let mut value = full_wire_value();
            value
                .as_object_mut()
                .unwrap()
                .insert(field.into(), json!(invalid));
            assert!(
                deserialize(value).is_err(),
                "{field} unexpectedly accepted {invalid:?}"
            );
        }
    }

    #[test]
    fn supersedes_record_id_accepts_only_normalized_typed_record_ids() {
        for valid in ["evidence:platform_clock_lead", "statement:witness_account"] {
            let mut value = full_wire_value();
            value
                .as_object_mut()
                .unwrap()
                .insert("supersedesRecordId".into(), json!(valid));
            assert_eq!(
                deserialize(value).unwrap().supersedes_record_id.as_deref(),
                Some(valid)
            );
        }

        for invalid in [
            "platform_clock_lead",
            "topic:platform_clock_lead",
            "evidence:",
            ":platform_clock_lead",
            "evidence:Platform-Clock",
            "statement:witness-account",
            "evidence:statement:platform_clock",
        ] {
            let mut value = full_wire_value();
            value
                .as_object_mut()
                .unwrap()
                .insert("supersedesRecordId".into(), json!(invalid));
            assert!(
                deserialize(value).is_err(),
                "supersedesRecordId unexpectedly accepted {invalid:?}"
            );
        }
    }

    #[test]
    fn present_provenance_rejects_duplicate_and_noncanonical_capabilities() {
        let mut duplicate = full_wire_value();
        duplicate
            .as_object_mut()
            .unwrap()
            .insert("proofCapabilities".into(), json!(["time", "order", "time"]));
        assert!(deserialize(duplicate)
            .unwrap_err()
            .to_string()
            .contains("duplicate proof capability"));

        let mut noncanonical = full_wire_value();
        noncanonical.as_object_mut().unwrap().insert(
            "proofCapabilities".into(),
            json!(["order", "time", "route"]),
        );
        assert!(deserialize(noncanonical)
            .unwrap_err()
            .to_string()
            .contains("canonical order"));
    }

    #[test]
    fn canonical_capabilities_deserialize_to_a_set_and_serialize_in_semantic_order() {
        let parsed = deserialize(full_wire_value().clone()).unwrap();
        assert_eq!(parsed.proof_capabilities.len(), 10);
        assert_eq!(
            serde_json::to_value(parsed).unwrap(),
            full_wire_value(),
            "serialization must not use BTreeSet or enum declaration order"
        );

        let inserted_out_of_order = CaseRecordProvenance {
            proof_capabilities: BTreeSet::from([
                ProofCapability::Causation,
                ProofCapability::Time,
                ProofCapability::Access,
            ]),
            ..CaseRecordProvenance::default()
        };
        assert_eq!(
            serde_json::to_value(inserted_out_of_order)
                .unwrap()
                .get("proofCapabilities"),
            Some(&json!(["time", "access", "causation"]))
        );
    }
}
