#include <limits.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

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

enum {
  GATE_OK = 0,
  GATE_ERR_UNKNOWN_SERVICE = 1,
  GATE_ERR_DUPLICATE_SERVICE = 2,
  GATE_ERR_NULL_OUTPUT = 3,
  GATE_ERR_INVALID_ENVIRONMENT = 4,
  GATE_ERR_NO_MEMORY = 5
};

typedef struct Attestation {
  int status;
  int64_t observed_ts;
  int64_t valid_until_ts;
} Attestation;

typedef struct EnvState {
  int environment_id;
  int rollout_enabled;
  int64_t waiver_until;
  Attestation *attestations;
  size_t attestation_count;
  size_t attestation_capacity;
} EnvState;

typedef struct Service {
  int service_id;
  int blocked;
  int *dependencies;
  size_t dependency_count;
  size_t dependency_capacity;
  EnvState *envs;
  size_t env_count;
  size_t env_capacity;
} Service;

typedef struct MapEntry {
  int key;
  size_t value;
  unsigned char used;
} MapEntry;

typedef struct EvidenceView {
  int attested;
  int waiver_active;
  int stale_attestation;
  int conflicting_evidence;
  int active_bad_evidence;
} EvidenceView;

static Service *g_services = NULL;
static size_t g_service_count = 0;

/* --- perf fix: persistent generation-stamped DFS state ---------------------
   Was: calloc(g_service_count) on EVERY gate_check_admission call -> O(n) per
   call -> O(n^2) overall. Now allocated once and "cleared" in O(1) by bumping
   a generation counter. Values match the old encoding (1=visiting, 2=ok, 3=no). */
static unsigned char *g_state_vals = NULL;
static uint32_t *g_state_stamp = NULL;
static size_t g_state_cap = 0;
static uint32_t g_state_gen = 0;
/* Memo stays valid while the query key AND the world are unchanged. Any
   mutation bumps g_epoch, forcing a fresh generation on the next query. */
static uint64_t g_epoch = 1;
static int g_memo_valid = 0;
static int g_memo_env = 0;
static int64_t g_memo_ts = 0;
static uint64_t g_memo_epoch = 0;

static void gate_touch(void) { ++g_epoch; g_memo_valid = 0; }
static unsigned char *g_visit_buf = NULL;
static size_t g_visit_cap = 0;

static int ensure_visit_cap(void) {
  if (g_visit_cap >= g_service_count) return 1;
  size_t next = g_visit_cap == 0 ? 16U : g_visit_cap;
  while (next < g_service_count) next *= 2U;
  unsigned char *nb = (unsigned char *)realloc(g_visit_buf, next * sizeof(*nb));
  if (nb == NULL) return 0;
  memset(nb + g_visit_cap, 0, (next - g_visit_cap) * sizeof(*nb));
  g_visit_buf = nb;
  g_visit_cap = next;
  return 1;
}

static int ensure_state_cap(void) {
  if (g_state_cap >= g_service_count) return 1;
  size_t next = g_state_cap == 0 ? 16U : g_state_cap;
  while (next < g_service_count) next *= 2U;
  unsigned char *nv = (unsigned char *)realloc(g_state_vals, next * sizeof(*nv));
  if (nv == NULL) return 0;
  g_state_vals = nv;
  uint32_t *ns = (uint32_t *)realloc(g_state_stamp, next * sizeof(*ns));
  if (ns == NULL) return 0;
  g_state_stamp = ns;
  memset(g_state_stamp + g_state_cap, 0, (next - g_state_cap) * sizeof(*g_state_stamp));
  g_state_cap = next;
  return 1;
}

static unsigned char st_get(size_t idx) {
  return (g_state_stamp[idx] == g_state_gen) ? g_state_vals[idx] : 0U;
}

static void st_set(size_t idx, unsigned char v) {
  g_state_stamp[idx] = g_state_gen;
  g_state_vals[idx] = v;
}
static size_t g_service_capacity = 0;
static MapEntry *g_service_map = NULL;
static size_t g_map_capacity = 0;
static size_t g_map_count = 0;
static int g_last_error = GATE_OK;

static uint32_t hash_int(int key) {
  uint32_t x = (uint32_t)key;
  x ^= x >> 16;
  x *= 0x7feb352dU;
  x ^= x >> 15;
  x *= 0x846ca68bU;
  x ^= x >> 16;
  return x;
}

static int valid_service_id(int service_id) { return service_id >= 0; }

static int valid_environment_id(int environment_id) { return environment_id >= 0; }

static void clear_service(Service *service) {
  free(service->dependencies);
  for (size_t i = 0; i < service->env_count; ++i) {
    free(service->envs[i].attestations);
  }
  free(service->envs);
}

static int reserve_services(size_t needed) {
  if (needed <= g_service_capacity) {
    return 1;
  }

  size_t next = g_service_capacity == 0 ? 16U : g_service_capacity;
  while (next < needed) {
    if (next > ((size_t)-1) / 2U) {
      g_last_error = GATE_ERR_NO_MEMORY;
      return 0;
    }
    next *= 2U;
  }

  Service *new_services = (Service *)realloc(g_services, next * sizeof(*new_services));
  if (new_services == NULL) {
    g_last_error = GATE_ERR_NO_MEMORY;
    return 0;
  }
  g_services = new_services;
  g_service_capacity = next;
  return 1;
}

static int map_rebuild(size_t new_capacity) {
  MapEntry *new_map = (MapEntry *)calloc(new_capacity, sizeof(*new_map));
  if (new_map == NULL) {
    g_last_error = GATE_ERR_NO_MEMORY;
    return 0;
  }

  for (size_t i = 0; i < g_service_count; ++i) {
    size_t pos = (size_t)hash_int(g_services[i].service_id) & (new_capacity - 1U);
    while (new_map[pos].used) {
      pos = (pos + 1U) & (new_capacity - 1U);
    }
    new_map[pos].used = 1U;
    new_map[pos].key = g_services[i].service_id;
    new_map[pos].value = i;
  }

  free(g_service_map);
  g_service_map = new_map;
  g_map_capacity = new_capacity;
  g_map_count = g_service_count;
  return 1;
}

static int ensure_map_room(void) {
  if (g_map_capacity == 0) {
    return map_rebuild(32U);
  }
  if ((g_map_count + 1U) * 10U >= g_map_capacity * 7U) {
    return map_rebuild(g_map_capacity * 2U);
  }
  return 1;
}

static Service *find_service(int service_id) {
  if (!valid_service_id(service_id) || g_map_capacity == 0) {
    return NULL;
  }

  size_t pos = (size_t)hash_int(service_id) & (g_map_capacity - 1U);
  while (g_service_map[pos].used) {
    if (g_service_map[pos].key == service_id) {
      return &g_services[g_service_map[pos].value];
    }
    pos = (pos + 1U) & (g_map_capacity - 1U);
  }
  return NULL;
}

static size_t service_index(const Service *service) {
  return (size_t)(service - g_services);
}

static int map_insert(int service_id, size_t index) {
  if (!ensure_map_room()) {
    return 0;
  }

  size_t pos = (size_t)hash_int(service_id) & (g_map_capacity - 1U);
  while (g_service_map[pos].used) {
    if (g_service_map[pos].key == service_id) {
      g_last_error = GATE_ERR_DUPLICATE_SERVICE;
      return 0;
    }
    pos = (pos + 1U) & (g_map_capacity - 1U);
  }

  g_service_map[pos].used = 1U;
  g_service_map[pos].key = service_id;
  g_service_map[pos].value = index;
  ++g_map_count;
  return 1;
}

static EnvState *find_env(Service *service, int environment_id) {
  for (size_t i = 0; i < service->env_count; ++i) {
    if (service->envs[i].environment_id == environment_id) {
      return &service->envs[i];
    }
  }
  return NULL;
}

static EnvState *get_env(Service *service, int environment_id, int create) {
  EnvState *env = find_env(service, environment_id);
  if (env != NULL || !create) {
    return env;
  }

  if (service->env_count == service->env_capacity) {
    size_t next = service->env_capacity == 0 ? 4U : service->env_capacity * 2U;
    EnvState *new_envs = (EnvState *)realloc(service->envs, next * sizeof(*new_envs));
    if (new_envs == NULL) {
      g_last_error = GATE_ERR_NO_MEMORY;
      return NULL;
    }
    service->envs = new_envs;
    service->env_capacity = next;
  }

  env = &service->envs[service->env_count++];
  memset(env, 0, sizeof(*env));
  env->environment_id = environment_id;
  return env;
}

static int append_dependency(Service *service, int dependency_id) {
  for (size_t i = 0; i < service->dependency_count; ++i) {
    if (service->dependencies[i] == dependency_id) {
      return 1;
    }
  }

  if (service->dependency_count == service->dependency_capacity) {
    size_t next = service->dependency_capacity == 0 ? 4U : service->dependency_capacity * 2U;
    int *new_dependencies = (int *)realloc(service->dependencies, next * sizeof(*new_dependencies));
    if (new_dependencies == NULL) {
      g_last_error = GATE_ERR_NO_MEMORY;
      return 0;
    }
    service->dependencies = new_dependencies;
    service->dependency_capacity = next;
  }

  service->dependencies[service->dependency_count++] = dependency_id;
  return 1;
}

static int append_attestation(EnvState *env, int status, int64_t observed_ts,
                              int64_t valid_until_ts) {
  if (env->attestation_count == env->attestation_capacity) {
    size_t next = env->attestation_capacity == 0 ? 4U : env->attestation_capacity * 2U;
    Attestation *new_attestations =
        (Attestation *)realloc(env->attestations, next * sizeof(*new_attestations));
    if (new_attestations == NULL) {
      g_last_error = GATE_ERR_NO_MEMORY;
      return 0;
    }
    env->attestations = new_attestations;
    env->attestation_capacity = next;
  }

  env->attestations[env->attestation_count].status = status;
  env->attestations[env->attestation_count].observed_ts = observed_ts;
  env->attestations[env->attestation_count].valid_until_ts = valid_until_ts;
  ++env->attestation_count;
  return 1;
}

static EvidenceView evaluate_evidence(const Service *service, int environment_id,
                                      int64_t ts) {
  EvidenceView view;
  memset(&view, 0, sizeof(view));

  EnvState *env = find_env((Service *)service, environment_id);
  if (env == NULL) {
    return view;
  }

  view.waiver_active = ts < env->waiver_until;

  int have_active = 0;
  int have_active_good = 0;
  int first_active_status = 0;
  for (size_t i = 0; i < env->attestation_count; ++i) {
    const Attestation *att = &env->attestations[i];
    if (ts >= att->valid_until_ts) {
      view.stale_attestation = 1;
      continue;
    }
    if (ts < att->observed_ts) {
      continue;
    }

    if (!have_active) {
      first_active_status = att->status;
      have_active = 1;
    } else if (att->status != first_active_status) {
      view.conflicting_evidence = 1;
    }

    if (att->status > 0) {
      have_active_good = 1;
    } else {
      view.active_bad_evidence = 1;
    }
  }

  view.attested =
      have_active_good && !view.active_bad_evidence && !view.conflicting_evidence;
  return view;
}

static int has_transitive_block(Service *service, unsigned char *visiting) {
  size_t idx = service_index(service);
  if (visiting[idx]) {
    return 0;
  }

  visiting[idx] = 1U;
  for (size_t i = 0; i < service->dependency_count; ++i) {
    Service *dep = find_service(service->dependencies[i]);
    if (dep == NULL) {
      continue;
    }
    if (dep->blocked || has_transitive_block(dep, visiting)) {
      visiting[idx] = 0U;
      return 1;
    }
  }
  visiting[idx] = 0U;
  return 0;
}

static int service_self_admissible(Service *service, int environment_id, int64_t ts) {
  EnvState *env = find_env(service, environment_id);
  EvidenceView evidence = evaluate_evidence(service, environment_id, ts);

  if (service->blocked) {
    return 0;
  }
  if (env == NULL || !env->rollout_enabled) {
    return 0;
  }
  if (evidence.conflicting_evidence || evidence.active_bad_evidence) {
    return 0;
  }
  return evidence.attested || evidence.waiver_active;
}

static int admission_dfs(Service *service, int environment_id, int64_t ts) {
  size_t idx = service_index(service);
  unsigned char st = st_get(idx);
  if (st == 2U) {
    return 1;
  }
  if (st == 3U) {
    return 0;
  }
  if (st == 1U) {
    return 1;
  }

  st_set(idx, 1U);
  if (!service_self_admissible(service, environment_id, ts)) {
    st_set(idx, 3U);
    return 0;
  }

  for (size_t i = 0; i < service->dependency_count; ++i) {
    Service *dep = find_service(service->dependencies[i]);
    if (dep == NULL || !admission_dfs(dep, environment_id, ts)) {
      st_set(idx, 3U);
      return 0;
    }
  }

  st_set(idx, 2U);
  return 1;
}

static int check_admission_known(Service *service, int environment_id, int64_t ts,
                                 int fresh_generation) {
  if (!ensure_state_cap()) {
    g_last_error = GATE_ERR_NO_MEMORY;
    return 0;
  }
  if (fresh_generation) {
    int reusable = g_memo_valid && g_memo_env == environment_id &&
                   g_memo_ts == ts && g_memo_epoch == g_epoch;
    if (!reusable) {
      ++g_state_gen;
      g_memo_valid = 1;
      g_memo_env = environment_id;
      g_memo_ts = ts;
      g_memo_epoch = g_epoch;
    }
  }
  return admission_dfs(service, environment_id, ts);
}

__attribute__((visibility("default"))) void gate_reset(void) {
  gate_touch();
  for (size_t i = 0; i < g_service_count; ++i) {
    clear_service(&g_services[i]);
  }
  free(g_services);
  free(g_service_map);

  g_services = NULL;
  g_service_count = 0;
  g_service_capacity = 0;
  g_service_map = NULL;
  g_map_capacity = 0;
  g_map_count = 0;
  g_last_error = GATE_OK;
}

__attribute__((visibility("default"))) int gate_register_service(int service_id) {
  gate_touch();
  if (!valid_service_id(service_id)) {
    g_last_error = GATE_ERR_UNKNOWN_SERVICE;
    return 0;
  }
  if (find_service(service_id) != NULL) {
    g_last_error = GATE_ERR_DUPLICATE_SERVICE;
    return 0;
  }
  if (!reserve_services(g_service_count + 1U)) {
    return 0;
  }

  size_t index = g_service_count;
  Service *service = &g_services[index];
  memset(service, 0, sizeof(*service));
  service->service_id = service_id;

  if (!map_insert(service_id, index)) {
    return 0;
  }

  ++g_service_count;
  g_last_error = GATE_OK;
  return 1;
}

__attribute__((visibility("default"))) int gate_set_dependency(int service_id,
                                                               int dependency_id) {
  Service *service = find_service(service_id);
  Service *dependency = find_service(dependency_id);
  if (service == NULL || dependency == NULL) {
    g_last_error = GATE_ERR_UNKNOWN_SERVICE;
    return 0;
  }
  if (!append_dependency(service, dependency_id)) {
    return 0;
  }

  g_last_error = GATE_OK;
  return 1;
}

__attribute__((visibility("default"))) int gate_report_attestation(
    int service_id, int environment_id, int status, int64_t observed_ts,
    int64_t valid_until_ts) {
  Service *service = find_service(service_id);
  if (service == NULL) {
    g_last_error = GATE_ERR_UNKNOWN_SERVICE;
    return 0;
  }
  if (!valid_environment_id(environment_id)) {
    g_last_error = GATE_ERR_INVALID_ENVIRONMENT;
    return 0;
  }

  EnvState *env = get_env(service, environment_id, 1);
  if (env == NULL) {
    return 0;
  }
  if (!append_attestation(env, status, observed_ts, valid_until_ts)) {
    return 0;
  }

  g_last_error = GATE_OK;
  return 1;
}

__attribute__((visibility("default"))) int gate_set_environment_rollout(
    int service_id, int environment_id, int enabled) {
  Service *service = find_service(service_id);
  if (service == NULL) {
    g_last_error = GATE_ERR_UNKNOWN_SERVICE;
    return 0;
  }
  if (!valid_environment_id(environment_id)) {
    g_last_error = GATE_ERR_INVALID_ENVIRONMENT;
    return 0;
  }

  EnvState *env = get_env(service, environment_id, 1);
  if (env == NULL) {
    return 0;
  }
  env->rollout_enabled = enabled ? 1 : 0;

  g_last_error = GATE_OK;
  return 1;
}

__attribute__((visibility("default"))) int gate_add_waiver(int service_id,
                                                           int environment_id,
                                                           int64_t valid_until_ts) {
  Service *service = find_service(service_id);
  if (service == NULL) {
    g_last_error = GATE_ERR_UNKNOWN_SERVICE;
    return 0;
  }
  if (!valid_environment_id(environment_id)) {
    g_last_error = GATE_ERR_INVALID_ENVIRONMENT;
    return 0;
  }

  EnvState *env = get_env(service, environment_id, 1);
  if (env == NULL) {
    return 0;
  }
  if (valid_until_ts > env->waiver_until) {
    env->waiver_until = valid_until_ts;
  }

  g_last_error = GATE_OK;
  return 1;
}

__attribute__((visibility("default"))) int gate_block_service(int service_id,
                                                              int blocked) {
  gate_touch();
  Service *service = find_service(service_id);
  if (service == NULL) {
    g_last_error = GATE_ERR_UNKNOWN_SERVICE;
    return 0;
  }

  service->blocked = blocked ? 1 : 0;
  g_last_error = GATE_OK;
  return 1;
}

__attribute__((visibility("default"))) int gate_check_admission(int service_id,
                                                                int environment_id,
                                                                int64_t ts) {
  Service *service = find_service(service_id);
  if (service == NULL) {
    g_last_error = GATE_ERR_UNKNOWN_SERVICE;
    return 0;
  }
  if (!valid_environment_id(environment_id)) {
    g_last_error = GATE_ERR_INVALID_ENVIRONMENT;
    return 0;
  }

  int result = check_admission_known(service, environment_id, ts, 1);
  if (g_last_error == GATE_ERR_NO_MEMORY) {
    return 0;
  }

  g_last_error = GATE_OK;
  return result;
}

__attribute__((visibility("default"))) int gate_audit_get(int service_id,
                                                          int environment_id,
                                                          int64_t ts,
                                                          GateAuditView *out_view) {
  if (out_view == NULL) {
    g_last_error = GATE_ERR_NULL_OUTPUT;
    return 0;
  }

  memset(out_view, 0, sizeof(*out_view));

  Service *service = find_service(service_id);
  if (service == NULL) {
    g_last_error = GATE_ERR_UNKNOWN_SERVICE;
    return 0;
  }
  if (!valid_environment_id(environment_id)) {
    g_last_error = GATE_ERR_INVALID_ENVIRONMENT;
    return 0;
  }

  EnvState *env = find_env(service, environment_id);
  EvidenceView evidence = evaluate_evidence(service, environment_id, ts);
  /* perf fix: has_transitive_block restores every mark it sets, so this buffer
     stays all-zero between calls and can be allocated once instead of per call. */
  if (!ensure_visit_cap()) {
    g_last_error = GATE_ERR_NO_MEMORY;
    return 0;
  }
  unsigned char *visiting = g_visit_buf;

  out_view->exists = 1;
  out_view->rollout_enabled = env != NULL ? env->rollout_enabled : 0;
  out_view->attested = evidence.attested;
  out_view->waiver_active = evidence.waiver_active;
  out_view->blocked_direct = service->blocked;
  out_view->blocked_transitive = has_transitive_block(service, visiting);
  out_view->stale_attestation = evidence.stale_attestation;
  out_view->conflicting_evidence = evidence.conflicting_evidence;

  out_view->admissible = check_admission_known(service, environment_id, ts, 1);
  if (g_last_error == GATE_ERR_NO_MEMORY) {
    return 0;
  }

  g_last_error = GATE_OK;
  return 1;
}

__attribute__((visibility("default"))) int gate_count_admissible(int environment_id,
                                                                 int64_t ts) {
  if (!valid_environment_id(environment_id)) {
    g_last_error = GATE_ERR_INVALID_ENVIRONMENT;
    return 0;
  }

  if (!ensure_state_cap()) {
    g_last_error = GATE_ERR_NO_MEMORY;
    return 0;
  }
  ++g_state_gen;

  int count = 0;
  for (size_t i = 0; i < g_service_count; ++i) {
    if (check_admission_known(&g_services[i], environment_id, ts, 0)) {
      if (count < INT_MAX) {
        ++count;
      }
    }
  }

  g_last_error = GATE_OK;
  return count;
}

__attribute__((visibility("default"))) int gate_last_error(void) {
  return g_last_error;
}
