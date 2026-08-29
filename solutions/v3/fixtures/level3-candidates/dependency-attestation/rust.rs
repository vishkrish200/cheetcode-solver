#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct GateAuditView {
    pub exists: i32,
    pub rollout_enabled: i32,
    pub attested: i32,
    pub waiver_active: i32,
    pub blocked_direct: i32,
    pub blocked_transitive: i32,
    pub stale_attestation: i32,
    pub conflicting_evidence: i32,
    pub admissible: i32,
}

use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, MutexGuard, Once};

const ERR_OK: i32 = 0;
const ERR_UNKNOWN_SERVICE: i32 = 1;
const ERR_DUPLICATE_SERVICE: i32 = 2;
const ERR_NULL_OUTPUT: i32 = 3;
const ERR_INVALID_ARGUMENT: i32 = 4;

const STATUS_FAIL: i32 = 0;
const STATUS_PASS: i32 = 1;

#[derive(Clone)]
struct Attestation {
    status: i32,
    observed_ts: i64,
    valid_until_ts: i64,
}

#[derive(Default)]
struct ServiceRecord {
    dependencies: Vec<i32>,
    attestations: HashMap<i32, Vec<Attestation>>,
    rollouts: HashMap<i32, bool>,
    waivers: HashMap<i32, i64>,
    blocked: bool,
}

struct State {
    services: HashMap<i32, ServiceRecord>,
    last_error: i32,
    // perf: cross-call memo of per-node aggregates, valid only while the query
    // key (env, ts) and the mutation epoch are unchanged.
    epoch: u64,
    memo_env: i32,
    memo_ts: i64,
    memo_epoch: u64,
    memo: HashMap<i32, NodeAgg>,
}

#[derive(Clone, Copy)]
struct NodeAgg {
    blocked_any: bool,
    all_attested: bool,
    any_stale: bool,
    any_conflicting: bool,
    all_admissible: bool,
}

impl NodeAgg {
    fn identity() -> Self {
        NodeAgg { blocked_any: false, all_attested: true, any_stale: false,
                  any_conflicting: false, all_admissible: true }
    }
    fn merge(self, other: NodeAgg) -> Self {
        NodeAgg {
            blocked_any: self.blocked_any || other.blocked_any,
            all_attested: self.all_attested && other.all_attested,
            any_stale: self.any_stale || other.any_stale,
            any_conflicting: self.any_conflicting || other.any_conflicting,
            all_admissible: self.all_admissible && other.all_admissible,
        }
    }
}

fn node_agg(
    services: &HashMap<i32, ServiceRecord>,
    memo: &mut HashMap<i32, NodeAgg>,
    inprog: &mut HashSet<i32>,
    id: i32,
    environment_id: i32,
    ts: i64,
) -> (NodeAgg, bool) {
    // returns (aggregate, tainted). "tainted" means the result was computed
    // through a cycle short-circuit, so it must NOT be cached: the value depends
    // on the traversal entry point, exactly as in the original per-call code.
    if let Some(a) = memo.get(&id) {
        return (*a, false);
    }
    if !inprog.insert(id) {
        return (NodeAgg::identity(), true);
    }
    let mut tainted = false;
    let agg = match services.get(&id) {
        None => NodeAgg::identity(),
        Some(service) => {
            let local = evaluate_node(service, environment_id, ts);
            let mut acc = NodeAgg {
                blocked_any: local.blocked_direct,
                all_attested: local.attested,
                any_stale: local.stale_attestation,
                any_conflicting: local.conflicting_evidence,
                all_admissible: local.locally_admissible,
            };
            for dep in &service.dependencies {
                let (sub, sub_tainted) =
                    node_agg(services, memo, inprog, *dep, environment_id, ts);
                acc = acc.merge(sub);
                tainted = tainted || sub_tainted;
            }
            acc
        }
    };
    inprog.remove(&id);
    if !tainted {
        memo.insert(id, agg);
    }
    (agg, tainted)
}

impl State {
    fn new() -> Self {
        Self {
            services: HashMap::new(),
            last_error: ERR_OK,
            epoch: 1,
            memo_env: 0,
            memo_ts: 0,
            memo_epoch: 0,
            memo: HashMap::new(),
        }
    }
}

#[derive(Clone, Copy)]
struct NodeStatus {
    rollout_enabled: bool,
    waiver_active: bool,
    blocked_direct: bool,
    attested: bool,
    stale_attestation: bool,
    conflicting_evidence: bool,
    active_failure: bool,
    locally_admissible: bool,
}

struct Evaluation {
    root: NodeStatus,
    blocked_transitive: bool,
    all_attested: bool,
    any_stale_attestation: bool,
    any_conflicting_evidence: bool,
    all_nodes_locally_admissible: bool,
}

fn state_cell() -> &'static Mutex<State> {
    static INIT: Once = Once::new();
    static mut STATE: *const Mutex<State> = std::ptr::null();
    unsafe {
        INIT.call_once(|| {
            STATE = Box::into_raw(Box::new(Mutex::new(State::new())));
        });
        &*STATE
    }
}

fn lock_state() -> MutexGuard<'static, State> {
    state_cell()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn bool_to_i32(value: bool) -> i32 {
    if value {
        1
    } else {
        0
    }
}

fn valid_service_id(service_id: i32) -> bool {
    service_id >= 0
}

fn valid_environment_id(environment_id: i32) -> bool {
    environment_id >= 0
}

fn empty_view(exists: bool) -> GateAuditView {
    GateAuditView {
        exists: bool_to_i32(exists),
        rollout_enabled: 0,
        attested: 0,
        waiver_active: 0,
        blocked_direct: 0,
        blocked_transitive: 0,
        stale_attestation: 0,
        conflicting_evidence: 0,
        admissible: 0,
    }
}

fn evaluate_node(service: &ServiceRecord, environment_id: i32, ts: i64) -> NodeStatus {
    let rollout_enabled = service
        .rollouts
        .get(&environment_id)
        .copied()
        .unwrap_or(false);
    let waiver_active = service
        .waivers
        .get(&environment_id)
        .copied()
        .is_some_and(|valid_until_ts| ts < valid_until_ts);

    let mut attested = false;
    let mut active_failure = false;
    let mut expired_evidence = false;

    if let Some(attestations) = service.attestations.get(&environment_id) {
        for attestation in attestations {
            if attestation.observed_ts > ts {
                continue;
            }

            if ts < attestation.valid_until_ts {
                if attestation.status == STATUS_PASS {
                    attested = true;
                } else if attestation.status == STATUS_FAIL {
                    active_failure = true;
                }
            } else {
                expired_evidence = true;
            }
        }
    }

    let conflicting_evidence = attested && active_failure;
    let stale_attestation = !attested && expired_evidence;
    let blocked_direct = service.blocked;
    let locally_admissible = !blocked_direct
        && rollout_enabled
        && !conflicting_evidence
        && !active_failure
        && (attested || waiver_active);

    NodeStatus {
        rollout_enabled,
        waiver_active,
        blocked_direct,
        attested,
        stale_attestation,
        conflicting_evidence,
        active_failure,
        locally_admissible,
    }
}

fn evaluate_service(state: &mut State, service_id: i32, environment_id: i32, ts: i64) -> Evaluation {
    if state.memo_env != environment_id || state.memo_ts != ts || state.memo_epoch != state.epoch {
        state.memo.clear();
        state.memo_env = environment_id;
        state.memo_ts = ts;
        state.memo_epoch = state.epoch;
    }
    let State { services, memo, .. } = state;

    let root_status = match services.get(&service_id) {
        Some(service) => evaluate_node(service, environment_id, ts),
        None => NodeStatus {
            rollout_enabled: false, waiver_active: false, blocked_direct: false,
            attested: false, stale_attestation: false, conflicting_evidence: false,
            active_failure: false, locally_admissible: false,
        },
    };

    let mut deps_agg = NodeAgg::identity();
    if let Some(service) = services.get(&service_id) {
        let mut inprog: HashSet<i32> = HashSet::new();
        inprog.insert(service_id);
        for dep in &service.dependencies {
            let (sub, _) = node_agg(services, memo, &mut inprog, *dep, environment_id, ts);
            deps_agg = deps_agg.merge(sub);
        }
    }

    let mut all_attested = root_status.attested && deps_agg.all_attested;
    if root_status.active_failure { all_attested = false; }

    Evaluation {
        root: root_status,
        blocked_transitive: deps_agg.blocked_any,
        all_attested,
        any_stale_attestation: root_status.stale_attestation || deps_agg.any_stale,
        any_conflicting_evidence: root_status.conflicting_evidence || deps_agg.any_conflicting,
        all_nodes_locally_admissible: root_status.locally_admissible && deps_agg.all_admissible,
    }
}

#[no_mangle]
pub extern "C" fn gate_reset() {
    let mut state = lock_state();
    state.epoch += 1;
    state.memo_epoch = 0;
    *state = State::new();
}

#[no_mangle]
pub extern "C" fn gate_register_service(service_id: i32) -> i32 {
    let mut state = lock_state();
    state.epoch += 1;
    state.memo_epoch = 0;
    if !valid_service_id(service_id) {
        state.last_error = ERR_INVALID_ARGUMENT;
        return 0;
    }
    if state.services.contains_key(&service_id) {
        state.last_error = ERR_DUPLICATE_SERVICE;
        return 0;
    }

    state.services.insert(service_id, ServiceRecord::default());
    state.last_error = ERR_OK;
    1
}

#[no_mangle]
pub extern "C" fn gate_set_dependency(service_id: i32, dependency_id: i32) -> i32 {
    let mut state = lock_state();
    state.epoch += 1;
    state.memo_epoch = 0;
    if !valid_service_id(service_id) || !valid_service_id(dependency_id) {
        state.last_error = ERR_INVALID_ARGUMENT;
        return 0;
    }
    if !state.services.contains_key(&service_id) || !state.services.contains_key(&dependency_id) {
        state.last_error = ERR_UNKNOWN_SERVICE;
        return 0;
    }

    let dependencies = &mut state
        .services
        .get_mut(&service_id)
        .expect("service existence already checked")
        .dependencies;
    if !dependencies.contains(&dependency_id) {
        dependencies.push(dependency_id);
    }

    state.last_error = ERR_OK;
    1
}

#[no_mangle]
pub extern "C" fn gate_report_attestation(
    service_id: i32,
    environment_id: i32,
    status: i32,
    observed_ts: i64,
    valid_until_ts: i64,
) -> i32 {
    let mut state = lock_state();
    state.epoch += 1;
    state.memo_epoch = 0;
    if !valid_service_id(service_id) || !valid_environment_id(environment_id) {
        state.last_error = ERR_INVALID_ARGUMENT;
        return 0;
    }
    if !state.services.contains_key(&service_id) {
        state.last_error = ERR_UNKNOWN_SERVICE;
        return 0;
    }
    if observed_ts < 0 || valid_until_ts < observed_ts {
        state.last_error = ERR_INVALID_ARGUMENT;
        return 0;
    }
    if status != STATUS_FAIL && status != STATUS_PASS {
        state.last_error = ERR_INVALID_ARGUMENT;
        return 0;
    }

    let attestation = Attestation {
        status,
        observed_ts,
        valid_until_ts,
    };
    state
        .services
        .get_mut(&service_id)
        .expect("service existence already checked")
        .attestations
        .entry(environment_id)
        .or_default()
        .push(attestation);

    state.last_error = ERR_OK;
    1
}

#[no_mangle]
pub extern "C" fn gate_set_environment_rollout(
    service_id: i32,
    environment_id: i32,
    enabled: i32,
) -> i32 {
    let mut state = lock_state();
    state.epoch += 1;
    state.memo_epoch = 0;
    if !valid_service_id(service_id) || !valid_environment_id(environment_id) {
        state.last_error = ERR_INVALID_ARGUMENT;
        return 0;
    }
    if !state.services.contains_key(&service_id) {
        state.last_error = ERR_UNKNOWN_SERVICE;
        return 0;
    }

    state
        .services
        .get_mut(&service_id)
        .expect("service existence already checked")
        .rollouts
        .insert(environment_id, enabled != 0);

    state.last_error = ERR_OK;
    1
}

#[no_mangle]
pub extern "C" fn gate_add_waiver(
    service_id: i32,
    environment_id: i32,
    valid_until_ts: i64,
) -> i32 {
    let mut state = lock_state();
    state.epoch += 1;
    state.memo_epoch = 0;
    if !valid_service_id(service_id) || !valid_environment_id(environment_id) {
        state.last_error = ERR_INVALID_ARGUMENT;
        return 0;
    }
    if !state.services.contains_key(&service_id) {
        state.last_error = ERR_UNKNOWN_SERVICE;
        return 0;
    }
    if valid_until_ts < 0 {
        state.last_error = ERR_INVALID_ARGUMENT;
        return 0;
    }

    state
        .services
        .get_mut(&service_id)
        .expect("service existence already checked")
        .waivers
        .insert(environment_id, valid_until_ts);

    state.last_error = ERR_OK;
    1
}

#[no_mangle]
pub extern "C" fn gate_block_service(service_id: i32, blocked: i32) -> i32 {
    let mut state = lock_state();
    state.epoch += 1;
    state.memo_epoch = 0;
    if !valid_service_id(service_id) {
        state.last_error = ERR_INVALID_ARGUMENT;
        return 0;
    }
    if !state.services.contains_key(&service_id) {
        state.last_error = ERR_UNKNOWN_SERVICE;
        return 0;
    }

    state
        .services
        .get_mut(&service_id)
        .expect("service existence already checked")
        .blocked = blocked != 0;

    state.last_error = ERR_OK;
    1
}

#[no_mangle]
pub extern "C" fn gate_check_admission(service_id: i32, environment_id: i32, ts: i64) -> i32 {
    let mut state = lock_state();
    if !valid_service_id(service_id) || !valid_environment_id(environment_id) || ts < 0 {
        state.last_error = ERR_INVALID_ARGUMENT;
        return 0;
    }
    if !state.services.contains_key(&service_id) {
        state.last_error = ERR_UNKNOWN_SERVICE;
        return 0;
    }

    let evaluation = evaluate_service(&mut state, service_id, environment_id, ts);
    state.last_error = ERR_OK;
    bool_to_i32(evaluation.all_nodes_locally_admissible)
}

#[no_mangle]
pub extern "C" fn gate_audit_get(
    service_id: i32,
    environment_id: i32,
    ts: i64,
    out_view: *mut GateAuditView,
) -> i32 {
    if out_view.is_null() {
        let mut state = lock_state();
        state.last_error = ERR_NULL_OUTPUT;
        return 0;
    }

    let mut state = lock_state();
    if !valid_service_id(service_id) || !valid_environment_id(environment_id) || ts < 0 {
        state.last_error = ERR_INVALID_ARGUMENT;
        unsafe {
            out_view.write(empty_view(false));
        }
        return 0;
    }
    if !state.services.contains_key(&service_id) {
        state.last_error = ERR_UNKNOWN_SERVICE;
        unsafe {
            out_view.write(empty_view(false));
        }
        return 0;
    }

    let evaluation = evaluate_service(&mut state, service_id, environment_id, ts);
    let view = GateAuditView {
        exists: 1,
        rollout_enabled: bool_to_i32(evaluation.root.rollout_enabled),
        attested: bool_to_i32(evaluation.all_attested),
        waiver_active: bool_to_i32(evaluation.root.waiver_active),
        blocked_direct: bool_to_i32(evaluation.root.blocked_direct),
        blocked_transitive: bool_to_i32(evaluation.blocked_transitive),
        stale_attestation: bool_to_i32(evaluation.any_stale_attestation),
        conflicting_evidence: bool_to_i32(evaluation.any_conflicting_evidence),
        admissible: bool_to_i32(evaluation.all_nodes_locally_admissible),
    };

    unsafe {
        out_view.write(view);
    }
    state.last_error = ERR_OK;
    1
}

#[no_mangle]
pub extern "C" fn gate_count_admissible(environment_id: i32, ts: i64) -> i32 {
    let mut state = lock_state();
    if !valid_environment_id(environment_id) || ts < 0 {
        state.last_error = ERR_INVALID_ARGUMENT;
        return -1;
    }

    let service_ids: Vec<i32> = state.services.keys().copied().collect();
    let mut count = 0;
    for service_id in service_ids {
        if evaluate_service(&mut state, service_id, environment_id, ts).all_nodes_locally_admissible {
            count += 1;
        }
    }

    state.last_error = ERR_OK;
    count
}

#[no_mangle]
pub extern "C" fn gate_last_error() -> i32 {
    let state = lock_state();
    state.last_error
}
