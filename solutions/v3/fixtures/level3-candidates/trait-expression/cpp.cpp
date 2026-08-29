#include <regex.h>

#include <cstdlib>
#include <cstring>
#include <string>
#include <unordered_map>
#include <vector>

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

namespace {

constexpr int KIND_LITERAL = 1;
constexpr int KIND_VAR = 2;
constexpr int KIND_EMAIL_LOCAL = 3;
constexpr int KIND_REPLACE = 4;
constexpr int KIND_MATCH = 5;

constexpr int ERR_NONE = 0;
constexpr int ERR_DUPLICATE_ID = 1;
constexpr int ERR_UNKNOWN_EXPR = 2;
constexpr int ERR_INVALID_KIND = 3;
constexpr int ERR_NULL_POINTER = 4;
constexpr int ERR_UNKNOWN_VAR = 5;
constexpr int ERR_UNKNOWN_STRING = 6;
constexpr int ERR_NAMESPACE = 7;
constexpr int ERR_REGEX = 8;
constexpr int ERR_CAPACITY = 9;

struct StringRec {
  int id = 0;
  std::string value;
};

struct VarRec {
  int namespace_kind = 0;
  int string_id = 0;
};

struct ExprRec {
  int kind = 0;
  int string_id = 0;
  int var_id = 0;
  int child_id = 0;
  int input_id = 0;
  int pattern_id = 0;
  int replacement_id = 0;
  int negate = 0;
  int has_input = 0;
  int constant_expr = 0;
  int namespace_error = 0;
  int matched = 0;
  int output_string_id = -1;
};

std::unordered_map<int, StringRec> g_strings;
std::unordered_map<std::string, int> g_canonical_string_id;
std::unordered_map<int, VarRec> g_vars;
std::unordered_map<int, ExprRec> g_exprs;
int g_last_error = ERR_NONE;
int g_next_auto_string_id = 1;

bool valid_namespace(int ns) { return ns == 1 || ns == 2 || ns == 3; }

StringRec *find_string(int id) {
  auto it = g_strings.find(id);
  return it == g_strings.end() ? nullptr : &it->second;
}

VarRec *find_var(int id) {
  auto it = g_vars.find(id);
  return it == g_vars.end() ? nullptr : &it->second;
}

ExprRec *find_expr(int id) {
  auto it = g_exprs.find(id);
  return it == g_exprs.end() ? nullptr : &it->second;
}

int add_string_with_id(int id, const char *value) {
  if (find_string(id) != nullptr) {
    g_last_error = ERR_DUPLICATE_ID;
    return 0;
  }
  try {
    const std::string text(value);
    g_strings.emplace(id, StringRec{id, text});
    if (g_canonical_string_id.find(text) == g_canonical_string_id.end()) {
      g_canonical_string_id.emplace(text, id);
    }
    if (id >= g_next_auto_string_id) {
      g_next_auto_string_id = id + 1;
    }
  } catch (...) {
    g_last_error = ERR_CAPACITY;
    return 0;
  }
  return 1;
}

int intern_string_value(const std::string &value) {
  auto it = g_canonical_string_id.find(value);
  if (it != g_canonical_string_id.end()) {
    return it->second;
  }
  while (find_string(g_next_auto_string_id) != nullptr) {
    ++g_next_auto_string_id;
  }
  const int id = g_next_auto_string_id++;
  if (!add_string_with_id(id, value.c_str())) {
    return -1;
  }
  return id;
}

int add_expr(int id, int kind, ExprRec **out) {
  if (find_expr(id) != nullptr) {
    g_last_error = ERR_DUPLICATE_ID;
    return 0;
  }
  try {
    ExprRec rec;
    rec.kind = kind;
    auto inserted = g_exprs.emplace(id, rec);
    *out = &inserted.first->second;
  } catch (...) {
    g_last_error = ERR_CAPACITY;
    return 0;
  }
  return 1;
}

int append_bytes(std::string *out, const char *data, size_t size) {
  try {
    out->append(data, size);
  } catch (...) {
    g_last_error = ERR_CAPACITY;
    return 0;
  }
  return 1;
}

int replace_all_regex(const std::string &input, const std::string &pattern,
                      const std::string &replacement, std::string *out) {
  regex_t re;
  if (regcomp(&re, pattern.c_str(), REG_EXTENDED) != 0) {
    g_last_error = ERR_REGEX;
    return 0;
  }

  out->clear();
  const char *base = input.c_str();
  const char *cur = base;
  regmatch_t match[1];

  while (regexec(&re, cur, 1, match, 0) == 0) {
    const size_t prefix = static_cast<size_t>(match[0].rm_so);
    if (!append_bytes(out, cur, prefix) ||
        !append_bytes(out, replacement.data(), replacement.size())) {
      regfree(&re);
      return 0;
    }

    if (match[0].rm_eo == 0) {
      if (*cur == '\0') {
        break;
      }
      if (!append_bytes(out, cur, 1)) {
        regfree(&re);
        return 0;
      }
      ++cur;
    } else {
      cur += match[0].rm_eo;
    }
  }

  if (!append_bytes(out, cur, std::strlen(cur))) {
    regfree(&re);
    return 0;
  }
  regfree(&re);
  return 1;
}

int eval_string_inner(int expr_id, int *out_string_id);

int eval_match_inner(ExprRec *expr, int matcher_string_id) {
  int input_id = matcher_string_id;
  if (expr->has_input) {
    if (!eval_string_inner(expr->input_id, &input_id)) {
      ExprRec *child = find_expr(expr->input_id);
      if (child != nullptr && child->namespace_error) {
        expr->namespace_error = 1;
      }
      return 0;
    }
    ExprRec *child = find_expr(expr->input_id);
    if (child != nullptr && child->namespace_error) {
      expr->namespace_error = 1;
    }
  }

  StringRec *input = find_string(input_id);
  StringRec *pattern = find_string(expr->pattern_id);
  if (input == nullptr || pattern == nullptr) {
    g_last_error = ERR_UNKNOWN_STRING;
    return 0;
  }

  regex_t re;
  if (regcomp(&re, pattern->value.c_str(), REG_EXTENDED) != 0) {
    g_last_error = ERR_REGEX;
    return 0;
  }
  const int raw = regexec(&re, input->value.c_str(), 0, nullptr, 0) == 0;
  regfree(&re);
  expr->matched = expr->negate ? !raw : raw;
  g_last_error = ERR_NONE;
  return expr->matched;
}

int eval_string_inner(int expr_id, int *out_string_id) {
  ExprRec *expr = find_expr(expr_id);
  if (expr == nullptr) {
    g_last_error = ERR_UNKNOWN_EXPR;
    return 0;
  }
  if (expr->kind == KIND_MATCH) {
    g_last_error = ERR_INVALID_KIND;
    return 0;
  }
  if (expr->output_string_id >= 0 && !expr->namespace_error) {
    *out_string_id = expr->output_string_id;
    g_last_error = ERR_NONE;
    return 1;
  }

  if (expr->kind == KIND_LITERAL) {
    expr->output_string_id = expr->string_id;
    *out_string_id = expr->string_id;
    g_last_error = ERR_NONE;
    return 1;
  }

  if (expr->kind == KIND_VAR) {
    VarRec *var = find_var(expr->var_id);
    if (var == nullptr) {
      g_last_error = ERR_UNKNOWN_VAR;
      return 0;
    }
    expr->output_string_id = var->string_id;
    if (!valid_namespace(var->namespace_kind)) {
      expr->namespace_error = 1;
      g_last_error = ERR_NAMESPACE;
      return 0;
    }
    *out_string_id = var->string_id;
    g_last_error = ERR_NONE;
    return 1;
  }

  if (expr->kind == KIND_EMAIL_LOCAL) {
    int child_id = -1;
    if (!eval_string_inner(expr->child_id, &child_id)) {
      ExprRec *child = find_expr(expr->child_id);
      if (child != nullptr && child->namespace_error) {
        expr->namespace_error = 1;
      }
      return 0;
    }
    ExprRec *child = find_expr(expr->child_id);
    if (child != nullptr && child->namespace_error) {
      expr->namespace_error = 1;
      g_last_error = ERR_NAMESPACE;
      return 0;
    }
    StringRec *text = find_string(child_id);
    if (text == nullptr) {
      g_last_error = ERR_UNKNOWN_STRING;
      return 0;
    }
    const std::string::size_type at = text->value.find('@');
    if (at == std::string::npos) {
      expr->output_string_id = child_id;
    } else {
      expr->output_string_id = intern_string_value(text->value.substr(0, at));
      if (expr->output_string_id < 0) {
        return 0;
      }
    }
    *out_string_id = expr->output_string_id;
    g_last_error = ERR_NONE;
    return 1;
  }

  if (expr->kind == KIND_REPLACE) {
    int input_id = -1;
    if (!eval_string_inner(expr->input_id, &input_id)) {
      ExprRec *child = find_expr(expr->input_id);
      if (child != nullptr && child->namespace_error) {
        expr->namespace_error = 1;
      }
      return 0;
    }
    ExprRec *child = find_expr(expr->input_id);
    if (child != nullptr && child->namespace_error) {
      expr->namespace_error = 1;
      g_last_error = ERR_NAMESPACE;
      return 0;
    }
    StringRec *input = find_string(input_id);
    StringRec *pattern = find_string(expr->pattern_id);
    StringRec *replacement = find_string(expr->replacement_id);
    if (input == nullptr || pattern == nullptr || replacement == nullptr) {
      g_last_error = ERR_UNKNOWN_STRING;
      return 0;
    }
    std::string result;
    if (!replace_all_regex(input->value, pattern->value, replacement->value,
                           &result)) {
      return 0;
    }
    expr->output_string_id = intern_string_value(result);
    if (expr->output_string_id < 0) {
      return 0;
    }
    *out_string_id = expr->output_string_id;
    g_last_error = ERR_NONE;
    return 1;
  }

  g_last_error = ERR_INVALID_KIND;
  return 0;
}

}  // namespace

extern "C" {

__attribute__((visibility("default"))) void expr_reset(void) {
  g_strings.clear();
  g_canonical_string_id.clear();
  g_vars.clear();
  g_exprs.clear();
  g_last_error = ERR_NONE;
  g_next_auto_string_id = 1;
}

__attribute__((visibility("default"))) int expr_register_string(
    int string_id, const char *value) {
  if (value == nullptr) {
    g_last_error = ERR_NULL_POINTER;
    return 0;
  }
  const int ok = add_string_with_id(string_id, value);
  if (ok) {
    g_last_error = ERR_NONE;
  }
  return ok;
}

__attribute__((visibility("default"))) int expr_register_var(
    int var_id, int namespace_kind, int string_id) {
  if (find_var(var_id) != nullptr) {
    g_last_error = ERR_DUPLICATE_ID;
    return 0;
  }
  if (find_string(string_id) == nullptr) {
    g_last_error = ERR_UNKNOWN_STRING;
    return 0;
  }
  try {
    g_vars.emplace(var_id, VarRec{namespace_kind, string_id});
  } catch (...) {
    g_last_error = ERR_CAPACITY;
    return 0;
  }
  g_last_error = ERR_NONE;
  return 1;
}

__attribute__((visibility("default"))) int expr_compile_literal(
    int expr_id, int string_id) {
  if (find_string(string_id) == nullptr) {
    g_last_error = ERR_UNKNOWN_STRING;
    return 0;
  }
  ExprRec *expr = nullptr;
  if (!add_expr(expr_id, KIND_LITERAL, &expr)) {
    return 0;
  }
  expr->string_id = string_id;
  expr->constant_expr = 1;
  expr->output_string_id = string_id;
  g_last_error = ERR_NONE;
  return 1;
}

__attribute__((visibility("default"))) int expr_compile_var(int expr_id,
                                                            int var_id) {
  VarRec *var = find_var(var_id);
  if (var == nullptr) {
    g_last_error = ERR_UNKNOWN_VAR;
    return 0;
  }
  ExprRec *expr = nullptr;
  if (!add_expr(expr_id, KIND_VAR, &expr)) {
    return 0;
  }
  expr->var_id = var_id;
  expr->string_id = var->string_id;
  expr->constant_expr = 0;
  int ignored = -1;
  (void)eval_string_inner(expr_id, &ignored);
  g_last_error = ERR_NONE;
  return 1;
}

__attribute__((visibility("default"))) int expr_compile_email_local(
    int expr_id, int child_expr_id) {
  ExprRec *child = find_expr(child_expr_id);
  if (child == nullptr) {
    g_last_error = ERR_UNKNOWN_EXPR;
    return 0;
  }
  if (child->kind == KIND_MATCH) {
    g_last_error = ERR_INVALID_KIND;
    return 0;
  }
  ExprRec *expr = nullptr;
  if (!add_expr(expr_id, KIND_EMAIL_LOCAL, &expr)) {
    return 0;
  }
  expr->child_id = child_expr_id;
  expr->constant_expr = child->constant_expr;
  int ignored = -1;
  (void)eval_string_inner(expr_id, &ignored);
  g_last_error = ERR_NONE;
  return 1;
}

__attribute__((visibility("default"))) int expr_compile_regex_replace(
    int expr_id, int input_expr_id, int pattern_string_id,
    int replacement_string_id) {
  ExprRec *input = find_expr(input_expr_id);
  if (input == nullptr) {
    g_last_error = ERR_UNKNOWN_EXPR;
    return 0;
  }
  if (input->kind == KIND_MATCH) {
    g_last_error = ERR_INVALID_KIND;
    return 0;
  }
  if (find_string(pattern_string_id) == nullptr ||
      find_string(replacement_string_id) == nullptr) {
    g_last_error = ERR_UNKNOWN_STRING;
    return 0;
  }
  ExprRec *expr = nullptr;
  if (!add_expr(expr_id, KIND_REPLACE, &expr)) {
    return 0;
  }
  expr->input_id = input_expr_id;
  expr->pattern_id = pattern_string_id;
  expr->replacement_id = replacement_string_id;
  expr->constant_expr = input->constant_expr;
  int ignored = -1;
  (void)eval_string_inner(expr_id, &ignored);
  g_last_error = ERR_NONE;
  return 1;
}

__attribute__((visibility("default"))) int expr_compile_regex_match(
    int expr_id, int input_expr_id, int pattern_string_id, int negate) {
  const int has_input = input_expr_id > 0;
  ExprRec *input = nullptr;
  if (has_input) {
    input = find_expr(input_expr_id);
    if (input == nullptr) {
      g_last_error = ERR_UNKNOWN_EXPR;
      return 0;
    }
    if (input->kind == KIND_MATCH) {
      g_last_error = ERR_INVALID_KIND;
      return 0;
    }
  }
  if (find_string(pattern_string_id) == nullptr) {
    g_last_error = ERR_UNKNOWN_STRING;
    return 0;
  }
  ExprRec *expr = nullptr;
  if (!add_expr(expr_id, KIND_MATCH, &expr)) {
    return 0;
  }
  expr->input_id = input_expr_id;
  expr->has_input = has_input;
  expr->pattern_id = pattern_string_id;
  expr->negate = negate ? 1 : 0;
  expr->constant_expr = has_input && input != nullptr ? input->constant_expr : 0;
  g_last_error = ERR_NONE;
  return 1;
}

__attribute__((visibility("default"))) int expr_evaluate_string(
    int expr_id, int *out_string_id) {
  if (out_string_id == nullptr) {
    g_last_error = ERR_NULL_POINTER;
    return 0;
  }
  return eval_string_inner(expr_id, out_string_id);
}

__attribute__((visibility("default"))) int expr_evaluate_match(
    int expr_id, int matcher_string_id) {
  ExprRec *expr = find_expr(expr_id);
  if (expr == nullptr) {
    g_last_error = ERR_UNKNOWN_EXPR;
    return 0;
  }
  if (expr->kind != KIND_MATCH) {
    g_last_error = ERR_INVALID_KIND;
    return 0;
  }
  return eval_match_inner(expr, matcher_string_id);
}

__attribute__((visibility("default"))) int expr_audit_get(
    int expr_id, int matcher_string_id, ExprAuditView *out_view) {
  if (out_view == nullptr) {
    g_last_error = ERR_NULL_POINTER;
    return 0;
  }
  *out_view = ExprAuditView{0, 0, 0, 0, 0, 0, 0, 0};
  ExprRec *expr = find_expr(expr_id);
  if (expr == nullptr) {
    return 0;
  }

  out_view->exists = 1;
  out_view->kind = expr->kind;
  out_view->string_evaluable = expr->kind != KIND_MATCH ? 1 : 0;
  out_view->match_evaluable = expr->kind == KIND_MATCH ? 1 : 0;
  out_view->constant_expr = expr->constant_expr;
  out_view->output_string_id = -1;

  if (expr->kind == KIND_MATCH) {
    const int saved_error = g_last_error;
    (void)eval_match_inner(expr, matcher_string_id);
    out_view->matched = expr->matched;
    out_view->namespace_error = expr->namespace_error;
    if (expr->namespace_error) {
      g_last_error = saved_error;
    }
  } else {
    int out_id = -1;
    const int ok = eval_string_inner(expr_id, &out_id);
    out_view->namespace_error = expr->namespace_error;
    if (ok) {
      out_view->output_string_id = out_id;
    }
  }

  return 1;
}

__attribute__((visibility("default"))) int expr_last_error(void) {
  return g_last_error;
}

}  // extern "C"
