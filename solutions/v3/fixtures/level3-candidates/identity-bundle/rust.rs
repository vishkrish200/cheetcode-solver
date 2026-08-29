#![allow(unknown_lints)]
#![allow(dead_code, unused_assignments, unused_imports, unused_mut, unused_variables, static_mut_refs)]
use std::collections::HashMap;
use std::sync::{Mutex, Once};

const SOURCE_LOCAL: i32 = 1;
const SOURCE_BUNDLE: i32 = 2;

const MODE_LOCAL_ONLY: i32 = 1;
const MODE_BUNDLE_ONLY: i32 = 2;
const MODE_AUTO: i32 = 3;

const ERR_OK: i32 = 0;
const ERR_DUPLICATE_ID: i32 = 1;
const ERR_UNKNOWN_GRANT: i32 = 2;
const ERR_WRONG_SOURCE_FOR_KEY: i32 = 3;
const ERR_NON_DELEGATABLE_PARENT: i32 = 4;
const ERR_PERMISSION_WIDENING: i32 = 5;
const ERR_CHILD_START_BEFORE_PARENT: i32 = 6;
const ERR_CHILD_EXPIRY_AFTER_PARENT: i32 = 7;
const ERR_NULL_OUTPUT: i32 = 8;
const ERR_PARENT_REVOKED: i32 = 9;
const ERR_INVALID_RESOLVE_MODE: i32 = 10;

#[repr(C)]
pub struct AuthAuditView {
    pub exists: i32,
    pub source: i32,
    pub stored_mask: i32,
    pub effective_mask: i32,
    pub revoked: i32,
    pub requires_key: i32,
    pub key_attached: i32,
    pub not_yet_valid: i32,
    pub expired: i32,
    pub disabled_by_ancestor: i32,
    pub usable: i32,
}

#[derive(Clone)]
struct Grant {
    source: i32,
    subject_id: i32,
    resource_id: i32,
    stored_mask: i32,
    not_before_ts: i64,
    expires_ts: i64,
    delegatable: bool,
    requires_key: bool,
    key_attached: bool,
    revoked: bool,
    parent: Option<usize>,
}

#[derive(Default)]
struct EvalInfo {
    effective_mask: i32,
    current_revoked: bool,
    current_requires_key: bool,
    current_key_attached: bool,
    current_not_yet_valid: bool,
    current_expired: bool,
    disabled_by_ancestor: bool,
    usable: bool,
}

#[derive(Default)]
struct State {
    grants: Vec<Grant>,
    id_to_idx: HashMap<i32, usize>,
    by_subject_source: HashMap<(i32, i32), Vec<usize>>,
    by_subject_source_resource: HashMap<(i32, i32, i32), Vec<usize>>,
    bundle_grant_counts: HashMap<i32, usize>,
    last_error: i32,
}

impl State {
    fn new() -> Self {
        Self::default()
    }

    fn set_error(&mut self, code: i32) -> i32 {
        self.last_error = code;
        0
    }

    fn set_success(&mut self) -> i32 {
        self.last_error = ERR_OK;
        1
    }

    fn get_idx(&self, grant_id: i32) -> Option<usize> {
        self.id_to_idx.get(&grant_id).copied()
    }

    fn has_bundle_grant_for_subject(&self, subject_id: i32) -> bool {
        self.bundle_grant_counts
            .get(&subject_id)
            .copied()
            .unwrap_or(0)
            > 0
    }

    fn add_grant(&mut self, grant_id: i32, grant: Grant) {
        let idx = self.grants.len();
        let subject_id = grant.subject_id;
        let source = grant.source;
        let resource_id = grant.resource_id;
        self.grants.push(grant);
        self.id_to_idx.insert(grant_id, idx);
        self.by_subject_source
            .entry((subject_id, source))
            .or_default()
            .push(idx);
        self.by_subject_source_resource
            .entry((subject_id, source, resource_id))
            .or_default()
            .push(idx);
        if source == SOURCE_BUNDLE {
            *self.bundle_grant_counts.entry(subject_id).or_insert(0) += 1;
        }
    }

    fn chosen_source(&self, subject_id: i32, resolve_mode: i32) -> Result<i32, i32> {
        match resolve_mode {
            MODE_LOCAL_ONLY => Ok(SOURCE_LOCAL),
            MODE_BUNDLE_ONLY => Ok(SOURCE_BUNDLE),
            MODE_AUTO => {
                if self.has_bundle_grant_for_subject(subject_id) {
                    Ok(SOURCE_BUNDLE)
                } else {
                    Ok(SOURCE_LOCAL)
                }
            }
            _ => Err(ERR_INVALID_RESOLVE_MODE),
        }
    }

    fn eval_grant(&self, idx: usize, ts: i64) -> EvalInfo {
        let grant = &self.grants[idx];
        let current_requires_key = grant.requires_key;
        let current_key_attached = !grant.requires_key || grant.key_attached;
        let current_not_yet_valid = ts < grant.not_before_ts;
        let current_expired = ts >= grant.expires_ts;
        let current_revoked = grant.revoked;
        let current_directly_disabled = current_revoked
            || current_not_yet_valid
            || current_expired
            || (grant.requires_key && !grant.key_attached);

        let mut disabled_by_ancestor = false;
        let mut effective_mask = grant.stored_mask;
        let mut cursor = grant.parent;

        while let Some(parent_idx) = cursor {
            let parent = &self.grants[parent_idx];
            effective_mask &= parent.stored_mask;
            let parent_disabled = parent.revoked
                || ts < parent.not_before_ts
                || ts >= parent.expires_ts
                || (parent.requires_key && !parent.key_attached);
            if parent_disabled {
                disabled_by_ancestor = true;
            }
            cursor = parent.parent;
        }

        let usable = !current_directly_disabled && !disabled_by_ancestor && effective_mask != 0;
        if !usable {
            effective_mask = 0;
        }

        EvalInfo {
            effective_mask,
            current_revoked,
            current_requires_key,
            current_key_attached,
            current_not_yet_valid,
            current_expired,
            disabled_by_ancestor,
            usable,
        }
    }
}

fn state() -> &'static Mutex<State> {
    static INIT: Once = Once::new();
    static mut STATE: *const Mutex<State> = std::ptr::null();
    unsafe {
        INIT.call_once(|| {
            STATE = Box::into_raw(Box::new(Mutex::new(State::new())));
        });
        &*STATE
    }
}

fn lock_state() -> std::sync::MutexGuard<'static, State> {
    state().lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn bool_to_i32(value: bool) -> i32 {
    if value {
        1
    } else {
        0
    }
}

#[no_mangle]
pub extern "C" fn auth_reset() {
    let mut guard = lock_state();
    *guard = State::new();
}

#[no_mangle]
pub extern "C" fn auth_create_local_grant(
    grant_id: i32,
    subject_id: i32,
    resource_id: i32,
    perms_mask: i32,
    not_before_ts: i64,
    expires_ts: i64,
    delegatable: i32,
) -> i32 {
    let mut guard = lock_state();
    if guard.id_to_idx.contains_key(&grant_id) {
        return guard.set_error(ERR_DUPLICATE_ID);
    }

    guard.add_grant(
        grant_id,
        Grant {
            source: SOURCE_LOCAL,
            subject_id,
            resource_id,
            stored_mask: perms_mask,
            not_before_ts,
            expires_ts,
            delegatable: delegatable != 0,
            requires_key: false,
            key_attached: true,
            revoked: false,
            parent: None,
        },
    );
    guard.set_success()
}

#[no_mangle]
pub extern "C" fn auth_import_bundle_grant(
    grant_id: i32,
    subject_id: i32,
    resource_id: i32,
    perms_mask: i32,
    not_before_ts: i64,
    expires_ts: i64,
    delegatable: i32,
    requires_key: i32,
) -> i32 {
    let mut guard = lock_state();
    if guard.id_to_idx.contains_key(&grant_id) {
        return guard.set_error(ERR_DUPLICATE_ID);
    }

    let requires_key_flag = requires_key != 0;
    guard.add_grant(
        grant_id,
        Grant {
            source: SOURCE_BUNDLE,
            subject_id,
            resource_id,
            stored_mask: perms_mask,
            not_before_ts,
            expires_ts,
            delegatable: delegatable != 0,
            requires_key: requires_key_flag,
            key_attached: !requires_key_flag,
            revoked: false,
            parent: None,
        },
    );
    guard.set_success()
}

#[no_mangle]
pub extern "C" fn auth_attach_bundle_key(grant_id: i32) -> i32 {
    let mut guard = lock_state();
    let idx = match guard.get_idx(grant_id) {
        Some(idx) => idx,
        None => return guard.set_error(ERR_UNKNOWN_GRANT),
    };

    let grant = &mut guard.grants[idx];
    if grant.source != SOURCE_BUNDLE {
        return guard.set_error(ERR_WRONG_SOURCE_FOR_KEY);
    }
    grant.key_attached = true;
    guard.set_success()
}

#[no_mangle]
pub extern "C" fn auth_delegate(
    parent_grant_id: i32,
    child_grant_id: i32,
    subject_id: i32,
    resource_id: i32,
    perms_mask: i32,
    not_before_ts: i64,
    expires_ts: i64,
    delegatable: i32,
    requires_key: i32,
) -> i32 {
    let mut guard = lock_state();
    if guard.id_to_idx.contains_key(&child_grant_id) {
        return guard.set_error(ERR_DUPLICATE_ID);
    }

    let parent_idx = match guard.get_idx(parent_grant_id) {
        Some(idx) => idx,
        None => return guard.set_error(ERR_UNKNOWN_GRANT),
    };

    let parent = &guard.grants[parent_idx];
    if parent.revoked {
        return guard.set_error(ERR_PARENT_REVOKED);
    }
    if !parent.delegatable {
        return guard.set_error(ERR_NON_DELEGATABLE_PARENT);
    }
    if (perms_mask & !parent.stored_mask) != 0 {
        return guard.set_error(ERR_PERMISSION_WIDENING);
    }
    if not_before_ts < parent.not_before_ts {
        return guard.set_error(ERR_CHILD_START_BEFORE_PARENT);
    }
    if expires_ts > parent.expires_ts {
        return guard.set_error(ERR_CHILD_EXPIRY_AFTER_PARENT);
    }

    let source = parent.source;
    let child_requires_key = source == SOURCE_BUNDLE && requires_key != 0;
    guard.add_grant(
        child_grant_id,
        Grant {
            source,
            subject_id,
            resource_id,
            stored_mask: perms_mask,
            not_before_ts,
            expires_ts,
            delegatable: delegatable != 0,
            requires_key: child_requires_key,
            key_attached: !child_requires_key,
            revoked: false,
            parent: Some(parent_idx),
        },
    );
    guard.set_success()
}

#[no_mangle]
pub extern "C" fn auth_revoke(grant_id: i32) -> i32 {
    let mut guard = lock_state();
    let idx = match guard.get_idx(grant_id) {
        Some(idx) => idx,
        None => return guard.set_error(ERR_UNKNOWN_GRANT),
    };

    guard.grants[idx].revoked = true;
    guard.set_success()
}

#[no_mangle]
pub extern "C" fn auth_check(
    subject_id: i32,
    resource_id: i32,
    perm_bit: i32,
    ts: i64,
    resolve_mode: i32,
) -> i32 {
    let mut guard = lock_state();
    let source = match guard.chosen_source(subject_id, resolve_mode) {
        Ok(source) => source,
        Err(code) => return guard.set_error(code),
    };

    let result = guard
        .by_subject_source_resource
        .get(&(subject_id, source, resource_id))
        .map(|indices| {
            indices.iter().copied().any(|idx| {
                let eval = guard.eval_grant(idx, ts);
                (eval.effective_mask & perm_bit) != 0
            })
        })
        .unwrap_or(false);
    guard.last_error = ERR_OK;
    bool_to_i32(result)
}

#[no_mangle]
pub extern "C" fn auth_effective_mask(grant_id: i32, ts: i64) -> i32 {
    let mut guard = lock_state();
    let idx = match guard.get_idx(grant_id) {
        Some(idx) => idx,
        None => {
            guard.last_error = ERR_UNKNOWN_GRANT;
            return 0;
        }
    };

    let result = guard.eval_grant(idx, ts).effective_mask;
    guard.last_error = ERR_OK;
    result
}

#[no_mangle]
pub extern "C" fn auth_audit_get(grant_id: i32, ts: i64, out_view: *mut AuthAuditView) -> i32 {
    let mut guard = lock_state();
    let out_ref = match unsafe { out_view.as_mut() } {
        Some(out_ref) => out_ref,
        None => return guard.set_error(ERR_NULL_OUTPUT),
    };
    let idx = match guard.get_idx(grant_id) {
        Some(idx) => idx,
        None => return guard.set_error(ERR_UNKNOWN_GRANT),
    };

    let grant = &guard.grants[idx];
    let eval = guard.eval_grant(idx, ts);
    *out_ref = AuthAuditView {
        exists: 1,
        source: grant.source,
        stored_mask: grant.stored_mask,
        effective_mask: eval.effective_mask,
        revoked: bool_to_i32(eval.current_revoked),
        requires_key: bool_to_i32(eval.current_requires_key),
        key_attached: bool_to_i32(eval.current_key_attached),
        not_yet_valid: bool_to_i32(eval.current_not_yet_valid),
        expired: bool_to_i32(eval.current_expired),
        disabled_by_ancestor: bool_to_i32(eval.disabled_by_ancestor),
        usable: bool_to_i32(eval.usable),
    };
    guard.set_success()
}

#[no_mangle]
pub extern "C" fn auth_count_usable(subject_id: i32, ts: i64, resolve_mode: i32) -> i32 {
    let mut guard = lock_state();
    let source = match guard.chosen_source(subject_id, resolve_mode) {
        Ok(source) => source,
        Err(code) => return guard.set_error(code),
    };

    let count = guard
        .by_subject_source
        .get(&(subject_id, source))
        .map(|indices| {
            indices
                .iter()
                .copied()
                .filter(|&idx| guard.eval_grant(idx, ts).effective_mask != 0)
                .count()
        })
        .unwrap_or(0);
    guard.last_error = ERR_OK;
    if count > i32::MAX as usize { i32::MAX } else { count as i32 }
}

#[no_mangle]
pub extern "C" fn auth_last_error() -> i32 {
    let guard = lock_state();
    guard.last_error
}
