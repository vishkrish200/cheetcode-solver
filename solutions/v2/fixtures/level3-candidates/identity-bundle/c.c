#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#define EXPORT __attribute__((visibility("default")))

enum {
    SOURCE_LOCAL = 1,
    SOURCE_BUNDLE = 2,
    MODE_LOCAL_ONLY = 1,
    MODE_BUNDLE_ONLY = 2,
    MODE_AUTO = 3,
    ERR_OK = 0,
    ERR_DUPLICATE_ID = 1,
    ERR_UNKNOWN_GRANT = 2,
    ERR_WRONG_SOURCE_FOR_KEY = 3,
    ERR_NON_DELEGATABLE_PARENT = 4,
    ERR_PERMISSION_WIDENING = 5,
    ERR_CHILD_START_BEFORE_PARENT = 6,
    ERR_CHILD_EXPIRY_AFTER_PARENT = 7,
    ERR_NULL_OUTPUT = 8,
    ERR_PARENT_REVOKED = 9,
    ERR_INVALID_RESOLVE_MODE = 10
};

typedef struct AuthAuditView {
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
} AuthAuditView;

typedef struct Grant {
    int source;
    int subject_id;
    int resource_id;
    int stored_mask;
    int64_t not_before_ts;
    int64_t expires_ts;
    int delegatable;
    int requires_key;
    int key_attached;
    int revoked;
    size_t parent_idx;
    int has_parent;
} Grant;

typedef struct IndexVec {
    size_t *items;
    size_t len;
    size_t cap;
} IndexVec;

typedef struct IdEntry {
    int used;
    int key;
    size_t value;
} IdEntry;

typedef struct IdMap {
    IdEntry *entries;
    size_t len;
    size_t cap;
} IdMap;

typedef struct CountEntry {
    int used;
    int subject_id;
    size_t count;
} CountEntry;

typedef struct CountMap {
    CountEntry *entries;
    size_t len;
    size_t cap;
} CountMap;

typedef struct PairEntry {
    int used;
    int subject_id;
    int source;
    IndexVec values;
} PairEntry;

typedef struct PairMap {
    PairEntry *entries;
    size_t len;
    size_t cap;
} PairMap;

typedef struct TripleEntry {
    int used;
    int subject_id;
    int source;
    int resource_id;
    IndexVec values;
} TripleEntry;

typedef struct TripleMap {
    TripleEntry *entries;
    size_t len;
    size_t cap;
} TripleMap;

typedef struct State {
    Grant *grants;
    size_t grants_len;
    size_t grants_cap;
    IdMap ids;
    PairMap by_subject_source;
    TripleMap by_subject_source_resource;
    CountMap bundle_counts;
    int last_error;
} State;

typedef struct EvalInfo {
    int effective_mask;
    int current_revoked;
    int current_requires_key;
    int current_key_attached;
    int current_not_yet_valid;
    int current_expired;
    int disabled_by_ancestor;
    int usable;
} EvalInfo;

static State g_state;

static int bool_to_int(int value) {
    return value ? 1 : 0;
}

static uint64_t mix64(uint64_t x) {
    x += UINT64_C(0x9e3779b97f4a7c15);
    x = (x ^ (x >> 30)) * UINT64_C(0xbf58476d1ce4e5b9);
    x = (x ^ (x >> 27)) * UINT64_C(0x94d049bb133111eb);
    return x ^ (x >> 31);
}

static uint64_t hash_int(int value) {
    return mix64((uint32_t)value);
}

static uint64_t hash_pair(int a, int b) {
    uint64_t h = hash_int(a);
    h ^= hash_int(b) + UINT64_C(0x9e3779b97f4a7c15) + (h << 6) + (h >> 2);
    return h;
}

static uint64_t hash_triple(int a, int b, int c) {
    uint64_t h = hash_pair(a, b);
    h ^= hash_int(c) + UINT64_C(0x9e3779b97f4a7c15) + (h << 6) + (h >> 2);
    return h;
}

static int index_vec_append(IndexVec *vec, size_t value) {
    if (vec->len == vec->cap) {
        size_t new_cap = vec->cap == 0 ? 4 : vec->cap * 2;
        size_t *new_items = (size_t *)realloc(vec->items, new_cap * sizeof(*new_items));
        if (new_items == NULL) {
            return 0;
        }
        vec->items = new_items;
        vec->cap = new_cap;
    }
    vec->items[vec->len++] = value;
    return 1;
}

static void index_vec_free(IndexVec *vec) {
    free(vec->items);
    vec->items = NULL;
    vec->len = 0;
    vec->cap = 0;
}

static int ensure_grant_capacity(State *state) {
    if (state->grants_len < state->grants_cap) {
        return 1;
    }
    size_t new_cap = state->grants_cap == 0 ? 64 : state->grants_cap * 2;
    Grant *new_grants = (Grant *)realloc(state->grants, new_cap * sizeof(*new_grants));
    if (new_grants == NULL) {
        return 0;
    }
    state->grants = new_grants;
    state->grants_cap = new_cap;
    return 1;
}

static int id_map_resize(IdMap *map, size_t new_cap) {
    IdEntry *old_entries = map->entries;
    size_t old_cap = map->cap;
    IdEntry *new_entries = (IdEntry *)calloc(new_cap, sizeof(*new_entries));
    if (new_entries == NULL) {
        return 0;
    }

    map->entries = new_entries;
    map->cap = new_cap;
    map->len = 0;
    for (size_t i = 0; i < old_cap; i++) {
        if (old_entries[i].used) {
            size_t mask = map->cap - 1;
            size_t pos = (size_t)hash_int(old_entries[i].key) & mask;
            while (map->entries[pos].used) {
                pos = (pos + 1) & mask;
            }
            map->entries[pos] = old_entries[i];
            map->len++;
        }
    }
    free(old_entries);
    return 1;
}

static int id_map_ensure(IdMap *map) {
    if (map->cap == 0) {
        return id_map_resize(map, 64);
    }
    if ((map->len + 1) * 10 >= map->cap * 7) {
        return id_map_resize(map, map->cap * 2);
    }
    return 1;
}

static int id_map_get(const IdMap *map, int key, size_t *out_value) {
    if (map->cap == 0) {
        return 0;
    }
    size_t mask = map->cap - 1;
    size_t pos = (size_t)hash_int(key) & mask;
    while (map->entries[pos].used) {
        if (map->entries[pos].key == key) {
            *out_value = map->entries[pos].value;
            return 1;
        }
        pos = (pos + 1) & mask;
    }
    return 0;
}

static int id_map_insert(IdMap *map, int key, size_t value) {
    if (!id_map_ensure(map)) {
        return 0;
    }
    size_t mask = map->cap - 1;
    size_t pos = (size_t)hash_int(key) & mask;
    while (map->entries[pos].used) {
        if (map->entries[pos].key == key) {
            return 0;
        }
        pos = (pos + 1) & mask;
    }
    map->entries[pos].used = 1;
    map->entries[pos].key = key;
    map->entries[pos].value = value;
    map->len++;
    return 1;
}

static int count_map_resize(CountMap *map, size_t new_cap) {
    CountEntry *old_entries = map->entries;
    size_t old_cap = map->cap;
    CountEntry *new_entries = (CountEntry *)calloc(new_cap, sizeof(*new_entries));
    if (new_entries == NULL) {
        return 0;
    }

    map->entries = new_entries;
    map->cap = new_cap;
    map->len = 0;
    for (size_t i = 0; i < old_cap; i++) {
        if (old_entries[i].used) {
            size_t mask = map->cap - 1;
            size_t pos = (size_t)hash_int(old_entries[i].subject_id) & mask;
            while (map->entries[pos].used) {
                pos = (pos + 1) & mask;
            }
            map->entries[pos] = old_entries[i];
            map->len++;
        }
    }
    free(old_entries);
    return 1;
}

static int count_map_ensure(CountMap *map) {
    if (map->cap == 0) {
        return count_map_resize(map, 64);
    }
    if ((map->len + 1) * 10 >= map->cap * 7) {
        return count_map_resize(map, map->cap * 2);
    }
    return 1;
}

static CountEntry *count_map_entry(CountMap *map, int subject_id) {
    if (!count_map_ensure(map)) {
        return NULL;
    }
    size_t mask = map->cap - 1;
    size_t pos = (size_t)hash_int(subject_id) & mask;
    while (map->entries[pos].used) {
        if (map->entries[pos].subject_id == subject_id) {
            return &map->entries[pos];
        }
        pos = (pos + 1) & mask;
    }
    map->entries[pos].used = 1;
    map->entries[pos].subject_id = subject_id;
    map->entries[pos].count = 0;
    map->len++;
    return &map->entries[pos];
}

static size_t count_map_get(const CountMap *map, int subject_id) {
    if (map->cap == 0) {
        return 0;
    }
    size_t mask = map->cap - 1;
    size_t pos = (size_t)hash_int(subject_id) & mask;
    while (map->entries[pos].used) {
        if (map->entries[pos].subject_id == subject_id) {
            return map->entries[pos].count;
        }
        pos = (pos + 1) & mask;
    }
    return 0;
}

static int pair_map_resize(PairMap *map, size_t new_cap) {
    PairEntry *old_entries = map->entries;
    size_t old_cap = map->cap;
    PairEntry *new_entries = (PairEntry *)calloc(new_cap, sizeof(*new_entries));
    if (new_entries == NULL) {
        return 0;
    }

    map->entries = new_entries;
    map->cap = new_cap;
    map->len = 0;
    for (size_t i = 0; i < old_cap; i++) {
        if (old_entries[i].used) {
            size_t mask = map->cap - 1;
            size_t pos = (size_t)hash_pair(old_entries[i].subject_id, old_entries[i].source) & mask;
            while (map->entries[pos].used) {
                pos = (pos + 1) & mask;
            }
            map->entries[pos] = old_entries[i];
            map->len++;
        }
    }
    free(old_entries);
    return 1;
}

static int pair_map_ensure(PairMap *map) {
    if (map->cap == 0) {
        return pair_map_resize(map, 64);
    }
    if ((map->len + 1) * 10 >= map->cap * 7) {
        return pair_map_resize(map, map->cap * 2);
    }
    return 1;
}

static PairEntry *pair_map_entry(PairMap *map, int subject_id, int source) {
    if (!pair_map_ensure(map)) {
        return NULL;
    }
    size_t mask = map->cap - 1;
    size_t pos = (size_t)hash_pair(subject_id, source) & mask;
    while (map->entries[pos].used) {
        if (map->entries[pos].subject_id == subject_id && map->entries[pos].source == source) {
            return &map->entries[pos];
        }
        pos = (pos + 1) & mask;
    }
    map->entries[pos].used = 1;
    map->entries[pos].subject_id = subject_id;
    map->entries[pos].source = source;
    map->len++;
    return &map->entries[pos];
}

static const PairEntry *pair_map_get(const PairMap *map, int subject_id, int source) {
    if (map->cap == 0) {
        return NULL;
    }
    size_t mask = map->cap - 1;
    size_t pos = (size_t)hash_pair(subject_id, source) & mask;
    while (map->entries[pos].used) {
        if (map->entries[pos].subject_id == subject_id && map->entries[pos].source == source) {
            return &map->entries[pos];
        }
        pos = (pos + 1) & mask;
    }
    return NULL;
}

static int triple_map_resize(TripleMap *map, size_t new_cap) {
    TripleEntry *old_entries = map->entries;
    size_t old_cap = map->cap;
    TripleEntry *new_entries = (TripleEntry *)calloc(new_cap, sizeof(*new_entries));
    if (new_entries == NULL) {
        return 0;
    }

    map->entries = new_entries;
    map->cap = new_cap;
    map->len = 0;
    for (size_t i = 0; i < old_cap; i++) {
        if (old_entries[i].used) {
            size_t mask = map->cap - 1;
            size_t pos = (size_t)hash_triple(old_entries[i].subject_id, old_entries[i].source, old_entries[i].resource_id) & mask;
            while (map->entries[pos].used) {
                pos = (pos + 1) & mask;
            }
            map->entries[pos] = old_entries[i];
            map->len++;
        }
    }
    free(old_entries);
    return 1;
}

static int triple_map_ensure(TripleMap *map) {
    if (map->cap == 0) {
        return triple_map_resize(map, 64);
    }
    if ((map->len + 1) * 10 >= map->cap * 7) {
        return triple_map_resize(map, map->cap * 2);
    }
    return 1;
}

static TripleEntry *triple_map_entry(TripleMap *map, int subject_id, int source, int resource_id) {
    if (!triple_map_ensure(map)) {
        return NULL;
    }
    size_t mask = map->cap - 1;
    size_t pos = (size_t)hash_triple(subject_id, source, resource_id) & mask;
    while (map->entries[pos].used) {
        if (map->entries[pos].subject_id == subject_id &&
            map->entries[pos].source == source &&
            map->entries[pos].resource_id == resource_id) {
            return &map->entries[pos];
        }
        pos = (pos + 1) & mask;
    }
    map->entries[pos].used = 1;
    map->entries[pos].subject_id = subject_id;
    map->entries[pos].source = source;
    map->entries[pos].resource_id = resource_id;
    map->len++;
    return &map->entries[pos];
}

static const TripleEntry *triple_map_get(const TripleMap *map, int subject_id, int source, int resource_id) {
    if (map->cap == 0) {
        return NULL;
    }
    size_t mask = map->cap - 1;
    size_t pos = (size_t)hash_triple(subject_id, source, resource_id) & mask;
    while (map->entries[pos].used) {
        if (map->entries[pos].subject_id == subject_id &&
            map->entries[pos].source == source &&
            map->entries[pos].resource_id == resource_id) {
            return &map->entries[pos];
        }
        pos = (pos + 1) & mask;
    }
    return NULL;
}

static void clear_state(State *state) {
    for (size_t i = 0; i < state->by_subject_source.cap; i++) {
        if (state->by_subject_source.entries[i].used) {
            index_vec_free(&state->by_subject_source.entries[i].values);
        }
    }
    for (size_t i = 0; i < state->by_subject_source_resource.cap; i++) {
        if (state->by_subject_source_resource.entries[i].used) {
            index_vec_free(&state->by_subject_source_resource.entries[i].values);
        }
    }
    free(state->grants);
    free(state->ids.entries);
    free(state->by_subject_source.entries);
    free(state->by_subject_source_resource.entries);
    free(state->bundle_counts.entries);
    memset(state, 0, sizeof(*state));
}

static int set_error(int code) {
    g_state.last_error = code;
    return 0;
}

static int set_success(void) {
    g_state.last_error = ERR_OK;
    return 1;
}

static int add_grant(int grant_id, Grant grant) {
    if (!ensure_grant_capacity(&g_state)) {
        return 0;
    }

    size_t idx = g_state.grants_len;
    PairEntry *pair_entry = pair_map_entry(&g_state.by_subject_source, grant.subject_id, grant.source);
    TripleEntry *triple_entry = triple_map_entry(&g_state.by_subject_source_resource, grant.subject_id, grant.source, grant.resource_id);
    if (pair_entry == NULL || triple_entry == NULL) {
        return 0;
    }
    if (!index_vec_append(&pair_entry->values, idx)) {
        return 0;
    }
    if (!index_vec_append(&triple_entry->values, idx)) {
        return 0;
    }
    if (!id_map_insert(&g_state.ids, grant_id, idx)) {
        return 0;
    }
    if (grant.source == SOURCE_BUNDLE) {
        CountEntry *count_entry = count_map_entry(&g_state.bundle_counts, grant.subject_id);
        if (count_entry == NULL) {
            return 0;
        }
        count_entry->count++;
    }

    g_state.grants[idx] = grant;
    g_state.grants_len++;
    return 1;
}

static int chosen_source(int subject_id, int resolve_mode, int *out_source) {
    if (resolve_mode == MODE_LOCAL_ONLY) {
        *out_source = SOURCE_LOCAL;
        return ERR_OK;
    }
    if (resolve_mode == MODE_BUNDLE_ONLY) {
        *out_source = SOURCE_BUNDLE;
        return ERR_OK;
    }
    if (resolve_mode == MODE_AUTO) {
        *out_source = count_map_get(&g_state.bundle_counts, subject_id) > 0 ? SOURCE_BUNDLE : SOURCE_LOCAL;
        return ERR_OK;
    }
    return ERR_INVALID_RESOLVE_MODE;
}

static EvalInfo eval_grant(size_t idx, int64_t ts) {
    const Grant *grant = &g_state.grants[idx];
    EvalInfo info;
    int current_direct_disabled;

    info.current_requires_key = grant->requires_key;
    info.current_key_attached = !grant->requires_key || grant->key_attached;
    info.current_not_yet_valid = ts < grant->not_before_ts;
    info.current_expired = ts >= grant->expires_ts;
    info.current_revoked = grant->revoked;
    current_direct_disabled = info.current_revoked ||
                              info.current_not_yet_valid ||
                              info.current_expired ||
                              (grant->requires_key && !grant->key_attached);
    info.disabled_by_ancestor = 0;
    info.effective_mask = grant->stored_mask;

    while (grant->has_parent) {
        const Grant *parent = &g_state.grants[grant->parent_idx];
        info.effective_mask &= parent->stored_mask;
        if (parent->revoked ||
            ts < parent->not_before_ts ||
            ts >= parent->expires_ts ||
            (parent->requires_key && !parent->key_attached)) {
            info.disabled_by_ancestor = 1;
        }
        grant = parent;
    }

    info.usable = !current_direct_disabled && !info.disabled_by_ancestor && info.effective_mask != 0;
    if (!info.usable) {
        info.effective_mask = 0;
    }
    return info;
}

EXPORT void auth_reset(void) {
    clear_state(&g_state);
}

EXPORT int auth_create_local_grant(
    int grant_id,
    int subject_id,
    int resource_id,
    int perms_mask,
    int64_t not_before_ts,
    int64_t expires_ts,
    int delegatable
) {
    size_t ignored;
    if (id_map_get(&g_state.ids, grant_id, &ignored)) {
        return set_error(ERR_DUPLICATE_ID);
    }

    Grant grant;
    grant.source = SOURCE_LOCAL;
    grant.subject_id = subject_id;
    grant.resource_id = resource_id;
    grant.stored_mask = perms_mask;
    grant.not_before_ts = not_before_ts;
    grant.expires_ts = expires_ts;
    grant.delegatable = delegatable != 0;
    grant.requires_key = 0;
    grant.key_attached = 1;
    grant.revoked = 0;
    grant.parent_idx = 0;
    grant.has_parent = 0;

    if (!add_grant(grant_id, grant)) {
        return set_error(ERR_UNKNOWN_GRANT);
    }
    return set_success();
}

EXPORT int auth_import_bundle_grant(
    int grant_id,
    int subject_id,
    int resource_id,
    int perms_mask,
    int64_t not_before_ts,
    int64_t expires_ts,
    int delegatable,
    int requires_key
) {
    size_t ignored;
    int requires_key_flag;
    if (id_map_get(&g_state.ids, grant_id, &ignored)) {
        return set_error(ERR_DUPLICATE_ID);
    }

    requires_key_flag = requires_key != 0;
    Grant grant;
    grant.source = SOURCE_BUNDLE;
    grant.subject_id = subject_id;
    grant.resource_id = resource_id;
    grant.stored_mask = perms_mask;
    grant.not_before_ts = not_before_ts;
    grant.expires_ts = expires_ts;
    grant.delegatable = delegatable != 0;
    grant.requires_key = requires_key_flag;
    grant.key_attached = !requires_key_flag;
    grant.revoked = 0;
    grant.parent_idx = 0;
    grant.has_parent = 0;

    if (!add_grant(grant_id, grant)) {
        return set_error(ERR_UNKNOWN_GRANT);
    }
    return set_success();
}

EXPORT int auth_attach_bundle_key(int grant_id) {
    size_t idx;
    if (!id_map_get(&g_state.ids, grant_id, &idx)) {
        return set_error(ERR_UNKNOWN_GRANT);
    }
    if (g_state.grants[idx].source != SOURCE_BUNDLE) {
        return set_error(ERR_WRONG_SOURCE_FOR_KEY);
    }
    g_state.grants[idx].key_attached = 1;
    return set_success();
}

EXPORT int auth_delegate(
    int parent_grant_id,
    int child_grant_id,
    int subject_id,
    int resource_id,
    int perms_mask,
    int64_t not_before_ts,
    int64_t expires_ts,
    int delegatable,
    int requires_key
) {
    size_t ignored;
    size_t parent_idx;
    const Grant *parent;
    int child_requires_key;

    if (id_map_get(&g_state.ids, child_grant_id, &ignored)) {
        return set_error(ERR_DUPLICATE_ID);
    }
    if (!id_map_get(&g_state.ids, parent_grant_id, &parent_idx)) {
        return set_error(ERR_UNKNOWN_GRANT);
    }

    parent = &g_state.grants[parent_idx];
    if (parent->revoked) {
        return set_error(ERR_PARENT_REVOKED);
    }
    if (!parent->delegatable) {
        return set_error(ERR_NON_DELEGATABLE_PARENT);
    }
    if ((perms_mask & ~parent->stored_mask) != 0) {
        return set_error(ERR_PERMISSION_WIDENING);
    }
    if (not_before_ts < parent->not_before_ts) {
        return set_error(ERR_CHILD_START_BEFORE_PARENT);
    }
    if (expires_ts > parent->expires_ts) {
        return set_error(ERR_CHILD_EXPIRY_AFTER_PARENT);
    }

    child_requires_key = parent->source == SOURCE_BUNDLE && requires_key != 0;
    Grant grant;
    grant.source = parent->source;
    grant.subject_id = subject_id;
    grant.resource_id = resource_id;
    grant.stored_mask = perms_mask;
    grant.not_before_ts = not_before_ts;
    grant.expires_ts = expires_ts;
    grant.delegatable = delegatable != 0;
    grant.requires_key = child_requires_key;
    grant.key_attached = !child_requires_key;
    grant.revoked = 0;
    grant.parent_idx = parent_idx;
    grant.has_parent = 1;

    if (!add_grant(child_grant_id, grant)) {
        return set_error(ERR_UNKNOWN_GRANT);
    }
    return set_success();
}

EXPORT int auth_revoke(int grant_id) {
    size_t idx;
    if (!id_map_get(&g_state.ids, grant_id, &idx)) {
        return set_error(ERR_UNKNOWN_GRANT);
    }
    g_state.grants[idx].revoked = 1;
    return set_success();
}

EXPORT int auth_check(int subject_id, int resource_id, int perm_bit, int64_t ts, int resolve_mode) {
    int source;
    int source_status = chosen_source(subject_id, resolve_mode, &source);
    if (source_status != ERR_OK) {
        return set_error(source_status);
    }

    const TripleEntry *entry = triple_map_get(&g_state.by_subject_source_resource, subject_id, source, resource_id);
    if (entry != NULL) {
        for (size_t i = 0; i < entry->values.len; i++) {
            EvalInfo info = eval_grant(entry->values.items[i], ts);
            if ((info.effective_mask & perm_bit) != 0) {
                g_state.last_error = ERR_OK;
                return 1;
            }
        }
    }
    g_state.last_error = ERR_OK;
    return 0;
}

EXPORT int auth_effective_mask(int grant_id, int64_t ts) {
    size_t idx;
    if (!id_map_get(&g_state.ids, grant_id, &idx)) {
        g_state.last_error = ERR_UNKNOWN_GRANT;
        return 0;
    }
    g_state.last_error = ERR_OK;
    return eval_grant(idx, ts).effective_mask;
}

EXPORT int auth_audit_get(int grant_id, int64_t ts, AuthAuditView *out_view) {
    size_t idx;
    const Grant *grant;
    EvalInfo info;

    if (out_view == NULL) {
        return set_error(ERR_NULL_OUTPUT);
    }
    if (!id_map_get(&g_state.ids, grant_id, &idx)) {
        return set_error(ERR_UNKNOWN_GRANT);
    }

    grant = &g_state.grants[idx];
    info = eval_grant(idx, ts);
    out_view->exists = 1;
    out_view->source = grant->source;
    out_view->stored_mask = grant->stored_mask;
    out_view->effective_mask = info.effective_mask;
    out_view->revoked = bool_to_int(info.current_revoked);
    out_view->requires_key = bool_to_int(info.current_requires_key);
    out_view->key_attached = bool_to_int(info.current_key_attached);
    out_view->not_yet_valid = bool_to_int(info.current_not_yet_valid);
    out_view->expired = bool_to_int(info.current_expired);
    out_view->disabled_by_ancestor = bool_to_int(info.disabled_by_ancestor);
    out_view->usable = bool_to_int(info.usable);
    return set_success();
}

EXPORT int auth_count_usable(int subject_id, int64_t ts, int resolve_mode) {
    int source;
    int count = 0;
    int source_status = chosen_source(subject_id, resolve_mode, &source);
    if (source_status != ERR_OK) {
        return set_error(source_status);
    }

    const PairEntry *entry = pair_map_get(&g_state.by_subject_source, subject_id, source);
    if (entry != NULL) {
        for (size_t i = 0; i < entry->values.len; i++) {
            if (eval_grant(entry->values.items[i], ts).effective_mask != 0) {
                if (count < INT32_MAX) {
                    count++;
                }
            }
        }
    }
    g_state.last_error = ERR_OK;
    return count;
}

EXPORT int auth_last_error(void) {
    return g_state.last_error;
}
