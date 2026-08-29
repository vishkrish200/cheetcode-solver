#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#define EXPORT __attribute__((visibility("default")))

enum {
  ERR_NONE = 0,
  ERR_SESSION_EXISTS = 1,
  ERR_SESSION_NOT_FOUND = 2,
  ERR_INVALID_GENERATION = 3,
  ERR_STAGED_GENERATION_EXISTS = 4,
  ERR_NO_STAGED_GENERATION = 5,
  ERR_CREDENTIAL_EXISTS = 6,
  ERR_INVALID_CREDENTIAL_WINDOW = 7,
  ERR_NULL_POINTER = 8,
  ERR_OUT_OF_MEMORY = 9
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

typedef struct CredentialWindow {
  int64_t issued_ts;
  int64_t expires_ts;
} CredentialWindow;

typedef struct GenerationState {
  int generation;
  int revoked;
  CredentialWindow *windows;
  size_t window_count;
  size_t window_cap;
} GenerationState;

typedef struct Session {
  int session_id;
  int subject_id;
  int resource_id;
  int active_generation;
  int staged_generation;
  int has_staged;
  int grace_generation;
  int has_grace;
  int64_t grace_until_ts;
  int session_revoked;
  GenerationState *generations;
  size_t generation_count;
  size_t generation_cap;
} Session;

typedef struct Credential {
  int credential_id;
  int session_index;
  int generation;
  int64_t issued_ts;
  int64_t expires_ts;
} Credential;

typedef struct IntMap {
  int *keys;
  size_t *values;
  unsigned char *used;
  size_t count;
  size_t cap;
} IntMap;

static Session *g_sessions = NULL;
static size_t g_session_count = 0;
static size_t g_session_cap = 0;
static Credential *g_credentials = NULL;
static size_t g_credential_count = 0;
static size_t g_credential_cap = 0;
static IntMap g_session_map = {0};
static IntMap g_credential_map = {0};
static int g_last_error = ERR_NONE;

static void set_error(int err) { g_last_error = err; }

static uint64_t hash_int_key(int key) {
  uint64_t x = (uint32_t)key;
  x ^= x >> 16;
  x *= 0x7feb352dU;
  x ^= x >> 15;
  x *= 0x846ca68bU;
  x ^= x >> 16;
  return x;
}

static void map_free(IntMap *map) {
  free(map->keys);
  free(map->values);
  free(map->used);
  memset(map, 0, sizeof(*map));
}

static int map_init(IntMap *map, size_t min_cap) {
  size_t cap = 16;
  while (cap < min_cap) {
    cap <<= 1;
  }
  map->keys = (int *)calloc(cap, sizeof(*map->keys));
  map->values = (size_t *)calloc(cap, sizeof(*map->values));
  map->used = (unsigned char *)calloc(cap, sizeof(*map->used));
  if (map->keys == NULL || map->values == NULL || map->used == NULL) {
    map_free(map);
    return 0;
  }
  map->count = 0;
  map->cap = cap;
  return 1;
}

static size_t map_find_slot(const IntMap *map, int key, int *found) {
  size_t mask = map->cap - 1;
  size_t slot = (size_t)hash_int_key(key) & mask;
  while (map->used[slot] != 0) {
    if (map->keys[slot] == key) {
      *found = 1;
      return slot;
    }
    slot = (slot + 1) & mask;
  }
  *found = 0;
  return slot;
}

static int map_rehash(IntMap *map, size_t new_cap) {
  IntMap next = {0};
  if (!map_init(&next, new_cap)) {
    return 0;
  }

  for (size_t i = 0; i < map->cap; ++i) {
    if (map->used[i] != 0) {
      int found = 0;
      size_t slot = map_find_slot(&next, map->keys[i], &found);
      next.used[slot] = 1;
      next.keys[slot] = map->keys[i];
      next.values[slot] = map->values[i];
      next.count++;
    }
  }

  map_free(map);
  *map = next;
  return 1;
}

static int map_put(IntMap *map, int key, size_t value) {
  if (map->cap == 0 && !map_init(map, 16)) {
    return 0;
  }
  if ((map->count + 1) * 10 >= map->cap * 7) {
    if (!map_rehash(map, map->cap * 2)) {
      return 0;
    }
  }

  int found = 0;
  size_t slot = map_find_slot(map, key, &found);
  if (found) {
    return 0;
  }
  map->used[slot] = 1;
  map->keys[slot] = key;
  map->values[slot] = value;
  map->count++;
  return 1;
}

static int map_get(const IntMap *map, int key, size_t *out_value) {
  if (map->cap == 0) {
    return 0;
  }
  int found = 0;
  size_t slot = map_find_slot(map, key, &found);
  if (!found) {
    return 0;
  }
  *out_value = map->values[slot];
  return 1;
}

static int ensure_session_capacity(void) {
  if (g_session_count < g_session_cap) {
    return 1;
  }
  size_t next_cap = g_session_cap == 0 ? 64 : g_session_cap * 2;
  Session *next =
      (Session *)realloc(g_sessions, next_cap * sizeof(*g_sessions));
  if (next == NULL) {
    return 0;
  }
  g_sessions = next;
  g_session_cap = next_cap;
  return 1;
}

static int ensure_credential_capacity(void) {
  if (g_credential_count < g_credential_cap) {
    return 1;
  }
  size_t next_cap = g_credential_cap == 0 ? 128 : g_credential_cap * 2;
  Credential *next =
      (Credential *)realloc(g_credentials, next_cap * sizeof(*g_credentials));
  if (next == NULL) {
    return 0;
  }
  g_credentials = next;
  g_credential_cap = next_cap;
  return 1;
}

static int ensure_generation_capacity(Session *session) {
  if (session->generation_count < session->generation_cap) {
    return 1;
  }
  size_t next_cap =
      session->generation_cap == 0 ? 4 : session->generation_cap * 2;
  GenerationState *next = (GenerationState *)realloc(
      session->generations, next_cap * sizeof(*session->generations));
  if (next == NULL) {
    return 0;
  }
  session->generations = next;
  session->generation_cap = next_cap;
  return 1;
}

static int ensure_window_capacity(GenerationState *generation) {
  if (generation->window_count < generation->window_cap) {
    return 1;
  }
  size_t next_cap =
      generation->window_cap == 0 ? 2 : generation->window_cap * 2;
  CredentialWindow *next = (CredentialWindow *)realloc(
      generation->windows, next_cap * sizeof(*generation->windows));
  if (next == NULL) {
    return 0;
  }
  generation->windows = next;
  generation->window_cap = next_cap;
  return 1;
}

static Session *find_session(int session_id, size_t *out_index) {
  size_t stored = 0;
  if (!map_get(&g_session_map, session_id, &stored)) {
    return NULL;
  }
  if (out_index != NULL) {
    *out_index = stored - 1;
  }
  return &g_sessions[stored - 1];
}

static GenerationState *find_generation(Session *session, int generation) {
  for (size_t i = 0; i < session->generation_count; ++i) {
    if (session->generations[i].generation == generation) {
      return &session->generations[i];
    }
  }
  return NULL;
}

static GenerationState *get_generation(Session *session, int generation) {
  GenerationState *existing = find_generation(session, generation);
  if (existing != NULL) {
    return existing;
  }
  if (!ensure_generation_capacity(session)) {
    return NULL;
  }
  GenerationState *created = &session->generations[session->generation_count++];
  memset(created, 0, sizeof(*created));
  created->generation = generation;
  return created;
}

static int generation_has_valid_credential(const GenerationState *generation,
                                           int64_t ts) {
  if (generation == NULL) {
    return 1;
  }
  if (generation->window_count == 0) {
    return 1;
  }
  for (size_t i = 0; i < generation->window_count; ++i) {
    const CredentialWindow *window = &generation->windows[i];
    if (window->issued_ts <= ts && ts < window->expires_ts) {
      return 1;
    }
  }
  return 0;
}

static int generation_revoked(const Session *session, int generation) {
  for (size_t i = 0; i < session->generation_count; ++i) {
    if (session->generations[i].generation == generation) {
      return session->generations[i].revoked;
    }
  }
  return 0;
}

static int grace_is_active(const Session *session, int64_t ts) {
  return session->has_grace && ts < session->grace_until_ts;
}

static int generation_compatible(const Session *session, int generation,
                                 int64_t ts) {
  if (generation == session->active_generation) {
    return 1;
  }
  if (grace_is_active(session, ts) &&
      generation == session->grace_generation) {
    return 1;
  }
  return 0;
}

static int generation_usable(const Session *session, int generation,
                             int64_t ts) {
  GenerationState *state = find_generation((Session *)session, generation);
  if (!generation_compatible(session, generation, ts)) {
    return 0;
  }
  if (session->session_revoked || generation_revoked(session, generation)) {
    return 0;
  }
  return generation_has_valid_credential(state, ts);
}

EXPORT void session_reset(void) {
  for (size_t i = 0; i < g_session_count; ++i) {
    for (size_t j = 0; j < g_sessions[i].generation_count; ++j) {
      free(g_sessions[i].generations[j].windows);
    }
    free(g_sessions[i].generations);
  }
  free(g_sessions);
  free(g_credentials);
  g_sessions = NULL;
  g_credentials = NULL;
  g_session_count = 0;
  g_session_cap = 0;
  g_credential_count = 0;
  g_credential_cap = 0;
  map_free(&g_session_map);
  map_free(&g_credential_map);
  set_error(ERR_NONE);
}

EXPORT int session_create(int session_id, int subject_id, int resource_id,
                          int active_generation) {
  if (active_generation < 0) {
    set_error(ERR_INVALID_GENERATION);
    return 0;
  }
  if (find_session(session_id, NULL) != NULL) {
    set_error(ERR_SESSION_EXISTS);
    return 0;
  }
  if (!ensure_session_capacity()) {
    set_error(ERR_OUT_OF_MEMORY);
    return 0;
  }

  size_t index = g_session_count;
  Session *session = &g_sessions[g_session_count++];
  memset(session, 0, sizeof(*session));
  session->session_id = session_id;
  session->subject_id = subject_id;
  session->resource_id = resource_id;
  session->active_generation = active_generation;
  session->staged_generation = -1;
  session->grace_generation = -1;

  if (get_generation(session, active_generation) == NULL ||
      !map_put(&g_session_map, session_id, index + 1)) {
    g_session_count--;
    for (size_t i = 0; i < session->generation_count; ++i) {
      free(session->generations[i].windows);
    }
    free(session->generations);
    memset(session, 0, sizeof(*session));
    set_error(ERR_OUT_OF_MEMORY);
    return 0;
  }

  set_error(ERR_NONE);
  return 1;
}

EXPORT int session_issue_credential(int credential_id, int session_id,
                                    int generation, int64_t issued_ts,
                                    int64_t expires_ts) {
  if (generation < 0) {
    set_error(ERR_INVALID_GENERATION);
    return 0;
  }
  if (expires_ts <= issued_ts) {
    set_error(ERR_INVALID_CREDENTIAL_WINDOW);
    return 0;
  }
  if (map_get(&g_credential_map, credential_id, &(size_t){0})) {
    set_error(ERR_CREDENTIAL_EXISTS);
    return 0;
  }

  size_t session_index = 0;
  Session *session = find_session(session_id, &session_index);
  if (session == NULL) {
    set_error(ERR_SESSION_NOT_FOUND);
    return 0;
  }

  GenerationState *state = get_generation(session, generation);
  if (state == NULL || !ensure_window_capacity(state) ||
      !ensure_credential_capacity()) {
    set_error(ERR_OUT_OF_MEMORY);
    return 0;
  }

  CredentialWindow *window = &state->windows[state->window_count++];
  window->issued_ts = issued_ts;
  window->expires_ts = expires_ts;

  size_t credential_index = g_credential_count;
  Credential *credential = &g_credentials[g_credential_count++];
  credential->credential_id = credential_id;
  credential->session_index = (int)session_index;
  credential->generation = generation;
  credential->issued_ts = issued_ts;
  credential->expires_ts = expires_ts;

  if (!map_put(&g_credential_map, credential_id, credential_index + 1)) {
    g_credential_count--;
    state->window_count--;
    set_error(ERR_OUT_OF_MEMORY);
    return 0;
  }

  set_error(ERR_NONE);
  return 1;
}

EXPORT int session_stage_generation(int session_id, int generation,
                                    int64_t grace_until_ts) {
  if (generation < 0) {
    set_error(ERR_INVALID_GENERATION);
    return 0;
  }
  Session *session = find_session(session_id, NULL);
  if (session == NULL) {
    set_error(ERR_SESSION_NOT_FOUND);
    return 0;
  }
  if (generation == session->active_generation) {
    set_error(ERR_INVALID_GENERATION);
    return 0;
  }
  if (session->has_staged) {
    set_error(ERR_STAGED_GENERATION_EXISTS);
    return 0;
  }
  if (get_generation(session, generation) == NULL) {
    set_error(ERR_OUT_OF_MEMORY);
    return 0;
  }

  session->has_staged = 1;
  session->staged_generation = generation;
  session->grace_until_ts = grace_until_ts;
  set_error(ERR_NONE);
  return 1;
}

EXPORT int session_activate_generation(int session_id, int64_t ts) {
  (void)ts;
  Session *session = find_session(session_id, NULL);
  if (session == NULL) {
    set_error(ERR_SESSION_NOT_FOUND);
    return 0;
  }
  if (!session->has_staged) {
    set_error(ERR_NO_STAGED_GENERATION);
    return 0;
  }

  session->has_grace = 1;
  session->grace_generation = session->active_generation;
  session->active_generation = session->staged_generation;
  session->staged_generation = -1;
  session->has_staged = 0;
  set_error(ERR_NONE);
  return 1;
}

EXPORT int session_revoke(int session_id, int generation) {
  Session *session = find_session(session_id, NULL);
  if (session == NULL) {
    set_error(ERR_SESSION_NOT_FOUND);
    return 0;
  }
  if (generation == -1) {
    session->session_revoked = 1;
    set_error(ERR_NONE);
    return 1;
  }
  if (generation < 0) {
    set_error(ERR_INVALID_GENERATION);
    return 0;
  }

  GenerationState *state = get_generation(session, generation);
  if (state == NULL) {
    set_error(ERR_OUT_OF_MEMORY);
    return 0;
  }
  state->revoked = 1;
  set_error(ERR_NONE);
  return 1;
}

EXPORT int session_check(int session_id, int generation, int64_t ts) {
  if (generation < 0) {
    set_error(ERR_INVALID_GENERATION);
    return 0;
  }
  Session *session = find_session(session_id, NULL);
  if (session == NULL) {
    set_error(ERR_SESSION_NOT_FOUND);
    return 0;
  }
  set_error(ERR_NONE);
  return generation_usable(session, generation, ts);
}

EXPORT int session_audit_get(int session_id, int generation, int64_t ts,
                             SessionAuditView *out_view) {
  if (out_view == NULL) {
    set_error(ERR_NULL_POINTER);
    return 0;
  }
  memset(out_view, 0, sizeof(*out_view));

  if (generation < 0) {
    set_error(ERR_INVALID_GENERATION);
    return 0;
  }

  Session *session = find_session(session_id, NULL);
  if (session == NULL) {
    set_error(ERR_SESSION_NOT_FOUND);
    return 0;
  }

  out_view->exists = 1;
  out_view->session_revoked = session->session_revoked;
  out_view->active_generation = session->active_generation;
  out_view->staged_generation =
      session->has_staged ? session->staged_generation : -1;
  out_view->presented_generation = generation;
  out_view->grace_generation =
      session->has_grace ? session->grace_generation : -1;
  out_view->grace_active = grace_is_active(session, ts);
  out_view->generation_revoked = generation_revoked(session, generation);
  out_view->compatible = generation_compatible(session, generation, ts);
  out_view->usable = generation_usable(session, generation, ts);

  set_error(ERR_NONE);
  return 1;
}

EXPORT int session_count_active(int subject_id, int64_t ts) {
  int count = 0;
  for (size_t i = 0; i < g_session_count; ++i) {
    Session *session = &g_sessions[i];
    if (session->subject_id == subject_id &&
        generation_usable(session, session->active_generation, ts)) {
      count++;
    }
  }
  set_error(ERR_NONE);
  return count;
}

EXPORT int session_last_error(void) { return g_last_error; }
