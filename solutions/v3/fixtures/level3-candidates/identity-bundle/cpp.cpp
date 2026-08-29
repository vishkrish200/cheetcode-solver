#include <cstdint>
#include <limits>
#include <mutex>
#include <unordered_map>
#include <utility>
#include <vector>

namespace {

constexpr int kSourceLocal = 1;
constexpr int kSourceBundle = 2;

constexpr int kModeLocalOnly = 1;
constexpr int kModeBundleOnly = 2;
constexpr int kModeAuto = 3;

constexpr int kErrOk = 0;
constexpr int kErrDuplicateId = 1;
constexpr int kErrUnknownGrant = 2;
constexpr int kErrWrongSourceForKey = 3;
constexpr int kErrNonDelegatableParent = 4;
constexpr int kErrPermissionWidening = 5;
constexpr int kErrChildStartBeforeParent = 6;
constexpr int kErrChildExpiryAfterParent = 7;
constexpr int kErrNullOutput = 8;
constexpr int kErrParentRevoked = 9;
constexpr int kErrInvalidResolveMode = 10;

struct SubjectSourceKey {
  int subject_id;
  int source;

  bool operator==(const SubjectSourceKey& other) const noexcept {
    return subject_id == other.subject_id && source == other.source;
  }
};

struct SubjectSourceResourceKey {
  int subject_id;
  int source;
  int resource_id;

  bool operator==(const SubjectSourceResourceKey& other) const noexcept {
    return subject_id == other.subject_id && source == other.source &&
           resource_id == other.resource_id;
  }
};

struct SubjectSourceKeyHash {
  std::size_t operator()(const SubjectSourceKey& key) const noexcept {
    std::size_t h = static_cast<std::size_t>(static_cast<std::uint32_t>(key.subject_id));
    h ^= static_cast<std::size_t>(static_cast<std::uint32_t>(key.source)) +
         0x9e3779b97f4a7c15ULL + (h << 6U) + (h >> 2U);
    return h;
  }
};

struct SubjectSourceResourceKeyHash {
  std::size_t operator()(const SubjectSourceResourceKey& key) const noexcept {
    std::size_t h = SubjectSourceKeyHash{}({key.subject_id, key.source});
    h ^= static_cast<std::size_t>(static_cast<std::uint32_t>(key.resource_id)) +
         0x9e3779b97f4a7c15ULL + (h << 6U) + (h >> 2U);
    return h;
  }
};

struct Grant {
  int source = 0;
  int subject_id = 0;
  int resource_id = 0;
  int stored_mask = 0;
  std::int64_t not_before_ts = 0;
  std::int64_t expires_ts = 0;
  bool delegatable = false;
  bool requires_key = false;
  bool key_attached = false;
  bool revoked = false;
  bool has_parent = false;
  std::size_t parent = 0;
};

struct EvalInfo {
  int effective_mask = 0;
  bool current_revoked = false;
  bool current_requires_key = false;
  bool current_key_attached = false;
  bool current_not_yet_valid = false;
  bool current_expired = false;
  bool disabled_by_ancestor = false;
  bool usable = false;
};

struct State {
  std::vector<Grant> grants;
  std::unordered_map<int, std::size_t> id_to_idx;
  std::unordered_map<SubjectSourceKey, std::vector<std::size_t>, SubjectSourceKeyHash>
      by_subject_source;
  std::unordered_map<SubjectSourceResourceKey, std::vector<std::size_t>,
                     SubjectSourceResourceKeyHash>
      by_subject_source_resource;
  std::unordered_map<int, int> bundle_grant_counts;
  int last_error = kErrOk;

  void reset() {
    grants.clear();
    id_to_idx.clear();
    by_subject_source.clear();
    by_subject_source_resource.clear();
    bundle_grant_counts.clear();
    last_error = kErrOk;
  }

  int set_error(int code) {
    last_error = code;
    return 0;
  }

  int set_success() {
    last_error = kErrOk;
    return 1;
  }

  std::pair<bool, std::size_t> get_idx(int grant_id) const {
    const auto it = id_to_idx.find(grant_id);
    if (it == id_to_idx.end()) {
      return {false, 0};
    }
    return {true, it->second};
  }

  bool has_bundle_grant_for_subject(int subject_id) const {
    const auto it = bundle_grant_counts.find(subject_id);
    return it != bundle_grant_counts.end() && it->second > 0;
  }

  void add_grant(int grant_id, const Grant& grant) {
    const std::size_t idx = grants.size();
    grants.push_back(grant);
    id_to_idx.emplace(grant_id, idx);
    by_subject_source[{grant.subject_id, grant.source}].push_back(idx);
    by_subject_source_resource[{grant.subject_id, grant.source, grant.resource_id}].push_back(idx);
    if (grant.source == kSourceBundle) {
      ++bundle_grant_counts[grant.subject_id];
    }
  }

  std::pair<bool, int> chosen_source(int subject_id, int resolve_mode) const {
    switch (resolve_mode) {
      case kModeLocalOnly:
        return {true, kSourceLocal};
      case kModeBundleOnly:
        return {true, kSourceBundle};
      case kModeAuto:
        return {true, has_bundle_grant_for_subject(subject_id) ? kSourceBundle : kSourceLocal};
      default:
        return {false, kErrInvalidResolveMode};
    }
  }

  EvalInfo eval_grant(std::size_t idx, std::int64_t ts) const {
    const Grant& grant = grants[idx];
    EvalInfo eval;
    eval.current_requires_key = grant.requires_key;
    eval.current_key_attached = !grant.requires_key || grant.key_attached;
    eval.current_not_yet_valid = ts < grant.not_before_ts;
    eval.current_expired = ts >= grant.expires_ts;
    eval.current_revoked = grant.revoked;

    const bool current_directly_disabled =
        eval.current_revoked || eval.current_not_yet_valid || eval.current_expired ||
        (grant.requires_key && !grant.key_attached);

    int effective_mask = grant.stored_mask;
    bool has_cursor = grant.has_parent;
    std::size_t cursor = grant.parent;
    while (has_cursor) {
      const Grant& parent = grants[cursor];
      effective_mask &= parent.stored_mask;
      const bool parent_disabled = parent.revoked || ts < parent.not_before_ts ||
                                   ts >= parent.expires_ts ||
                                   (parent.requires_key && !parent.key_attached);
      if (parent_disabled) {
        eval.disabled_by_ancestor = true;
      }
      has_cursor = parent.has_parent;
      cursor = parent.parent;
    }

    eval.usable = !current_directly_disabled && !eval.disabled_by_ancestor && effective_mask != 0;
    eval.effective_mask = eval.usable ? effective_mask : 0;
    return eval;
  }
};

State& state() {
  static State resolver_state;
  return resolver_state;
}

std::mutex& state_mutex() {
  static std::mutex resolver_mutex;
  return resolver_mutex;
}

int bool_to_int(bool value) {
  return value ? 1 : 0;
}

int saturated_i32_count(std::size_t count) {
  if (count > static_cast<std::size_t>(std::numeric_limits<int>::max())) {
    return std::numeric_limits<int>::max();
  }
  return static_cast<int>(count);
}

}  // namespace

extern "C" {

struct AuthAuditView {
  int exists;
  int source;
  int stored_mask;
  int effective_mask;
  int revoked;
  int requires_key;
  int key_attached;
  int not_yet_valid;
  int expired;
  int disabled_by_ancestor;
  int usable;
};

__attribute__((visibility("default"))) void auth_reset(void) {
  std::lock_guard<std::mutex> lock(state_mutex());
  state().reset();
}

__attribute__((visibility("default"))) int auth_create_local_grant(
    int grant_id, int subject_id, int resource_id, int perms_mask,
    std::int64_t not_before_ts, std::int64_t expires_ts, int delegatable) {
  std::lock_guard<std::mutex> lock(state_mutex());
  State& s = state();
  if (s.id_to_idx.find(grant_id) != s.id_to_idx.end()) {
    return s.set_error(kErrDuplicateId);
  }

  Grant grant;
  grant.source = kSourceLocal;
  grant.subject_id = subject_id;
  grant.resource_id = resource_id;
  grant.stored_mask = perms_mask;
  grant.not_before_ts = not_before_ts;
  grant.expires_ts = expires_ts;
  grant.delegatable = delegatable != 0;
  grant.requires_key = false;
  grant.key_attached = true;
  s.add_grant(grant_id, grant);
  return s.set_success();
}

__attribute__((visibility("default"))) int auth_import_bundle_grant(
    int grant_id, int subject_id, int resource_id, int perms_mask,
    std::int64_t not_before_ts, std::int64_t expires_ts, int delegatable,
    int requires_key) {
  std::lock_guard<std::mutex> lock(state_mutex());
  State& s = state();
  if (s.id_to_idx.find(grant_id) != s.id_to_idx.end()) {
    return s.set_error(kErrDuplicateId);
  }

  const bool requires_key_flag = requires_key != 0;
  Grant grant;
  grant.source = kSourceBundle;
  grant.subject_id = subject_id;
  grant.resource_id = resource_id;
  grant.stored_mask = perms_mask;
  grant.not_before_ts = not_before_ts;
  grant.expires_ts = expires_ts;
  grant.delegatable = delegatable != 0;
  grant.requires_key = requires_key_flag;
  grant.key_attached = !requires_key_flag;
  s.add_grant(grant_id, grant);
  return s.set_success();
}

__attribute__((visibility("default"))) int auth_attach_bundle_key(int grant_id) {
  std::lock_guard<std::mutex> lock(state_mutex());
  State& s = state();
  const auto idx = s.get_idx(grant_id);
  if (!idx.first) {
    return s.set_error(kErrUnknownGrant);
  }

  Grant& grant = s.grants[idx.second];
  if (grant.source != kSourceBundle) {
    return s.set_error(kErrWrongSourceForKey);
  }
  grant.key_attached = true;
  return s.set_success();
}

__attribute__((visibility("default"))) int auth_delegate(
    int parent_grant_id, int child_grant_id, int subject_id, int resource_id, int perms_mask,
    std::int64_t not_before_ts, std::int64_t expires_ts, int delegatable, int requires_key) {
  std::lock_guard<std::mutex> lock(state_mutex());
  State& s = state();
  if (s.id_to_idx.find(child_grant_id) != s.id_to_idx.end()) {
    return s.set_error(kErrDuplicateId);
  }

  const auto parent_idx = s.get_idx(parent_grant_id);
  if (!parent_idx.first) {
    return s.set_error(kErrUnknownGrant);
  }

  const Grant& parent = s.grants[parent_idx.second];
  if (parent.revoked) {
    return s.set_error(kErrParentRevoked);
  }
  if (!parent.delegatable) {
    return s.set_error(kErrNonDelegatableParent);
  }
  if ((perms_mask & ~parent.stored_mask) != 0) {
    return s.set_error(kErrPermissionWidening);
  }
  if (not_before_ts < parent.not_before_ts) {
    return s.set_error(kErrChildStartBeforeParent);
  }
  if (expires_ts > parent.expires_ts) {
    return s.set_error(kErrChildExpiryAfterParent);
  }

  const bool child_requires_key = parent.source == kSourceBundle && requires_key != 0;
  Grant grant;
  grant.source = parent.source;
  grant.subject_id = subject_id;
  grant.resource_id = resource_id;
  grant.stored_mask = perms_mask;
  grant.not_before_ts = not_before_ts;
  grant.expires_ts = expires_ts;
  grant.delegatable = delegatable != 0;
  grant.requires_key = child_requires_key;
  grant.key_attached = !child_requires_key;
  grant.has_parent = true;
  grant.parent = parent_idx.second;
  s.add_grant(child_grant_id, grant);
  return s.set_success();
}

__attribute__((visibility("default"))) int auth_revoke(int grant_id) {
  std::lock_guard<std::mutex> lock(state_mutex());
  State& s = state();
  const auto idx = s.get_idx(grant_id);
  if (!idx.first) {
    return s.set_error(kErrUnknownGrant);
  }

  s.grants[idx.second].revoked = true;
  return s.set_success();
}

__attribute__((visibility("default"))) int auth_check(
    int subject_id, int resource_id, int perm_bit, std::int64_t ts, int resolve_mode) {
  std::lock_guard<std::mutex> lock(state_mutex());
  State& s = state();
  const auto source = s.chosen_source(subject_id, resolve_mode);
  if (!source.first) {
    return s.set_error(source.second);
  }

  bool authorized = false;
  const auto it = s.by_subject_source_resource.find({subject_id, source.second, resource_id});
  if (it != s.by_subject_source_resource.end()) {
    for (std::size_t idx : it->second) {
      const EvalInfo eval = s.eval_grant(idx, ts);
      if ((eval.effective_mask & perm_bit) != 0) {
        authorized = true;
        break;
      }
    }
  }
  s.last_error = kErrOk;
  return bool_to_int(authorized);
}

__attribute__((visibility("default"))) int auth_effective_mask(int grant_id, std::int64_t ts) {
  std::lock_guard<std::mutex> lock(state_mutex());
  State& s = state();
  const auto idx = s.get_idx(grant_id);
  if (!idx.first) {
    s.last_error = kErrUnknownGrant;
    return 0;
  }

  const int result = s.eval_grant(idx.second, ts).effective_mask;
  s.last_error = kErrOk;
  return result;
}

__attribute__((visibility("default"))) int auth_audit_get(
    int grant_id, std::int64_t ts, AuthAuditView* out_view) {
  std::lock_guard<std::mutex> lock(state_mutex());
  State& s = state();
  if (out_view == nullptr) {
    return s.set_error(kErrNullOutput);
  }

  const auto idx = s.get_idx(grant_id);
  if (!idx.first) {
    return s.set_error(kErrUnknownGrant);
  }

  const Grant& grant = s.grants[idx.second];
  const EvalInfo eval = s.eval_grant(idx.second, ts);
  *out_view = AuthAuditView{
      1,
      grant.source,
      grant.stored_mask,
      eval.effective_mask,
      bool_to_int(eval.current_revoked),
      bool_to_int(eval.current_requires_key),
      bool_to_int(eval.current_key_attached),
      bool_to_int(eval.current_not_yet_valid),
      bool_to_int(eval.current_expired),
      bool_to_int(eval.disabled_by_ancestor),
      bool_to_int(eval.usable),
  };
  return s.set_success();
}

__attribute__((visibility("default"))) int auth_count_usable(
    int subject_id, std::int64_t ts, int resolve_mode) {
  std::lock_guard<std::mutex> lock(state_mutex());
  State& s = state();
  const auto source = s.chosen_source(subject_id, resolve_mode);
  if (!source.first) {
    return s.set_error(source.second);
  }

  std::size_t count = 0;
  const auto it = s.by_subject_source.find({subject_id, source.second});
  if (it != s.by_subject_source.end()) {
    for (std::size_t idx : it->second) {
      if (s.eval_grant(idx, ts).effective_mask != 0) {
        ++count;
      }
    }
  }
  s.last_error = kErrOk;
  return saturated_i32_count(count);
}

__attribute__((visibility("default"))) int auth_last_error(void) {
  std::lock_guard<std::mutex> lock(state_mutex());
  return state().last_error;
}

}  // extern "C"
