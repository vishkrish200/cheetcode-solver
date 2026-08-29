use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, Once};

const ERR_NONE: i32 = 0;
const ERR_SESSION_EXISTS: i32 = 1;
const ERR_SESSION_NOT_FOUND: i32 = 2;
const ERR_INVALID_GENERATION: i32 = 3;
const ERR_STAGED_GENERATION_EXISTS: i32 = 4;
const ERR_NO_STAGED_GENERATION: i32 = 5;
const ERR_CREDENTIAL_EXISTS: i32 = 6;
const ERR_INVALID_CREDENTIAL_WINDOW: i32 = 7;
const ERR_NULL_POINTER: i32 = 8;

#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct SessionAuditView {
    pub exists: i32,
    pub session_revoked: i32,
    pub active_generation: i32,
    pub staged_generation: i32,
    pub presented_generation: i32,
    pub grace_generation: i32,
    pub grace_active: i32,
    pub generation_revoked: i32,
    pub compatible: i32,
    pub usable: i32,
}

#[derive(Clone, Copy)]
struct CredentialWindow {
    issued_ts: i64,
    expires_ts: i64,
}

#[derive(Default)]
struct GenerationState {
    revoked: bool,
    windows: Vec<CredentialWindow>,
}

struct Session {
    subject_id: i32,
    active_generation: i32,
    staged_generation: Option<i32>,
    grace_generation: Option<i32>,
    grace_until_ts: i64,
    session_revoked: bool,
    generations: HashMap<i32, GenerationState>,
}

#[derive(Default)]
struct Registry {
    sessions: HashMap<i32, Session>,
    credential_ids: HashSet<i32>,
    last_error: i32,
}

fn registry() -> &'static Mutex<Registry> {
    static INIT: Once = Once::new();
    static mut REGISTRY: *const Mutex<Registry> = std::ptr::null();
    unsafe {
        INIT.call_once(|| {
            REGISTRY = Box::into_raw(Box::new(Mutex::new(Registry::default())));
        });
        &*REGISTRY
    }
}

fn set_error(registry: &mut Registry, error: i32) {
    registry.last_error = error;
}

fn bool_int(value: bool) -> i32 {
    if value {
        1
    } else {
        0
    }
}

fn grace_is_active(session: &Session, ts: i64) -> bool {
    session
        .grace_generation
        .is_some_and(|_| ts <= session.grace_until_ts)
}

fn generation_compatible(session: &Session, generation: i32, ts: i64) -> bool {
    generation == session.active_generation
        || (grace_is_active(session, ts) && session.grace_generation == Some(generation))
}

fn generation_revoked(session: &Session, generation: i32) -> bool {
    session
        .generations
        .get(&generation)
        .is_some_and(|state| state.revoked)
}

fn generation_has_valid_credential(generation: Option<&GenerationState>, ts: i64) -> bool {
    let Some(state) = generation else {
        return true;
    };
    state.windows.is_empty()
        || state
            .windows
            .iter()
            .any(|window| window.issued_ts <= ts && ts < window.expires_ts)
}

fn generation_usable(session: &Session, generation: i32, ts: i64) -> bool {
    generation_compatible(session, generation, ts)
        && !session.session_revoked
        && !generation_revoked(session, generation)
        && generation_has_valid_credential(session.generations.get(&generation), ts)
}

#[no_mangle]
pub extern "C" fn session_reset() {
    let mut registry = registry().lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    *registry = Registry::default();
    registry.last_error = ERR_NONE;
}

#[no_mangle]
pub extern "C" fn session_create(
    session_id: i32,
    subject_id: i32,
    _resource_id: i32,
    active_generation: i32,
) -> i32 {
    let mut registry = registry().lock().unwrap_or_else(|poisoned| poisoned.into_inner());

    if active_generation < 0 {
        set_error(&mut registry, ERR_INVALID_GENERATION);
        return 0;
    }
    if registry.sessions.contains_key(&session_id) {
        set_error(&mut registry, ERR_SESSION_EXISTS);
        return 0;
    }

    let mut generations = HashMap::new();
    generations.insert(active_generation, GenerationState::default());
    registry.sessions.insert(
        session_id,
        Session {
            subject_id,
            active_generation,
            staged_generation: None,
            grace_generation: None,
            grace_until_ts: 0,
            session_revoked: false,
            generations,
        },
    );

    set_error(&mut registry, ERR_NONE);
    1
}

#[no_mangle]
pub extern "C" fn session_issue_credential(
    credential_id: i32,
    session_id: i32,
    generation: i32,
    issued_ts: i64,
    expires_ts: i64,
) -> i32 {
    let mut registry = registry().lock().unwrap_or_else(|poisoned| poisoned.into_inner());

    if generation < 0 {
        set_error(&mut registry, ERR_INVALID_GENERATION);
        return 0;
    }
    if expires_ts <= issued_ts {
        set_error(&mut registry, ERR_INVALID_CREDENTIAL_WINDOW);
        return 0;
    }
    if registry.credential_ids.contains(&credential_id) {
        set_error(&mut registry, ERR_CREDENTIAL_EXISTS);
        return 0;
    }

    let Some(session) = registry.sessions.get_mut(&session_id) else {
        set_error(&mut registry, ERR_SESSION_NOT_FOUND);
        return 0;
    };
    session
        .generations
        .entry(generation)
        .or_default()
        .windows
        .push(CredentialWindow {
            issued_ts,
            expires_ts,
        });
    registry.credential_ids.insert(credential_id);

    set_error(&mut registry, ERR_NONE);
    1
}

#[no_mangle]
pub extern "C" fn session_stage_generation(
    session_id: i32,
    generation: i32,
    grace_until_ts: i64,
) -> i32 {
    let mut registry = registry().lock().unwrap_or_else(|poisoned| poisoned.into_inner());

    if generation < 0 {
        set_error(&mut registry, ERR_INVALID_GENERATION);
        return 0;
    }

    let Some(session) = registry.sessions.get_mut(&session_id) else {
        set_error(&mut registry, ERR_SESSION_NOT_FOUND);
        return 0;
    };
    if generation == session.active_generation {
        set_error(&mut registry, ERR_INVALID_GENERATION);
        return 0;
    }
    if session.staged_generation.is_some() {
        set_error(&mut registry, ERR_STAGED_GENERATION_EXISTS);
        return 0;
    }

    session.generations.entry(generation).or_default();
    session.staged_generation = Some(generation);
    session.grace_until_ts = grace_until_ts;

    set_error(&mut registry, ERR_NONE);
    1
}

#[no_mangle]
pub extern "C" fn session_activate_generation(session_id: i32, _ts: i64) -> i32 {
    let mut registry = registry().lock().unwrap_or_else(|poisoned| poisoned.into_inner());

    let Some(session) = registry.sessions.get_mut(&session_id) else {
        set_error(&mut registry, ERR_SESSION_NOT_FOUND);
        return 0;
    };
    let Some(staged_generation) = session.staged_generation else {
        set_error(&mut registry, ERR_NO_STAGED_GENERATION);
        return 0;
    };

    session.grace_generation = Some(session.active_generation);
    session.active_generation = staged_generation;
    session.staged_generation = None;

    set_error(&mut registry, ERR_NONE);
    1
}

#[no_mangle]
pub extern "C" fn session_revoke(session_id: i32, generation: i32) -> i32 {
    let mut registry = registry().lock().unwrap_or_else(|poisoned| poisoned.into_inner());

    let Some(session) = registry.sessions.get_mut(&session_id) else {
        set_error(&mut registry, ERR_SESSION_NOT_FOUND);
        return 0;
    };
    if generation == -1 {
        session.session_revoked = true;
        set_error(&mut registry, ERR_NONE);
        return 1;
    }
    if generation < 0 {
        set_error(&mut registry, ERR_INVALID_GENERATION);
        return 0;
    }

    session.generations.entry(generation).or_default().revoked = true;
    set_error(&mut registry, ERR_NONE);
    1
}

#[no_mangle]
pub extern "C" fn session_check(session_id: i32, generation: i32, ts: i64) -> i32 {
    let mut registry = registry().lock().unwrap_or_else(|poisoned| poisoned.into_inner());

    if generation < 0 {
        set_error(&mut registry, ERR_INVALID_GENERATION);
        return 0;
    }

    let Some(session) = registry.sessions.get(&session_id) else {
        set_error(&mut registry, ERR_SESSION_NOT_FOUND);
        return 0;
    };
    let usable = generation_usable(session, generation, ts);

    set_error(&mut registry, ERR_NONE);
    bool_int(usable)
}

#[no_mangle]
pub extern "C" fn session_audit_get(
    session_id: i32,
    generation: i32,
    ts: i64,
    out_view: *mut SessionAuditView,
) -> i32 {
    let mut registry = registry().lock().unwrap_or_else(|poisoned| poisoned.into_inner());

    if out_view.is_null() {
        set_error(&mut registry, ERR_NULL_POINTER);
        return 0;
    }

    unsafe {
        *out_view = SessionAuditView::default();
    }

    if generation < 0 {
        set_error(&mut registry, ERR_INVALID_GENERATION);
        return 0;
    }

    let Some(session) = registry.sessions.get(&session_id) else {
        set_error(&mut registry, ERR_SESSION_NOT_FOUND);
        return 0;
    };

    let view = SessionAuditView {
        exists: 1,
        session_revoked: bool_int(session.session_revoked),
        active_generation: session.active_generation,
        staged_generation: session.staged_generation.unwrap_or(-1),
        presented_generation: generation,
        grace_generation: session.grace_generation.unwrap_or(-1),
        grace_active: bool_int(grace_is_active(session, ts)),
        generation_revoked: bool_int(generation_revoked(session, generation)),
        compatible: bool_int(generation_compatible(session, generation, ts)),
        usable: bool_int(generation_usable(session, generation, ts)),
    };

    unsafe {
        *out_view = view;
    }

    set_error(&mut registry, ERR_NONE);
    1
}

#[no_mangle]
pub extern "C" fn session_count_active(subject_id: i32, ts: i64) -> i32 {
    let mut registry = registry().lock().unwrap_or_else(|poisoned| poisoned.into_inner());

    let count = registry
        .sessions
        .values()
        .filter(|session| {
            session.subject_id == subject_id
                && generation_usable(session, session.active_generation, ts)
        })
        .count() as i32;

    set_error(&mut registry, ERR_NONE);
    count
}

#[no_mangle]
pub extern "C" fn session_last_error() -> i32 {
    let registry = registry().lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    registry.last_error
}
