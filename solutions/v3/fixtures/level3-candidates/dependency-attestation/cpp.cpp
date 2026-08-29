#include <algorithm>
#include <cstdint>
#include <mutex>
#include <unordered_map>
#include <unordered_set>
#include <vector>

extern "C" {
typedef struct GateAuditView {
  int exists;
  int rollout_enabled;
  int attested;
  int waiver_active;
  int blocked_direct;
  int blocked_transitive;
  int stale_attestation;
  int conflicting_evidence;
  int admissible;
} GateAuditView;
}

namespace {

constexpr int kOk = 0;
constexpr int kErrUnknownService = 1;
constexpr int kErrDuplicateService = 2;
constexpr int kErrNullOutput = 3;
constexpr int kErrInvalidArgument = 4;

struct Attestation {
  int status = 0;
  int64_t observed_ts = 0;
  int64_t valid_until_ts = 0;
};

struct EnvState {
  int rollout_enabled = 0;
  int64_t waiver_until = 0;
  std::vector<Attestation> attestations;
};

struct Service {
  int blocked = 0;
  std::vector<int> dependencies;
  std::unordered_map<int, EnvState> environments;
};

struct NodeStatus {
  bool rollout_enabled = false;
  bool attested = false;
  bool waiver_active = false;
  bool blocked_direct = false;
  bool stale_attestation = false;
  bool conflicting_evidence = false;
  bool active_bad_evidence = false;
  bool locally_admissible = false;
};

struct Evaluation {
  NodeStatus root;
  bool blocked_transitive = false;
  bool all_attested = true;
  bool any_stale_attestation = false;
  bool any_conflicting_evidence = false;
  bool all_locally_admissible = true;
};

std::mutex g_mutex;
std::unordered_map<int, Service> g_services;
int g_last_error = kOk;

bool valid_service_id(int service_id) { return service_id >= 0; }

bool valid_environment_id(int environment_id) { return environment_id >= 0; }

bool valid_ts(int64_t ts) { return ts >= 0; }

int as_int(bool value) { return value ? 1 : 0; }

GateAuditView empty_view(bool exists) {
  return GateAuditView{as_int(exists), 0, 0, 0, 0, 0, 0, 0, 0};
}

NodeStatus evaluate_node(const Service &service, int environment_id, int64_t ts) {
  NodeStatus status;
  status.blocked_direct = service.blocked != 0;

  const auto env_it = service.environments.find(environment_id);
  if (env_it == service.environments.end()) {
    status.locally_admissible = false;
    return status;
  }

  const EnvState &env = env_it->second;
  status.rollout_enabled = env.rollout_enabled != 0;
  status.waiver_active = ts < env.waiver_until;

  bool active_good = false;
  bool active_bad = false;
  bool has_active_status = false;
  int first_active_status = 0;

  for (const Attestation &attestation : env.attestations) {
    if (attestation.observed_ts > ts) {
      continue;
    }
    if (ts >= attestation.valid_until_ts) {
      status.stale_attestation = true;
      continue;
    }

    if (!has_active_status) {
      first_active_status = attestation.status;
      has_active_status = true;
    } else if (attestation.status != first_active_status) {
      status.conflicting_evidence = true;
    }

    if (attestation.status > 0) {
      active_good = true;
    } else {
      active_bad = true;
    }
  }

  status.active_bad_evidence = active_bad;
  if (active_good && active_bad) {
    status.conflicting_evidence = true;
  }
  status.attested = active_good && !active_bad && !status.conflicting_evidence;
  status.locally_admissible =
      !status.blocked_direct && status.rollout_enabled &&
      !status.conflicting_evidence && !status.active_bad_evidence &&
      (status.attested || status.waiver_active);
  return status;
}

Evaluation evaluate_service(int service_id, int environment_id, int64_t ts) {
  Evaluation evaluation;
  std::vector<int> stack{service_id};
  std::unordered_set<int> visited;

  while (!stack.empty()) {
    const int current_id = stack.back();
    stack.pop_back();
    if (!visited.insert(current_id).second) {
      continue;
    }

    const auto service_it = g_services.find(current_id);
    if (service_it == g_services.end()) {
      evaluation.all_attested = false;
      evaluation.all_locally_admissible = false;
      continue;
    }

    const NodeStatus node =
        evaluate_node(service_it->second, environment_id, ts);
    if (current_id == service_id) {
      evaluation.root = node;
    } else if (node.blocked_direct) {
      evaluation.blocked_transitive = true;
    }

    if (!node.attested) {
      evaluation.all_attested = false;
    }
    if (node.stale_attestation) {
      evaluation.any_stale_attestation = true;
    }
    if (node.conflicting_evidence) {
      evaluation.any_conflicting_evidence = true;
    }
    if (!node.locally_admissible) {
      evaluation.all_locally_admissible = false;
    }

    for (int dependency_id : service_it->second.dependencies) {
      stack.push_back(dependency_id);
    }
  }

  return evaluation;
}

/* perf fix: memo was rebuilt per call, so every query re-walked the whole
   dependency chain (O(n) per call -> O(n^2)). Keep it while the query key and
   the world are unchanged; every mutator bumps g_epoch. */
unsigned long long g_epoch = 1;
std::unordered_map<int, bool> g_memo;
bool g_memo_valid = false;
int g_memo_env = 0;
int64_t g_memo_ts = 0;
unsigned long long g_memo_epoch = 0;
void gate_touch() { ++g_epoch; g_memo_valid = false; }

bool admission_dfs(int service_id, int environment_id, int64_t ts,
                   std::unordered_map<int, bool> &memo,
                   std::unordered_set<int> &visiting) {
  const auto memo_it = memo.find(service_id);
  if (memo_it != memo.end()) {
    return memo_it->second;
  }
  if (!visiting.insert(service_id).second) {
    return true;
  }

  const auto service_it = g_services.find(service_id);
  if (service_it == g_services.end()) {
    visiting.erase(service_id);
    memo[service_id] = false;
    return false;
  }

  bool admitted =
      evaluate_node(service_it->second, environment_id, ts).locally_admissible;
  if (admitted) {
    for (int dependency_id : service_it->second.dependencies) {
      if (!admission_dfs(dependency_id, environment_id, ts, memo, visiting)) {
        admitted = false;
        break;
      }
    }
  }

  visiting.erase(service_id);
  memo[service_id] = admitted;
  return admitted;
}

bool check_admission_known(int service_id, int environment_id, int64_t ts) {
  if (!g_memo_valid || g_memo_env != environment_id || g_memo_ts != ts ||
      g_memo_epoch != g_epoch) {
    g_memo.clear();
    g_memo_valid = true;
    g_memo_env = environment_id;
    g_memo_ts = ts;
    g_memo_epoch = g_epoch;
  }
  std::unordered_set<int> visiting;
  return admission_dfs(service_id, environment_id, ts, g_memo, visiting);
}

}  // namespace

#define GATE_EXPORT extern "C" __attribute__((visibility("default")))

GATE_EXPORT void gate_reset(void) {
  std::lock_guard<std::mutex> lock(g_mutex);
  gate_touch();
  g_services.clear();
  g_last_error = kOk;
}

GATE_EXPORT int gate_register_service(int service_id) {
  std::lock_guard<std::mutex> lock(g_mutex);
  gate_touch();
  if (!valid_service_id(service_id)) {
    g_last_error = kErrInvalidArgument;
    return 0;
  }
  if (g_services.find(service_id) != g_services.end()) {
    g_last_error = kErrDuplicateService;
    return 0;
  }

  g_services.emplace(service_id, Service{});
  g_last_error = kOk;
  return 1;
}

GATE_EXPORT int gate_set_dependency(int service_id, int dependency_id) {
  std::lock_guard<std::mutex> lock(g_mutex);
  gate_touch();
  if (!valid_service_id(service_id) || !valid_service_id(dependency_id)) {
    g_last_error = kErrInvalidArgument;
    return 0;
  }

  const auto service_it = g_services.find(service_id);
  if (service_it == g_services.end() ||
      g_services.find(dependency_id) == g_services.end()) {
    g_last_error = kErrUnknownService;
    return 0;
  }

  std::vector<int> &dependencies = service_it->second.dependencies;
  if (std::find(dependencies.begin(), dependencies.end(), dependency_id) ==
      dependencies.end()) {
    dependencies.push_back(dependency_id);
  }
  g_last_error = kOk;
  return 1;
}

GATE_EXPORT int gate_report_attestation(int service_id, int environment_id,
                                        int status, int64_t observed_ts,
                                        int64_t valid_until_ts) {
  std::lock_guard<std::mutex> lock(g_mutex);
  gate_touch();
  if (!valid_service_id(service_id) || !valid_environment_id(environment_id) ||
      !valid_ts(observed_ts) || valid_until_ts < observed_ts) {
    g_last_error = kErrInvalidArgument;
    return 0;
  }

  const auto service_it = g_services.find(service_id);
  if (service_it == g_services.end()) {
    g_last_error = kErrUnknownService;
    return 0;
  }

  EnvState &env = service_it->second.environments[environment_id];
  env.attestations.push_back(Attestation{status, observed_ts, valid_until_ts});
  g_last_error = kOk;
  return 1;
}

GATE_EXPORT int gate_set_environment_rollout(int service_id, int environment_id,
                                             int enabled) {
  std::lock_guard<std::mutex> lock(g_mutex);
  gate_touch();
  if (!valid_service_id(service_id) || !valid_environment_id(environment_id)) {
    g_last_error = kErrInvalidArgument;
    return 0;
  }

  const auto service_it = g_services.find(service_id);
  if (service_it == g_services.end()) {
    g_last_error = kErrUnknownService;
    return 0;
  }

  service_it->second.environments[environment_id].rollout_enabled =
      enabled ? 1 : 0;
  g_last_error = kOk;
  return 1;
}

GATE_EXPORT int gate_add_waiver(int service_id, int environment_id,
                                int64_t valid_until_ts) {
  std::lock_guard<std::mutex> lock(g_mutex);
  gate_touch();
  if (!valid_service_id(service_id) || !valid_environment_id(environment_id) ||
      !valid_ts(valid_until_ts)) {
    g_last_error = kErrInvalidArgument;
    return 0;
  }

  const auto service_it = g_services.find(service_id);
  if (service_it == g_services.end()) {
    g_last_error = kErrUnknownService;
    return 0;
  }

  EnvState &env = service_it->second.environments[environment_id];
  env.waiver_until = std::max(env.waiver_until, valid_until_ts);
  g_last_error = kOk;
  return 1;
}

GATE_EXPORT int gate_block_service(int service_id, int blocked) {
  std::lock_guard<std::mutex> lock(g_mutex);
  gate_touch();
  if (!valid_service_id(service_id)) {
    g_last_error = kErrInvalidArgument;
    return 0;
  }

  const auto service_it = g_services.find(service_id);
  if (service_it == g_services.end()) {
    g_last_error = kErrUnknownService;
    return 0;
  }

  service_it->second.blocked = blocked ? 1 : 0;
  g_last_error = kOk;
  return 1;
}

GATE_EXPORT int gate_check_admission(int service_id, int environment_id,
                                     int64_t ts) {
  std::lock_guard<std::mutex> lock(g_mutex);
  if (!valid_service_id(service_id) || !valid_environment_id(environment_id) ||
      !valid_ts(ts)) {
    g_last_error = kErrInvalidArgument;
    return 0;
  }
  if (g_services.find(service_id) == g_services.end()) {
    g_last_error = kErrUnknownService;
    return 0;
  }

  const bool admitted = check_admission_known(service_id, environment_id, ts);
  g_last_error = kOk;
  return as_int(admitted);
}

GATE_EXPORT int gate_audit_get(int service_id, int environment_id, int64_t ts,
                               GateAuditView *out_view) {
  std::lock_guard<std::mutex> lock(g_mutex);
  if (out_view == nullptr) {
    g_last_error = kErrNullOutput;
    return 0;
  }
  *out_view = empty_view(false);

  if (!valid_service_id(service_id) || !valid_environment_id(environment_id) ||
      !valid_ts(ts)) {
    g_last_error = kErrInvalidArgument;
    return 0;
  }
  if (g_services.find(service_id) == g_services.end()) {
    g_last_error = kErrUnknownService;
    return 0;
  }

  const Evaluation evaluation = evaluate_service(service_id, environment_id, ts);
  *out_view = GateAuditView{
      1,
      as_int(evaluation.root.rollout_enabled),
      as_int(evaluation.all_attested),
      as_int(evaluation.root.waiver_active),
      as_int(evaluation.root.blocked_direct),
      as_int(evaluation.blocked_transitive),
      as_int(evaluation.any_stale_attestation),
      as_int(evaluation.any_conflicting_evidence),
      as_int(evaluation.all_locally_admissible),
  };
  g_last_error = kOk;
  return 1;
}

GATE_EXPORT int gate_count_admissible(int environment_id, int64_t ts) {
  std::lock_guard<std::mutex> lock(g_mutex);
  if (!valid_environment_id(environment_id) || !valid_ts(ts)) {
    g_last_error = kErrInvalidArgument;
    return 0;
  }

  std::unordered_map<int, bool> memo;
  int count = 0;
  for (const auto &entry : g_services) {
    std::unordered_set<int> visiting;
    if (admission_dfs(entry.first, environment_id, ts, memo, visiting)) {
      ++count;
    }
  }

  g_last_error = kOk;
  return count;
}

GATE_EXPORT int gate_last_error(void) {
  std::lock_guard<std::mutex> lock(g_mutex);
  return g_last_error;
}
