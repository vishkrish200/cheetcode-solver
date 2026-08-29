use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, Once};

#[repr(C)]
pub struct PolicyExplainView {
    pub exists: i32,
    pub matched_snapshot_id: i32,
    pub decided_version: i32,
    pub allow_mask: i32,
    pub deny_mask: i32,
    pub fallback_used: i32,
    pub stale_snapshot: i32,
    pub disabled_snapshot: i32,
    pub usable: i32,
}

const ERR_NONE: i32 = 0;
const ERR_INVALID_ARGUMENT: i32 = -1;
const ERR_DUPLICATE_SNAPSHOT: i32 = -2;
const ERR_MISSING_BINDING: i32 = -3;
const ERR_MISSING_STAGED_VERSION: i32 = -4;
const ERR_MISSING_SNAPSHOT: i32 = -5;
const ERR_ALREADY_RETIRED: i32 = -6;
const ERR_ALREADY_DISABLED: i32 = -7;
const ERR_NULL_OUTPUT: i32 = -8;

#[derive(Clone)]
struct Snapshot {
    snapshot_id: i32,
    allow_mask: i32,
    deny_mask: i32,
    priority: i32,
    not_before_ts: i64,
    expires_ts: i64,
    retired: bool,
    disabled: bool,
}

struct SubjectBinding {
    active_version: i32,
    fallback_version: Option<i32>,
    staged_version: Option<i32>,
}

#[derive(Default)]
struct VersionInspection {
    best_any: Option<i32>,
    best_usable: Option<i32>,
    stale_snapshot: bool,
    disabled_snapshot: bool,
}

#[derive(Default)]
struct Engine {
    last_error: i32,
    snapshots: HashMap<i32, Snapshot>,
    bindings: HashMap<i32, SubjectBinding>,
    known_subjects: HashSet<i32>,
    by_subject_version: HashMap<(i32, i32), Vec<i32>>,
    by_subject_version_resource: HashMap<(i32, i32, i32), Vec<i32>>,
}

impl Engine {
    fn reset(&mut self) {
        self.last_error = ERR_NONE;
        self.snapshots.clear();
        self.bindings.clear();
        self.known_subjects.clear();
        self.by_subject_version.clear();
        self.by_subject_version_resource.clear();
    }

    fn set_error(&mut self, error: i32) {
        self.last_error = error;
    }

    fn clear_error(&mut self) {
        self.last_error = ERR_NONE;
    }

    fn publish_snapshot(
        &mut self,
        snapshot_id: i32,
        version: i32,
        subject_id: i32,
        resource_id: i32,
        allow_mask: i32,
        deny_mask: i32,
        priority: i32,
        not_before_ts: i64,
        expires_ts: i64,
    ) -> i32 {
        if snapshot_id <= 0 || version <= 0 || not_before_ts >= expires_ts {
            self.set_error(ERR_INVALID_ARGUMENT);
            return 0;
        }
        if self.snapshots.contains_key(&snapshot_id) {
            self.set_error(ERR_DUPLICATE_SNAPSHOT);
            return 0;
        }

        let snapshot = Snapshot {
            snapshot_id,
            allow_mask,
            deny_mask,
            priority,
            not_before_ts,
            expires_ts,
            retired: false,
            disabled: false,
        };

        self.snapshots.insert(snapshot_id, snapshot);
        self.known_subjects.insert(subject_id);
        self.by_subject_version
            .entry((subject_id, version))
            .or_default()
            .push(snapshot_id);
        self.by_subject_version_resource
            .entry((subject_id, version, resource_id))
            .or_default()
            .push(snapshot_id);
        self.clear_error();
        0
    }

    fn set_subject_binding(
        &mut self,
        subject_id: i32,
        active_version: i32,
        fallback_version: i32,
    ) -> i32 {
        if active_version <= 0 || fallback_version < 0 {
            self.set_error(ERR_INVALID_ARGUMENT);
            return 0;
        }

        let binding = SubjectBinding {
            active_version,
            fallback_version: if fallback_version == 0 {
                None
            } else {
                Some(fallback_version)
            },
            staged_version: None,
        };

        self.bindings.insert(subject_id, binding);
        self.known_subjects.insert(subject_id);
        self.clear_error();
        0
    }

    fn stage_version(&mut self, subject_id: i32, staged_version: i32) -> i32 {
        if staged_version <= 0 {
            self.set_error(ERR_INVALID_ARGUMENT);
            return 0;
        }

        let Some(binding) = self.bindings.get_mut(&subject_id) else {
            self.set_error(ERR_MISSING_BINDING);
            return 0;
        };

        binding.staged_version = Some(staged_version);
        self.clear_error();
        0
    }

    fn activate_version(&mut self, subject_id: i32) -> i32 {
        let Some(binding) = self.bindings.get_mut(&subject_id) else {
            self.set_error(ERR_MISSING_BINDING);
            return 0;
        };

        let Some(staged_version) = binding.staged_version.take() else {
            self.set_error(ERR_MISSING_STAGED_VERSION);
            return 0;
        };

        binding.fallback_version = Some(binding.active_version);
        binding.active_version = staged_version;
        self.clear_error();
        0
    }

    fn retire_snapshot(&mut self, snapshot_id: i32) -> i32 {
        let Some(snapshot) = self.snapshots.get_mut(&snapshot_id) else {
            self.set_error(ERR_MISSING_SNAPSHOT);
            return 0;
        };

        if snapshot.retired {
            self.set_error(ERR_ALREADY_RETIRED);
            return 0;
        }

        snapshot.retired = true;
        self.clear_error();
        0
    }

    fn disable_snapshot(&mut self, snapshot_id: i32) -> i32 {
        let Some(snapshot) = self.snapshots.get_mut(&snapshot_id) else {
            self.set_error(ERR_MISSING_SNAPSHOT);
            return 0;
        };

        if snapshot.disabled {
            self.set_error(ERR_ALREADY_DISABLED);
            return 0;
        }

        snapshot.disabled = true;
        self.clear_error();
        0
    }
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

fn with_engine_mut<F, R>(func: F) -> R
where
    F: FnOnce(&mut Engine) -> R,
{
    let mutex = engine();
    let mut guard = match mutex.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    func(&mut guard)
}

fn is_usable(snapshot: &Snapshot, ts: i64) -> bool {
    !snapshot.retired
        && !snapshot.disabled
        && snapshot.not_before_ts <= ts
        && ts < snapshot.expires_ts
}

fn is_stale(snapshot: &Snapshot, ts: i64) -> bool {
    snapshot.retired || ts < snapshot.not_before_ts || ts >= snapshot.expires_ts
}

fn better_than(candidate: &Snapshot, current: &Snapshot) -> bool {
    candidate.priority > current.priority
        || (candidate.priority == current.priority && candidate.snapshot_id > current.snapshot_id)
}

fn inspect_version(
    engine: &Engine,
    subject_id: i32,
    version: i32,
    resource_id: i32,
    ts: i64,
) -> VersionInspection {
    let mut inspection = VersionInspection::default();
    let Some(snapshot_ids) = engine
        .by_subject_version_resource
        .get(&(subject_id, version, resource_id))
    else {
        return inspection;
    };

    let mut best_any: Option<&Snapshot> = None;
    let mut best_usable: Option<&Snapshot> = None;

    for &snapshot_id in snapshot_ids {
        let Some(snapshot) = engine.snapshots.get(&snapshot_id) else {
            continue;
        };

        if snapshot.disabled {
            inspection.disabled_snapshot = true;
        }
        if is_stale(snapshot, ts) {
            inspection.stale_snapshot = true;
        }

        best_any = match best_any {
            Some(current) if !better_than(snapshot, current) => Some(current),
            _ => Some(snapshot),
        };

        if is_usable(snapshot, ts) {
            best_usable = match best_usable {
                Some(current) if !better_than(snapshot, current) => Some(current),
                _ => Some(snapshot),
            };
        }
    }

    inspection.best_any = best_any.map(|snapshot| snapshot.snapshot_id);
    inspection.best_usable = best_usable.map(|snapshot| snapshot.snapshot_id);
    inspection
}

fn fill_snapshot_fields(
    view: &mut PolicyExplainView,
    engine: &Engine,
    snapshot_id: i32,
    decided_version: i32,
    fallback_used: bool,
    usable: bool,
) {
    if let Some(snapshot) = engine.snapshots.get(&snapshot_id) {
        view.matched_snapshot_id = snapshot.snapshot_id;
        view.decided_version = decided_version;
        view.allow_mask = snapshot.allow_mask;
        view.deny_mask = snapshot.deny_mask;
        view.fallback_used = if fallback_used { 1 } else { 0 };
        view.usable = if usable { 1 } else { 0 };
    }
}

fn empty_view(exists: bool) -> PolicyExplainView {
    PolicyExplainView {
        exists: if exists { 1 } else { 0 },
        matched_snapshot_id: 0,
        decided_version: 0,
        allow_mask: 0,
        deny_mask: 0,
        fallback_used: 0,
        stale_snapshot: 0,
        disabled_snapshot: 0,
        usable: 0,
    }
}

#[no_mangle]
pub extern "C" fn policy_reset() {
    with_engine_mut(|engine| {
        engine.reset();
    });
}

#[no_mangle]
pub extern "C" fn policy_publish_snapshot(
    snapshot_id: i32,
    version: i32,
    subject_id: i32,
    resource_id: i32,
    allow_mask: i32,
    deny_mask: i32,
    priority: i32,
    not_before_ts: i64,
    expires_ts: i64,
) -> i32 {
    with_engine_mut(|engine| {
        engine.publish_snapshot(
            snapshot_id,
            version,
            subject_id,
            resource_id,
            allow_mask,
            deny_mask,
            priority,
            not_before_ts,
            expires_ts,
        )
    })
}

#[no_mangle]
pub extern "C" fn policy_set_subject_binding(
    subject_id: i32,
    active_version: i32,
    fallback_version: i32,
) -> i32 {
    with_engine_mut(|engine| engine.set_subject_binding(subject_id, active_version, fallback_version))
}

#[no_mangle]
pub extern "C" fn policy_stage_version(subject_id: i32, staged_version: i32) -> i32 {
    with_engine_mut(|engine| engine.stage_version(subject_id, staged_version))
}

#[no_mangle]
pub extern "C" fn policy_activate_version(subject_id: i32) -> i32 {
    with_engine_mut(|engine| engine.activate_version(subject_id))
}

#[no_mangle]
pub extern "C" fn policy_retire_snapshot(snapshot_id: i32) -> i32 {
    with_engine_mut(|engine| engine.retire_snapshot(snapshot_id))
}

#[no_mangle]
pub extern "C" fn policy_disable_snapshot(snapshot_id: i32) -> i32 {
    with_engine_mut(|engine| engine.disable_snapshot(snapshot_id))
}

#[no_mangle]
pub extern "C" fn policy_check(subject_id: i32, resource_id: i32, perm_bit: i32, ts: i64) -> i32 {
    with_engine_mut(|engine| {
        engine.clear_error();

        let Some(binding) = engine.bindings.get(&subject_id) else {
            return 0;
        };

        let active = inspect_version(engine, subject_id, binding.active_version, resource_id, ts);
        let resolved_snapshot = if let Some(snapshot_id) = active.best_usable {
            Some(snapshot_id)
        } else if let Some(fallback_version) = binding.fallback_version {
            if fallback_version == binding.active_version {
                None
            } else {
                inspect_version(engine, subject_id, fallback_version, resource_id, ts).best_usable
            }
        } else {
            None
        };

        let Some(snapshot_id) = resolved_snapshot else {
            return 0;
        };
        let Some(snapshot) = engine.snapshots.get(&snapshot_id) else {
            return 0;
        };

        let allowed = (snapshot.allow_mask & perm_bit) == perm_bit;
        let denied = (snapshot.deny_mask & perm_bit) != 0;
        if allowed && !denied { 1 } else { 0 }
    })
}

#[no_mangle]
pub extern "C" fn policy_explain_get(
    subject_id: i32,
    resource_id: i32,
    _perm_bit: i32,
    ts: i64,
    out_view: *mut PolicyExplainView,
) -> i32 {
    with_engine_mut(|engine| {
        if out_view.is_null() {
            engine.set_error(ERR_NULL_OUTPUT);
            return 0;
        }

        let known_subject = engine.known_subjects.contains(&subject_id);
        if !known_subject {
            engine.clear_error();
            return 0;
        }

        let mut view = empty_view(true);
        let binding = engine.bindings.get(&subject_id);

        let (active_inspection, fallback_version, active_version) = if let Some(binding) = binding {
            (
                Some(inspect_version(
                    engine,
                    subject_id,
                    binding.active_version,
                    resource_id,
                    ts,
                )),
                binding.fallback_version,
                Some(binding.active_version),
            )
        } else {
            (None, None, None)
        };

        if let Some(active) = active_inspection.as_ref() {
            view.stale_snapshot = if active.stale_snapshot { 1 } else { 0 };
            view.disabled_snapshot = if active.disabled_snapshot { 1 } else { 0 };

            if let Some(snapshot_id) = active.best_usable {
                fill_snapshot_fields(&mut view, engine, snapshot_id, active_version.unwrap_or(0), false, true);
            } else if let Some(version) = fallback_version {
                let fallback = inspect_version(engine, subject_id, version, resource_id, ts);
                if let Some(snapshot_id) = fallback.best_usable {
                    fill_snapshot_fields(&mut view, engine, snapshot_id, version, true, true);
                } else if let Some(snapshot_id) = active.best_any {
                    fill_snapshot_fields(
                        &mut view,
                        engine,
                        snapshot_id,
                        active_version.unwrap_or(0),
                        false,
                        false,
                    );
                } else if let Some(snapshot_id) = fallback.best_any {
                    fill_snapshot_fields(&mut view, engine, snapshot_id, version, true, false);
                }
            } else if let Some(snapshot_id) = active.best_any {
                fill_snapshot_fields(
                    &mut view,
                    engine,
                    snapshot_id,
                    active_version.unwrap_or(0),
                    false,
                    false,
                );
            }
        }

        // SAFETY: null is checked above and `out_view` points to caller-owned writable memory.
        unsafe {
            *out_view = view;
        }
        engine.clear_error();
        1
    })
}

#[no_mangle]
pub extern "C" fn policy_count_subject_rules(subject_id: i32, ts: i64) -> i32 {
    with_engine_mut(|engine| {
        engine.clear_error();

        let Some(binding) = engine.bindings.get(&subject_id) else {
            return 0;
        };

        let mut versions = HashSet::new();
        versions.insert(binding.active_version);
        if let Some(fallback_version) = binding.fallback_version {
            versions.insert(fallback_version);
        }

        let mut count = 0;
        let mut seen_snapshot_ids = HashSet::new();
        for version in versions {
            let Some(snapshot_ids) = engine.by_subject_version.get(&(subject_id, version)) else {
                continue;
            };
            for &snapshot_id in snapshot_ids {
                if !seen_snapshot_ids.insert(snapshot_id) {
                    continue;
                }
                if let Some(snapshot) = engine.snapshots.get(&snapshot_id) {
                    if is_usable(snapshot, ts) {
                        count += 1;
                    }
                }
            }
        }

        count
    })
}

#[no_mangle]
pub extern "C" fn policy_last_error() -> i32 {
    with_engine_mut(|engine| engine.last_error)
}
