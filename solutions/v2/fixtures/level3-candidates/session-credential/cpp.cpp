#include <cstdint>
#include <mutex>
#include <new>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <vector>

enum ErrorCode {
  ERR_NONE = 0,
  ERR_SESSION_EXISTS = 1,
  ERR_SESSION_NOT_FOUND = 2,
  ERR_INVALID_GENERATION = 3,
  ERR_STAGED_GENERATION_EXISTS = 4,
  ERR_NO_STAGED_GENERATION = 5,
  ERR_CREDENTIAL_EXISTS = 6,
  ERR_INVALID_CREDENTIAL_WINDOW = 7,
  ERR_NULL_POINTER = 8,
  ERR_OUT_OF_MEMORY = 9,
};

typedef struct SessionAuditView {
  int exists;
  int session_revoked;
  int active_generation;
  int staged_generation;
  int presented_generation;
  int grace_generation;
  int grace_active;
  int generation_revoked;
  int compatible;
  int usable;
} SessionAuditView;

namespace {

struct CredentialWindow {
  int64_t issued_ts;
  int64_t expires_ts;
};

struct GenerationState {
  bool revoked = false;
  std::vector<CredentialWindow> windows;
};

struct Session {
  int subject_id = 0;
  int resource_id = 0;
  int active_generation = 0;
  int staged_generation = -1;
  bool has_staged = false;
  int grace_generation = -1;
  bool has_grace = false;
  int64_t grace_until_ts = 0;
  bool session_revoked = false;
  std::unordered_map<int, GenerationState> generations;
};

struct Registry {
  std::unordered_map<int, Session> sessions;
  std::unordered_set<int> credential_ids;
  int last_error = ERR_NONE;
};

Registry &registry() {
  static Registry instance;
  return instance;
}

std::mutex &registry_mutex() {
  static std::mutex instance;
  return instance;
}

void set_error(Registry &reg, int err) { reg.last_error = err; }

int bool_int(bool value) { return value ? 1 : 0; }

bool grace_is_active(const Session &session, int64_t ts) {
  return session.has_grace && ts <= session.grace_until_ts;
}

bool generation_compatible(const Session &session, int generation, int64_t ts) {
  return generation == session.active_generation ||
         (grace_is_active(session, ts) &&
          generation == session.grace_generation);
}

bool generation_revoked(const Session &session, int generation) {
  const auto found = session.generations.find(generation);
  return found != session.generations.end() && found->second.revoked;
}

bool generation_has_valid_credential(const GenerationState *generation,
                                     int64_t ts) {
  if (generation == nullptr || generation->windows.empty()) {
    return true;
  }
  for (const CredentialWindow &window : generation->windows) {
    if (window.issued_ts <= ts && ts < window.expires_ts) {
      return true;
    }
  }
  return false;
}

bool generation_usable(const Session &session, int generation, int64_t ts) {
  if (!generation_compatible(session, generation, ts)) {
    return false;
  }
  if (session.session_revoked || generation_revoked(session, generation)) {
    return false;
  }
  const auto found = session.generations.find(generation);
  const GenerationState *state =
      found == session.generations.end() ? nullptr : &found->second;
  return generation_has_valid_credential(state, ts);
}

void clear_view(SessionAuditView *out_view) {
  *out_view = SessionAuditView{0, 0, 0, 0, 0, 0, 0, 0, 0, 0};
}

} // namespace

extern "C" __attribute__((visibility("default"))) void session_reset(void) {
  std::lock_guard<std::mutex> lock(registry_mutex());
  Registry &reg = registry();
  reg = Registry{};
  reg.last_error = ERR_NONE;
}

extern "C" __attribute__((visibility("default"))) int
session_create(int session_id, int subject_id, int resource_id,
               int active_generation) {
  try {
    std::lock_guard<std::mutex> lock(registry_mutex());
    Registry &reg = registry();

    if (active_generation < 0) {
      set_error(reg, ERR_INVALID_GENERATION);
      return 0;
    }
    if (reg.sessions.find(session_id) != reg.sessions.end()) {
      set_error(reg, ERR_SESSION_EXISTS);
      return 0;
    }

    Session session;
    session.subject_id = subject_id;
    session.resource_id = resource_id;
    session.active_generation = active_generation;
    session.generations.emplace(active_generation, GenerationState{});
    reg.sessions.emplace(session_id, std::move(session));

    set_error(reg, ERR_NONE);
    return 1;
  } catch (const std::bad_alloc &) {
    Registry &reg = registry();
    set_error(reg, ERR_OUT_OF_MEMORY);
    return 0;
  }
}

extern "C" __attribute__((visibility("default"))) int
session_issue_credential(int credential_id, int session_id, int generation,
                         int64_t issued_ts, int64_t expires_ts) {
  try {
    std::lock_guard<std::mutex> lock(registry_mutex());
    Registry &reg = registry();

    if (generation < 0) {
      set_error(reg, ERR_INVALID_GENERATION);
      return 0;
    }
    if (expires_ts <= issued_ts) {
      set_error(reg, ERR_INVALID_CREDENTIAL_WINDOW);
      return 0;
    }
    if (reg.credential_ids.find(credential_id) != reg.credential_ids.end()) {
      set_error(reg, ERR_CREDENTIAL_EXISTS);
      return 0;
    }

    auto session_it = reg.sessions.find(session_id);
    if (session_it == reg.sessions.end()) {
      set_error(reg, ERR_SESSION_NOT_FOUND);
      return 0;
    }

    Session &session = session_it->second;
    session.generations[generation].windows.push_back(
        CredentialWindow{issued_ts, expires_ts});
    reg.credential_ids.insert(credential_id);

    set_error(reg, ERR_NONE);
    return 1;
  } catch (const std::bad_alloc &) {
    Registry &reg = registry();
    set_error(reg, ERR_OUT_OF_MEMORY);
    return 0;
  }
}

extern "C" __attribute__((visibility("default"))) int
session_stage_generation(int session_id, int generation,
                         int64_t grace_until_ts) {
  try {
    std::lock_guard<std::mutex> lock(registry_mutex());
    Registry &reg = registry();

    if (generation < 0) {
      set_error(reg, ERR_INVALID_GENERATION);
      return 0;
    }

    auto session_it = reg.sessions.find(session_id);
    if (session_it == reg.sessions.end()) {
      set_error(reg, ERR_SESSION_NOT_FOUND);
      return 0;
    }

    Session &session = session_it->second;
    if (generation == session.active_generation) {
      set_error(reg, ERR_INVALID_GENERATION);
      return 0;
    }
    if (session.has_staged) {
      set_error(reg, ERR_STAGED_GENERATION_EXISTS);
      return 0;
    }

    session.generations.try_emplace(generation);
    session.has_staged = true;
    session.staged_generation = generation;
    session.grace_until_ts = grace_until_ts;

    set_error(reg, ERR_NONE);
    return 1;
  } catch (const std::bad_alloc &) {
    Registry &reg = registry();
    set_error(reg, ERR_OUT_OF_MEMORY);
    return 0;
  }
}

extern "C" __attribute__((visibility("default"))) int
session_activate_generation(int session_id, int64_t ts) {
  (void)ts;
  std::lock_guard<std::mutex> lock(registry_mutex());
  Registry &reg = registry();

  auto session_it = reg.sessions.find(session_id);
  if (session_it == reg.sessions.end()) {
    set_error(reg, ERR_SESSION_NOT_FOUND);
    return 0;
  }

  Session &session = session_it->second;
  if (!session.has_staged) {
    set_error(reg, ERR_NO_STAGED_GENERATION);
    return 0;
  }

  session.has_grace = true;
  session.grace_generation = session.active_generation;
  session.active_generation = session.staged_generation;
  session.staged_generation = -1;
  session.has_staged = false;

  set_error(reg, ERR_NONE);
  return 1;
}

extern "C" __attribute__((visibility("default"))) int session_revoke(int session_id,
                                                          int generation) {
  try {
    std::lock_guard<std::mutex> lock(registry_mutex());
    Registry &reg = registry();

    auto session_it = reg.sessions.find(session_id);
    if (session_it == reg.sessions.end()) {
      set_error(reg, ERR_SESSION_NOT_FOUND);
      return 0;
    }

    Session &session = session_it->second;
    if (generation == -1) {
      session.session_revoked = true;
      set_error(reg, ERR_NONE);
      return 1;
    }
    if (generation < 0) {
      set_error(reg, ERR_INVALID_GENERATION);
      return 0;
    }

    session.generations[generation].revoked = true;
    set_error(reg, ERR_NONE);
    return 1;
  } catch (const std::bad_alloc &) {
    Registry &reg = registry();
    set_error(reg, ERR_OUT_OF_MEMORY);
    return 0;
  }
}

extern "C" __attribute__((visibility("default"))) int
session_check(int session_id, int generation, int64_t ts) {
  std::lock_guard<std::mutex> lock(registry_mutex());
  Registry &reg = registry();

  if (generation < 0) {
    set_error(reg, ERR_INVALID_GENERATION);
    return 0;
  }

  const auto session_it = reg.sessions.find(session_id);
  if (session_it == reg.sessions.end()) {
    set_error(reg, ERR_SESSION_NOT_FOUND);
    return 0;
  }

  set_error(reg, ERR_NONE);
  return bool_int(generation_usable(session_it->second, generation, ts));
}

extern "C" __attribute__((visibility("default"))) int
session_audit_get(int session_id, int generation, int64_t ts,
                  SessionAuditView *out_view) {
  std::lock_guard<std::mutex> lock(registry_mutex());
  Registry &reg = registry();

  if (out_view == nullptr) {
    set_error(reg, ERR_NULL_POINTER);
    return 0;
  }
  clear_view(out_view);

  if (generation < 0) {
    set_error(reg, ERR_INVALID_GENERATION);
    return 0;
  }

  const auto session_it = reg.sessions.find(session_id);
  if (session_it == reg.sessions.end()) {
    set_error(reg, ERR_SESSION_NOT_FOUND);
    return 0;
  }

  const Session &session = session_it->second;
  out_view->exists = 1;
  out_view->session_revoked = bool_int(session.session_revoked);
  out_view->active_generation = session.active_generation;
  out_view->staged_generation =
      session.has_staged ? session.staged_generation : -1;
  out_view->presented_generation = generation;
  out_view->grace_generation =
      session.has_grace ? session.grace_generation : -1;
  out_view->grace_active = bool_int(grace_is_active(session, ts));
  out_view->generation_revoked = bool_int(generation_revoked(session, generation));
  out_view->compatible = bool_int(generation_compatible(session, generation, ts));
  out_view->usable = bool_int(generation_usable(session, generation, ts));

  set_error(reg, ERR_NONE);
  return 1;
}

extern "C" __attribute__((visibility("default"))) int session_count_active(int subject_id,
                                                                int64_t ts) {
  std::lock_guard<std::mutex> lock(registry_mutex());
  Registry &reg = registry();

  int count = 0;
  for (const auto &entry : reg.sessions) {
    const Session &session = entry.second;
    if (session.subject_id == subject_id &&
        generation_usable(session, session.active_generation, ts)) {
      ++count;
    }
  }

  set_error(reg, ERR_NONE);
  return count;
}

extern "C" __attribute__((visibility("default"))) int session_last_error(void) {
  std::lock_guard<std::mutex> lock(registry_mutex());
  return registry().last_error;
}
