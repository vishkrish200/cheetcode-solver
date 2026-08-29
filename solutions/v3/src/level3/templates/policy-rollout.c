#include <stdint.h>
#include <stdlib.h>
#include <string.h>

typedef struct PolicyExplainView {
  int exists;
  int matched_snapshot_id;
  int decided_version;
  int allow_mask;
  int deny_mask;
  int fallback_used;
  int stale_snapshot;
  int disabled_snapshot;
  int usable;
} PolicyExplainView;

enum {
  ERR_NONE = 0,
  ERR_INVALID_ARGUMENT = -1,
  ERR_DUPLICATE_SNAPSHOT = -2,
  ERR_MISSING_BINDING = -3,
  ERR_MISSING_STAGED_VERSION = -4,
  ERR_MISSING_SNAPSHOT = -5,
  ERR_ALREADY_RETIRED = -6,
  ERR_ALREADY_DISABLED = -7,
  ERR_NULL_OUTPUT = -8,
  ERR_ALLOCATION = -9
};

enum {
  SNAPSHOT_BUCKET_COUNT = 4096,
  BINDING_BUCKET_COUNT = 2048,
  SUBJECT_BUCKET_COUNT = 2048,
  SVR_BUCKET_COUNT = 8192,
  SV_BUCKET_COUNT = 4096
};

typedef struct Snapshot Snapshot;
typedef struct SubjectBinding SubjectBinding;
typedef struct KnownSubject KnownSubject;
typedef struct SubjectVersionResourceEntry SubjectVersionResourceEntry;
typedef struct SubjectVersionEntry SubjectVersionEntry;

struct Snapshot {
  int snapshot_id;
  int version;
  int subject_id;
  int resource_id;
  int allow_mask;
  int deny_mask;
  int priority;
  int64_t not_before_ts;
  int64_t expires_ts;
  int retired;
  int disabled;
  Snapshot *next_id;
  Snapshot *next_svr;
  Snapshot *next_sv;
};

struct SubjectBinding {
  int subject_id;
  int active_version;
  int fallback_version;
  int staged_version;
  SubjectBinding *next;
};

struct KnownSubject {
  int subject_id;
  KnownSubject *next;
};

struct SubjectVersionResourceEntry {
  int subject_id;
  int version;
  int resource_id;
  Snapshot *head;
  SubjectVersionResourceEntry *next;
};

struct SubjectVersionEntry {
  int subject_id;
  int version;
  Snapshot *head;
  SubjectVersionEntry *next;
};

typedef struct VersionInspection {
  Snapshot *best_any;
  Snapshot *best_usable;
  int stale_snapshot;
  int disabled_snapshot;
} VersionInspection;

static int g_last_error = ERR_NONE;
static Snapshot *g_snapshot_buckets[SNAPSHOT_BUCKET_COUNT];
static SubjectBinding *g_binding_buckets[BINDING_BUCKET_COUNT];
static KnownSubject *g_subject_buckets[SUBJECT_BUCKET_COUNT];
static SubjectVersionResourceEntry *g_svr_buckets[SVR_BUCKET_COUNT];
static SubjectVersionEntry *g_sv_buckets[SV_BUCKET_COUNT];

static void set_error(int error_code) { g_last_error = error_code; }

static void clear_error(void) { g_last_error = ERR_NONE; }

static uint32_t mix_u32(uint32_t value) {
  value ^= value >> 16;
  value *= 0x7feb352dU;
  value ^= value >> 15;
  value *= 0x846ca68bU;
  value ^= value >> 16;
  return value;
}

static size_t hash_int(int value, size_t bucket_count) {
  return (size_t)(mix_u32((uint32_t)value) % bucket_count);
}

static size_t hash_pair(int first, int second, size_t bucket_count) {
  uint32_t mixed = mix_u32((uint32_t)first) ^ (mix_u32((uint32_t)second) * 0x9e3779b9U);
  return (size_t)(mix_u32(mixed) % bucket_count);
}

static size_t hash_triple(int first, int second, int third, size_t bucket_count) {
  uint32_t mixed = mix_u32((uint32_t)first);
  mixed ^= mix_u32((uint32_t)second) + 0x9e3779b9U + (mixed << 6) + (mixed >> 2);
  mixed ^= mix_u32((uint32_t)third) + 0x9e3779b9U + (mixed << 6) + (mixed >> 2);
  return (size_t)(mix_u32(mixed) % bucket_count);
}

static Snapshot *find_snapshot(int snapshot_id) {
  Snapshot *current = g_snapshot_buckets[hash_int(snapshot_id, SNAPSHOT_BUCKET_COUNT)];
  while (current != NULL) {
    if (current->snapshot_id == snapshot_id) {
      return current;
    }
    current = current->next_id;
  }
  return NULL;
}

static SubjectBinding *find_binding(int subject_id) {
  SubjectBinding *current = g_binding_buckets[hash_int(subject_id, BINDING_BUCKET_COUNT)];
  while (current != NULL) {
    if (current->subject_id == subject_id) {
      return current;
    }
    current = current->next;
  }
  return NULL;
}

static int subject_is_known(int subject_id) {
  KnownSubject *current = g_subject_buckets[hash_int(subject_id, SUBJECT_BUCKET_COUNT)];
  while (current != NULL) {
    if (current->subject_id == subject_id) {
      return 1;
    }
    current = current->next;
  }
  return 0;
}

static int ensure_known_subject(int subject_id) {
  KnownSubject *subject;
  size_t bucket;

  if (subject_is_known(subject_id)) {
    return 1;
  }

  subject = (KnownSubject *)calloc(1, sizeof(KnownSubject));
  if (subject == NULL) {
    set_error(ERR_ALLOCATION);
    return 0;
  }

  subject->subject_id = subject_id;
  bucket = hash_int(subject_id, SUBJECT_BUCKET_COUNT);
  subject->next = g_subject_buckets[bucket];
  g_subject_buckets[bucket] = subject;
  return 1;
}

static SubjectBinding *ensure_binding(int subject_id) {
  SubjectBinding *binding = find_binding(subject_id);
  size_t bucket;

  if (binding != NULL) {
    return binding;
  }

  binding = (SubjectBinding *)calloc(1, sizeof(SubjectBinding));
  if (binding == NULL) {
    set_error(ERR_ALLOCATION);
    return NULL;
  }

  binding->subject_id = subject_id;
  bucket = hash_int(subject_id, BINDING_BUCKET_COUNT);
  binding->next = g_binding_buckets[bucket];
  g_binding_buckets[bucket] = binding;
  return binding;
}

static SubjectVersionResourceEntry *find_svr_entry(int subject_id, int version, int resource_id) {
  SubjectVersionResourceEntry *current =
      g_svr_buckets[hash_triple(subject_id, version, resource_id, SVR_BUCKET_COUNT)];
  while (current != NULL) {
    if (current->subject_id == subject_id && current->version == version &&
        current->resource_id == resource_id) {
      return current;
    }
    current = current->next;
  }
  return NULL;
}

static SubjectVersionResourceEntry *ensure_svr_entry(int subject_id, int version, int resource_id) {
  SubjectVersionResourceEntry *entry = find_svr_entry(subject_id, version, resource_id);
  size_t bucket;

  if (entry != NULL) {
    return entry;
  }

  entry = (SubjectVersionResourceEntry *)calloc(1, sizeof(SubjectVersionResourceEntry));
  if (entry == NULL) {
    set_error(ERR_ALLOCATION);
    return NULL;
  }

  entry->subject_id = subject_id;
  entry->version = version;
  entry->resource_id = resource_id;
  bucket = hash_triple(subject_id, version, resource_id, SVR_BUCKET_COUNT);
  entry->next = g_svr_buckets[bucket];
  g_svr_buckets[bucket] = entry;
  return entry;
}

static SubjectVersionEntry *find_sv_entry(int subject_id, int version) {
  SubjectVersionEntry *current = g_sv_buckets[hash_pair(subject_id, version, SV_BUCKET_COUNT)];
  while (current != NULL) {
    if (current->subject_id == subject_id && current->version == version) {
      return current;
    }
    current = current->next;
  }
  return NULL;
}

static SubjectVersionEntry *ensure_sv_entry(int subject_id, int version) {
  SubjectVersionEntry *entry = find_sv_entry(subject_id, version);
  size_t bucket;

  if (entry != NULL) {
    return entry;
  }

  entry = (SubjectVersionEntry *)calloc(1, sizeof(SubjectVersionEntry));
  if (entry == NULL) {
    set_error(ERR_ALLOCATION);
    return NULL;
  }

  entry->subject_id = subject_id;
  entry->version = version;
  bucket = hash_pair(subject_id, version, SV_BUCKET_COUNT);
  entry->next = g_sv_buckets[bucket];
  g_sv_buckets[bucket] = entry;
  return entry;
}

static int snapshot_is_usable(const Snapshot *snapshot, int64_t ts) {
  return snapshot != NULL && !snapshot->retired && !snapshot->disabled &&
         snapshot->not_before_ts <= ts && ts < snapshot->expires_ts;
}

static int snapshot_is_stale(const Snapshot *snapshot, int64_t ts) {
  return snapshot != NULL &&
         (snapshot->retired || ts < snapshot->not_before_ts || ts >= snapshot->expires_ts);
}

static int snapshot_better(const Snapshot *candidate, const Snapshot *current) {
  return candidate->priority > current->priority ||
         (candidate->priority == current->priority && candidate->snapshot_id > current->snapshot_id);
}

static int snapshot_decides(const Snapshot *snapshot, int perm_bit) {
  return snapshot != NULL && ((snapshot->allow_mask | snapshot->deny_mask) & perm_bit) != 0;
}

static int requested_mask(int perm_bit) {
  if (perm_bit == 0) {
    return 1;
  }
  return perm_bit;
}

static VersionInspection inspect_version(int subject_id, int version, int resource_id, int64_t ts) {
  VersionInspection inspection;
  SubjectVersionResourceEntry *entry;
  Snapshot *current;

  inspection.best_any = NULL;
  inspection.best_usable = NULL;
  inspection.stale_snapshot = 0;
  inspection.disabled_snapshot = 0;

  if (version == 0) {
    return inspection;
  }

  entry = find_svr_entry(subject_id, version, resource_id);
  if (entry == NULL) {
    return inspection;
  }

  current = entry->head;
  while (current != NULL) {
    if (current->disabled) {
      inspection.disabled_snapshot = 1;
    }
    if (snapshot_is_stale(current, ts)) {
      inspection.stale_snapshot = 1;
    }

    if (inspection.best_any == NULL || snapshot_better(current, inspection.best_any)) {
      inspection.best_any = current;
    }
    if (snapshot_is_usable(current, ts) &&
        (inspection.best_usable == NULL || snapshot_better(current, inspection.best_usable))) {
      inspection.best_usable = current;
    }
    current = current->next_svr;
  }

  return inspection;
}

static void clear_view(PolicyExplainView *view) {
  memset(view, 0, sizeof(*view));
}

static void fill_view(PolicyExplainView *view, const Snapshot *snapshot, int decided_version,
                      int fallback_used, int usable) {
  if (snapshot == NULL) {
    return;
  }

  view->matched_snapshot_id = snapshot->snapshot_id;
  view->decided_version = decided_version;
  view->allow_mask = snapshot->allow_mask;
  view->deny_mask = snapshot->deny_mask;
  view->fallback_used = fallback_used;
  view->usable = usable;
}

static int count_usable_in_version(int subject_id, int version, int64_t ts) {
  SubjectVersionEntry *entry;
  Snapshot *current;
  int count = 0;

  if (version == 0) {
    return 0;
  }

  entry = find_sv_entry(subject_id, version);
  if (entry == NULL) {
    return 0;
  }

  current = entry->head;
  while (current != NULL) {
    if (snapshot_is_usable(current, ts)) {
      count += 1;
    }
    current = current->next_sv;
  }

  return count;
}

static void free_snapshots(void) {
  size_t i;

  for (i = 0; i < SNAPSHOT_BUCKET_COUNT; ++i) {
    Snapshot *current = g_snapshot_buckets[i];
    while (current != NULL) {
      Snapshot *next = current->next_id;
      free(current);
      current = next;
    }
    g_snapshot_buckets[i] = NULL;
  }
}

static void free_bindings(void) {
  size_t i;

  for (i = 0; i < BINDING_BUCKET_COUNT; ++i) {
    SubjectBinding *current = g_binding_buckets[i];
    while (current != NULL) {
      SubjectBinding *next = current->next;
      free(current);
      current = next;
    }
    g_binding_buckets[i] = NULL;
  }
}

static void free_known_subjects(void) {
  size_t i;

  for (i = 0; i < SUBJECT_BUCKET_COUNT; ++i) {
    KnownSubject *current = g_subject_buckets[i];
    while (current != NULL) {
      KnownSubject *next = current->next;
      free(current);
      current = next;
    }
    g_subject_buckets[i] = NULL;
  }
}

static void free_svr_entries(void) {
  size_t i;

  for (i = 0; i < SVR_BUCKET_COUNT; ++i) {
    SubjectVersionResourceEntry *current = g_svr_buckets[i];
    while (current != NULL) {
      SubjectVersionResourceEntry *next = current->next;
      free(current);
      current = next;
    }
    g_svr_buckets[i] = NULL;
  }
}

static void free_sv_entries(void) {
  size_t i;

  for (i = 0; i < SV_BUCKET_COUNT; ++i) {
    SubjectVersionEntry *current = g_sv_buckets[i];
    while (current != NULL) {
      SubjectVersionEntry *next = current->next;
      free(current);
      current = next;
    }
    g_sv_buckets[i] = NULL;
  }
}

__attribute__((visibility("default"))) void policy_reset(void) {
  free_snapshots();
  free_bindings();
  free_known_subjects();
  free_svr_entries();
  free_sv_entries();
  clear_error();
}

__attribute__((visibility("default"))) int
policy_publish_snapshot(int snapshot_id, int version, int subject_id, int resource_id,
                        int allow_mask, int deny_mask, int priority, int64_t not_before_ts,
                        int64_t expires_ts) {
  Snapshot *snapshot;
  SubjectVersionEntry *sv_entry;
  SubjectVersionResourceEntry *svr_entry;
  size_t bucket;

  if (snapshot_id <= 0 || version <= 0 || not_before_ts >= expires_ts) {
    set_error(ERR_INVALID_ARGUMENT);
    return 0;
  }

  if (find_snapshot(snapshot_id) != NULL) {
    set_error(ERR_DUPLICATE_SNAPSHOT);
    return 0;
  }

  sv_entry = ensure_sv_entry(subject_id, version);
  if (sv_entry == NULL) {
    return 0;
  }

  svr_entry = ensure_svr_entry(subject_id, version, resource_id);
  if (svr_entry == NULL) {
    return 0;
  }

  if (!ensure_known_subject(subject_id)) {
    return 0;
  }

  snapshot = (Snapshot *)calloc(1, sizeof(Snapshot));
  if (snapshot == NULL) {
    set_error(ERR_ALLOCATION);
    return 0;
  }

  snapshot->snapshot_id = snapshot_id;
  snapshot->version = version;
  snapshot->subject_id = subject_id;
  snapshot->resource_id = resource_id;
  snapshot->allow_mask = allow_mask;
  snapshot->deny_mask = deny_mask;
  snapshot->priority = priority;
  snapshot->not_before_ts = not_before_ts;
  snapshot->expires_ts = expires_ts;
  snapshot->retired = 0;
  snapshot->disabled = 0;

  bucket = hash_int(snapshot_id, SNAPSHOT_BUCKET_COUNT);
  snapshot->next_id = g_snapshot_buckets[bucket];
  g_snapshot_buckets[bucket] = snapshot;

  snapshot->next_sv = sv_entry->head;
  sv_entry->head = snapshot;

  snapshot->next_svr = svr_entry->head;
  svr_entry->head = snapshot;

  clear_error();
  return 1;
}

__attribute__((visibility("default"))) int
policy_set_subject_binding(int subject_id, int active_version, int fallback_version) {
  SubjectBinding *binding;

  if (active_version <= 0 || fallback_version < -1) {
    set_error(ERR_INVALID_ARGUMENT);
    return 0;
  }

  binding = ensure_binding(subject_id);
  if (binding == NULL) {
    return 0;
  }
  if (!ensure_known_subject(subject_id)) {
    return 0;
  }

  binding->active_version = active_version;
  binding->fallback_version = fallback_version;
  binding->staged_version = 0;

  clear_error();
  return 1;
}

__attribute__((visibility("default"))) int policy_stage_version(int subject_id, int staged_version) {
  SubjectBinding *binding;

  if (staged_version <= 0) {
    set_error(ERR_INVALID_ARGUMENT);
    return 0;
  }

  binding = find_binding(subject_id);
  if (binding == NULL) {
    set_error(ERR_MISSING_BINDING);
    return 0;
  }

  binding->staged_version = staged_version;
  clear_error();
  return 1;
}

__attribute__((visibility("default"))) int policy_activate_version(int subject_id) {
  SubjectBinding *binding = find_binding(subject_id);
  int previous_active;

  if (binding == NULL) {
    set_error(ERR_MISSING_BINDING);
    return 0;
  }
  if (binding->staged_version == 0) {
    set_error(ERR_MISSING_STAGED_VERSION);
    return 0;
  }

  previous_active = binding->active_version;
  binding->active_version = binding->staged_version;
  binding->fallback_version = previous_active;
  binding->staged_version = 0;

  clear_error();
  return 1;
}

__attribute__((visibility("default"))) int policy_retire_snapshot(int snapshot_id) {
  Snapshot *snapshot = find_snapshot(snapshot_id);

  if (snapshot == NULL) {
    set_error(ERR_MISSING_SNAPSHOT);
    return 0;
  }
  if (snapshot->retired) {
    set_error(ERR_ALREADY_RETIRED);
    return 0;
  }

  snapshot->retired = 1;
  clear_error();
  return 1;
}

__attribute__((visibility("default"))) int policy_disable_snapshot(int snapshot_id) {
  Snapshot *snapshot = find_snapshot(snapshot_id);

  if (snapshot == NULL) {
    set_error(ERR_MISSING_SNAPSHOT);
    return 0;
  }
  if (snapshot->disabled) {
    set_error(ERR_ALREADY_DISABLED);
    return 0;
  }

  snapshot->disabled = 1;
  clear_error();
  return 1;
}

__attribute__((visibility("default"))) int policy_check(int subject_id, int resource_id, int perm_bit,
                                                        int64_t ts) {
  SubjectBinding *binding;
  VersionInspection active;
  Snapshot *chosen = NULL;
  int mask = requested_mask(perm_bit);

  clear_error();

  binding = find_binding(subject_id);
  if (binding == NULL) {
    return 0;
  }

  active = inspect_version(subject_id, binding->active_version, resource_id, ts);
  if (active.best_usable != NULL && snapshot_decides(active.best_usable, mask)) {
    chosen = active.best_usable;
  } else if (binding->fallback_version != 0 && binding->fallback_version != binding->active_version) {
    VersionInspection fallback = inspect_version(subject_id, binding->fallback_version, resource_id, ts);
    chosen = fallback.best_usable;
  }

  if (chosen == NULL) {
    return 0;
  }

  if ((chosen->allow_mask & mask) != mask) {
    return 0;
  }
  if ((chosen->deny_mask & mask) != 0) {
    return 0;
  }

  return 1;
}

__attribute__((visibility("default"))) int
policy_explain_get(int subject_id, int resource_id, int perm_bit, int64_t ts,
                   PolicyExplainView *out_view) {
  SubjectBinding *binding;
  VersionInspection active;
  int mask = requested_mask(perm_bit);

  if (out_view == NULL) {
    set_error(ERR_NULL_OUTPUT);
    return 0;
  }

  clear_view(out_view);

  if (!subject_is_known(subject_id)) {
    clear_error();
    return 0;
  }

  out_view->exists = 1;
  binding = find_binding(subject_id);
  if (binding == NULL) {
    clear_error();
    return 1;
  }

  active = inspect_version(subject_id, binding->active_version, resource_id, ts);
  out_view->stale_snapshot = active.stale_snapshot;
  out_view->disabled_snapshot = active.disabled_snapshot;

  if (active.best_usable != NULL && snapshot_decides(active.best_usable, mask)) {
    fill_view(out_view, active.best_usable, binding->active_version, 0, 1);
  } else {
    VersionInspection fallback;
    int checked_fallback = 0;

    fallback.best_any = NULL;
    fallback.best_usable = NULL;
    fallback.stale_snapshot = 0;
    fallback.disabled_snapshot = 0;

    if (binding->fallback_version != 0 && binding->fallback_version != binding->active_version) {
      fallback = inspect_version(subject_id, binding->fallback_version, resource_id, ts);
      checked_fallback = 1;
      if (fallback.best_usable != NULL) {
        fill_view(out_view, fallback.best_usable, binding->fallback_version, 1, 1);
      } else if (active.best_any != NULL) {
        fill_view(out_view, active.best_any, binding->active_version, 0, 0);
      } else if (fallback.best_any != NULL) {
        fill_view(out_view, fallback.best_any, binding->fallback_version, 1, 0);
      }
    }

    if (!checked_fallback && active.best_any != NULL) {
      fill_view(out_view, active.best_any, binding->active_version, 0, 0);
    }
  }

  clear_error();
  return 1;
}

__attribute__((visibility("default"))) int policy_count_subject_rules(int subject_id, int64_t ts) {
  SubjectBinding *binding;
  int count;

  clear_error();

  binding = find_binding(subject_id);
  if (binding == NULL) {
    return 0;
  }

  count = count_usable_in_version(subject_id, binding->active_version, ts);
  if (binding->fallback_version != 0 && binding->fallback_version != binding->active_version) {
    count += count_usable_in_version(subject_id, binding->fallback_version, ts);
  }

  return count;
}

__attribute__((visibility("default"))) int policy_last_error(void) { return g_last_error; }
