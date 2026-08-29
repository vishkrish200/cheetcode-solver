#include <cstdint>
#include <mutex>
#include <stdexcept>
#include <unordered_map>
#include <unordered_set>
#include <vector>

extern "C" {

struct PolicyExplainView {
  int exists;
  int matched_snapshot_id;
  int decided_version;
  int allow_mask;
  int deny_mask;
  int fallback_used;
  int stale_snapshot;
  int disabled_snapshot;
  int usable;
};

}

namespace {

constexpr int ERR_NONE = 0;
constexpr int ERR_INVALID_ARGUMENT = -1;
constexpr int ERR_DUPLICATE_SNAPSHOT = -2;
constexpr int ERR_MISSING_BINDING = -3;
constexpr int ERR_MISSING_STAGED_VERSION = -4;
constexpr int ERR_MISSING_SNAPSHOT = -5;
constexpr int ERR_ALREADY_RETIRED = -6;
constexpr int ERR_ALREADY_DISABLED = -7;
constexpr int ERR_NULL_OUTPUT = -8;
constexpr int ERR_ALLOCATION = -9;

struct Snapshot {
  int snapshot_id = 0;
  int version = 0;
  int subject_id = 0;
  int resource_id = 0;
  int allow_mask = 0;
  int deny_mask = 0;
  int priority = 0;
  std::int64_t not_before_ts = 0;
  std::int64_t expires_ts = 0;
  bool retired = false;
  bool disabled = false;
};

struct SubjectBinding {
  int active_version = 0;
  int fallback_version = 0;
  int staged_version = 0;
};

struct PairKey {
  int first = 0;
  int second = 0;

  bool operator==(const PairKey &other) const {
    return first == other.first && second == other.second;
  }
};

struct TripleKey {
  int first = 0;
  int second = 0;
  int third = 0;

  bool operator==(const TripleKey &other) const {
    return first == other.first && second == other.second && third == other.third;
  }
};

std::uint32_t mix_u32(std::uint32_t value) {
  value ^= value >> 16;
  value *= 0x7feb352dU;
  value ^= value >> 15;
  value *= 0x846ca68bU;
  value ^= value >> 16;
  return value;
}

struct PairHash {
  std::size_t operator()(const PairKey &key) const {
    std::uint32_t mixed = mix_u32(static_cast<std::uint32_t>(key.first));
    mixed ^= mix_u32(static_cast<std::uint32_t>(key.second)) + 0x9e3779b9U + (mixed << 6) +
             (mixed >> 2);
    return static_cast<std::size_t>(mix_u32(mixed));
  }
};

struct TripleHash {
  std::size_t operator()(const TripleKey &key) const {
    std::uint32_t mixed = mix_u32(static_cast<std::uint32_t>(key.first));
    mixed ^= mix_u32(static_cast<std::uint32_t>(key.second)) + 0x9e3779b9U + (mixed << 6) +
             (mixed >> 2);
    mixed ^= mix_u32(static_cast<std::uint32_t>(key.third)) + 0x9e3779b9U + (mixed << 6) +
             (mixed >> 2);
    return static_cast<std::size_t>(mix_u32(mixed));
  }
};

struct VersionInspection {
  int best_any_id = 0;
  int best_usable_id = 0;
  int stale_snapshot = 0;
  int disabled_snapshot = 0;
};

struct Engine {
  int last_error = ERR_NONE;
  std::unordered_map<int, Snapshot> snapshots;
  std::unordered_map<int, SubjectBinding> bindings;
  std::unordered_set<int> known_subjects;
  std::unordered_map<PairKey, std::vector<int>, PairHash> by_subject_version;
  std::unordered_map<TripleKey, std::vector<int>, TripleHash> by_subject_version_resource;

  void reset() {
    last_error = ERR_NONE;
    snapshots.clear();
    bindings.clear();
    known_subjects.clear();
    by_subject_version.clear();
    by_subject_version_resource.clear();
  }

  void set_error(int error) { last_error = error; }

  void clear_error() { last_error = ERR_NONE; }
};

Engine g_engine;
std::mutex g_mutex;

bool snapshot_is_usable(const Snapshot &snapshot, std::int64_t ts) {
  return !snapshot.retired && !snapshot.disabled && snapshot.not_before_ts <= ts &&
         ts < snapshot.expires_ts;
}

bool snapshot_is_stale(const Snapshot &snapshot, std::int64_t ts) {
  return snapshot.retired || ts < snapshot.not_before_ts || ts >= snapshot.expires_ts;
}

bool snapshot_better(const Snapshot &candidate, const Snapshot &current) {
  return candidate.priority > current.priority ||
         (candidate.priority == current.priority &&
          candidate.snapshot_id > current.snapshot_id);
}

const Snapshot *find_snapshot(const Engine &engine, int snapshot_id) {
  const auto found = engine.snapshots.find(snapshot_id);
  if (found == engine.snapshots.end()) {
    return nullptr;
  }
  return &found->second;
}

Snapshot *find_snapshot_mut(Engine &engine, int snapshot_id) {
  const auto found = engine.snapshots.find(snapshot_id);
  if (found == engine.snapshots.end()) {
    return nullptr;
  }
  return &found->second;
}

VersionInspection inspect_version(const Engine &engine, int subject_id, int version,
                                  int resource_id, std::int64_t ts) {
  VersionInspection inspection;
  if (version == 0) {
    return inspection;
  }

  const auto found =
      engine.by_subject_version_resource.find(TripleKey{subject_id, version, resource_id});
  if (found == engine.by_subject_version_resource.end()) {
    return inspection;
  }

  const Snapshot *best_any = nullptr;
  const Snapshot *best_usable = nullptr;
  for (const int snapshot_id : found->second) {
    const Snapshot *snapshot = find_snapshot(engine, snapshot_id);
    if (snapshot == nullptr) {
      continue;
    }

    if (snapshot->disabled) {
      inspection.disabled_snapshot = 1;
    }
    if (snapshot_is_stale(*snapshot, ts)) {
      inspection.stale_snapshot = 1;
    }

    if (best_any == nullptr || snapshot_better(*snapshot, *best_any)) {
      best_any = snapshot;
    }
    if (snapshot_is_usable(*snapshot, ts) &&
        (best_usable == nullptr || snapshot_better(*snapshot, *best_usable))) {
      best_usable = snapshot;
    }
  }

  if (best_any != nullptr) {
    inspection.best_any_id = best_any->snapshot_id;
  }
  if (best_usable != nullptr) {
    inspection.best_usable_id = best_usable->snapshot_id;
  }
  return inspection;
}

void clear_view(PolicyExplainView *view) {
  *view = PolicyExplainView{};
}

void fill_view(PolicyExplainView *view, const Snapshot &snapshot, int decided_version,
               int fallback_used, int usable) {
  view->matched_snapshot_id = snapshot.snapshot_id;
  view->decided_version = decided_version;
  view->allow_mask = snapshot.allow_mask;
  view->deny_mask = snapshot.deny_mask;
  view->fallback_used = fallback_used;
  view->usable = usable;
}

int count_usable_in_version(const Engine &engine, int subject_id, int version, std::int64_t ts) {
  if (version == 0) {
    return 0;
  }

  const auto found = engine.by_subject_version.find(PairKey{subject_id, version});
  if (found == engine.by_subject_version.end()) {
    return 0;
  }

  int count = 0;
  for (const int snapshot_id : found->second) {
    const Snapshot *snapshot = find_snapshot(engine, snapshot_id);
    if (snapshot != nullptr && snapshot_is_usable(*snapshot, ts)) {
      ++count;
    }
  }
  return count;
}

int handle_bad_alloc(Engine &engine) {
  engine.set_error(ERR_ALLOCATION);
  return 0;
}

int requested_mask(int perm_bit) {
  if (perm_bit >= 0 && perm_bit < 31) {
    return 1 << perm_bit;
  }
  return perm_bit;
}

}  // namespace

extern "C" __attribute__((visibility("default"))) void policy_reset() {
  std::lock_guard<std::mutex> lock(g_mutex);
  g_engine.reset();
}

extern "C" __attribute__((visibility("default"))) int policy_publish_snapshot(
    int snapshot_id, int version, int subject_id, int resource_id, int allow_mask, int deny_mask,
    int priority, std::int64_t not_before_ts, std::int64_t expires_ts) {
  std::lock_guard<std::mutex> lock(g_mutex);

  if (snapshot_id <= 0 || version <= 0 || not_before_ts >= expires_ts) {
    g_engine.set_error(ERR_INVALID_ARGUMENT);
    return 0;
  }
  if (g_engine.snapshots.find(snapshot_id) != g_engine.snapshots.end()) {
    g_engine.set_error(ERR_DUPLICATE_SNAPSHOT);
    return 0;
  }

  try {
    Snapshot snapshot;
    snapshot.snapshot_id = snapshot_id;
    snapshot.version = version;
    snapshot.subject_id = subject_id;
    snapshot.resource_id = resource_id;
    snapshot.allow_mask = allow_mask;
    snapshot.deny_mask = deny_mask;
    snapshot.priority = priority;
    snapshot.not_before_ts = not_before_ts;
    snapshot.expires_ts = expires_ts;

    g_engine.snapshots.emplace(snapshot_id, snapshot);
    g_engine.known_subjects.insert(subject_id);
    g_engine.by_subject_version[PairKey{subject_id, version}].push_back(snapshot_id);
    g_engine.by_subject_version_resource[TripleKey{subject_id, version, resource_id}].push_back(
        snapshot_id);
  } catch (const std::bad_alloc &) {
    return handle_bad_alloc(g_engine);
  }

  g_engine.clear_error();
  return 1;
}

extern "C" __attribute__((visibility("default"))) int policy_set_subject_binding(
    int subject_id, int active_version, int fallback_version) {
  std::lock_guard<std::mutex> lock(g_mutex);

  if (active_version <= 0 || fallback_version < 0) {
    g_engine.set_error(ERR_INVALID_ARGUMENT);
    return 0;
  }

  try {
    g_engine.bindings[subject_id] = SubjectBinding{active_version, fallback_version, 0};
    g_engine.known_subjects.insert(subject_id);
  } catch (const std::bad_alloc &) {
    return handle_bad_alloc(g_engine);
  }

  g_engine.clear_error();
  return 1;
}

extern "C" __attribute__((visibility("default"))) int policy_stage_version(int subject_id,
                                                                            int staged_version) {
  std::lock_guard<std::mutex> lock(g_mutex);

  if (staged_version <= 0) {
    g_engine.set_error(ERR_INVALID_ARGUMENT);
    return 0;
  }

  const auto found = g_engine.bindings.find(subject_id);
  if (found == g_engine.bindings.end()) {
    g_engine.set_error(ERR_MISSING_BINDING);
    return 0;
  }

  found->second.staged_version = staged_version;
  g_engine.clear_error();
  return 1;
}

extern "C" __attribute__((visibility("default"))) int policy_activate_version(int subject_id) {
  std::lock_guard<std::mutex> lock(g_mutex);

  const auto found = g_engine.bindings.find(subject_id);
  if (found == g_engine.bindings.end()) {
    g_engine.set_error(ERR_MISSING_BINDING);
    return 0;
  }

  SubjectBinding &binding = found->second;
  if (binding.staged_version == 0) {
    g_engine.set_error(ERR_MISSING_STAGED_VERSION);
    return 0;
  }

  const int previous_active = binding.active_version;
  binding.active_version = binding.staged_version;
  binding.fallback_version = previous_active;
  binding.staged_version = 0;

  g_engine.clear_error();
  return 1;
}

extern "C" __attribute__((visibility("default"))) int policy_retire_snapshot(int snapshot_id) {
  std::lock_guard<std::mutex> lock(g_mutex);

  Snapshot *snapshot = find_snapshot_mut(g_engine, snapshot_id);
  if (snapshot == nullptr) {
    g_engine.set_error(ERR_MISSING_SNAPSHOT);
    return 0;
  }
  if (snapshot->retired) {
    g_engine.set_error(ERR_ALREADY_RETIRED);
    return 0;
  }

  snapshot->retired = true;
  g_engine.clear_error();
  return 1;
}

extern "C" __attribute__((visibility("default"))) int policy_disable_snapshot(int snapshot_id) {
  std::lock_guard<std::mutex> lock(g_mutex);

  Snapshot *snapshot = find_snapshot_mut(g_engine, snapshot_id);
  if (snapshot == nullptr) {
    g_engine.set_error(ERR_MISSING_SNAPSHOT);
    return 0;
  }
  if (snapshot->disabled) {
    g_engine.set_error(ERR_ALREADY_DISABLED);
    return 0;
  }

  snapshot->disabled = true;
  g_engine.clear_error();
  return 1;
}

extern "C" __attribute__((visibility("default"))) int policy_check(
    int subject_id, int resource_id, int perm_bit, std::int64_t ts) {
  std::lock_guard<std::mutex> lock(g_mutex);
  g_engine.clear_error();

  const auto binding_found = g_engine.bindings.find(subject_id);
  if (binding_found == g_engine.bindings.end()) {
    return 0;
  }
  const int perm_mask = requested_mask(perm_bit);

  const SubjectBinding &binding = binding_found->second;
  const VersionInspection active =
      inspect_version(g_engine, subject_id, binding.active_version, resource_id, ts);

  int chosen_snapshot_id = active.best_usable_id;
  if (chosen_snapshot_id == 0 && binding.fallback_version != 0 &&
      binding.fallback_version != binding.active_version) {
    const VersionInspection fallback =
        inspect_version(g_engine, subject_id, binding.fallback_version, resource_id, ts);
    chosen_snapshot_id = fallback.best_usable_id;
  }

  const Snapshot *chosen = find_snapshot(g_engine, chosen_snapshot_id);
  if (chosen == nullptr) {
    return 0;
  }

  const bool allowed = (chosen->allow_mask & perm_mask) == perm_mask;
  const bool denied = (chosen->deny_mask & perm_mask) != 0;
  return allowed && !denied ? 1 : 0;
}

extern "C" __attribute__((visibility("default"))) int policy_explain_get(
    int subject_id, int resource_id, int perm_bit, std::int64_t ts,
    PolicyExplainView *out_view) {
  (void)perm_bit;
  std::lock_guard<std::mutex> lock(g_mutex);

  if (out_view == nullptr) {
    g_engine.set_error(ERR_NULL_OUTPUT);
    return 0;
  }

  clear_view(out_view);
  if (g_engine.known_subjects.find(subject_id) == g_engine.known_subjects.end()) {
    g_engine.clear_error();
    return 0;
  }

  out_view->exists = 1;
  const auto binding_found = g_engine.bindings.find(subject_id);
  if (binding_found == g_engine.bindings.end()) {
    g_engine.clear_error();
    return 1;
  }

  const SubjectBinding &binding = binding_found->second;
  const VersionInspection active =
      inspect_version(g_engine, subject_id, binding.active_version, resource_id, ts);
  out_view->stale_snapshot = active.stale_snapshot;
  out_view->disabled_snapshot = active.disabled_snapshot;

  if (active.best_usable_id != 0) {
    const Snapshot *snapshot = find_snapshot(g_engine, active.best_usable_id);
    if (snapshot != nullptr) {
      fill_view(out_view, *snapshot, binding.active_version, 0, 1);
    }
  } else {
    VersionInspection fallback;
    bool checked_fallback = false;

    if (binding.fallback_version != 0 && binding.fallback_version != binding.active_version) {
      fallback = inspect_version(g_engine, subject_id, binding.fallback_version, resource_id, ts);
      checked_fallback = true;

      if (fallback.best_usable_id != 0) {
        const Snapshot *snapshot = find_snapshot(g_engine, fallback.best_usable_id);
        if (snapshot != nullptr) {
          fill_view(out_view, *snapshot, binding.fallback_version, 1, 1);
        }
      } else if (active.best_any_id != 0) {
        const Snapshot *snapshot = find_snapshot(g_engine, active.best_any_id);
        if (snapshot != nullptr) {
          fill_view(out_view, *snapshot, binding.active_version, 0, 0);
        }
      } else if (fallback.best_any_id != 0) {
        const Snapshot *snapshot = find_snapshot(g_engine, fallback.best_any_id);
        if (snapshot != nullptr) {
          fill_view(out_view, *snapshot, binding.fallback_version, 1, 0);
        }
      }
    }

    if (!checked_fallback && active.best_any_id != 0) {
      const Snapshot *snapshot = find_snapshot(g_engine, active.best_any_id);
      if (snapshot != nullptr) {
        fill_view(out_view, *snapshot, binding.active_version, 0, 0);
      }
    }
  }

  g_engine.clear_error();
  return 1;
}

extern "C" __attribute__((visibility("default"))) int policy_count_subject_rules(
    int subject_id, std::int64_t ts) {
  std::lock_guard<std::mutex> lock(g_mutex);
  g_engine.clear_error();

  const auto binding_found = g_engine.bindings.find(subject_id);
  if (binding_found == g_engine.bindings.end()) {
    return 0;
  }

  const SubjectBinding &binding = binding_found->second;
  int count = count_usable_in_version(g_engine, subject_id, binding.active_version, ts);
  if (binding.fallback_version != 0 && binding.fallback_version != binding.active_version) {
    count += count_usable_in_version(g_engine, subject_id, binding.fallback_version, ts);
  }
  return count;
}

extern "C" __attribute__((visibility("default"))) int policy_last_error() {
  std::lock_guard<std::mutex> lock(g_mutex);
  return g_engine.last_error;
}
