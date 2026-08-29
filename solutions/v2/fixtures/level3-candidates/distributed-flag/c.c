#include <stdint.h>
#include <stdlib.h>
#include <string.h>

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

typedef struct Prerequisite {
  int prerequisite_flag_id;
  int required_variant_id;
  struct Prerequisite *next;
} Prerequisite;

typedef struct VersionState {
  int version;
  int stale;
  struct VersionState *next;
} VersionState;

typedef struct EnvironmentBinding {
  int environment_id;
  int active_version;
  int staged_version;
  int fallback_version;
  VersionState *versions;
  struct EnvironmentBinding *next;
} EnvironmentBinding;

typedef struct Flag {
  int flag_id;
  int default_variant_id;
  int off_variant_id;
  Prerequisite *prerequisites;
  EnvironmentBinding *environments;
  struct Flag *next;
} Flag;

typedef struct Snapshot {
  int snapshot_id;
  int flag_id;
  int environment_id;
  int version;
  int rule_id;
  int segment_id;
  int priority;
  int variant_id;
  int rollout_percent;
  int track_events;
  int64_t not_before_ts;
  int64_t expires_ts;
  int disabled;
  int retired;
  struct Snapshot *next;
} Snapshot;

typedef struct Tombstone {
  int tombstone_id;
  int flag_id;
  int environment_id;
  int version;
  int64_t not_before_ts;
  int64_t expires_ts;
  struct Tombstone *next;
} Tombstone;

typedef struct SegmentMembership {
  int subject_id;
  int segment_id;
  int member;
  struct SegmentMembership *next;
} SegmentMembership;

static int g_last_error = ERR_NONE;
static Flag *g_flags = NULL;
static Snapshot *g_snapshots = NULL;
static Tombstone *g_tombstones = NULL;
static SegmentMembership *g_memberships = NULL;

static void set_error(int code) { g_last_error = code; }

static Flag *find_flag(int flag_id) {
  Flag *flag = g_flags;
  while (flag != NULL) {
    if (flag->flag_id == flag_id) {
      return flag;
    }
    flag = flag->next;
  }
  return NULL;
}

static Snapshot *find_snapshot(int snapshot_id) {
  Snapshot *snapshot = g_snapshots;
  while (snapshot != NULL) {
    if (snapshot->snapshot_id == snapshot_id) {
      return snapshot;
    }
    snapshot = snapshot->next;
  }
  return NULL;
}

static Tombstone *find_tombstone(int tombstone_id) {
  Tombstone *tombstone = g_tombstones;
  while (tombstone != NULL) {
    if (tombstone->tombstone_id == tombstone_id) {
      return tombstone;
    }
    tombstone = tombstone->next;
  }
  return NULL;
}

static EnvironmentBinding *find_environment_binding(Flag *flag, int environment_id) {
  EnvironmentBinding *binding = flag->environments;
  while (binding != NULL) {
    if (binding->environment_id == environment_id) {
      return binding;
    }
    binding = binding->next;
  }
  return NULL;
}

static VersionState *find_version_state(EnvironmentBinding *binding, int version) {
  VersionState *state = binding->versions;
  while (state != NULL) {
    if (state->version == version) {
      return state;
    }
    state = state->next;
  }
  return NULL;
}

static EnvironmentBinding *ensure_environment_binding(Flag *flag, int environment_id) {
  EnvironmentBinding *binding = find_environment_binding(flag, environment_id);
  if (binding != NULL) {
    return binding;
  }

  binding = (EnvironmentBinding *)calloc(1, sizeof(EnvironmentBinding));
  if (binding == NULL) {
    set_error(ERR_ALLOCATION);
    return NULL;
  }
  binding->environment_id = environment_id;
  binding->next = flag->environments;
  flag->environments = binding;
  return binding;
}

static VersionState *ensure_version_state(EnvironmentBinding *binding, int version) {
  VersionState *state;

  if (version == 0) {
    return NULL;
  }

  state = find_version_state(binding, version);
  if (state != NULL) {
    return state;
  }

  state = (VersionState *)calloc(1, sizeof(VersionState));
  if (state == NULL) {
    set_error(ERR_ALLOCATION);
    return NULL;
  }
  state->version = version;
  state->next = binding->versions;
  binding->versions = state;
  return state;
}

static int version_is_known(int flag_id, int environment_id, int version) {
  Flag *flag;
  EnvironmentBinding *binding;
  Snapshot *snapshot;
  Tombstone *tombstone;

  if (version == 0) {
    return 1;
  }

  flag = find_flag(flag_id);
  if (flag == NULL) {
    return 0;
  }

  binding = find_environment_binding(flag, environment_id);
  if (binding != NULL && find_version_state(binding, version) != NULL) {
    return 1;
  }

  snapshot = g_snapshots;
  while (snapshot != NULL) {
    if (snapshot->flag_id == flag_id && snapshot->environment_id == environment_id && snapshot->version == version) {
      return 1;
    }
    snapshot = snapshot->next;
  }

  tombstone = g_tombstones;
  while (tombstone != NULL) {
    if (tombstone->flag_id == flag_id && tombstone->environment_id == environment_id && tombstone->version == version) {
      return 1;
    }
    tombstone = tombstone->next;
  }

  return 0;
}

static int segment_is_member(int subject_id, int segment_id) {
  SegmentMembership *membership;

  if (segment_id == 0) {
    return 1;
  }

  membership = g_memberships;
  while (membership != NULL) {
    if (membership->subject_id == subject_id && membership->segment_id == segment_id) {
      return membership->member != 0;
    }
    membership = membership->next;
  }

  return 0;
}

static int snapshot_time_usable(const Snapshot *snapshot, int64_t ts) {
  if (ts < snapshot->not_before_ts) {
    return 0;
  }
  if (ts >= snapshot->expires_ts) {
    return 0;
  }
  return 1;
}

static int snapshot_live(const Snapshot *snapshot, int64_t ts) {
  if (!snapshot_time_usable(snapshot, ts)) {
    return 0;
  }
  if (snapshot->disabled || snapshot->retired) {
    return 0;
  }
  return 1;
}

static int tombstone_active(const Tombstone *tombstone, int64_t ts) {
  if (ts < tombstone->not_before_ts) {
    return 0;
  }
  if (ts >= tombstone->expires_ts) {
    return 0;
  }
  return 1;
}

static int version_is_tombstoned(int flag_id, int environment_id, int version, int64_t ts) {
  Tombstone *tombstone = g_tombstones;

  while (tombstone != NULL) {
    if (tombstone->flag_id == flag_id && tombstone->environment_id == environment_id && tombstone->version == version &&
        tombstone_active(tombstone, ts)) {
      return 1;
    }
    tombstone = tombstone->next;
  }

  return 0;
}

static int version_is_stale(EnvironmentBinding *binding, int version) {
  VersionState *state;

  if (binding == NULL || version == 0) {
    return 0;
  }

  state = find_version_state(binding, version);
  return state != NULL && state->stale != 0;
}

static int version_has_live_snapshot(int flag_id, int environment_id, int version, int64_t ts) {
  Snapshot *snapshot = g_snapshots;

  while (snapshot != NULL) {
    if (snapshot->flag_id == flag_id && snapshot->environment_id == environment_id && snapshot->version == version &&
        snapshot_live(snapshot, ts)) {
      return 1;
    }
    snapshot = snapshot->next;
  }

  return 0;
}

static int version_has_disabled_match(int flag_id, int environment_id, int version, int subject_id, int subject_bucket,
                                      int64_t ts) {
  Snapshot *snapshot = g_snapshots;

  while (snapshot != NULL) {
    if (snapshot->flag_id == flag_id && snapshot->environment_id == environment_id && snapshot->version == version &&
        snapshot->disabled && !snapshot->retired && snapshot_time_usable(snapshot, ts) &&
        segment_is_member(subject_id, snapshot->segment_id) && subject_bucket < snapshot->rollout_percent) {
      return 1;
    }
    snapshot = snapshot->next;
  }

  return 0;
}

static Snapshot *select_best_snapshot(int flag_id, int environment_id, int version, int subject_id, int subject_bucket,
                                      int64_t ts) {
  Snapshot *snapshot = g_snapshots;
  Snapshot *best = NULL;

  while (snapshot != NULL) {
    int snapshot_specific;
    int best_specific;

    if (snapshot->flag_id != flag_id || snapshot->environment_id != environment_id || snapshot->version != version) {
      snapshot = snapshot->next;
      continue;
    }
    if (!snapshot_live(snapshot, ts)) {
      snapshot = snapshot->next;
      continue;
    }
    if (!segment_is_member(subject_id, snapshot->segment_id)) {
      snapshot = snapshot->next;
      continue;
    }
    if (subject_bucket >= snapshot->rollout_percent) {
      snapshot = snapshot->next;
      continue;
    }

    if (best == NULL) {
      best = snapshot;
      snapshot = snapshot->next;
      continue;
    }

    if (snapshot->priority > best->priority) {
      best = snapshot;
      snapshot = snapshot->next;
      continue;
    }
    if (snapshot->priority < best->priority) {
      snapshot = snapshot->next;
      continue;
    }

    snapshot_specific = snapshot->segment_id != 0;
    best_specific = best->segment_id != 0;
    if (snapshot_specific != best_specific) {
      if (snapshot_specific) {
        best = snapshot;
      }
      snapshot = snapshot->next;
      continue;
    }

    if (snapshot->rule_id < best->rule_id) {
      best = snapshot;
      snapshot = snapshot->next;
      continue;
    }
    if (snapshot->rule_id > best->rule_id) {
      snapshot = snapshot->next;
      continue;
    }

    if (snapshot->snapshot_id < best->snapshot_id) {
      best = snapshot;
    }
    snapshot = snapshot->next;
  }

  return best;
}

static int prerequisite_path_exists(int current_flag_id, int target_flag_id) {
  Flag *flag = find_flag(current_flag_id);
  Prerequisite *edge;

  if (current_flag_id == target_flag_id) {
    return 1;
  }
  if (flag == NULL) {
    return 0;
  }

  edge = flag->prerequisites;
  while (edge != NULL) {
    if (prerequisite_path_exists(edge->prerequisite_flag_id, target_flag_id)) {
      return 1;
    }
    edge = edge->next;
  }

  return 0;
}

static int choose_version(Flag *flag, EnvironmentBinding *binding, int environment_id, int subject_id, int subject_bucket,
                          int64_t ts, int *chosen_version, int *fallback_used, int *tombstone_blocked,
                          int *stale_active_seen, int *disabled_active_seen) {
  int active_version;
  int fallback_version;
  int active_readable = 0;
  int fallback_readable = 0;

  (void)subject_bucket;

  *chosen_version = 0;
  *fallback_used = 0;
  *tombstone_blocked = 0;
  *stale_active_seen = 0;
  *disabled_active_seen = 0;

  if (binding == NULL) {
    return 1;
  }

  active_version = binding->active_version;
  fallback_version = binding->fallback_version;

  if (active_version != 0) {
    if (version_has_disabled_match(flag->flag_id, environment_id, active_version, subject_id, subject_bucket, ts)) {
      *disabled_active_seen = 1;
    }
    if (version_is_tombstoned(flag->flag_id, environment_id, active_version, ts)) {
      *tombstone_blocked = 1;
    } else if (version_is_stale(binding, active_version)) {
      *stale_active_seen = 1;
    } else if (version_has_live_snapshot(flag->flag_id, environment_id, active_version, ts)) {
      active_readable = 1;
    }
  }

  if (active_readable) {
    *chosen_version = active_version;
    return 1;
  }

  if (fallback_version != 0) {
    if (version_is_tombstoned(flag->flag_id, environment_id, fallback_version, ts)) {
      *tombstone_blocked = 1;
    } else if (!version_is_stale(binding, fallback_version) &&
               version_has_live_snapshot(flag->flag_id, environment_id, fallback_version, ts)) {
      fallback_readable = 1;
    }
  }

  if (fallback_readable) {
    *chosen_version = fallback_version;
    *fallback_used = 1;
  }

  return 1;
}

static int evaluate_internal(int flag_id, int environment_id, int subject_id, int subject_bucket, int64_t ts,
                             int *out_variant, FlagEvalView *out_view) {
  Flag *flag = find_flag(flag_id);
  EnvironmentBinding *binding;
  Snapshot *winner;
  Prerequisite *edge;
  int chosen_version = 0;
  int fallback_used = 0;
  int tombstone_blocked = 0;
  int stale_active_seen = 0;
  int disabled_active_seen = 0;
  int prerequisite_failed = 0;
  int decided_variant = 0;
  int off_by_targeting = 0;

  if (flag == NULL) {
    set_error(ERR_UNKNOWN_FLAG);
    return 0;
  }

  if (out_view != NULL) {
    memset(out_view, 0, sizeof(*out_view));
    out_view->exists = 1;
    out_view->environment_id = environment_id;
  }

  binding = find_environment_binding(flag, environment_id);
  if (!choose_version(flag, binding, environment_id, subject_id, subject_bucket, ts, &chosen_version, &fallback_used,
                      &tombstone_blocked, &stale_active_seen, &disabled_active_seen)) {
    return 0;
  }

  if (chosen_version == 0) {
    decided_variant = flag->off_variant_id;
    *out_variant = decided_variant;
    if (out_view != NULL) {
      out_view->decided_variant_id = decided_variant;
      out_view->fallback_used = 0;
      out_view->tombstone_blocked = tombstone_blocked;
      out_view->stale_active_seen = stale_active_seen;
      out_view->disabled_active_seen = disabled_active_seen;
      out_view->usable = 0;
    }
    set_error(ERR_NONE);
    return 1;
  }

  winner = select_best_snapshot(flag_id, environment_id, chosen_version, subject_id, subject_bucket, ts);
  if (winner != NULL) {
    decided_variant = winner->variant_id;
  } else {
    decided_variant = flag->default_variant_id;
    off_by_targeting = 1;
  }

  edge = flag->prerequisites;
  while (edge != NULL) {
    int prerequisite_variant = 0;

    if (!evaluate_internal(edge->prerequisite_flag_id, environment_id, subject_id, subject_bucket, ts,
                           &prerequisite_variant, NULL)) {
      return 0;
    }
    if (prerequisite_variant != edge->required_variant_id) {
      prerequisite_failed = 1;
      decided_variant = flag->off_variant_id;
      break;
    }
    edge = edge->next;
  }

  *out_variant = decided_variant;
  if (out_view != NULL) {
    out_view->decided_version = chosen_version;
    out_view->matched_snapshot_id = winner != NULL ? winner->snapshot_id : 0;
    out_view->matched_rule_id = winner != NULL ? winner->rule_id : 0;
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
  return 1;
}

__attribute__((visibility("default"))) void flag_reset(void) {
  while (g_flags != NULL) {
    Flag *flag = g_flags;
    g_flags = flag->next;

    while (flag->prerequisites != NULL) {
      Prerequisite *edge = flag->prerequisites;
      flag->prerequisites = edge->next;
      free(edge);
    }

    while (flag->environments != NULL) {
      EnvironmentBinding *binding = flag->environments;
      flag->environments = binding->next;
      while (binding->versions != NULL) {
        VersionState *state = binding->versions;
        binding->versions = state->next;
        free(state);
      }
      free(binding);
    }

    free(flag);
  }

  while (g_snapshots != NULL) {
    Snapshot *snapshot = g_snapshots;
    g_snapshots = snapshot->next;
    free(snapshot);
  }

  while (g_tombstones != NULL) {
    Tombstone *tombstone = g_tombstones;
    g_tombstones = tombstone->next;
    free(tombstone);
  }

  while (g_memberships != NULL) {
    SegmentMembership *membership = g_memberships;
    g_memberships = membership->next;
    free(membership);
  }

  set_error(ERR_NONE);
}

__attribute__((visibility("default"))) int flag_define(int flag_id, int default_variant_id, int off_variant_id) {
  Flag *flag;

  if (find_flag(flag_id) != NULL) {
    set_error(ERR_DUP_FLAG);
    return 0;
  }

  flag = (Flag *)calloc(1, sizeof(Flag));
  if (flag == NULL) {
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

__attribute__((visibility("default"))) int flag_define_prerequisite(int flag_id, int prerequisite_flag_id,
                                                                    int required_variant_id) {
  Flag *flag = find_flag(flag_id);
  Flag *prerequisite_flag = find_flag(prerequisite_flag_id);
  Prerequisite *edge;

  if (flag == NULL) {
    set_error(ERR_UNKNOWN_FLAG);
    return 0;
  }
  if (prerequisite_flag == NULL) {
    set_error(ERR_UNKNOWN_PREREQUISITE_FLAG);
    return 0;
  }
  if (flag_id == prerequisite_flag_id || prerequisite_path_exists(prerequisite_flag_id, flag_id)) {
    set_error(ERR_PREREQUISITE_CYCLE);
    return 0;
  }

  edge = flag->prerequisites;
  while (edge != NULL) {
    if (edge->prerequisite_flag_id == prerequisite_flag_id) {
      edge->required_variant_id = required_variant_id;
      set_error(ERR_NONE);
      return 1;
    }
    edge = edge->next;
  }

  edge = (Prerequisite *)calloc(1, sizeof(Prerequisite));
  if (edge == NULL) {
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

__attribute__((visibility("default"))) int flag_publish_snapshot(int snapshot_id, int flag_id, int environment_id,
                                                                 int version, int rule_id, int segment_id, int priority,
                                                                 int variant_id, int rollout_percent, int track_events,
                                                                 int64_t not_before_ts, int64_t expires_ts) {
  Flag *flag = find_flag(flag_id);
  Snapshot *snapshot;
  EnvironmentBinding *binding;

  if (find_snapshot(snapshot_id) != NULL) {
    set_error(ERR_DUP_SNAPSHOT);
    return 0;
  }
  if (flag == NULL) {
    set_error(ERR_UNKNOWN_FLAG);
    return 0;
  }
  if (rollout_percent < 0 || rollout_percent > 100) {
    set_error(ERR_INVALID_ROLLOUT);
    return 0;
  }

  binding = ensure_environment_binding(flag, environment_id);
  if (binding == NULL) {
    return 0;
  }
  if (version != 0 && ensure_version_state(binding, version) == NULL) {
    return 0;
  }

  snapshot = (Snapshot *)calloc(1, sizeof(Snapshot));
  if (snapshot == NULL) {
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

__attribute__((visibility("default"))) int flag_publish_tombstone(int tombstone_id, int flag_id, int environment_id,
                                                                  int version, int64_t not_before_ts,
                                                                  int64_t expires_ts) {
  Flag *flag = find_flag(flag_id);
  Tombstone *tombstone;
  EnvironmentBinding *binding;

  if (find_tombstone(tombstone_id) != NULL) {
    set_error(ERR_DUP_TOMBSTONE);
    return 0;
  }
  if (flag == NULL) {
    set_error(ERR_UNKNOWN_FLAG);
    return 0;
  }

  binding = ensure_environment_binding(flag, environment_id);
  if (binding == NULL) {
    return 0;
  }
  if (version != 0 && ensure_version_state(binding, version) == NULL) {
    return 0;
  }

  tombstone = (Tombstone *)calloc(1, sizeof(Tombstone));
  if (tombstone == NULL) {
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

__attribute__((visibility("default"))) int flag_stage_version(int flag_id, int environment_id, int version) {
  Flag *flag = find_flag(flag_id);
  EnvironmentBinding *binding;

  if (flag == NULL) {
    set_error(ERR_UNKNOWN_FLAG);
    return 0;
  }

  binding = ensure_environment_binding(flag, environment_id);
  if (binding == NULL) {
    return 0;
  }
  if (version != 0 && ensure_version_state(binding, version) == NULL) {
    return 0;
  }

  binding->staged_version = version;
  set_error(ERR_NONE);
  return 1;
}

__attribute__((visibility("default"))) int flag_activate_version(int flag_id, int environment_id) {
  Flag *flag = find_flag(flag_id);
  EnvironmentBinding *binding;
  int previous_active;

  if (flag == NULL) {
    set_error(ERR_UNKNOWN_FLAG);
    return 0;
  }

  binding = find_environment_binding(flag, environment_id);
  if (binding == NULL) {
    set_error(ERR_UNKNOWN_ENV_BINDING);
    return 0;
  }
  if (binding->staged_version == 0) {
    set_error(ERR_NO_STAGED_VERSION);
    return 0;
  }

  if (ensure_version_state(binding, binding->staged_version) == NULL) {
    return 0;
  }

  previous_active = binding->active_version;
  binding->active_version = binding->staged_version;
  binding->staged_version = 0;
  if (previous_active != 0) {
    binding->fallback_version = previous_active;
  }

  set_error(ERR_NONE);
  return 1;
}

__attribute__((visibility("default"))) int flag_set_fallback_version(int flag_id, int environment_id, int version) {
  Flag *flag = find_flag(flag_id);
  EnvironmentBinding *binding;

  if (flag == NULL) {
    set_error(ERR_UNKNOWN_FLAG);
    return 0;
  }
  if (!version_is_known(flag_id, environment_id, version)) {
    set_error(ERR_UNKNOWN_VERSION);
    return 0;
  }

  binding = ensure_environment_binding(flag, environment_id);
  if (binding == NULL) {
    return 0;
  }
  if (version != 0 && ensure_version_state(binding, version) == NULL) {
    return 0;
  }

  binding->fallback_version = version;
  set_error(ERR_NONE);
  return 1;
}

__attribute__((visibility("default"))) int flag_disable_snapshot(int snapshot_id) {
  Snapshot *snapshot = find_snapshot(snapshot_id);

  if (snapshot == NULL) {
    set_error(ERR_UNKNOWN_SNAPSHOT);
    return 0;
  }

  snapshot->disabled = 1;
  set_error(ERR_NONE);
  return 1;
}

__attribute__((visibility("default"))) int flag_retire_snapshot(int snapshot_id) {
  Snapshot *snapshot = find_snapshot(snapshot_id);

  if (snapshot == NULL) {
    set_error(ERR_UNKNOWN_SNAPSHOT);
    return 0;
  }

  snapshot->retired = 1;
  set_error(ERR_NONE);
  return 1;
}

__attribute__((visibility("default"))) int flag_mark_replica_stale(int flag_id, int environment_id, int version,
                                                                   int stale) {
  Flag *flag = find_flag(flag_id);
  EnvironmentBinding *binding;
  VersionState *state;

  if (flag == NULL) {
    set_error(ERR_UNKNOWN_FLAG);
    return 0;
  }

  binding = ensure_environment_binding(flag, environment_id);
  if (binding == NULL) {
    return 0;
  }
  state = ensure_version_state(binding, version);
  if (version != 0 && state == NULL) {
    return 0;
  }
  if (state != NULL) {
    state->stale = stale != 0;
  }

  set_error(ERR_NONE);
  return 1;
}

__attribute__((visibility("default"))) int flag_register_segment_membership(int subject_id, int segment_id, int member) {
  SegmentMembership *membership = g_memberships;

  while (membership != NULL) {
    if (membership->subject_id == subject_id && membership->segment_id == segment_id) {
      membership->member = member != 0;
      set_error(ERR_NONE);
      return 1;
    }
    membership = membership->next;
  }

  membership = (SegmentMembership *)calloc(1, sizeof(SegmentMembership));
  if (membership == NULL) {
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

__attribute__((visibility("default"))) int flag_evaluate(int flag_id, int environment_id, int subject_id,
                                                         int subject_bucket, int64_t ts) {
  int variant = 0;

  if (!evaluate_internal(flag_id, environment_id, subject_id, subject_bucket, ts, &variant, NULL)) {
    return 0;
  }
  return variant;
}

__attribute__((visibility("default"))) int flag_explain_get(int flag_id, int environment_id, int subject_id,
                                                            int subject_bucket, int64_t ts, FlagEvalView *out_view) {
  int variant = 0;

  if (out_view == NULL) {
    set_error(ERR_NULL_EXPLAIN_POINTER);
    return 0;
  }

  memset(out_view, 0, sizeof(*out_view));
  if (find_flag(flag_id) == NULL) {
    set_error(ERR_UNKNOWN_FLAG);
    return 0;
  }

  if (!evaluate_internal(flag_id, environment_id, subject_id, subject_bucket, ts, &variant, out_view)) {
    return 0;
  }
  return 1;
}

__attribute__((visibility("default"))) int flag_count_usable_snapshots(int flag_id, int environment_id, int64_t ts) {
  Flag *flag = find_flag(flag_id);
  EnvironmentBinding *binding;
  Snapshot *snapshot;
  int chosen_version = 0;
  int fallback_used = 0;
  int tombstone_blocked = 0;
  int stale_active_seen = 0;
  int disabled_active_seen = 0;
  int count = 0;

  if (flag == NULL) {
    set_error(ERR_UNKNOWN_FLAG);
    return 0;
  }

  binding = find_environment_binding(flag, environment_id);
  if (!choose_version(flag, binding, environment_id, 0, 0, ts, &chosen_version, &fallback_used, &tombstone_blocked,
                      &stale_active_seen, &disabled_active_seen)) {
    return 0;
  }

  (void)fallback_used;
  (void)tombstone_blocked;
  (void)stale_active_seen;
  (void)disabled_active_seen;

  if (chosen_version == 0) {
    set_error(ERR_NONE);
    return 0;
  }

  snapshot = g_snapshots;
  while (snapshot != NULL) {
    if (snapshot->flag_id == flag_id && snapshot->environment_id == environment_id &&
        snapshot->version == chosen_version && snapshot_live(snapshot, ts)) {
      count += 1;
    }
    snapshot = snapshot->next;
  }

  set_error(ERR_NONE);
  return count;
}

__attribute__((visibility("default"))) int flag_last_error(void) { return g_last_error; }
