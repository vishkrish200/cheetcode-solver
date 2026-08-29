use std::sync::{Mutex, Once};

#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct FlagEvalView {
    pub exists: i32,
    pub environment_id: i32,
    pub decided_version: i32,
    pub matched_snapshot_id: i32,
    pub matched_rule_id: i32,
    pub decided_variant_id: i32,
    pub fallback_used: i32,
    pub tombstone_blocked: i32,
    pub stale_active_seen: i32,
    pub disabled_active_seen: i32,
    pub prerequisite_failed: i32,
    pub off_by_targeting: i32,
    pub usable: i32,
}

const ERR_NONE: i32 = 0;
const ERR_DUP_FLAG: i32 = 1;
const ERR_DUP_SNAPSHOT: i32 = 2;
const ERR_DUP_TOMBSTONE: i32 = 3;
const ERR_UNKNOWN_FLAG: i32 = 4;
const ERR_UNKNOWN_SNAPSHOT: i32 = 5;
const ERR_INVALID_ROLLOUT: i32 = 6;
const ERR_UNKNOWN_ENV_BINDING: i32 = 7;
const ERR_UNKNOWN_PREREQUISITE_FLAG: i32 = 8;
const ERR_PREREQUISITE_CYCLE: i32 = 9;
const ERR_NULL_EXPLAIN_POINTER: i32 = 10;
const ERR_NO_STAGED_VERSION: i32 = 11;
const ERR_UNKNOWN_VERSION: i32 = 12;

#[derive(Clone)]
struct Prerequisite {
    prerequisite_flag_id: i32,
    required_variant_id: i32,
}

#[derive(Clone)]
struct VersionState {
    version: i32,
    stale: bool,
}

#[derive(Clone)]
struct EnvironmentBinding {
    environment_id: i32,
    active_version: i32,
    staged_version: i32,
    fallback_version: i32,
    versions: Vec<VersionState>,
}

#[derive(Clone)]
struct Flag {
    flag_id: i32,
    default_variant_id: i32,
    off_variant_id: i32,
    prerequisites: Vec<Prerequisite>,
    environments: Vec<EnvironmentBinding>,
}

#[derive(Clone)]
struct Snapshot {
    snapshot_id: i32,
    flag_id: i32,
    environment_id: i32,
    version: i32,
    rule_id: i32,
    segment_id: i32,
    priority: i32,
    variant_id: i32,
    rollout_percent: i32,
    _track_events: i32,
    not_before_ts: i64,
    expires_ts: i64,
    disabled: bool,
    retired: bool,
}

#[derive(Clone)]
struct Tombstone {
    tombstone_id: i32,
    flag_id: i32,
    environment_id: i32,
    version: i32,
    not_before_ts: i64,
    expires_ts: i64,
}

#[derive(Clone)]
struct SegmentMembership {
    subject_id: i32,
    segment_id: i32,
    member: bool,
}

#[derive(Default)]
struct Engine {
    last_error: i32,
    flags: Vec<Flag>,
    snapshots: Vec<Snapshot>,
    tombstones: Vec<Tombstone>,
    memberships: Vec<SegmentMembership>,
}

#[derive(Default)]
struct VersionChoice {
    chosen_version: i32,
    fallback_used: i32,
    tombstone_blocked: i32,
    stale_active_seen: i32,
    disabled_active_seen: i32,
}

fn engine() -> &'static Mutex<Engine> {
    static INIT: Once = Once::new();
    static mut ENGINE: *const Mutex<Engine> = std::ptr::null();
    unsafe {
        INIT.call_once(|| {
            ENGINE = Box::into_raw(Box::new(Mutex::new(Engine::default())));
        });
        &*ENGINE
    }
}

impl Engine {
    fn set_error(&mut self, code: i32) {
        self.last_error = code;
    }

    fn flag_index(&self, flag_id: i32) -> Option<usize> {
        self.flags.iter().position(|flag| flag.flag_id == flag_id)
    }

    fn snapshot_index(&self, snapshot_id: i32) -> Option<usize> {
        self.snapshots
            .iter()
            .position(|snapshot| snapshot.snapshot_id == snapshot_id)
    }

    fn tombstone_index(&self, tombstone_id: i32) -> Option<usize> {
        self.tombstones
            .iter()
            .position(|tombstone| tombstone.tombstone_id == tombstone_id)
    }

    fn environment_index(&self, flag_index: usize, environment_id: i32) -> Option<usize> {
        self.flags[flag_index]
            .environments
            .iter()
            .position(|binding| binding.environment_id == environment_id)
    }

    fn ensure_environment_index(
        &mut self,
        flag_index: usize,
        environment_id: i32,
    ) -> Option<usize> {
        if let Some(index) = self.environment_index(flag_index, environment_id) {
            return Some(index);
        }

        self.flags[flag_index].environments.push(EnvironmentBinding {
            environment_id,
            active_version: 0,
            staged_version: 0,
            fallback_version: 0,
            versions: Vec::new(),
        });
        Some(self.flags[flag_index].environments.len() - 1)
    }

    fn ensure_version_state(binding: &mut EnvironmentBinding, version: i32) {
        if version == 0 {
            return;
        }
        if binding
            .versions
            .iter()
            .any(|state| state.version == version)
        {
            return;
        }
        binding.versions.push(VersionState {
            version,
            stale: false,
        });
    }

    fn version_is_known(&self, flag_id: i32, environment_id: i32, version: i32) -> bool {
        if version == 0 {
            return true;
        }

        let Some(flag_index) = self.flag_index(flag_id) else {
            return false;
        };

        if let Some(env_index) = self.environment_index(flag_index, environment_id) {
            if self.flags[flag_index].environments[env_index]
                .versions
                .iter()
                .any(|state| state.version == version)
            {
                return true;
            }
        }

        self.snapshots.iter().any(|snapshot| {
            snapshot.flag_id == flag_id
                && snapshot.environment_id == environment_id
                && snapshot.version == version
        }) || self.tombstones.iter().any(|tombstone| {
            tombstone.flag_id == flag_id
                && tombstone.environment_id == environment_id
                && tombstone.version == version
        })
    }

    fn segment_is_member(&self, subject_id: i32, segment_id: i32) -> bool {
        if segment_id == 0 {
            return true;
        }

        self.memberships
            .iter()
            .find(|membership| {
                membership.subject_id == subject_id && membership.segment_id == segment_id
            })
            .map(|membership| membership.member)
            .unwrap_or(false)
    }

    fn snapshot_time_usable(snapshot: &Snapshot, ts: i64) -> bool {
        ts >= snapshot.not_before_ts && ts < snapshot.expires_ts
    }

    fn snapshot_live(snapshot: &Snapshot, ts: i64) -> bool {
        Self::snapshot_time_usable(snapshot, ts) && !snapshot.disabled && !snapshot.retired
    }

    fn tombstone_active(tombstone: &Tombstone, ts: i64) -> bool {
        ts >= tombstone.not_before_ts && ts < tombstone.expires_ts
    }

    fn version_is_tombstoned(
        &self,
        flag_id: i32,
        environment_id: i32,
        version: i32,
        ts: i64,
    ) -> bool {
        self.tombstones.iter().any(|tombstone| {
            tombstone.flag_id == flag_id
                && tombstone.environment_id == environment_id
                && tombstone.version == version
                && Self::tombstone_active(tombstone, ts)
        })
    }

    fn version_is_stale(&self, flag_index: usize, env_index: usize, version: i32) -> bool {
        if version == 0 {
            return false;
        }

        self.flags[flag_index].environments[env_index]
            .versions
            .iter()
            .find(|state| state.version == version)
            .map(|state| state.stale)
            .unwrap_or(false)
    }

    fn version_has_live_snapshot(
        &self,
        flag_id: i32,
        environment_id: i32,
        version: i32,
        ts: i64,
    ) -> bool {
        self.snapshots.iter().any(|snapshot| {
            snapshot.flag_id == flag_id
                && snapshot.environment_id == environment_id
                && snapshot.version == version
                && Self::snapshot_live(snapshot, ts)
        })
    }

    fn version_has_disabled_match(
        &self,
        flag_id: i32,
        environment_id: i32,
        version: i32,
        subject_id: i32,
        subject_bucket: i32,
        ts: i64,
    ) -> bool {
        self.snapshots.iter().any(|snapshot| {
            snapshot.flag_id == flag_id
                && snapshot.environment_id == environment_id
                && snapshot.version == version
                && snapshot.disabled
                && !snapshot.retired
                && Self::snapshot_time_usable(snapshot, ts)
                && self.segment_is_member(subject_id, snapshot.segment_id)
                && subject_bucket < snapshot.rollout_percent
        })
    }

    fn select_best_snapshot(
        &self,
        flag_id: i32,
        environment_id: i32,
        version: i32,
        subject_id: i32,
        subject_bucket: i32,
        ts: i64,
    ) -> Option<usize> {
        let mut best: Option<usize> = None;

        for (index, snapshot) in self.snapshots.iter().enumerate() {
            if snapshot.flag_id != flag_id
                || snapshot.environment_id != environment_id
                || snapshot.version != version
            {
                continue;
            }
            if !Self::snapshot_live(snapshot, ts) {
                continue;
            }
            if !self.segment_is_member(subject_id, snapshot.segment_id) {
                continue;
            }
            if subject_bucket >= snapshot.rollout_percent {
                continue;
            }

            let Some(best_index) = best else {
                best = Some(index);
                continue;
            };
            let best_snapshot = &self.snapshots[best_index];

            if snapshot.priority > best_snapshot.priority {
                best = Some(index);
                continue;
            }
            if snapshot.priority < best_snapshot.priority {
                continue;
            }

            let snapshot_specific = snapshot.segment_id != 0;
            let best_specific = best_snapshot.segment_id != 0;
            if snapshot_specific != best_specific {
                if snapshot_specific {
                    best = Some(index);
                }
                continue;
            }

            if snapshot.rule_id < best_snapshot.rule_id {
                best = Some(index);
                continue;
            }
            if snapshot.rule_id > best_snapshot.rule_id {
                continue;
            }

            if snapshot.snapshot_id < best_snapshot.snapshot_id {
                best = Some(index);
            }
        }

        best
    }

    fn prerequisite_path_exists(&self, current_flag_id: i32, target_flag_id: i32) -> bool {
        if current_flag_id == target_flag_id {
            return true;
        }

        let Some(flag_index) = self.flag_index(current_flag_id) else {
            return false;
        };

        self.flags[flag_index]
            .prerequisites
            .iter()
            .any(|edge| self.prerequisite_path_exists(edge.prerequisite_flag_id, target_flag_id))
    }

    fn choose_version(
        &self,
        flag_index: usize,
        environment_id: i32,
        subject_id: i32,
        subject_bucket: i32,
        ts: i64,
    ) -> VersionChoice {
        let mut choice = VersionChoice::default();
        let Some(env_index) = self.environment_index(flag_index, environment_id) else {
            return choice;
        };

        let flag_id = self.flags[flag_index].flag_id;
        let binding = &self.flags[flag_index].environments[env_index];
        let active_version = binding.active_version;
        let fallback_version = binding.fallback_version;
        let mut active_readable = false;
        let mut fallback_readable = false;

        if active_version != 0 {
            if self.version_has_disabled_match(
                flag_id,
                environment_id,
                active_version,
                subject_id,
                subject_bucket,
                ts,
            ) {
                choice.disabled_active_seen = 1;
            }
            if self.version_is_tombstoned(flag_id, environment_id, active_version, ts) {
                choice.tombstone_blocked = 1;
            } else if self.version_is_stale(flag_index, env_index, active_version) {
                choice.stale_active_seen = 1;
            } else if self.version_has_live_snapshot(flag_id, environment_id, active_version, ts) {
                active_readable = true;
            }
        }

        if active_readable {
            choice.chosen_version = active_version;
            return choice;
        }

        if fallback_version != 0 {
            if self.version_is_tombstoned(flag_id, environment_id, fallback_version, ts) {
                choice.tombstone_blocked = 1;
            } else if !self.version_is_stale(flag_index, env_index, fallback_version)
                && self.version_has_live_snapshot(flag_id, environment_id, fallback_version, ts)
            {
                fallback_readable = true;
            }
        }

        if fallback_readable {
            choice.chosen_version = fallback_version;
            choice.fallback_used = 1;
        }

        choice
    }

    fn evaluate_internal(
        &mut self,
        flag_id: i32,
        environment_id: i32,
        subject_id: i32,
        subject_bucket: i32,
        ts: i64,
        mut out_view: Option<&mut FlagEvalView>,
    ) -> Option<i32> {
        let Some(flag_index) = self.flag_index(flag_id) else {
            self.set_error(ERR_UNKNOWN_FLAG);
            return None;
        };

        if let Some(view) = out_view.as_deref_mut() {
            *view = FlagEvalView {
                exists: 1,
                environment_id,
                ..FlagEvalView::default()
            };
        }

        let choice = self.choose_version(flag_index, environment_id, subject_id, subject_bucket, ts);
        if choice.chosen_version == 0 {
            let decided_variant = self.flags[flag_index].off_variant_id;
            if let Some(view) = out_view.as_deref_mut() {
                view.decided_variant_id = decided_variant;
                view.tombstone_blocked = choice.tombstone_blocked;
                view.stale_active_seen = choice.stale_active_seen;
                view.disabled_active_seen = choice.disabled_active_seen;
                view.usable = 0;
            }
            self.set_error(ERR_NONE);
            return Some(decided_variant);
        }

        let winner_index = self.select_best_snapshot(
            flag_id,
            environment_id,
            choice.chosen_version,
            subject_id,
            subject_bucket,
            ts,
        );
        let (matched_snapshot_id, matched_rule_id, mut decided_variant, off_by_targeting) =
            if let Some(index) = winner_index {
                let winner = &self.snapshots[index];
                (winner.snapshot_id, winner.rule_id, winner.variant_id, 0)
            } else {
                (0, 0, self.flags[flag_index].default_variant_id, 1)
            };

        let prerequisites = self.flags[flag_index].prerequisites.clone();
        let mut prerequisite_failed = 0;
        for edge in prerequisites {
            let Some(prerequisite_variant) = self.evaluate_internal(
                edge.prerequisite_flag_id,
                environment_id,
                subject_id,
                subject_bucket,
                ts,
                None,
            ) else {
                return None;
            };
            if prerequisite_variant != edge.required_variant_id {
                prerequisite_failed = 1;
                decided_variant = self.flags[flag_index].off_variant_id;
                break;
            }
        }

        if let Some(view) = out_view.as_deref_mut() {
            view.decided_version = choice.chosen_version;
            view.matched_snapshot_id = matched_snapshot_id;
            view.matched_rule_id = matched_rule_id;
            view.decided_variant_id = decided_variant;
            view.fallback_used = choice.fallback_used;
            view.tombstone_blocked = choice.tombstone_blocked;
            view.stale_active_seen = choice.stale_active_seen;
            view.disabled_active_seen = choice.disabled_active_seen;
            view.prerequisite_failed = prerequisite_failed;
            view.off_by_targeting = off_by_targeting;
            view.usable = 1;
        }

        self.set_error(ERR_NONE);
        Some(decided_variant)
    }
}

#[no_mangle]
pub extern "C" fn flag_reset() {
    let mut state = engine().lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    *state = Engine::default();
    state.set_error(ERR_NONE);
}

#[no_mangle]
pub extern "C" fn flag_define(
    flag_id: i32,
    default_variant_id: i32,
    off_variant_id: i32,
) -> i32 {
    let mut state = engine().lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    if state.flag_index(flag_id).is_some() {
        state.set_error(ERR_DUP_FLAG);
        return 0;
    }

    state.flags.push(Flag {
        flag_id,
        default_variant_id,
        off_variant_id,
        prerequisites: Vec::new(),
        environments: Vec::new(),
    });
    state.set_error(ERR_NONE);
    1
}

#[no_mangle]
pub extern "C" fn flag_define_prerequisite(
    flag_id: i32,
    prerequisite_flag_id: i32,
    required_variant_id: i32,
) -> i32 {
    let mut state = engine().lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let Some(flag_index) = state.flag_index(flag_id) else {
        state.set_error(ERR_UNKNOWN_FLAG);
        return 0;
    };
    if state.flag_index(prerequisite_flag_id).is_none() {
        state.set_error(ERR_UNKNOWN_PREREQUISITE_FLAG);
        return 0;
    }
    if flag_id == prerequisite_flag_id
        || state.prerequisite_path_exists(prerequisite_flag_id, flag_id)
    {
        state.set_error(ERR_PREREQUISITE_CYCLE);
        return 0;
    }

    if let Some(edge) = state.flags[flag_index]
        .prerequisites
        .iter_mut()
        .find(|edge| edge.prerequisite_flag_id == prerequisite_flag_id)
    {
        edge.required_variant_id = required_variant_id;
        state.set_error(ERR_NONE);
        return 1;
    }

    state.flags[flag_index].prerequisites.push(Prerequisite {
        prerequisite_flag_id,
        required_variant_id,
    });
    state.set_error(ERR_NONE);
    1
}

#[no_mangle]
#[allow(clippy::too_many_arguments)]
pub extern "C" fn flag_publish_snapshot(
    snapshot_id: i32,
    flag_id: i32,
    environment_id: i32,
    version: i32,
    rule_id: i32,
    segment_id: i32,
    priority: i32,
    variant_id: i32,
    rollout_percent: i32,
    track_events: i32,
    not_before_ts: i64,
    expires_ts: i64,
) -> i32 {
    let mut state = engine().lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    if state.snapshot_index(snapshot_id).is_some() {
        state.set_error(ERR_DUP_SNAPSHOT);
        return 0;
    }
    let Some(flag_index) = state.flag_index(flag_id) else {
        state.set_error(ERR_UNKNOWN_FLAG);
        return 0;
    };
    if !(0..=100).contains(&rollout_percent) {
        state.set_error(ERR_INVALID_ROLLOUT);
        return 0;
    }

    let Some(env_index) = state.ensure_environment_index(flag_index, environment_id) else {
        return 0;
    };
    Engine::ensure_version_state(
        &mut state.flags[flag_index].environments[env_index],
        version,
    );

    state.snapshots.push(Snapshot {
        snapshot_id,
        flag_id,
        environment_id,
        version,
        rule_id,
        segment_id,
        priority,
        variant_id,
        rollout_percent,
        _track_events: track_events,
        not_before_ts,
        expires_ts,
        disabled: false,
        retired: false,
    });
    state.set_error(ERR_NONE);
    1
}

#[no_mangle]
pub extern "C" fn flag_publish_tombstone(
    tombstone_id: i32,
    flag_id: i32,
    environment_id: i32,
    version: i32,
    not_before_ts: i64,
    expires_ts: i64,
) -> i32 {
    let mut state = engine().lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    if state.tombstone_index(tombstone_id).is_some() {
        state.set_error(ERR_DUP_TOMBSTONE);
        return 0;
    }
    let Some(flag_index) = state.flag_index(flag_id) else {
        state.set_error(ERR_UNKNOWN_FLAG);
        return 0;
    };

    let Some(env_index) = state.ensure_environment_index(flag_index, environment_id) else {
        return 0;
    };
    Engine::ensure_version_state(
        &mut state.flags[flag_index].environments[env_index],
        version,
    );

    state.tombstones.push(Tombstone {
        tombstone_id,
        flag_id,
        environment_id,
        version,
        not_before_ts,
        expires_ts,
    });
    state.set_error(ERR_NONE);
    1
}

#[no_mangle]
pub extern "C" fn flag_stage_version(flag_id: i32, environment_id: i32, version: i32) -> i32 {
    let mut state = engine().lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let Some(flag_index) = state.flag_index(flag_id) else {
        state.set_error(ERR_UNKNOWN_FLAG);
        return 0;
    };

    let Some(env_index) = state.ensure_environment_index(flag_index, environment_id) else {
        return 0;
    };
    let binding = &mut state.flags[flag_index].environments[env_index];
    Engine::ensure_version_state(binding, version);
    binding.staged_version = version;
    state.set_error(ERR_NONE);
    1
}

#[no_mangle]
pub extern "C" fn flag_activate_version(flag_id: i32, environment_id: i32) -> i32 {
    let mut state = engine().lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let Some(flag_index) = state.flag_index(flag_id) else {
        state.set_error(ERR_UNKNOWN_FLAG);
        return 0;
    };
    let Some(env_index) = state.environment_index(flag_index, environment_id) else {
        state.set_error(ERR_UNKNOWN_ENV_BINDING);
        return 0;
    };

    let binding = &mut state.flags[flag_index].environments[env_index];
    if binding.staged_version == 0 {
        state.set_error(ERR_NO_STAGED_VERSION);
        return 0;
    }

    Engine::ensure_version_state(binding, binding.staged_version);
    let previous_active = binding.active_version;
    binding.active_version = binding.staged_version;
    binding.staged_version = 0;
    if previous_active != 0 {
        binding.fallback_version = previous_active;
    }

    state.set_error(ERR_NONE);
    1
}

#[no_mangle]
pub extern "C" fn flag_set_fallback_version(
    flag_id: i32,
    environment_id: i32,
    version: i32,
) -> i32 {
    let mut state = engine().lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let Some(flag_index) = state.flag_index(flag_id) else {
        state.set_error(ERR_UNKNOWN_FLAG);
        return 0;
    };
    if !state.version_is_known(flag_id, environment_id, version) {
        state.set_error(ERR_UNKNOWN_VERSION);
        return 0;
    }

    let Some(env_index) = state.ensure_environment_index(flag_index, environment_id) else {
        return 0;
    };
    let binding = &mut state.flags[flag_index].environments[env_index];
    Engine::ensure_version_state(binding, version);
    binding.fallback_version = version;
    state.set_error(ERR_NONE);
    1
}

#[no_mangle]
pub extern "C" fn flag_disable_snapshot(snapshot_id: i32) -> i32 {
    let mut state = engine().lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let Some(snapshot_index) = state.snapshot_index(snapshot_id) else {
        state.set_error(ERR_UNKNOWN_SNAPSHOT);
        return 0;
    };

    state.snapshots[snapshot_index].disabled = true;
    state.set_error(ERR_NONE);
    1
}

#[no_mangle]
pub extern "C" fn flag_retire_snapshot(snapshot_id: i32) -> i32 {
    let mut state = engine().lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let Some(snapshot_index) = state.snapshot_index(snapshot_id) else {
        state.set_error(ERR_UNKNOWN_SNAPSHOT);
        return 0;
    };

    state.snapshots[snapshot_index].retired = true;
    state.set_error(ERR_NONE);
    1
}

#[no_mangle]
pub extern "C" fn flag_mark_replica_stale(
    flag_id: i32,
    environment_id: i32,
    version: i32,
    stale: i32,
) -> i32 {
    let mut state = engine().lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let Some(flag_index) = state.flag_index(flag_id) else {
        state.set_error(ERR_UNKNOWN_FLAG);
        return 0;
    };

    let Some(env_index) = state.ensure_environment_index(flag_index, environment_id) else {
        return 0;
    };
    let binding = &mut state.flags[flag_index].environments[env_index];
    Engine::ensure_version_state(binding, version);
    if let Some(version_state) = binding
        .versions
        .iter_mut()
        .find(|state| state.version == version)
    {
        version_state.stale = stale != 0;
    }

    state.set_error(ERR_NONE);
    1
}

#[no_mangle]
pub extern "C" fn flag_register_segment_membership(
    subject_id: i32,
    segment_id: i32,
    member: i32,
) -> i32 {
    let mut state = engine().lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some(membership) = state
        .memberships
        .iter_mut()
        .find(|membership| membership.subject_id == subject_id && membership.segment_id == segment_id)
    {
        membership.member = member != 0;
        state.set_error(ERR_NONE);
        return 1;
    }

    state.memberships.push(SegmentMembership {
        subject_id,
        segment_id,
        member: member != 0,
    });
    state.set_error(ERR_NONE);
    1
}

#[no_mangle]
pub extern "C" fn flag_evaluate(
    flag_id: i32,
    environment_id: i32,
    subject_id: i32,
    subject_bucket: i32,
    ts: i64,
) -> i32 {
    let mut state = engine().lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    state
        .evaluate_internal(flag_id, environment_id, subject_id, subject_bucket, ts, None)
        .unwrap_or(0)
}

#[no_mangle]
pub extern "C" fn flag_explain_get(
    flag_id: i32,
    environment_id: i32,
    subject_id: i32,
    subject_bucket: i32,
    ts: i64,
    out_view: *mut FlagEvalView,
) -> i32 {
    let mut state = engine().lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    if out_view.is_null() {
        state.set_error(ERR_NULL_EXPLAIN_POINTER);
        return 0;
    }
    unsafe {
        *out_view = FlagEvalView::default();
    }
    if state.flag_index(flag_id).is_none() {
        state.set_error(ERR_UNKNOWN_FLAG);
        return 0;
    }

    let mut view = FlagEvalView::default();
    let result =
        state.evaluate_internal(flag_id, environment_id, subject_id, subject_bucket, ts, Some(&mut view));
    if result.is_none() {
        return 0;
    }

    unsafe {
        *out_view = view;
    }
    1
}

#[no_mangle]
pub extern "C" fn flag_count_usable_snapshots(
    flag_id: i32,
    environment_id: i32,
    ts: i64,
) -> i32 {
    let mut state = engine().lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let Some(flag_index) = state.flag_index(flag_id) else {
        state.set_error(ERR_UNKNOWN_FLAG);
        return 0;
    };

    let choice = state.choose_version(flag_index, environment_id, 0, 0, ts);
    if choice.chosen_version == 0 {
        state.set_error(ERR_NONE);
        return 0;
    }

    let count = state
        .snapshots
        .iter()
        .filter(|snapshot| {
            snapshot.flag_id == flag_id
                && snapshot.environment_id == environment_id
                && snapshot.version == choice.chosen_version
                && Engine::snapshot_live(snapshot, ts)
        })
        .count();

    state.set_error(ERR_NONE);
    if count > i32::MAX as usize { i32::MAX } else { count as i32 }
}

#[no_mangle]
pub extern "C" fn flag_last_error() -> i32 {
    let state = engine().lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    state.last_error
}
