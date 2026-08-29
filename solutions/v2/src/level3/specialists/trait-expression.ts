export function solveTraitExpressionTask(taskName: string, language: string): string | undefined {
  if (!/Trait Expression AST/i.test(taskName)) return undefined;
  if (language !== "C" && language !== "C++") return undefined;
  return TRAIT_EXPRESSION_SOURCE;
}

const TRAIT_EXPRESSION_SOURCE = String.raw`
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <regex.h>

typedef struct ExprAuditView {
  int exists;
  int kind;
  int string_evaluable;
  int match_evaluable;
  int constant_expr;
  int namespace_error;
  int matched;
  int output_string_id;
} ExprAuditView;

#define KIND_LITERAL 1
#define KIND_VAR 2
#define KIND_EMAIL_LOCAL 3
#define KIND_REPLACE 4
#define KIND_MATCH 5

#define ERR_NONE 0
#define ERR_DUPLICATE_ID 1
#define ERR_UNKNOWN_EXPR 2
#define ERR_INVALID_KIND 3
#define ERR_NULL_POINTER 4
#define ERR_UNKNOWN_VAR 5
#define ERR_UNKNOWN_STRING 6
#define ERR_NAMESPACE 7
#define ERR_REGEX 8
#define ERR_CAPACITY 9

typedef struct {
  int exists;
  int id;
  char *value;
} StringRec;

typedef struct {
  int exists;
  int id;
  int namespace_kind;
  int string_id;
} VarRec;

typedef struct {
  int exists;
  int id;
  int kind;
  int string_id;
  int var_id;
  int child_id;
  int input_id;
  int pattern_id;
  int replacement_id;
  int negate;
  int has_input;
  int constant_expr;
  int namespace_error;
  int matched;
  int output_string_id;
} ExprRec;

typedef struct {
  int *keys;
  int *vals;
  unsigned char *used;
  int cap;
  int len;
} IntMap;

typedef struct {
  char **keys;
  int *vals;
  unsigned char *used;
  int cap;
  int len;
} StrMap;

static StringRec *strings = NULL;
static int strings_len = 0;
static int strings_cap = 0;
static VarRec *vars = NULL;
static int vars_len = 0;
static int vars_cap = 0;
static ExprRec *exprs = NULL;
static int exprs_len = 0;
static int exprs_cap = 0;
static IntMap string_by_id;
static IntMap var_by_id;
static IntMap expr_by_id;
static StrMap string_by_value;
static int last_error = 0;
static int next_auto_string_id = 1;

static uint32_t hash_int(int key) {
  uint32_t x = (uint32_t)key;
  x ^= x >> 16;
  x *= 0x7feb352dU;
  x ^= x >> 15;
  x *= 0x846ca68bU;
  x ^= x >> 16;
  return x;
}

static uint32_t hash_str(const char *s) {
  uint32_t h = 2166136261U;
  while (*s) {
    h ^= (unsigned char)*s++;
    h *= 16777619U;
  }
  return h ? h : 1U;
}

static char *dup_cstr(const char *s) {
  size_t n = strlen(s);
  char *out = (char *)malloc(n + 1);
  if (!out) return NULL;
  memcpy(out, s, n + 1);
  return out;
}

static int intmap_init(IntMap *m, int cap) {
  m->cap = cap;
  m->len = 0;
  m->keys = (int *)calloc((size_t)cap, sizeof(int));
  m->vals = (int *)calloc((size_t)cap, sizeof(int));
  m->used = (unsigned char *)calloc((size_t)cap, sizeof(unsigned char));
  return m->keys && m->vals && m->used;
}

static void intmap_free(IntMap *m) {
  free(m->keys);
  free(m->vals);
  free(m->used);
  memset(m, 0, sizeof(*m));
}

static int intmap_get(const IntMap *m, int key, int *out) {
  if (!m->cap) return 0;
  uint32_t h = hash_int(key);
  for (int step = 0; step < m->cap; step++) {
    int pos = (int)((h + (uint32_t)step) & (uint32_t)(m->cap - 1));
    if (!m->used[pos]) return 0;
    if (m->keys[pos] == key) {
      *out = m->vals[pos];
      return 1;
    }
  }
  return 0;
}

static int intmap_put_raw(IntMap *m, int key, int val) {
  uint32_t h = hash_int(key);
  for (int step = 0; step < m->cap; step++) {
    int pos = (int)((h + (uint32_t)step) & (uint32_t)(m->cap - 1));
    if (!m->used[pos]) {
      m->used[pos] = 1;
      m->keys[pos] = key;
      m->vals[pos] = val;
      m->len++;
      return 1;
    }
    if (m->keys[pos] == key) {
      m->vals[pos] = val;
      return 1;
    }
  }
  return 0;
}

static int intmap_grow(IntMap *m) {
  IntMap n;
  if (!intmap_init(&n, m->cap ? m->cap * 2 : 4096)) return 0;
  for (int i = 0; i < m->cap; i++) {
    if (m->used[i] && !intmap_put_raw(&n, m->keys[i], m->vals[i])) return 0;
  }
  intmap_free(m);
  *m = n;
  return 1;
}

static int intmap_put(IntMap *m, int key, int val) {
  if (!m->cap && !intmap_init(m, 4096)) return 0;
  if ((m->len + 1) * 10 >= m->cap * 7 && !intmap_grow(m)) return 0;
  return intmap_put_raw(m, key, val);
}

static int strmap_init(StrMap *m, int cap) {
  m->cap = cap;
  m->len = 0;
  m->keys = (char **)calloc((size_t)cap, sizeof(char *));
  m->vals = (int *)calloc((size_t)cap, sizeof(int));
  m->used = (unsigned char *)calloc((size_t)cap, sizeof(unsigned char));
  return m->keys && m->vals && m->used;
}

static void strmap_free(StrMap *m) {
  free(m->keys);
  free(m->vals);
  free(m->used);
  memset(m, 0, sizeof(*m));
}

static int strmap_get(const StrMap *m, const char *key, int *out) {
  if (!m->cap) return 0;
  uint32_t h = hash_str(key);
  for (int step = 0; step < m->cap; step++) {
    int pos = (int)((h + (uint32_t)step) & (uint32_t)(m->cap - 1));
    if (!m->used[pos]) return 0;
    if (strcmp(m->keys[pos], key) == 0) {
      *out = m->vals[pos];
      return 1;
    }
  }
  return 0;
}

static int strmap_put_raw(StrMap *m, char *key, int val) {
  uint32_t h = hash_str(key);
  for (int step = 0; step < m->cap; step++) {
    int pos = (int)((h + (uint32_t)step) & (uint32_t)(m->cap - 1));
    if (!m->used[pos]) {
      m->used[pos] = 1;
      m->keys[pos] = key;
      m->vals[pos] = val;
      m->len++;
      return 1;
    }
    if (strcmp(m->keys[pos], key) == 0) return 1;
  }
  return 0;
}

static int strmap_grow(StrMap *m) {
  StrMap n;
  if (!strmap_init(&n, m->cap ? m->cap * 2 : 4096)) return 0;
  for (int i = 0; i < m->cap; i++) {
    if (m->used[i] && !strmap_put_raw(&n, m->keys[i], m->vals[i])) return 0;
  }
  strmap_free(m);
  *m = n;
  return 1;
}

static int strmap_put(StrMap *m, char *key, int val) {
  if (!m->cap && !strmap_init(m, 4096)) return 0;
  if ((m->len + 1) * 10 >= m->cap * 7 && !strmap_grow(m)) return 0;
  return strmap_put_raw(m, key, val);
}

static int ensure_string_cap(void) {
  if (strings_len < strings_cap) return 1;
  int new_cap = strings_cap ? strings_cap * 2 : 4096;
  StringRec *n = (StringRec *)realloc(strings, (size_t)new_cap * sizeof(StringRec));
  if (!n) return 0;
  strings = n;
  memset(strings + strings_cap, 0, (size_t)(new_cap - strings_cap) * sizeof(StringRec));
  strings_cap = new_cap;
  return 1;
}

static int ensure_var_cap(void) {
  if (vars_len < vars_cap) return 1;
  int new_cap = vars_cap ? vars_cap * 2 : 4096;
  VarRec *n = (VarRec *)realloc(vars, (size_t)new_cap * sizeof(VarRec));
  if (!n) return 0;
  vars = n;
  memset(vars + vars_cap, 0, (size_t)(new_cap - vars_cap) * sizeof(VarRec));
  vars_cap = new_cap;
  return 1;
}

static int ensure_expr_cap(void) {
  if (exprs_len < exprs_cap) return 1;
  int new_cap = exprs_cap ? exprs_cap * 2 : 4096;
  ExprRec *n = (ExprRec *)realloc(exprs, (size_t)new_cap * sizeof(ExprRec));
  if (!n) return 0;
  exprs = n;
  memset(exprs + exprs_cap, 0, (size_t)(new_cap - exprs_cap) * sizeof(ExprRec));
  exprs_cap = new_cap;
  return 1;
}

static StringRec *find_string(int id) {
  int idx;
  if (!intmap_get(&string_by_id, id, &idx)) return NULL;
  return &strings[idx];
}

static VarRec *find_var(int id) {
  int idx;
  if (!intmap_get(&var_by_id, id, &idx)) return NULL;
  return &vars[idx];
}

static ExprRec *find_expr(int id) {
  int idx;
  if (!intmap_get(&expr_by_id, id, &idx)) return NULL;
  return &exprs[idx];
}

static int valid_namespace(int ns) {
  return ns == 1 || ns == 2 || ns == 3;
}

static int add_string_with_id(int id, const char *value) {
  if (find_string(id)) {
    last_error = ERR_DUPLICATE_ID;
    return 0;
  }
  if (!ensure_string_cap()) {
    last_error = ERR_CAPACITY;
    return 0;
  }
  char *copy = dup_cstr(value);
  if (!copy) {
    last_error = ERR_CAPACITY;
    return 0;
  }
  int idx = strings_len++;
  strings[idx].exists = 1;
  strings[idx].id = id;
  strings[idx].value = copy;
  if (!intmap_put(&string_by_id, id, idx)) return 0;
  int existing;
  if (!strmap_get(&string_by_value, copy, &existing)) {
    if (!strmap_put(&string_by_value, copy, id)) return 0;
  }
  if (id >= next_auto_string_id) next_auto_string_id = id + 1;
  return 1;
}

static int intern_string_value(const char *value) {
  int id;
  if (strmap_get(&string_by_value, value, &id)) return id;
  while (find_string(next_auto_string_id)) next_auto_string_id++;
  id = next_auto_string_id++;
  if (!add_string_with_id(id, value)) return -1;
  return id;
}

static int add_expr(int id, int kind, ExprRec **out) {
  if (find_expr(id)) {
    last_error = ERR_DUPLICATE_ID;
    return 0;
  }
  if (!ensure_expr_cap()) {
    last_error = ERR_CAPACITY;
    return 0;
  }
  int idx = exprs_len++;
  ExprRec *e = &exprs[idx];
  memset(e, 0, sizeof(*e));
  e->exists = 1;
  e->id = id;
  e->kind = kind;
  e->output_string_id = -1;
  if (!intmap_put(&expr_by_id, id, idx)) return 0;
  *out = e;
  return 1;
}

static int replace_all_regex(const char *input, const char *pattern, const char *replacement, char **out) {
  regex_t re;
  if (regcomp(&re, pattern, REG_EXTENDED) != 0) {
    last_error = ERR_REGEX;
    return 0;
  }
  size_t cap = strlen(input) + 64;
  char *buf = (char *)malloc(cap);
  if (!buf) {
    regfree(&re);
    last_error = ERR_CAPACITY;
    return 0;
  }
  size_t len = 0;
  buf[0] = 0;
  const char *cur = input;
  regmatch_t m[1];
  while (regexec(&re, cur, 1, m, 0) == 0) {
    size_t pre = (size_t)m[0].rm_so;
    size_t rep = strlen(replacement);
    while (len + pre + rep + strlen(cur + m[0].rm_eo) + 2 > cap) {
      cap *= 2;
      char *n = (char *)realloc(buf, cap);
      if (!n) {
        free(buf);
        regfree(&re);
        last_error = ERR_CAPACITY;
        return 0;
      }
      buf = n;
    }
    memcpy(buf + len, cur, pre);
    len += pre;
    memcpy(buf + len, replacement, rep);
    len += rep;
    if (m[0].rm_eo == 0) {
      if (*cur == 0) break;
      buf[len++] = *cur++;
    } else {
      cur += m[0].rm_eo;
    }
    buf[len] = 0;
  }
  size_t rest = strlen(cur);
  while (len + rest + 1 > cap) {
    cap *= 2;
    char *n = (char *)realloc(buf, cap);
    if (!n) {
      free(buf);
      regfree(&re);
      last_error = ERR_CAPACITY;
      return 0;
    }
    buf = n;
  }
  memcpy(buf + len, cur, rest + 1);
  regfree(&re);
  *out = buf;
  return 1;
}

static int eval_string_inner(int expr_id, int *out_string_id);

static int eval_match_inner(ExprRec *e, int matcher_string_id) {
  int input_id = matcher_string_id;
  if (e->has_input) {
    if (!eval_string_inner(e->input_id, &input_id)) {
      ExprRec *child = find_expr(e->input_id);
      if (child && child->namespace_error) e->namespace_error = 1;
      return 0;
    }
    ExprRec *child = find_expr(e->input_id);
    if (child && child->namespace_error) e->namespace_error = 1;
  }
  StringRec *in = find_string(input_id);
  StringRec *pat = find_string(e->pattern_id);
  if (!in || !pat) {
    last_error = ERR_UNKNOWN_STRING;
    return 0;
  }
  regex_t re;
  if (regcomp(&re, pat->value, REG_EXTENDED) != 0) {
    last_error = ERR_REGEX;
    return 0;
  }
  int raw = regexec(&re, in->value, 0, NULL, 0) == 0;
  regfree(&re);
  e->matched = e->negate ? !raw : raw;
  last_error = ERR_NONE;
  return e->matched;
}

static int eval_string_inner(int expr_id, int *out_string_id) {
  ExprRec *e = find_expr(expr_id);
  if (!e) {
    last_error = ERR_UNKNOWN_EXPR;
    return 0;
  }
  if (e->kind == KIND_MATCH) {
    last_error = ERR_INVALID_KIND;
    return 0;
  }
  if (e->output_string_id >= 0 && !e->namespace_error) {
    *out_string_id = e->output_string_id;
    last_error = ERR_NONE;
    return 1;
  }
  if (e->kind == KIND_LITERAL) {
    e->output_string_id = e->string_id;
    *out_string_id = e->string_id;
    last_error = ERR_NONE;
    return 1;
  }
  if (e->kind == KIND_VAR) {
    VarRec *v = find_var(e->var_id);
    if (!v) {
      last_error = ERR_UNKNOWN_VAR;
      return 0;
    }
    e->output_string_id = v->string_id;
    if (!valid_namespace(v->namespace_kind)) {
      e->namespace_error = 1;
      last_error = ERR_NAMESPACE;
      return 0;
    }
    *out_string_id = v->string_id;
    last_error = ERR_NONE;
    return 1;
  }
  if (e->kind == KIND_EMAIL_LOCAL) {
    int child_id = -1;
    if (!eval_string_inner(e->child_id, &child_id)) {
      ExprRec *child = find_expr(e->child_id);
      if (child && child->namespace_error) e->namespace_error = 1;
      return 0;
    }
    ExprRec *child = find_expr(e->child_id);
    if (child && child->namespace_error) {
      e->namespace_error = 1;
      last_error = ERR_NAMESPACE;
      return 0;
    }
    StringRec *s = find_string(child_id);
    if (!s) {
      last_error = ERR_UNKNOWN_STRING;
      return 0;
    }
    const char *at = strchr(s->value, '@');
    if (!at) {
      e->output_string_id = child_id;
    } else {
      size_t n = (size_t)(at - s->value);
      char *tmp = (char *)malloc(n + 1);
      if (!tmp) {
        last_error = ERR_CAPACITY;
        return 0;
      }
      memcpy(tmp, s->value, n);
      tmp[n] = 0;
      e->output_string_id = intern_string_value(tmp);
      free(tmp);
      if (e->output_string_id < 0) return 0;
    }
    *out_string_id = e->output_string_id;
    last_error = ERR_NONE;
    return 1;
  }
  if (e->kind == KIND_REPLACE) {
    int input_id = -1;
    if (!eval_string_inner(e->input_id, &input_id)) {
      ExprRec *child = find_expr(e->input_id);
      if (child && child->namespace_error) e->namespace_error = 1;
      return 0;
    }
    ExprRec *child = find_expr(e->input_id);
    if (child && child->namespace_error) {
      e->namespace_error = 1;
      last_error = ERR_NAMESPACE;
      return 0;
    }
    StringRec *in = find_string(input_id);
    StringRec *pat = find_string(e->pattern_id);
    StringRec *rep = find_string(e->replacement_id);
    if (!in || !pat || !rep) {
      last_error = ERR_UNKNOWN_STRING;
      return 0;
    }
    char *result = NULL;
    if (!replace_all_regex(in->value, pat->value, rep->value, &result)) return 0;
    e->output_string_id = intern_string_value(result);
    free(result);
    if (e->output_string_id < 0) return 0;
    *out_string_id = e->output_string_id;
    last_error = ERR_NONE;
    return 1;
  }
  last_error = ERR_INVALID_KIND;
  return 0;
}

#ifdef __cplusplus
extern "C" {
#endif

__attribute__((visibility("default"))) void expr_reset(void) {
  for (int i = 0; i < strings_len; i++) free(strings[i].value);
  free(strings); strings = NULL; strings_len = 0; strings_cap = 0;
  free(vars); vars = NULL; vars_len = 0; vars_cap = 0;
  free(exprs); exprs = NULL; exprs_len = 0; exprs_cap = 0;
  intmap_free(&string_by_id);
  intmap_free(&var_by_id);
  intmap_free(&expr_by_id);
  strmap_free(&string_by_value);
  last_error = ERR_NONE;
  next_auto_string_id = 1;
}

__attribute__((visibility("default"))) int expr_register_string(int string_id, const char *value) {
  if (!value) {
    last_error = ERR_NULL_POINTER;
    return 0;
  }
  int ok = add_string_with_id(string_id, value);
  if (ok) last_error = ERR_NONE;
  return ok;
}

__attribute__((visibility("default"))) int expr_register_var(int var_id, int namespace_kind, int string_id) {
  if (find_var(var_id)) {
    last_error = ERR_DUPLICATE_ID;
    return 0;
  }
  if (!find_string(string_id)) {
    last_error = ERR_UNKNOWN_STRING;
    return 0;
  }
  if (!ensure_var_cap()) {
    last_error = ERR_CAPACITY;
    return 0;
  }
  int idx = vars_len++;
  vars[idx].exists = 1;
  vars[idx].id = var_id;
  vars[idx].namespace_kind = namespace_kind;
  vars[idx].string_id = string_id;
  if (!intmap_put(&var_by_id, var_id, idx)) {
    last_error = ERR_CAPACITY;
    return 0;
  }
  last_error = ERR_NONE;
  return 1;
}

__attribute__((visibility("default"))) int expr_compile_literal(int expr_id, int string_id) {
  if (!find_string(string_id)) {
    last_error = ERR_UNKNOWN_STRING;
    return 0;
  }
  ExprRec *e = NULL;
  if (!add_expr(expr_id, KIND_LITERAL, &e)) return 0;
  e->string_id = string_id;
  e->constant_expr = 1;
  last_error = ERR_NONE;
  return 1;
}

__attribute__((visibility("default"))) int expr_compile_var(int expr_id, int var_id) {
  VarRec *v = find_var(var_id);
  if (!v) {
    last_error = ERR_UNKNOWN_VAR;
    return 0;
  }
  ExprRec *e = NULL;
  if (!add_expr(expr_id, KIND_VAR, &e)) return 0;
  e->var_id = var_id;
  e->string_id = v->string_id;
  e->constant_expr = 0;
  last_error = ERR_NONE;
  return 1;
}

__attribute__((visibility("default"))) int expr_compile_email_local(int expr_id, int child_expr_id) {
  ExprRec *child = find_expr(child_expr_id);
  if (!child) {
    last_error = ERR_UNKNOWN_EXPR;
    return 0;
  }
  if (child->kind == KIND_MATCH) {
    last_error = ERR_INVALID_KIND;
    return 0;
  }
  ExprRec *e = NULL;
  if (!add_expr(expr_id, KIND_EMAIL_LOCAL, &e)) return 0;
  e->child_id = child_expr_id;
  e->constant_expr = child->constant_expr;
  last_error = ERR_NONE;
  return 1;
}

__attribute__((visibility("default"))) int expr_compile_regex_replace(int expr_id, int input_expr_id, int pattern_string_id, int replacement_string_id) {
  ExprRec *input = find_expr(input_expr_id);
  if (!input) {
    last_error = ERR_UNKNOWN_EXPR;
    return 0;
  }
  if (input->kind == KIND_MATCH) {
    last_error = ERR_INVALID_KIND;
    return 0;
  }
  if (!find_string(pattern_string_id) || !find_string(replacement_string_id)) {
    last_error = ERR_UNKNOWN_STRING;
    return 0;
  }
  ExprRec *e = NULL;
  if (!add_expr(expr_id, KIND_REPLACE, &e)) return 0;
  e->input_id = input_expr_id;
  e->pattern_id = pattern_string_id;
  e->replacement_id = replacement_string_id;
  e->constant_expr = input->constant_expr;
  last_error = ERR_NONE;
  return 1;
}

__attribute__((visibility("default"))) int expr_compile_regex_match(int expr_id, int input_expr_id, int pattern_string_id, int negate) {
  int has_input = input_expr_id > 0;
  ExprRec *input = NULL;
  if (has_input) {
    input = find_expr(input_expr_id);
    if (!input) {
      last_error = ERR_UNKNOWN_EXPR;
      return 0;
    }
    if (input->kind == KIND_MATCH) {
      last_error = ERR_INVALID_KIND;
      return 0;
    }
  }
  if (!find_string(pattern_string_id)) {
    last_error = ERR_UNKNOWN_STRING;
    return 0;
  }
  ExprRec *e = NULL;
  if (!add_expr(expr_id, KIND_MATCH, &e)) return 0;
  e->input_id = input_expr_id;
  e->has_input = has_input;
  e->pattern_id = pattern_string_id;
  e->negate = negate ? 1 : 0;
  e->constant_expr = has_input && input ? input->constant_expr : 0;
  last_error = ERR_NONE;
  return 1;
}

__attribute__((visibility("default"))) int expr_evaluate_string(int expr_id, int *out_string_id) {
  if (!out_string_id) {
    last_error = ERR_NULL_POINTER;
    return 0;
  }
  return eval_string_inner(expr_id, out_string_id);
}

__attribute__((visibility("default"))) int expr_evaluate_match(int expr_id, int matcher_string_id) {
  ExprRec *e = find_expr(expr_id);
  if (!e) {
    last_error = ERR_UNKNOWN_EXPR;
    return 0;
  }
  if (e->kind != KIND_MATCH) {
    last_error = ERR_INVALID_KIND;
    return 0;
  }
  return eval_match_inner(e, matcher_string_id);
}

__attribute__((visibility("default"))) int expr_audit_get(int expr_id, int matcher_string_id, ExprAuditView *out_view) {
  if (!out_view) {
    last_error = ERR_NULL_POINTER;
    return 0;
  }
  memset(out_view, 0, sizeof(*out_view));
  ExprRec *e = find_expr(expr_id);
  if (!e) return 0;
  out_view->exists = 1;
  out_view->kind = e->kind;
  out_view->string_evaluable = e->kind != KIND_MATCH;
  out_view->match_evaluable = e->kind == KIND_MATCH;
  out_view->constant_expr = e->constant_expr;
  out_view->output_string_id = -1;
  if (e->kind == KIND_MATCH) {
    int saved_error = last_error;
    int matched = eval_match_inner(e, matcher_string_id);
    (void)matched;
    out_view->matched = e->matched;
    out_view->namespace_error = e->namespace_error;
    if (e->namespace_error) last_error = saved_error;
  } else {
    int out_id = -1;
    int ok = eval_string_inner(expr_id, &out_id);
    out_view->namespace_error = e->namespace_error;
    if (ok) out_view->output_string_id = out_id;
  }
  return 1;
}

__attribute__((visibility("default"))) int expr_last_error(void) {
  return last_error;
}

#ifdef __cplusplus
}
#endif
`;
