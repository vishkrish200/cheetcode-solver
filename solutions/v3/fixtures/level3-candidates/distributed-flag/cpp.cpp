#include <cstdint>
#include <cstring>
#include <new>

extern "C" {

typedef struct FlagEvalView {
  int exists;
  int environment_id;
  int decided_version;
  int matched_snapshot_id;
  int matched_rule_id;
  int decided_variant_id;
  int fallback_used;
  int tombstone_blocked;
  int stale_active_seen;
  int disabled_active_seen;
  int prerequisite_failed;
  int off_by_targeting;
  int usable;
} FlagEvalView;

}  // extern "C"

namespace {

enum {
  ERR_NONE = 0,
  ERR_DUP_FLAG = 1,
  ERR_DUP_SNAPSHOT = 2,
  ERR_DUP_TOMBSTONE = 3,
  ERR_UNKNOWN_FLAG = 4,
  ERR_UNKNOWN_SNAPSHOT = 5,
  ERR_INVALID_ROLLOUT = 6,
  ERR_UNKNOWN_ENV_BINDING = 7,
  ERR_UNKNOWN_PREREQUISITE_FLAG = 8,
  ERR_PREREQUISITE_CYCLE = 9,
  ERR_NULL_EXPLAIN_POINTER = 10,
  ERR_NO_STAGED_VERSION = 11,
  ERR_UNKNOWN_VERSION = 12,
  ERR_ALLOCATION = 13
};

struct Prerequisite {
  int prerequisite_flag_id = 0;
  int required_variant_id = 0;
  Prerequisite *next = nullptr;
};

struct VersionState {
  int version = 0;
  int stale = 0;
  VersionState *next = nullptr;
};

struct EnvironmentBinding {
  int environment_id = 0;
  int active_version = 0;
  int staged_version = 0;
  int fallback_version = 0;
  VersionState *versions = nullptr;
  EnvironmentBinding *next = nullptr;
};

struct Flag {
  int flag_id = 0;
  int default_variant_id = 0;
  int off_variant_id = 0;
  Prerequisite *prerequisites = nullptr;
  EnvironmentBinding *environments = nullptr;
  Flag *next = nullptr;
};

struct Snapshot {
  int snapshot_id = 0;
  int flag_id = 0;
  int environment_id = 0;
  int version = 0;
  int rule_id = 0;
  int segment_id = 0;
  int priority = 0;
  int variant_id = 0;
  int rollout_percent = 0;
  int track_events = 0;
  int64_t not_before_ts = 0;
  int64_t expires_ts = 0;
  int disabled = 0;
  int retired = 0;
  Snapshot *next = nullptr;
};

struct Tombstone {
  int tombstone_id = 0;
  int flag_id = 0;
  int environment_id = 0;
  int version = 0;
  int64_t not_before_ts = 0;
  int64_t expires_ts = 0;
  Tombstone *next = nullptr;
};

struct SegmentMembership {
  int subject_id = 0;
  int segment_id = 0;
  int member = 0;
  SegmentMembership *next = nullptr;
};

int g_last_error = ERR_NONE;
Flag *g_flags = nullptr;
Snapshot *g_snapshots = nullptr;
Tombstone *g_tombstones = nullptr;
SegmentMembership *g_memberships = nullptr;

void set_error(int code) { g_last_error = code; }

template <typename T>
T *allocate_node() {
  return new (std::nothrow) T();
}

Flag *find_flag(int flag_id) {
  for (Flag *flag = g_flags; flag != nullptr; flag = flag->next) {
    if (flag->flag_id == flag_id) {
      return flag;
    }
  }
  return nullptr;
}

Snapshot *find_snapshot(int snapshot_id) {
  for (Snapshot *snapshot = g_snapshots; snapshot != nullptr;
       snapshot = snapshot->next) {
    if (snapshot->snapshot_id == snapshot_id) {
      return snapshot;
    }
  }
  return nullptr;
}

Tombstone *find_tombstone(int tombstone_id) {
  for (Tombstone *tombstone = g_tombstones; tombstone != nullptr;
       tombstone = tombstone->next) {
    if (tombstone->tombstone_id == tombstone_id) {
      return tombstone;
    }
  }
  return nullptr;
}

EnvironmentBinding *find_environment_binding(Flag *flag, int environment_id) {
  for (EnvironmentBinding *binding = flag->environments; binding != nullptr;
       binding = binding->next) {
    if (binding->environment_id == environment_id) {
      return binding;
    }
  }
  return nullptr;
}

VersionState *find_version_state(EnvironmentBinding *binding, int version) {
  for (VersionState *state = binding->versions; state != nullptr;
       state = state->next) {
    if (state->version == version) {
      return state;
    }
  }
  return nullptr;
}

EnvironmentBinding *ensure_environment_binding(Flag *flag, int environment_id) {
  EnvironmentBinding *binding = find_environment_binding(flag, environment_id);
  if (binding != nullptr) {
    return binding;
  }

  binding = allocate_node<EnvironmentBinding>();
  if (binding == nullptr) {
    set_error(ERR_ALLOCATION);
    return nullptr;
  }
  binding->environment_id = environment_id;
  binding->next = flag->environments;
  flag->environments = binding;
  return binding;
}

VersionState *ensure_version_state(EnvironmentBinding *binding, int version) {
  if (version == 0) {
    return nullptr;
  }

  VersionState *state = find_version_state(binding, version);
  if (state != nullptr) {
    return state;
  }

  state = allocate_node<VersionState>();
  if (state == nullptr) {
    set_error(ERR_ALLOCATION);
    return nullptr;
  }
  state->version = version;
  state->next = binding->versions;
  binding->versions = state;
  return state;
}

bool version_is_known(int flag_id, int environment_id, int version) {
  if (version == 0) {
    return true;
  }

  Flag *flag = find_flag(flag_id);
  if (flag == nullptr) {
    return false;
  }

  EnvironmentBinding *binding =
      find_environment_binding(flag, environment_id);
  if (binding != nullptr && find_version_state(binding, version) != nullptr) {
    return true;
  }

  for (Snapshot *snapshot = g_snapshots; snapshot != nullptr;
       snapshot = snapshot->next) {
    if (snapshot->flag_id == flag_id &&
        snapshot->environment_id == environment_id &&
        snapshot->version == version) {
      return true;
    }
  }

  for (Tombstone *tombstone = g_tombstones; tombstone != nullptr;
       tombstone = tombstone->next) {
    if (tombstone->flag_id == flag_id &&
        tombstone->environment_id == environment_id &&
        tombstone->version == version) {
      return true;
    }
  }

  return false;
}

bool segment_is_member(int subject_id, int segment_id) {
  if (segment_id == 0) {
    return true;
  }

  for (SegmentMembership *membership = g_memberships; membership != nullptr;
       membership = membership->next) {
    if (membership->subject_id == subject_id &&
        membership->segment_id == segment_id) {
      return membership->member != 0;
    }
  }

  return false;
}

bool snapshot_time_usable(const Snapshot *snapshot, int64_t ts) {
  return ts >= snapshot->not_before_ts && ts < snapshot->expires_ts;
}

bool snapshot_live(const Snapshot *snapshot, int64_t ts) {
  return snapshot_time_usable(snapshot, ts) && snapshot->disabled == 0 &&
         snapshot->retired == 0;
}

bool tombstone_active(const Tombstone *tombstone, int64_t ts) {
  return ts >= tombstone->not_before_ts && ts < tombstone->expires_ts;
}

bool version_is_tombstoned(int flag_id, int environment_id, int version,
                           int64_t ts) {
  for (Tombstone *tombstone = g_tombstones; tombstone != nullptr;
       tombstone = tombstone->next) {
    if (tombstone->flag_id == flag_id &&
        tombstone->environment_id == environment_id &&
        tombstone->version == version && tombstone_active(tombstone, ts)) {
      return true;
    }
  }

  return false;
}

bool version_is_stale(EnvironmentBinding *binding, int version) {
  if (binding == nullptr || version == 0) {
    return false;
  }

  VersionState *state = find_version_state(binding, version);
  return state != nullptr && state->stale != 0;
}

bool version_has_live_snapshot(int flag_id, int environment_id, int version,
                               int64_t ts) {
  for (Snapshot *snapshot = g_snapshots; snapshot != nullptr;
       snapshot = snapshot->next) {
    if (snapshot->flag_id == flag_id &&
        snapshot->environment_id == environment_id &&
        snapshot->version == version && snapshot_live(snapshot, ts)) {
      return true;
    }
  }

  return false;
}

bool version_has_disabled_match(int flag_id, int environment_id, int version,
                                int subject_id, int subject_bucket,
                                int64_t ts) {
  for (Snapshot *snapshot = g_snapshots; snapshot != nullptr;
       snapshot = snapshot->next) {
    if (snapshot->flag_id == flag_id &&
        snapshot->environment_id == environment_id &&
        snapshot->version == version && snapshot->disabled != 0 &&
        snapshot->retired == 0 && snapshot_time_usable(snapshot, ts) &&
        segment_is_member(subject_id, snapshot->segment_id) &&
        subject_bucket < snapshot->rollout_percent) {
      return true;
    }
  }

  return false;
}

Snapshot *select_best_snapshot(int flag_id, int environment_id, int version,
                               int subject_id, int subject_bucket,
                               int64_t ts) {
  Snapshot *best = nullptr;

  for (Snapshot *snapshot = g_snapshots; snapshot != nullptr;
       snapshot = snapshot->next) {
    if (snapshot->flag_id != flag_id ||
        snapshot->environment_id != environment_id ||
        snapshot->version != version) {
      continue;
    }
    if (!snapshot_live(snapshot, ts)) {
      continue;
    }
    if (!segment_is_member(subject_id, snapshot->segment_id)) {
      continue;
    }
    if (subject_bucket >= snapshot->rollout_percent) {
      continue;
    }

    if (best == nullptr) {
      best = snapshot;
      continue;
    }

    if (snapshot->priority > best->priority) {
      best = snapshot;
      continue;
    }
    if (snapshot->priority < best->priority) {
      continue;
    }

    const bool snapshot_specific = snapshot->segment_id != 0;
    const bool best_specific = best->segment_id != 0;
    if (snapshot_specific != best_specific) {
      if (snapshot_specific) {
        best = snapshot;
      }
      continue;
    }

    if (snapshot->rule_id < best->rule_id) {
      best = snapshot;
      continue;
    }
    if (snapshot->rule_id > best->rule_id) {
      continue;
    }

    if (snapshot->snapshot_id < best->snapshot_id) {
      best = snapshot;
    }
  }

  return best;
}

bool prerequisite_path_exists(int current_flag_id, int target_flag_id) {
  if (current_flag_id == target_flag_id) {
    return true;
  }

  Flag *flag = find_flag(current_flag_id);
  if (flag == nullptr) {
    return false;
  }

  for (Prerequisite *edge = flag->prerequisites; edge != nullptr;
       edge = edge->next) {
    if (prerequisite_path_exists(edge->prerequisite_flag_id, target_flag_id)) {
      return true;
    }
  }

  return false;
}

bool choose_version(Flag *flag, EnvironmentBinding *binding, int environment_id,
                    int subject_id, int subject_bucket, int64_t ts,
                    int *chosen_version, int *fallback_used,
                    int *tombstone_blocked, int *stale_active_seen,
                    int *disabled_active_seen) {
  *chosen_version = 0;
  *fallback_used = 0;
  *tombstone_blocked = 0;
  *stale_active_seen = 0;
  *disabled_active_seen = 0;

  if (binding == nullptr) {
    return true;
  }

  const int active_version = binding->active_version;
  const int fallback_version = binding->fallback_version;
  bool active_readable = false;
  bool fallback_readable = false;

  if (active_version != 0) {
    if (version_has_disabled_match(flag->flag_id, environment_id,
                                   active_version, subject_id, subject_bucket,
                                   ts)) {
      *disabled_active_seen = 1;
    }
    if (version_is_tombstoned(flag->flag_id, environment_id, active_version,
                              ts)) {
      *tombstone_blocked = 1;
    } else if (version_is_stale(binding, active_version)) {
      *stale_active_seen = 1;
    } else if (version_has_live_snapshot(flag->flag_id, environment_id,
                                         active_version, ts)) {
      active_readable = true;
    }
  }

  if (active_readable) {
    *chosen_version = active_version;
    return true;
  }

  if (fallback_version != 0) {
    if (version_is_tombstoned(flag->flag_id, environment_id, fallback_version,
                              ts)) {
      *tombstone_blocked = 1;
    } else if (!version_is_stale(binding, fallback_version) &&
               version_has_live_snapshot(flag->flag_id, environment_id,
                                         fallback_version, ts)) {
      fallback_readable = true;
    }
  }

  if (fallback_readable) {
    *chosen_version = fallback_version;
    *fallback_used = 1;
  }

  return true;
}

bool evaluate_internal(int flag_id, int environment_id, int subject_id,
                       int subject_bucket, int64_t ts, int *out_variant,
                       FlagEvalView *out_view) {
  Flag *flag = find_flag(flag_id);
  if (flag == nullptr) {
    set_error(ERR_UNKNOWN_FLAG);
    return false;
  }

  if (out_view != nullptr) {
    std::memset(out_view, 0, sizeof(*out_view));
    out_view->exists = 1;
    out_view->environment_id = environment_id;
  }

  EnvironmentBinding *binding = find_environment_binding(flag, environment_id);
  int chosen_version = 0;
  int fallback_used = 0;
  int tombstone_blocked = 0;
  int stale_active_seen = 0;
  int disabled_active_seen = 0;
  if (!choose_version(flag, binding, environment_id, subject_id, subject_bucket,
                      ts, &chosen_version, &fallback_used,
                      &tombstone_blocked, &stale_active_seen,
                      &disabled_active_seen)) {
    return false;
  }

  if (chosen_version == 0) {
    const int decided_variant = flag->off_variant_id;
    *out_variant = decided_variant;
    if (out_view != nullptr) {
      out_view->decided_variant_id = decided_variant;
      out_view->fallback_used = 0;
      out_view->tombstone_blocked = tombstone_blocked;
      out_view->stale_active_seen = stale_active_seen;
      out_view->disabled_active_seen = disabled_active_seen;
      out_view->usable = 0;
    }
    set_error(ERR_NONE);
    return true;
  }

  Snapshot *winner = select_best_snapshot(flag_id, environment_id,
                                          chosen_version, subject_id,
                                          subject_bucket, ts);
  int decided_variant = 0;
  int off_by_targeting = 0;
  if (winner != nullptr) {
    decided_variant = winner->variant_id;
  } else {
    decided_variant = flag->default_variant_id;
    off_by_targeting = 1;
  }

  int prerequisite_failed = 0;
  for (Prerequisite *edge = flag->prerequisites; edge != nullptr;
       edge = edge->next) {
    int prerequisite_variant = 0;
    if (!evaluate_internal(edge->prerequisite_flag_id, environment_id,
                           subject_id, subject_bucket, ts,
                           &prerequisite_variant, nullptr)) {
      return false;
    }
    if (prerequisite_variant != edge->required_variant_id) {
      prerequisite_failed = 1;
      decided_variant = flag->off_variant_id;
      break;
    }
  }

  *out_variant = decided_variant;
  if (out_view != nullptr) {
    out_view->decided_version = chosen_version;
    out_view->matched_snapshot_id = winner != nullptr ? winner->snapshot_id : 0;
    out_view->matched_rule_id = winner != nullptr ? winner->rule_id : 0;
    out_view->decided_variant_id = decided_variant;
    out_view->fallback_used = fallback_used;
    out_view->tombstone_blocked = tombstone_blocked;
    out_view->stale_active_seen = stale_active_seen;
    out_view->disabled_active_seen = disabled_active_seen;
    out_view->prerequisite_failed = prerequisite_failed;
    out_view->off_by_targeting = off_by_targeting;
    out_view->usable = 1;
  }

  set_error(ERR_NONE);
  return true;
}

}  // namespace

extern "C" __attribute__((visibility("default"))) void flag_reset(void) {
  while (g_flags != nullptr) {
    Flag *flag = g_flags;
    g_flags = flag->next;

    while (flag->prerequisites != nullptr) {
      Prerequisite *edge = flag->prerequisites;
      flag->prerequisites = edge->next;
      delete edge;
    }

    while (flag->environments != nullptr) {
      EnvironmentBinding *binding = flag->environments;
      flag->environments = binding->next;

      while (binding->versions != nullptr) {
        VersionState *state = binding->versions;
        binding->versions = state->next;
        delete state;
      }

      delete binding;
    }

    delete flag;
  }

  while (g_snapshots != nullptr) {
    Snapshot *snapshot = g_snapshots;
    g_snapshots = snapshot->next;
    delete snapshot;
  }

  while (g_tombstones != nullptr) {
    Tombstone *tombstone = g_tombstones;
    g_tombstones = tombstone->next;
    delete tombstone;
  }

  while (g_memberships != nullptr) {
    SegmentMembership *membership = g_memberships;
    g_memberships = membership->next;
    delete membership;
  }

  set_error(ERR_NONE);
}

extern "C" __attribute__((visibility("default"))) int flag_define(
    int flag_id, int default_variant_id, int off_variant_id) {
  if (find_flag(flag_id) != nullptr) {
    set_error(ERR_DUP_FLAG);
    return 0;
  }

  Flag *flag = allocate_node<Flag>();
  if (flag == nullptr) {
    set_error(ERR_ALLOCATION);
    return 0;
  }

  flag->flag_id = flag_id;
  flag->default_variant_id = default_variant_id;
  flag->off_variant_id = off_variant_id;
  flag->next = g_flags;
  g_flags = flag;
  set_error(ERR_NONE);
  return 1;
}

extern "C" __attribute__((visibility("default"))) int
flag_define_prerequisite(int flag_id, int prerequisite_flag_id,
                         int required_variant_id) {
  Flag *flag = find_flag(flag_id);
  Flag *prerequisite_flag = find_flag(prerequisite_flag_id);

  if (flag == nullptr) {
    set_error(ERR_UNKNOWN_FLAG);
    return 0;
  }
  if (prerequisite_flag == nullptr) {
    set_error(ERR_UNKNOWN_PREREQUISITE_FLAG);
    return 0;
  }
  if (flag_id == prerequisite_flag_id ||
      prerequisite_path_exists(prerequisite_flag_id, flag_id)) {
    set_error(ERR_PREREQUISITE_CYCLE);
    return 0;
  }

  for (Prerequisite *edge = flag->prerequisites; edge != nullptr;
       edge = edge->next) {
    if (edge->prerequisite_flag_id == prerequisite_flag_id) {
      edge->required_variant_id = required_variant_id;
      set_error(ERR_NONE);
      return 1;
    }
  }

  Prerequisite *edge = allocate_node<Prerequisite>();
  if (edge == nullptr) {
    set_error(ERR_ALLOCATION);
    return 0;
  }
  edge->prerequisite_flag_id = prerequisite_flag_id;
  edge->required_variant_id = required_variant_id;
  edge->next = flag->prerequisites;
  flag->prerequisites = edge;
  set_error(ERR_NONE);
  return 1;
}

extern "C" __attribute__((visibility("default"))) int flag_publish_snapshot(
    int snapshot_id, int flag_id, int environment_id, int version, int rule_id,
    int segment_id, int priority, int variant_id, int rollout_percent,
    int track_events, int64_t not_before_ts, int64_t expires_ts) {
  Flag *flag = find_flag(flag_id);

  if (find_snapshot(snapshot_id) != nullptr) {
    set_error(ERR_DUP_SNAPSHOT);
    return 0;
  }
  if (flag == nullptr) {
    set_error(ERR_UNKNOWN_FLAG);
    return 0;
  }
  if (rollout_percent < 0 || rollout_percent > 100) {
    set_error(ERR_INVALID_ROLLOUT);
    return 0;
  }

  EnvironmentBinding *binding =
      ensure_environment_binding(flag, environment_id);
  if (binding == nullptr) {
    return 0;
  }
  if (version != 0 && ensure_version_state(binding, version) == nullptr) {
    return 0;
  }

  Snapshot *snapshot = allocate_node<Snapshot>();
  if (snapshot == nullptr) {
    set_error(ERR_ALLOCATION);
    return 0;
  }

  snapshot->snapshot_id = snapshot_id;
  snapshot->flag_id = flag_id;
  snapshot->environment_id = environment_id;
  snapshot->version = version;
  snapshot->rule_id = rule_id;
  snapshot->segment_id = segment_id;
  snapshot->priority = priority;
  snapshot->variant_id = variant_id;
  snapshot->rollout_percent = rollout_percent;
  snapshot->track_events = track_events;
  snapshot->not_before_ts = not_before_ts;
  snapshot->expires_ts = expires_ts;
  snapshot->next = g_snapshots;
  g_snapshots = snapshot;
  set_error(ERR_NONE);
  return 1;
}

extern "C" __attribute__((visibility("default"))) int flag_publish_tombstone(
    int tombstone_id, int flag_id, int environment_id, int version,
    int64_t not_before_ts, int64_t expires_ts) {
  Flag *flag = find_flag(flag_id);

  if (find_tombstone(tombstone_id) != nullptr) {
    set_error(ERR_DUP_TOMBSTONE);
    return 0;
  }
  if (flag == nullptr) {
    set_error(ERR_UNKNOWN_FLAG);
    return 0;
  }

  EnvironmentBinding *binding =
      ensure_environment_binding(flag, environment_id);
  if (binding == nullptr) {
    return 0;
  }
  if (version != 0 && ensure_version_state(binding, version) == nullptr) {
    return 0;
  }

  Tombstone *tombstone = allocate_node<Tombstone>();
  if (tombstone == nullptr) {
    set_error(ERR_ALLOCATION);
    return 0;
  }

  tombstone->tombstone_id = tombstone_id;
  tombstone->flag_id = flag_id;
  tombstone->environment_id = environment_id;
  tombstone->version = version;
  tombstone->not_before_ts = not_before_ts;
  tombstone->expires_ts = expires_ts;
  tombstone->next = g_tombstones;
  g_tombstones = tombstone;
  set_error(ERR_NONE);
  return 1;
}

extern "C" __attribute__((visibility("default"))) int flag_stage_version(
    int flag_id, int environment_id, int version) {
  Flag *flag = find_flag(flag_id);
  if (flag == nullptr) {
    set_error(ERR_UNKNOWN_FLAG);
    return 0;
  }

  EnvironmentBinding *binding =
      ensure_environment_binding(flag, environment_id);
  if (binding == nullptr) {
    return 0;
  }
  if (version != 0 && ensure_version_state(binding, version) == nullptr) {
    return 0;
  }

  binding->staged_version = version;
  set_error(ERR_NONE);
  return 1;
}

extern "C" __attribute__((visibility("default"))) int flag_activate_version(
    int flag_id, int environment_id) {
  Flag *flag = find_flag(flag_id);
  if (flag == nullptr) {
    set_error(ERR_UNKNOWN_FLAG);
    return 0;
  }

  EnvironmentBinding *binding = find_environment_binding(flag, environment_id);
  if (binding == nullptr) {
    set_error(ERR_UNKNOWN_ENV_BINDING);
    return 0;
  }
  if (binding->staged_version == 0) {
    set_error(ERR_NO_STAGED_VERSION);
    return 0;
  }

  if (ensure_version_state(binding, binding->staged_version) == nullptr) {
    return 0;
  }

  const int previous_active = binding->active_version;
  binding->active_version = binding->staged_version;
  binding->staged_version = 0;
  if (previous_active != 0) {
    binding->fallback_version = previous_active;
  }

  set_error(ERR_NONE);
  return 1;
}

extern "C" __attribute__((visibility("default"))) int
flag_set_fallback_version(int flag_id, int environment_id, int version) {
  Flag *flag = find_flag(flag_id);
  if (flag == nullptr) {
    set_error(ERR_UNKNOWN_FLAG);
    return 0;
  }
  if (!version_is_known(flag_id, environment_id, version)) {
    set_error(ERR_UNKNOWN_VERSION);
    return 0;
  }

  EnvironmentBinding *binding =
      ensure_environment_binding(flag, environment_id);
  if (binding == nullptr) {
    return 0;
  }
  if (version != 0 && ensure_version_state(binding, version) == nullptr) {
    return 0;
  }

  binding->fallback_version = version;
  set_error(ERR_NONE);
  return 1;
}

extern "C" __attribute__((visibility("default"))) int flag_disable_snapshot(
    int snapshot_id) {
  Snapshot *snapshot = find_snapshot(snapshot_id);
  if (snapshot == nullptr) {
    set_error(ERR_UNKNOWN_SNAPSHOT);
    return 0;
  }

  snapshot->disabled = 1;
  set_error(ERR_NONE);
  return 1;
}

extern "C" __attribute__((visibility("default"))) int flag_retire_snapshot(
    int snapshot_id) {
  Snapshot *snapshot = find_snapshot(snapshot_id);
  if (snapshot == nullptr) {
    set_error(ERR_UNKNOWN_SNAPSHOT);
    return 0;
  }

  snapshot->retired = 1;
  set_error(ERR_NONE);
  return 1;
}

extern "C" __attribute__((visibility("default"))) int flag_mark_replica_stale(
    int flag_id, int environment_id, int version, int stale) {
  Flag *flag = find_flag(flag_id);
  if (flag == nullptr) {
    set_error(ERR_UNKNOWN_FLAG);
    return 0;
  }

  EnvironmentBinding *binding =
      ensure_environment_binding(flag, environment_id);
  if (binding == nullptr) {
    return 0;
  }
  VersionState *state = ensure_version_state(binding, version);
  if (version != 0 && state == nullptr) {
    return 0;
  }
  if (state != nullptr) {
    state->stale = stale != 0;
  }

  set_error(ERR_NONE);
  return 1;
}

extern "C" __attribute__((visibility("default"))) int
flag_register_segment_membership(int subject_id, int segment_id, int member) {
  for (SegmentMembership *membership = g_memberships; membership != nullptr;
       membership = membership->next) {
    if (membership->subject_id == subject_id &&
        membership->segment_id == segment_id) {
      membership->member = member != 0;
      set_error(ERR_NONE);
      return 1;
    }
  }

  SegmentMembership *membership = allocate_node<SegmentMembership>();
  if (membership == nullptr) {
    set_error(ERR_ALLOCATION);
    return 0;
  }
  membership->subject_id = subject_id;
  membership->segment_id = segment_id;
  membership->member = member != 0;
  membership->next = g_memberships;
  g_memberships = membership;
  set_error(ERR_NONE);
  return 1;
}

extern "C" __attribute__((visibility("default"))) int flag_evaluate(
    int flag_id, int environment_id, int subject_id, int subject_bucket,
    int64_t ts) {
  int variant = 0;
  if (!evaluate_internal(flag_id, environment_id, subject_id, subject_bucket,
                         ts, &variant, nullptr)) {
    return 0;
  }
  return variant;
}

extern "C" __attribute__((visibility("default"))) int flag_explain_get(
    int flag_id, int environment_id, int subject_id, int subject_bucket,
    int64_t ts, FlagEvalView *out_view) {
  int variant = 0;

  if (out_view == nullptr) {
    set_error(ERR_NULL_EXPLAIN_POINTER);
    return 0;
  }

  std::memset(out_view, 0, sizeof(*out_view));
  if (find_flag(flag_id) == nullptr) {
    set_error(ERR_UNKNOWN_FLAG);
    return 0;
  }

  if (!evaluate_internal(flag_id, environment_id, subject_id, subject_bucket,
                         ts, &variant, out_view)) {
    return 0;
  }
  return 1;
}

extern "C" __attribute__((visibility("default"))) int
flag_count_usable_snapshots(int flag_id, int environment_id, int64_t ts) {
  Flag *flag = find_flag(flag_id);
  if (flag == nullptr) {
    set_error(ERR_UNKNOWN_FLAG);
    return 0;
  }

  EnvironmentBinding *binding = find_environment_binding(flag, environment_id);
  int chosen_version = 0;
  int fallback_used = 0;
  int tombstone_blocked = 0;
  int stale_active_seen = 0;
  int disabled_active_seen = 0;
  if (!choose_version(flag, binding, environment_id, 0, 0, ts, &chosen_version,
                      &fallback_used, &tombstone_blocked, &stale_active_seen,
                      &disabled_active_seen)) {
    return 0;
  }

  if (chosen_version == 0) {
    set_error(ERR_NONE);
    return 0;
  }

  int count = 0;
  for (Snapshot *snapshot = g_snapshots; snapshot != nullptr;
       snapshot = snapshot->next) {
    if (snapshot->flag_id == flag_id &&
        snapshot->environment_id == environment_id &&
        snapshot->version == chosen_version && snapshot_live(snapshot, ts)) {
      count += 1;
    }
  }

  set_error(ERR_NONE);
  return count;
}

extern "C" __attribute__((visibility("default"))) int flag_last_error(void) {
  return g_last_error;
}
