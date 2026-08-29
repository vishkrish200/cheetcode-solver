#include <regex.h>
#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#define EXPORT __attribute__((visibility("default")))

#define KIND_LITERAL 1
#define KIND_VAR 2
#define KIND_EMAIL_LOCAL 3
#define KIND_REPLACE 4
#define KIND_MATCH 5

#define VALID_NAMESPACE_KIND 1

#define ERR_NONE 0
#define ERR_DUPLICATE_ID 1
#define ERR_UNKNOWN_EXPR 2
#define ERR_INVALID_KIND 3
#define ERR_NULL_POINTER 4
#define ERR_UNKNOWN_VAR 5
#define ERR_UNKNOWN_STRING 6
#define ERR_NAMESPACE 7
#define ERR_REGEX 8
#define ERR_NO_MEMORY 9
#define HASH_BUCKET_COUNT 262144u

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

typedef struct {
  int used;
  int string_id;
  char *value;
  size_t next_id_bucket;
  size_t next_value_bucket;
} StringEntry;

typedef struct {
  int used;
  int var_id;
  int namespace_kind;
  int string_id;
  size_t next_id_bucket;
} VarEntry;

typedef struct {
  int used;
  int expr_id;
  int kind;
  int string_id;
  int var_id;
  int child_expr_id;
  int input_expr_id;
  int pattern_string_id;
  int replacement_string_id;
  int negate;
  int has_input_expr;
  int constant_expr;
  int namespace_error;
  int matched;
  int output_string_id;
  size_t next_id_bucket;
} ExprEntry;

typedef struct {
  int *items;
  size_t count;
  size_t cap;
} IntStack;

typedef struct {
  char *data;
  size_t len;
  size_t cap;
} StrBuf;

static StringEntry *strings;
static size_t string_count;
static size_t string_cap;
static VarEntry *vars;
static size_t var_count;
static size_t var_cap;
static ExprEntry *exprs;
static size_t expr_count;
static size_t expr_cap;
static int last_error_code;
static int next_generated_string_id = 1;
static size_t string_id_buckets[HASH_BUCKET_COUNT];
static size_t string_value_buckets[HASH_BUCKET_COUNT];
static size_t var_id_buckets[HASH_BUCKET_COUNT];
static size_t expr_id_buckets[HASH_BUCKET_COUNT];

static void set_error(int code) { last_error_code = code; }

static size_t hash_int_key(int value) {
  uint32_t x = (uint32_t)value;
  x ^= x >> 16;
  x *= 0x7feb352du;
  x ^= x >> 15;
  x *= 0x846ca68bu;
  x ^= x >> 16;
  return (size_t)(x & (HASH_BUCKET_COUNT - 1u));
}

static size_t hash_cstr_key(const char *value) {
  uint32_t h = 2166136261u;
  while (*value != '\0') {
    h ^= (unsigned char)*value;
    h *= 16777619u;
    value++;
  }
  return (size_t)(h & (HASH_BUCKET_COUNT - 1u));
}

static char *dup_cstr(const char *value) {
  size_t len = strlen(value);
  char *copy = (char *)malloc(len + 1);
  if (copy == NULL) {
    return NULL;
  }
  memcpy(copy, value, len + 1);
  return copy;
}

static int ensure_strings(size_t need) {
  size_t new_cap;
  StringEntry *new_items;
  if (string_cap >= need) {
    return 1;
  }
  new_cap = string_cap == 0 ? 64u : string_cap;
  while (new_cap < need) {
    new_cap *= 2u;
  }
  new_items = (StringEntry *)realloc(strings, new_cap * sizeof(*strings));
  if (new_items == NULL) {
    set_error(ERR_NO_MEMORY);
    return 0;
  }
  strings = new_items;
  string_cap = new_cap;
  return 1;
}

static int ensure_vars(size_t need) {
  size_t new_cap;
  VarEntry *new_items;
  if (var_cap >= need) {
    return 1;
  }
  new_cap = var_cap == 0 ? 64u : var_cap;
  while (new_cap < need) {
    new_cap *= 2u;
  }
  new_items = (VarEntry *)realloc(vars, new_cap * sizeof(*vars));
  if (new_items == NULL) {
    set_error(ERR_NO_MEMORY);
    return 0;
  }
  vars = new_items;
  var_cap = new_cap;
  return 1;
}

static int ensure_exprs(size_t need) {
  size_t new_cap;
  ExprEntry *new_items;
  if (expr_cap >= need) {
    return 1;
  }
  new_cap = expr_cap == 0 ? 64u : expr_cap;
  while (new_cap < need) {
    new_cap *= 2u;
  }
  new_items = (ExprEntry *)realloc(exprs, new_cap * sizeof(*exprs));
  if (new_items == NULL) {
    set_error(ERR_NO_MEMORY);
    return 0;
  }
  exprs = new_items;
  expr_cap = new_cap;
  return 1;
}

static StringEntry *find_string(int string_id) {
  size_t bucket = string_id_buckets[hash_int_key(string_id)];
  while (bucket != 0u) {
    StringEntry *entry = &strings[bucket - 1u];
    if (entry->used && entry->string_id == string_id) {
      return entry;
    }
    bucket = entry->next_id_bucket;
  }
  return NULL;
}

static StringEntry *find_string_by_value(const char *value) {
  size_t bucket = string_value_buckets[hash_cstr_key(value)];
  while (bucket != 0u) {
    StringEntry *entry = &strings[bucket - 1u];
    if (entry->used && strcmp(entry->value, value) == 0) {
      return entry;
    }
    bucket = entry->next_value_bucket;
  }
  return NULL;
}

static VarEntry *find_var(int var_id) {
  size_t bucket = var_id_buckets[hash_int_key(var_id)];
  while (bucket != 0u) {
    VarEntry *entry = &vars[bucket - 1u];
    if (entry->used && entry->var_id == var_id) {
      return entry;
    }
    bucket = entry->next_id_bucket;
  }
  return NULL;
}

static ExprEntry *find_expr(int expr_id) {
  size_t bucket = expr_id_buckets[hash_int_key(expr_id)];
  while (bucket != 0u) {
    ExprEntry *entry = &exprs[bucket - 1u];
    if (entry->used && entry->expr_id == expr_id) {
      return entry;
    }
    bucket = entry->next_id_bucket;
  }
  return NULL;
}

static int is_string_kind(int kind) {
  return kind == KIND_LITERAL || kind == KIND_VAR || kind == KIND_EMAIL_LOCAL ||
         kind == KIND_REPLACE;
}

static int is_namespace_valid(int namespace_kind) {
  return namespace_kind == VALID_NAMESPACE_KIND || namespace_kind == 2 ||
         namespace_kind == 3;
}

static void index_string(size_t index) {
  StringEntry *entry = &strings[index];
  size_t id_bucket = hash_int_key(entry->string_id);
  size_t value_bucket = hash_cstr_key(entry->value);
  entry->next_id_bucket = string_id_buckets[id_bucket];
  string_id_buckets[id_bucket] = index + 1u;
  entry->next_value_bucket = string_value_buckets[value_bucket];
  string_value_buckets[value_bucket] = index + 1u;
}

static void index_var(size_t index) {
  VarEntry *entry = &vars[index];
  size_t bucket = hash_int_key(entry->var_id);
  entry->next_id_bucket = var_id_buckets[bucket];
  var_id_buckets[bucket] = index + 1u;
}

static void index_expr(size_t index) {
  ExprEntry *entry = &exprs[index];
  size_t bucket = hash_int_key(entry->expr_id);
  entry->next_id_bucket = expr_id_buckets[bucket];
  expr_id_buckets[bucket] = index + 1u;
}

static int add_string_with_id(int string_id, const char *value) {
  char *copy;
  if (!ensure_strings(string_count + 1u)) {
    return 0;
  }
  copy = dup_cstr(value);
  if (copy == NULL) {
    set_error(ERR_NO_MEMORY);
    return 0;
  }
  strings[string_count].used = 1;
  strings[string_count].string_id = string_id;
  strings[string_count].value = copy;
  index_string(string_count);
  string_count++;
  if (string_id >= next_generated_string_id) {
    next_generated_string_id = string_id + 1;
  }
  return 1;
}

static int intern_string_value(const char *value) {
  StringEntry *existing = find_string_by_value(value);
  int candidate;
  if (existing != NULL) {
    return existing->string_id;
  }
  candidate = next_generated_string_id;
  while (find_string(candidate) != NULL) {
    if (candidate == INT32_MAX) {
      candidate = 1;
    } else {
      candidate++;
    }
  }
  if (!add_string_with_id(candidate, value)) {
    return -1;
  }
  return candidate;
}

static int push_stack(IntStack *stack, int value) {
  int *new_items;
  size_t new_cap;
  if (stack->count == stack->cap) {
    new_cap = stack->cap == 0 ? 16u : stack->cap * 2u;
    new_items = (int *)realloc(stack->items, new_cap * sizeof(*stack->items));
    if (new_items == NULL) {
      set_error(ERR_NO_MEMORY);
      return 0;
    }
    stack->items = new_items;
    stack->cap = new_cap;
  }
  stack->items[stack->count++] = value;
  return 1;
}

static void free_stack(IntStack *stack) {
  free(stack->items);
  stack->items = NULL;
  stack->count = 0;
  stack->cap = 0;
}

static int buf_reserve(StrBuf *buf, size_t extra) {
  size_t need = buf->len + extra + 1u;
  size_t new_cap;
  char *new_data;
  if (buf->cap >= need) {
    return 1;
  }
  new_cap = buf->cap == 0 ? 64u : buf->cap;
  while (new_cap < need) {
    if (new_cap > ((size_t)-1) / 2u) {
      set_error(ERR_NO_MEMORY);
      return 0;
    }
    new_cap *= 2u;
  }
  new_data = (char *)realloc(buf->data, new_cap);
  if (new_data == NULL) {
    set_error(ERR_NO_MEMORY);
    return 0;
  }
  buf->data = new_data;
  buf->cap = new_cap;
  return 1;
}

static int buf_append_n(StrBuf *buf, const char *text, size_t len) {
  if (!buf_reserve(buf, len)) {
    return 0;
  }
  memcpy(buf->data + buf->len, text, len);
  buf->len += len;
  buf->data[buf->len] = '\0';
  return 1;
}

static int buf_append_cstr(StrBuf *buf, const char *text) {
  return buf_append_n(buf, text, strlen(text));
}

static int regex_replace_all(const char *input, const char *pattern,
                             const char *replacement, char **out_value) {
  regex_t regex;
  const char *cursor = input;
  StrBuf buf;
  int status;
  *out_value = NULL;
  status = regcomp(&regex, pattern, REG_EXTENDED);
  if (status != 0) {
    set_error(ERR_REGEX);
    return 0;
  }
  buf.data = NULL;
  buf.len = 0;
  buf.cap = 0;
  if (!buf_reserve(&buf, strlen(input) + strlen(replacement) + 1u)) {
    regfree(&regex);
    return 0;
  }
  buf.data[0] = '\0';
  for (;;) {
    regmatch_t match;
    status = regexec(&regex, cursor, 1, &match, 0);
    if (status == REG_NOMATCH) {
      if (!buf_append_cstr(&buf, cursor)) {
        regfree(&regex);
        free(buf.data);
        return 0;
      }
      break;
    }
    if (status != 0 || match.rm_so < 0 || match.rm_eo < match.rm_so) {
      regfree(&regex);
      free(buf.data);
      set_error(ERR_REGEX);
      return 0;
    }
    if (!buf_append_n(&buf, cursor, (size_t)match.rm_so) ||
        !buf_append_cstr(&buf, replacement)) {
      regfree(&regex);
      free(buf.data);
      return 0;
    }
    cursor += match.rm_eo;
    if (match.rm_eo == 0) {
      if (*cursor == '\0') {
        break;
      }
      if (!buf_append_n(&buf, cursor, 1u)) {
        regfree(&regex);
        free(buf.data);
        return 0;
      }
      cursor++;
    }
  }
  regfree(&regex);
  *out_value = buf.data;
  return 1;
}

static int regex_matches(const char *input, const char *pattern, int *out_match) {
  regex_t regex;
  int status = regcomp(&regex, pattern, REG_EXTENDED);
  if (status != 0) {
    set_error(ERR_REGEX);
    return 0;
  }
  status = regexec(&regex, input, 0, NULL, 0);
  regfree(&regex);
  if (status == 0) {
    *out_match = 1;
    return 1;
  }
  if (status == REG_NOMATCH) {
    *out_match = 0;
    return 1;
  }
  set_error(ERR_REGEX);
  return 0;
}

static int matcher_has_input_expr(int input_expr_id, ExprEntry **out_input) {
  ExprEntry *input;
  if (input_expr_id < 0) {
    *out_input = NULL;
    return 0;
  }
  input = find_expr(input_expr_id);
  if (input != NULL) {
    *out_input = input;
    return 1;
  }
  if (input_expr_id == 0) {
    *out_input = NULL;
    return 0;
  }
  *out_input = NULL;
  return -1;
}

static int eval_string_inner(ExprEntry *expr, int *out_string_id,
                             IntStack *touched) {
  int child_string_id;
  ExprEntry *child;
  StringEntry *value;
  StringEntry *pattern;
  StringEntry *replacement;
  char *generated;
  char *at;
  size_t local_len;
  int result_id;
  if (!is_string_kind(expr->kind)) {
    set_error(ERR_INVALID_KIND);
    return 0;
  }
  if (!push_stack(touched, expr->expr_id)) {
    return 0;
  }
  expr->namespace_error = 0;
  expr->output_string_id = -1;
  switch (expr->kind) {
  case KIND_LITERAL:
    if (find_string(expr->string_id) == NULL) {
      set_error(ERR_UNKNOWN_STRING);
      return 0;
    }
    expr->output_string_id = expr->string_id;
    *out_string_id = expr->string_id;
    return 1;
  case KIND_VAR: {
    VarEntry *var = find_var(expr->var_id);
    if (var == NULL) {
      set_error(ERR_UNKNOWN_VAR);
      return 0;
    }
    if (find_string(var->string_id) == NULL) {
      set_error(ERR_UNKNOWN_STRING);
      return 0;
    }
    if (!is_namespace_valid(var->namespace_kind)) {
      expr->namespace_error = 1;
      set_error(ERR_NAMESPACE);
      return 0;
    }
    expr->output_string_id = var->string_id;
    *out_string_id = var->string_id;
    return 1;
  }
  case KIND_EMAIL_LOCAL:
    child = find_expr(expr->child_expr_id);
    if (child == NULL) {
      set_error(ERR_UNKNOWN_EXPR);
      return 0;
    }
    if (!eval_string_inner(child, &child_string_id, touched)) {
      expr->namespace_error = child->namespace_error;
      return 0;
    }
    expr->namespace_error = child->namespace_error;
    value = find_string(child_string_id);
    if (value == NULL) {
      set_error(ERR_UNKNOWN_STRING);
      return 0;
    }
    at = strchr(value->value, '@');
    if (at == NULL) {
      result_id = child_string_id;
    } else {
      local_len = (size_t)(at - value->value);
      generated = (char *)malloc(local_len + 1u);
      if (generated == NULL) {
        set_error(ERR_NO_MEMORY);
        return 0;
      }
      memcpy(generated, value->value, local_len);
      generated[local_len] = '\0';
      result_id = intern_string_value(generated);
      free(generated);
      if (result_id < 0) {
        return 0;
      }
    }
    expr->output_string_id = result_id;
    *out_string_id = result_id;
    return 1;
  case KIND_REPLACE:
    child = find_expr(expr->input_expr_id);
    if (child == NULL) {
      set_error(ERR_UNKNOWN_EXPR);
      return 0;
    }
    if (!eval_string_inner(child, &child_string_id, touched)) {
      expr->namespace_error = child->namespace_error;
      return 0;
    }
    expr->namespace_error = child->namespace_error;
    value = find_string(child_string_id);
    pattern = find_string(expr->pattern_string_id);
    replacement = find_string(expr->replacement_string_id);
    if (value == NULL || pattern == NULL || replacement == NULL) {
      set_error(ERR_UNKNOWN_STRING);
      return 0;
    }
    generated = NULL;
    if (!regex_replace_all(value->value, pattern->value, replacement->value,
                           &generated)) {
      return 0;
    }
    result_id = intern_string_value(generated);
    free(generated);
    if (result_id < 0) {
      return 0;
    }
    expr->output_string_id = result_id;
    *out_string_id = result_id;
    return 1;
  default:
    set_error(ERR_INVALID_KIND);
    return 0;
  }
}

static int eval_string_public(int expr_id, int *out_string_id) {
  ExprEntry *expr = find_expr(expr_id);
  IntStack touched;
  int ok;
  if (expr == NULL) {
    set_error(ERR_UNKNOWN_EXPR);
    return 0;
  }
  touched.items = NULL;
  touched.count = 0;
  touched.cap = 0;
  ok = eval_string_inner(expr, out_string_id, &touched);
  free_stack(&touched);
  if (ok) {
    expr = find_expr(expr_id);
    if (expr != NULL) {
      expr->output_string_id = *out_string_id;
    }
    set_error(ERR_NONE);
  }
  return ok;
}

EXPORT void expr_reset(void) {
  size_t i;
  for (i = 0; i < string_count; i++) {
    free(strings[i].value);
  }
  free(strings);
  free(vars);
  free(exprs);
  strings = NULL;
  vars = NULL;
  exprs = NULL;
  string_count = 0;
  var_count = 0;
  expr_count = 0;
  string_cap = 0;
  var_cap = 0;
  expr_cap = 0;
  next_generated_string_id = 1;
  memset(string_id_buckets, 0, sizeof(string_id_buckets));
  memset(string_value_buckets, 0, sizeof(string_value_buckets));
  memset(var_id_buckets, 0, sizeof(var_id_buckets));
  memset(expr_id_buckets, 0, sizeof(expr_id_buckets));
  last_error_code = ERR_NONE;
}

EXPORT int expr_register_string(int string_id, const char *value) {
  if (value == NULL) {
    set_error(ERR_NULL_POINTER);
    return 0;
  }
  if (find_string(string_id) != NULL) {
    set_error(ERR_DUPLICATE_ID);
    return 0;
  }
  if (!add_string_with_id(string_id, value)) {
    return 0;
  }
  set_error(ERR_NONE);
  return 1;
}

EXPORT int expr_register_var(int var_id, int namespace_kind, int string_id) {
  if (find_var(var_id) != NULL) {
    set_error(ERR_DUPLICATE_ID);
    return 0;
  }
  if (find_string(string_id) == NULL) {
    set_error(ERR_UNKNOWN_STRING);
    return 0;
  }
  if (!ensure_vars(var_count + 1u)) {
    return 0;
  }
  vars[var_count].used = 1;
  vars[var_count].var_id = var_id;
  vars[var_count].namespace_kind = namespace_kind;
  vars[var_count].string_id = string_id;
  index_var(var_count);
  var_count++;
  set_error(ERR_NONE);
  return 1;
}

EXPORT int expr_compile_literal(int expr_id, int string_id) {
  if (find_expr(expr_id) != NULL) {
    set_error(ERR_DUPLICATE_ID);
    return 0;
  }
  if (find_string(string_id) == NULL) {
    set_error(ERR_UNKNOWN_STRING);
    return 0;
  }
  if (!ensure_exprs(expr_count + 1u)) {
    return 0;
  }
  memset(&exprs[expr_count], 0, sizeof(exprs[expr_count]));
  exprs[expr_count].used = 1;
  exprs[expr_count].expr_id = expr_id;
  exprs[expr_count].kind = KIND_LITERAL;
  exprs[expr_count].string_id = string_id;
  exprs[expr_count].constant_expr = 1;
  exprs[expr_count].output_string_id = -1;
  index_expr(expr_count);
  expr_count++;
  set_error(ERR_NONE);
  return 1;
}

EXPORT int expr_compile_var(int expr_id, int var_id) {
  if (find_expr(expr_id) != NULL) {
    set_error(ERR_DUPLICATE_ID);
    return 0;
  }
  if (find_var(var_id) == NULL) {
    set_error(ERR_UNKNOWN_VAR);
    return 0;
  }
  if (!ensure_exprs(expr_count + 1u)) {
    return 0;
  }
  memset(&exprs[expr_count], 0, sizeof(exprs[expr_count]));
  exprs[expr_count].used = 1;
  exprs[expr_count].expr_id = expr_id;
  exprs[expr_count].kind = KIND_VAR;
  exprs[expr_count].var_id = var_id;
  exprs[expr_count].constant_expr = 0;
  exprs[expr_count].output_string_id = -1;
  index_expr(expr_count);
  expr_count++;
  set_error(ERR_NONE);
  return 1;
}

EXPORT int expr_compile_email_local(int expr_id, int child_expr_id) {
  ExprEntry *child;
  if (find_expr(expr_id) != NULL) {
    set_error(ERR_DUPLICATE_ID);
    return 0;
  }
  child = find_expr(child_expr_id);
  if (child == NULL) {
    set_error(ERR_UNKNOWN_EXPR);
    return 0;
  }
  if (!is_string_kind(child->kind)) {
    set_error(ERR_INVALID_KIND);
    return 0;
  }
  if (!ensure_exprs(expr_count + 1u)) {
    return 0;
  }
  memset(&exprs[expr_count], 0, sizeof(exprs[expr_count]));
  exprs[expr_count].used = 1;
  exprs[expr_count].expr_id = expr_id;
  exprs[expr_count].kind = KIND_EMAIL_LOCAL;
  exprs[expr_count].child_expr_id = child_expr_id;
  exprs[expr_count].constant_expr = child->constant_expr;
  exprs[expr_count].output_string_id = -1;
  index_expr(expr_count);
  expr_count++;
  set_error(ERR_NONE);
  return 1;
}

EXPORT int expr_compile_regex_replace(int expr_id, int input_expr_id,
                                      int pattern_string_id,
                                      int replacement_string_id) {
  ExprEntry *input;
  if (find_expr(expr_id) != NULL) {
    set_error(ERR_DUPLICATE_ID);
    return 0;
  }
  input = find_expr(input_expr_id);
  if (input == NULL) {
    set_error(ERR_UNKNOWN_EXPR);
    return 0;
  }
  if (!is_string_kind(input->kind)) {
    set_error(ERR_INVALID_KIND);
    return 0;
  }
  if (find_string(pattern_string_id) == NULL ||
      find_string(replacement_string_id) == NULL) {
    set_error(ERR_UNKNOWN_STRING);
    return 0;
  }
  if (!ensure_exprs(expr_count + 1u)) {
    return 0;
  }
  memset(&exprs[expr_count], 0, sizeof(exprs[expr_count]));
  exprs[expr_count].used = 1;
  exprs[expr_count].expr_id = expr_id;
  exprs[expr_count].kind = KIND_REPLACE;
  exprs[expr_count].input_expr_id = input_expr_id;
  exprs[expr_count].pattern_string_id = pattern_string_id;
  exprs[expr_count].replacement_string_id = replacement_string_id;
  exprs[expr_count].constant_expr = input->constant_expr;
  exprs[expr_count].output_string_id = -1;
  index_expr(expr_count);
  expr_count++;
  set_error(ERR_NONE);
  return 1;
}

EXPORT int expr_compile_regex_match(int expr_id, int input_expr_id,
                                    int pattern_string_id, int negate) {
  ExprEntry *input = NULL;
  int has_input;
  if (find_expr(expr_id) != NULL) {
    set_error(ERR_DUPLICATE_ID);
    return 0;
  }
  has_input = matcher_has_input_expr(input_expr_id, &input);
  if (has_input < 0) {
    set_error(ERR_UNKNOWN_EXPR);
    return 0;
  }
  if (has_input) {
    if (!is_string_kind(input->kind)) {
      set_error(ERR_INVALID_KIND);
      return 0;
    }
  }
  if (find_string(pattern_string_id) == NULL) {
    set_error(ERR_UNKNOWN_STRING);
    return 0;
  }
  if (!ensure_exprs(expr_count + 1u)) {
    return 0;
  }
  memset(&exprs[expr_count], 0, sizeof(exprs[expr_count]));
  exprs[expr_count].used = 1;
  exprs[expr_count].expr_id = expr_id;
  exprs[expr_count].kind = KIND_MATCH;
  exprs[expr_count].input_expr_id = input_expr_id;
  exprs[expr_count].pattern_string_id = pattern_string_id;
  exprs[expr_count].negate = negate != 0 ? 1 : 0;
  exprs[expr_count].has_input_expr = has_input;
  exprs[expr_count].constant_expr = has_input && input != NULL ? input->constant_expr : 0;
  exprs[expr_count].output_string_id = -1;
  index_expr(expr_count);
  expr_count++;
  set_error(ERR_NONE);
  return 1;
}

EXPORT int expr_evaluate_string(int expr_id, int *out_string_id) {
  if (out_string_id == NULL) {
    set_error(ERR_NULL_POINTER);
    return 0;
  }
  return eval_string_public(expr_id, out_string_id);
}

EXPORT int expr_evaluate_match(int expr_id, int matcher_string_id) {
  ExprEntry *expr = find_expr(expr_id);
  ExprEntry *child;
  StringEntry *input;
  StringEntry *pattern;
  IntStack touched;
  int input_id;
  int raw_match = 0;
  int final_match;
  if (expr == NULL) {
    set_error(ERR_UNKNOWN_EXPR);
    return 0;
  }
  if (expr->kind != KIND_MATCH) {
    set_error(ERR_INVALID_KIND);
    return 0;
  }
  expr->namespace_error = 0;
  expr->matched = 0;
  expr->output_string_id = -1;
  if (expr->has_input_expr) {
    child = find_expr(expr->input_expr_id);
    if (child == NULL) {
      set_error(ERR_UNKNOWN_EXPR);
      return 0;
    }
    touched.items = NULL;
    touched.count = 0;
    touched.cap = 0;
    if (!eval_string_inner(child, &input_id, &touched)) {
      expr->namespace_error = child->namespace_error;
      free_stack(&touched);
      return 0;
    }
    expr->namespace_error = child->namespace_error;
    free_stack(&touched);
  } else {
    input_id = matcher_string_id;
  }
  input = find_string(input_id);
  pattern = find_string(expr->pattern_string_id);
  if (input == NULL || pattern == NULL) {
    set_error(ERR_UNKNOWN_STRING);
    return 0;
  }
  if (!regex_matches(input->value, pattern->value, &raw_match)) {
    return 0;
  }
  final_match = expr->negate ? !raw_match : raw_match;
  expr->matched = final_match;
  set_error(ERR_NONE);
  return final_match;
}

EXPORT int expr_audit_get(int expr_id, int matcher_string_id,
                          ExprAuditView *out_view) {
  ExprEntry *expr;
  int ignored;
  if (out_view == NULL) {
    set_error(ERR_NULL_POINTER);
    return 0;
  }
  expr = find_expr(expr_id);
  if (expr == NULL) {
    set_error(ERR_UNKNOWN_EXPR);
    return 0;
  }
  memset(out_view, 0, sizeof(*out_view));
  out_view->exists = 1;
  out_view->kind = expr->kind;
  out_view->string_evaluable = is_string_kind(expr->kind) ? 1 : 0;
  out_view->match_evaluable = expr->kind == KIND_MATCH ? 1 : 0;
  out_view->constant_expr = expr->constant_expr;
  out_view->output_string_id = -1;
  if (expr->kind == KIND_MATCH) {
    (void)expr_evaluate_match(expr_id, matcher_string_id);
  } else {
    ignored = -1;
    (void)expr_evaluate_string(expr_id, &ignored);
  }
  expr = find_expr(expr_id);
  if (expr != NULL) {
    out_view->namespace_error = expr->namespace_error;
    out_view->matched = expr->matched;
    out_view->output_string_id = expr->output_string_id;
  }
  return 1;
}

EXPORT int expr_last_error(void) { return last_error_code; }
