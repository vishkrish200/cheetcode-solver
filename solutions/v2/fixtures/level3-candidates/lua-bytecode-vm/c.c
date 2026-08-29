#include <ctype.h>
#include <limits.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define EXPORT __attribute__((visibility("default")))

enum {
    ERR_NULL = 1,
    ERR_UTF8 = 2,
    ERR_SYNTAX = 3,
    ERR_BAD_CHUNK = 4,
    ERR_RUNTIME = 5,
    ERR_BAD_POINTER = 6,
    ERR_BAD_FUNCTION = 7,
    ERR_STACK = 8
};

enum { MAX_RECURSION = 512, MAX_STRING = 127 };

typedef enum {
    VAL_NIL,
    VAL_BOOL,
    VAL_INT,
    VAL_STR,
    VAL_FUNCTION
} ValueType;

typedef struct FunctionDef FunctionDef;

typedef struct {
    ValueType type;
    int boolean;
    int64_t integer;
    char str[MAX_STRING + 1];
    const FunctionDef *func;
} Value;

typedef enum {
    TOK_EOF,
    TOK_IDENT,
    TOK_INT,
    TOK_STR,
    TOK_PLUS,
    TOK_MINUS,
    TOK_STAR,
    TOK_FLOORDIV,
    TOK_PERCENT,
    TOK_DOTDOT,
    TOK_LEN,
    TOK_EQEQ,
    TOK_NE,
    TOK_LT,
    TOK_LE,
    TOK_GT,
    TOK_GE,
    TOK_ASSIGN,
    TOK_LPAREN,
    TOK_RPAREN,
    TOK_COMMA,
    TOK_SEMI,
    TOK_AND,
    TOK_OR,
    TOK_NOT,
    TOK_IF,
    TOK_THEN,
    TOK_ELSEIF,
    TOK_ELSE,
    TOK_END,
    TOK_WHILE,
    TOK_DO,
    TOK_FOR,
    TOK_FUNCTION,
    TOK_LOCAL,
    TOK_RETURN,
    TOK_TRUE,
    TOK_FALSE,
    TOK_NIL
} TokenKind;

typedef struct {
    TokenKind kind;
    int64_t integer;
    char *text;
    size_t pos;
} Token;

typedef struct Expr Expr;
typedef struct Stmt Stmt;

typedef struct {
    Expr **items;
    size_t len;
    size_t cap;
} ExprVec;

typedef struct {
    Stmt *items;
    size_t len;
    size_t cap;
} StmtVec;

typedef struct {
    char **items;
    size_t len;
    size_t cap;
} NameVec;

typedef struct {
    Expr *cond;
    StmtVec body;
} Branch;

typedef struct {
    Branch *items;
    size_t len;
    size_t cap;
} BranchVec;

typedef enum {
    EX_NIL,
    EX_BOOL,
    EX_INT,
    EX_STR,
    EX_VAR,
    EX_UNARY,
    EX_BINARY,
    EX_CALL
} ExprKind;

typedef enum { UN_NEG, UN_NOT, UN_LEN } UnOp;

typedef enum {
    BIN_ADD,
    BIN_SUB,
    BIN_MUL,
    BIN_FLOORDIV,
    BIN_MOD,
    BIN_CONCAT,
    BIN_EQ,
    BIN_NE,
    BIN_LT,
    BIN_LE,
    BIN_GT,
    BIN_GE,
    BIN_AND,
    BIN_OR
} BinOp;

struct Expr {
    ExprKind kind;
    union {
        int boolean;
        int64_t integer;
        char *text;
        struct {
            UnOp op;
            Expr *inner;
        } unary;
        struct {
            Expr *left;
            BinOp op;
            Expr *right;
        } binary;
        struct {
            char *name;
            ExprVec args;
        } call;
    } as;
};

struct FunctionDef {
    NameVec params;
    StmtVec body;
};

typedef enum {
    ST_LOCAL,
    ST_ASSIGN,
    ST_IF,
    ST_WHILE,
    ST_FOR,
    ST_FUNCTION,
    ST_CALL,
    ST_RETURN,
    ST_DO
} StmtKind;

struct Stmt {
    StmtKind kind;
    union {
        struct {
            NameVec names;
            ExprVec exprs;
        } local_stmt;
        struct {
            NameVec names;
            ExprVec exprs;
        } assign_stmt;
        struct {
            BranchVec branches;
            StmtVec else_body;
        } if_stmt;
        struct {
            Expr *cond;
            StmtVec body;
        } while_stmt;
        struct {
            char *name;
            Expr *start;
            Expr *limit;
            Expr *step;
            StmtVec body;
        } for_stmt;
        struct {
            char *name;
            FunctionDef func;
        } function_stmt;
        struct {
            Expr *expr;
        } call_stmt;
        struct {
            Expr *expr;
            int has_expr;
        } return_stmt;
        struct {
            StmtVec body;
        } do_stmt;
    } as;
};

typedef struct {
    StmtVec body;
} Chunk;

typedef struct {
    Token *items;
    size_t len;
    size_t cap;
} TokenVec;

typedef struct {
    TokenVec tokens;
    size_t pos;
} Parser;

typedef struct {
    char *name;
    Value value;
} Binding;

typedef struct {
    Binding *items;
    size_t len;
    size_t cap;
} Scope;

typedef struct {
    Scope *scopes;
    size_t len;
    size_t cap;
    int depth;
} Env;

typedef struct {
    Chunk *items;
    size_t len;
    size_t cap;
} ChunkVec;

typedef struct {
    Binding *items;
    size_t len;
    size_t cap;
} Globals;

typedef struct {
    ChunkVec chunks;
    Globals globals;
    int last_error;
    Value last_result;
} State;

typedef enum { FLOW_NORMAL, FLOW_RETURN } FlowKind;

typedef struct {
    FlowKind kind;
    Value value;
} Flow;

static State G;

static Value value_nil(void) {
    Value v;
    memset(&v, 0, sizeof(v));
    v.type = VAL_NIL;
    return v;
}

static Value value_bool(int b) {
    Value v = value_nil();
    v.type = VAL_BOOL;
    v.boolean = b ? 1 : 0;
    return v;
}

static Value value_int(int64_t n) {
    Value v = value_nil();
    v.type = VAL_INT;
    v.integer = n;
    return v;
}

static Value value_str_len(const char *s, size_t len) {
    Value v = value_nil();
    v.type = VAL_STR;
    if (len > MAX_STRING) {
        len = MAX_STRING;
    }
    if (len > 0) {
        memcpy(v.str, s, len);
    }
    v.str[len] = '\0';
    return v;
}

static Value value_func(const FunctionDef *f) {
    Value v = value_nil();
    v.type = VAL_FUNCTION;
    v.func = f;
    return v;
}

static int value_truthy(Value v) {
    return !(v.type == VAL_NIL || (v.type == VAL_BOOL && !v.boolean));
}

static int value_type_code(Value v) {
    switch (v.type) {
        case VAL_NIL: return 0;
        case VAL_BOOL: return 1;
        case VAL_INT: return 2;
        case VAL_STR: return 3;
        case VAL_FUNCTION: return 4;
    }
    return 0;
}

static char *dup_range(const char *s, size_t len) {
    char *out = (char *)malloc(len + 1);
    if (out == NULL) {
        abort();
    }
    if (len > 0) {
        memcpy(out, s, len);
    }
    out[len] = '\0';
    return out;
}

static char *dup_cstr(const char *s) {
    return dup_range(s, strlen(s));
}

static void *grow_array(void *items, size_t elem_size, size_t *cap, size_t need) {
    if (*cap >= need) {
        return items;
    }
    size_t next = (*cap == 0) ? 4 : (*cap * 2);
    while (next < need) {
        next *= 2;
    }
    void *out = realloc(items, elem_size * next);
    if (out == NULL) {
        abort();
    }
    *cap = next;
    return out;
}

#define VEC_PUSH(vec, value) do { \
    (vec)->items = grow_array((vec)->items, sizeof(*(vec)->items), &(vec)->cap, (vec)->len + 1); \
    (vec)->items[(vec)->len++] = (value); \
} while (0)

static Expr *new_expr(ExprKind kind) {
    Expr *expr = (Expr *)calloc(1, sizeof(*expr));
    if (expr == NULL) {
        abort();
    }
    expr->kind = kind;
    return expr;
}

static Stmt new_stmt(StmtKind kind) {
    Stmt stmt;
    memset(&stmt, 0, sizeof(stmt));
    stmt.kind = kind;
    return stmt;
}

static Token current_token(Parser *p) {
    return p->tokens.items[p->pos];
}

static int same_kind(TokenKind a, TokenKind b) {
    return a == b;
}

static int parser_matches(Parser *p, TokenKind kind) {
    return same_kind(current_token(p).kind, kind);
}

static Token parser_bump(Parser *p) {
    Token tok = current_token(p);
    if (p->pos + 1 < p->tokens.len) {
        p->pos++;
    }
    return tok;
}

static int parser_eat(Parser *p, TokenKind kind) {
    if (parser_matches(p, kind)) {
        (void)parser_bump(p);
        return 1;
    }
    return 0;
}

static int parser_expect(Parser *p, TokenKind kind) {
    return parser_eat(p, kind) ? 1 : 0;
}

static int lex_int(const char *src, size_t *pos, Token *tok) {
    size_t start = *pos;
    while (isdigit((unsigned char)src[*pos])) {
        (*pos)++;
    }
    char *text = dup_range(src + start, *pos - start);
    char *end = NULL;
    long long n = strtoll(text, &end, 10);
    int ok = (end != text && *end == '\0');
    free(text);
    if (!ok) {
        return 0;
    }
    tok->kind = TOK_INT;
    tok->integer = (int64_t)n;
    tok->text = NULL;
    return 1;
}

static TokenKind keyword_kind(const char *text) {
    if (strcmp(text, "and") == 0) return TOK_AND;
    if (strcmp(text, "or") == 0) return TOK_OR;
    if (strcmp(text, "not") == 0) return TOK_NOT;
    if (strcmp(text, "if") == 0) return TOK_IF;
    if (strcmp(text, "then") == 0) return TOK_THEN;
    if (strcmp(text, "elseif") == 0) return TOK_ELSEIF;
    if (strcmp(text, "else") == 0) return TOK_ELSE;
    if (strcmp(text, "end") == 0) return TOK_END;
    if (strcmp(text, "while") == 0) return TOK_WHILE;
    if (strcmp(text, "do") == 0) return TOK_DO;
    if (strcmp(text, "for") == 0) return TOK_FOR;
    if (strcmp(text, "function") == 0) return TOK_FUNCTION;
    if (strcmp(text, "local") == 0) return TOK_LOCAL;
    if (strcmp(text, "return") == 0) return TOK_RETURN;
    if (strcmp(text, "true") == 0) return TOK_TRUE;
    if (strcmp(text, "false") == 0) return TOK_FALSE;
    if (strcmp(text, "nil") == 0) return TOK_NIL;
    return TOK_IDENT;
}

static void lex_ident(const char *src, size_t *pos, Token *tok) {
    size_t start = *pos;
    while (isalnum((unsigned char)src[*pos]) || src[*pos] == '_') {
        (*pos)++;
    }
    char *text = dup_range(src + start, *pos - start);
    TokenKind kind = keyword_kind(text);
    tok->kind = kind;
    tok->integer = 0;
    tok->text = (kind == TOK_IDENT) ? text : NULL;
    if (kind != TOK_IDENT) {
        free(text);
    }
}

static int lex_string(const char *src, size_t *pos, Token *tok) {
    char quote = src[*pos];
    (*pos)++;
    char buf[MAX_STRING + 1];
    size_t len = 0;
    while (src[*pos] != '\0') {
        unsigned char ch = (unsigned char)src[*pos];
        (*pos)++;
        if (ch == (unsigned char)quote) {
            tok->kind = TOK_STR;
            tok->integer = 0;
            tok->text = dup_range(buf, len);
            return 1;
        }
        if (ch == '\\') {
            unsigned char esc = (unsigned char)src[*pos];
            if (esc == '\0') {
                return 0;
            }
            (*pos)++;
            switch (esc) {
                case '\\': ch = '\\'; break;
                case '\'': ch = '\''; break;
                case '"': ch = '"'; break;
                case 'n': ch = '\n'; break;
                case 't': ch = '\t'; break;
                default: return 0;
            }
        }
        if (len >= MAX_STRING) {
            return 0;
        }
        buf[len++] = (char)ch;
    }
    return 0;
}

static int tokenize(const char *src, TokenVec *out) {
    size_t pos = 0;
    while (1) {
        while (src[pos] == ' ' || src[pos] == '\n' || src[pos] == '\r' || src[pos] == '\t') {
            pos++;
        }
        if (src[pos] == '-' && src[pos + 1] == '-') {
            pos += 2;
            while (src[pos] != '\0' && src[pos] != '\n') {
                pos++;
            }
            continue;
        }
        Token tok;
        memset(&tok, 0, sizeof(tok));
        tok.pos = pos;
        unsigned char ch = (unsigned char)src[pos];
        if (ch == '\0') {
            tok.kind = TOK_EOF;
            VEC_PUSH(out, tok);
            return 1;
        }
        if (isdigit(ch)) {
            if (!lex_int(src, &pos, &tok)) {
                return 0;
            }
        } else if (isalpha(ch) || ch == '_') {
            lex_ident(src, &pos, &tok);
        } else if (ch == '\'' || ch == '"') {
            if (!lex_string(src, &pos, &tok)) {
                return 0;
            }
        } else {
            pos++;
            switch (ch) {
                case '+': tok.kind = TOK_PLUS; break;
                case '-': tok.kind = TOK_MINUS; break;
                case '*': tok.kind = TOK_STAR; break;
                case '%': tok.kind = TOK_PERCENT; break;
                case '#': tok.kind = TOK_LEN; break;
                case '(' : tok.kind = TOK_LPAREN; break;
                case ')' : tok.kind = TOK_RPAREN; break;
                case ',' : tok.kind = TOK_COMMA; break;
                case ';' : tok.kind = TOK_SEMI; break;
                case '/':
                    if (src[pos] != '/') return 0;
                    pos++;
                    tok.kind = TOK_FLOORDIV;
                    break;
                case '.':
                    if (src[pos] != '.') return 0;
                    pos++;
                    tok.kind = TOK_DOTDOT;
                    break;
                case '=':
                    if (src[pos] == '=') {
                        pos++;
                        tok.kind = TOK_EQEQ;
                    } else {
                        tok.kind = TOK_ASSIGN;
                    }
                    break;
                case '~':
                    if (src[pos] != '=') return 0;
                    pos++;
                    tok.kind = TOK_NE;
                    break;
                case '<':
                    if (src[pos] == '=') {
                        pos++;
                        tok.kind = TOK_LE;
                    } else {
                        tok.kind = TOK_LT;
                    }
                    break;
                case '>':
                    if (src[pos] == '=') {
                        pos++;
                        tok.kind = TOK_GE;
                    } else {
                        tok.kind = TOK_GT;
                    }
                    break;
                default:
                    return 0;
            }
        }
        VEC_PUSH(out, tok);
    }
}

static char *parse_ident(Parser *p, int *ok) {
    Token tok = parser_bump(p);
    if (tok.kind != TOK_IDENT) {
        *ok = 0;
        return NULL;
    }
    return dup_cstr(tok.text);
}

static Expr *parse_expr(Parser *p, int *ok);

static ExprVec parse_expr_list(Parser *p, int *ok) {
    ExprVec exprs = {0};
    Expr *first = parse_expr(p, ok);
    if (!*ok) {
        return exprs;
    }
    VEC_PUSH(&exprs, first);
    while (parser_eat(p, TOK_COMMA)) {
        Expr *expr = parse_expr(p, ok);
        if (!*ok) {
            return exprs;
        }
        VEC_PUSH(&exprs, expr);
    }
    return exprs;
}

static ExprVec parse_args(Parser *p, int *ok) {
    ExprVec args = {0};
    if (!parser_expect(p, TOK_LPAREN)) {
        *ok = 0;
        return args;
    }
    if (!parser_eat(p, TOK_RPAREN)) {
        Expr *expr = parse_expr(p, ok);
        if (!*ok) {
            return args;
        }
        VEC_PUSH(&args, expr);
        while (parser_eat(p, TOK_COMMA)) {
            expr = parse_expr(p, ok);
            if (!*ok) {
                return args;
            }
            VEC_PUSH(&args, expr);
        }
        if (!parser_expect(p, TOK_RPAREN)) {
            *ok = 0;
        }
    }
    return args;
}

static Expr *parse_primary(Parser *p, int *ok) {
    Token tok = parser_bump(p);
    Expr *expr = NULL;
    switch (tok.kind) {
        case TOK_NIL:
            return new_expr(EX_NIL);
        case TOK_TRUE:
            expr = new_expr(EX_BOOL);
            expr->as.boolean = 1;
            return expr;
        case TOK_FALSE:
            expr = new_expr(EX_BOOL);
            expr->as.boolean = 0;
            return expr;
        case TOK_INT:
            expr = new_expr(EX_INT);
            expr->as.integer = tok.integer;
            return expr;
        case TOK_STR:
            expr = new_expr(EX_STR);
            expr->as.text = dup_cstr(tok.text);
            return expr;
        case TOK_IDENT:
            if (parser_matches(p, TOK_LPAREN)) {
                expr = new_expr(EX_CALL);
                expr->as.call.name = dup_cstr(tok.text);
                expr->as.call.args = parse_args(p, ok);
                return *ok ? expr : NULL;
            }
            expr = new_expr(EX_VAR);
            expr->as.text = dup_cstr(tok.text);
            return expr;
        case TOK_LPAREN:
            expr = parse_expr(p, ok);
            if (!*ok || !parser_expect(p, TOK_RPAREN)) {
                *ok = 0;
                return NULL;
            }
            return expr;
        default:
            *ok = 0;
            return NULL;
    }
}

static Expr *parse_unary(Parser *p, int *ok) {
    UnOp op;
    if (parser_eat(p, TOK_MINUS)) {
        op = UN_NEG;
    } else if (parser_eat(p, TOK_NOT)) {
        op = UN_NOT;
    } else if (parser_eat(p, TOK_LEN)) {
        op = UN_LEN;
    } else {
        return parse_primary(p, ok);
    }
    Expr *expr = new_expr(EX_UNARY);
    expr->as.unary.op = op;
    expr->as.unary.inner = parse_unary(p, ok);
    return *ok ? expr : NULL;
}

static Expr *parse_mul(Parser *p, int *ok) {
    Expr *expr = parse_unary(p, ok);
    while (*ok) {
        BinOp op;
        if (parser_eat(p, TOK_STAR)) {
            op = BIN_MUL;
        } else if (parser_eat(p, TOK_FLOORDIV)) {
            op = BIN_FLOORDIV;
        } else if (parser_eat(p, TOK_PERCENT)) {
            op = BIN_MOD;
        } else {
            break;
        }
        Expr *rhs = parse_unary(p, ok);
        if (!*ok) return NULL;
        Expr *bin = new_expr(EX_BINARY);
        bin->as.binary.left = expr;
        bin->as.binary.op = op;
        bin->as.binary.right = rhs;
        expr = bin;
    }
    return expr;
}

static Expr *parse_add(Parser *p, int *ok) {
    Expr *expr = parse_mul(p, ok);
    while (*ok) {
        BinOp op;
        if (parser_eat(p, TOK_PLUS)) {
            op = BIN_ADD;
        } else if (parser_eat(p, TOK_MINUS)) {
            op = BIN_SUB;
        } else {
            break;
        }
        Expr *rhs = parse_mul(p, ok);
        if (!*ok) return NULL;
        Expr *bin = new_expr(EX_BINARY);
        bin->as.binary.left = expr;
        bin->as.binary.op = op;
        bin->as.binary.right = rhs;
        expr = bin;
    }
    return expr;
}

static Expr *parse_concat(Parser *p, int *ok) {
    Expr *left = parse_add(p, ok);
    if (*ok && parser_eat(p, TOK_DOTDOT)) {
        Expr *right = parse_concat(p, ok);
        if (!*ok) return NULL;
        Expr *expr = new_expr(EX_BINARY);
        expr->as.binary.left = left;
        expr->as.binary.op = BIN_CONCAT;
        expr->as.binary.right = right;
        return expr;
    }
    return left;
}

static Expr *parse_compare(Parser *p, int *ok) {
    Expr *expr = parse_concat(p, ok);
    while (*ok) {
        BinOp op;
        if (parser_eat(p, TOK_EQEQ)) op = BIN_EQ;
        else if (parser_eat(p, TOK_NE)) op = BIN_NE;
        else if (parser_eat(p, TOK_LT)) op = BIN_LT;
        else if (parser_eat(p, TOK_LE)) op = BIN_LE;
        else if (parser_eat(p, TOK_GT)) op = BIN_GT;
        else if (parser_eat(p, TOK_GE)) op = BIN_GE;
        else break;
        Expr *rhs = parse_concat(p, ok);
        if (!*ok) return NULL;
        Expr *bin = new_expr(EX_BINARY);
        bin->as.binary.left = expr;
        bin->as.binary.op = op;
        bin->as.binary.right = rhs;
        expr = bin;
    }
    return expr;
}

static Expr *parse_and(Parser *p, int *ok) {
    Expr *expr = parse_compare(p, ok);
    while (*ok && parser_eat(p, TOK_AND)) {
        Expr *rhs = parse_compare(p, ok);
        if (!*ok) return NULL;
        Expr *bin = new_expr(EX_BINARY);
        bin->as.binary.left = expr;
        bin->as.binary.op = BIN_AND;
        bin->as.binary.right = rhs;
        expr = bin;
    }
    return expr;
}

static Expr *parse_or(Parser *p, int *ok) {
    Expr *expr = parse_and(p, ok);
    while (*ok && parser_eat(p, TOK_OR)) {
        Expr *rhs = parse_and(p, ok);
        if (!*ok) return NULL;
        Expr *bin = new_expr(EX_BINARY);
        bin->as.binary.left = expr;
        bin->as.binary.op = BIN_OR;
        bin->as.binary.right = rhs;
        expr = bin;
    }
    return expr;
}

static Expr *parse_expr(Parser *p, int *ok) {
    return parse_or(p, ok);
}

static StmtVec parse_block(Parser *p, const TokenKind *terms, size_t nterms, int *ok);

static int is_terminator(Parser *p, const TokenKind *terms, size_t nterms) {
    TokenKind cur = current_token(p).kind;
    for (size_t i = 0; i < nterms; i++) {
        if (same_kind(cur, terms[i])) {
            return 1;
        }
    }
    return 0;
}

static Stmt parse_local(Parser *p, int *ok) {
    Stmt stmt = new_stmt(ST_LOCAL);
    if (!parser_expect(p, TOK_LOCAL)) {
        *ok = 0;
        return stmt;
    }
    VEC_PUSH(&stmt.as.local_stmt.names, parse_ident(p, ok));
    if (!*ok) return stmt;
    while (parser_eat(p, TOK_COMMA)) {
        VEC_PUSH(&stmt.as.local_stmt.names, parse_ident(p, ok));
        if (!*ok) return stmt;
    }
    if (parser_eat(p, TOK_ASSIGN)) {
        stmt.as.local_stmt.exprs = parse_expr_list(p, ok);
    }
    return stmt;
}

static Stmt parse_if(Parser *p, int *ok) {
    Stmt stmt = new_stmt(ST_IF);
    TokenKind first_terms[] = {TOK_ELSEIF, TOK_ELSE, TOK_END};
    TokenKind end_terms[] = {TOK_END};
    if (!parser_expect(p, TOK_IF)) {
        *ok = 0;
        return stmt;
    }
    Branch br;
    memset(&br, 0, sizeof(br));
    br.cond = parse_expr(p, ok);
    if (!*ok || !parser_expect(p, TOK_THEN)) {
        *ok = 0;
        return stmt;
    }
    br.body = parse_block(p, first_terms, 3, ok);
    if (!*ok) return stmt;
    VEC_PUSH(&stmt.as.if_stmt.branches, br);
    while (parser_eat(p, TOK_ELSEIF)) {
        memset(&br, 0, sizeof(br));
        br.cond = parse_expr(p, ok);
        if (!*ok || !parser_expect(p, TOK_THEN)) {
            *ok = 0;
            return stmt;
        }
        br.body = parse_block(p, first_terms, 3, ok);
        if (!*ok) return stmt;
        VEC_PUSH(&stmt.as.if_stmt.branches, br);
    }
    if (parser_eat(p, TOK_ELSE)) {
        stmt.as.if_stmt.else_body = parse_block(p, end_terms, 1, ok);
        if (!*ok) return stmt;
    }
    if (!parser_expect(p, TOK_END)) {
        *ok = 0;
    }
    return stmt;
}

static Stmt parse_while(Parser *p, int *ok) {
    Stmt stmt = new_stmt(ST_WHILE);
    TokenKind terms[] = {TOK_END};
    if (!parser_expect(p, TOK_WHILE)) {
        *ok = 0;
        return stmt;
    }
    stmt.as.while_stmt.cond = parse_expr(p, ok);
    if (!*ok || !parser_expect(p, TOK_DO)) {
        *ok = 0;
        return stmt;
    }
    stmt.as.while_stmt.body = parse_block(p, terms, 1, ok);
    if (!*ok || !parser_expect(p, TOK_END)) {
        *ok = 0;
    }
    return stmt;
}

static Stmt parse_for(Parser *p, int *ok) {
    Stmt stmt = new_stmt(ST_FOR);
    TokenKind terms[] = {TOK_END};
    if (!parser_expect(p, TOK_FOR)) {
        *ok = 0;
        return stmt;
    }
    stmt.as.for_stmt.name = parse_ident(p, ok);
    if (!*ok || !parser_expect(p, TOK_ASSIGN)) {
        *ok = 0;
        return stmt;
    }
    stmt.as.for_stmt.start = parse_expr(p, ok);
    if (!*ok || !parser_expect(p, TOK_COMMA)) {
        *ok = 0;
        return stmt;
    }
    stmt.as.for_stmt.limit = parse_expr(p, ok);
    if (!*ok) return stmt;
    if (parser_eat(p, TOK_COMMA)) {
        stmt.as.for_stmt.step = parse_expr(p, ok);
        if (!*ok) return stmt;
    }
    if (!parser_expect(p, TOK_DO)) {
        *ok = 0;
        return stmt;
    }
    stmt.as.for_stmt.body = parse_block(p, terms, 1, ok);
    if (!*ok || !parser_expect(p, TOK_END)) {
        *ok = 0;
    }
    return stmt;
}

static Stmt parse_function_stmt(Parser *p, int *ok) {
    Stmt stmt = new_stmt(ST_FUNCTION);
    TokenKind terms[] = {TOK_END};
    if (!parser_expect(p, TOK_FUNCTION)) {
        *ok = 0;
        return stmt;
    }
    stmt.as.function_stmt.name = parse_ident(p, ok);
    if (!*ok || !parser_expect(p, TOK_LPAREN)) {
        *ok = 0;
        return stmt;
    }
    if (!parser_eat(p, TOK_RPAREN)) {
        VEC_PUSH(&stmt.as.function_stmt.func.params, parse_ident(p, ok));
        if (!*ok) return stmt;
        while (parser_eat(p, TOK_COMMA)) {
            VEC_PUSH(&stmt.as.function_stmt.func.params, parse_ident(p, ok));
            if (!*ok) return stmt;
        }
        if (!parser_expect(p, TOK_RPAREN)) {
            *ok = 0;
            return stmt;
        }
    }
    if (stmt.as.function_stmt.func.params.len > 8) {
        *ok = 0;
        return stmt;
    }
    stmt.as.function_stmt.func.body = parse_block(p, terms, 1, ok);
    if (!*ok || !parser_expect(p, TOK_END)) {
        *ok = 0;
    }
    return stmt;
}

static Stmt parse_return(Parser *p, int *ok) {
    Stmt stmt = new_stmt(ST_RETURN);
    if (!parser_expect(p, TOK_RETURN)) {
        *ok = 0;
        return stmt;
    }
    TokenKind cur = current_token(p).kind;
    if (cur == TOK_EOF || cur == TOK_END || cur == TOK_ELSE || cur == TOK_ELSEIF || cur == TOK_SEMI) {
        stmt.as.return_stmt.has_expr = 0;
        stmt.as.return_stmt.expr = NULL;
    } else {
        stmt.as.return_stmt.has_expr = 1;
        stmt.as.return_stmt.expr = parse_expr(p, ok);
    }
    return stmt;
}

static Stmt parse_do(Parser *p, int *ok) {
    Stmt stmt = new_stmt(ST_DO);
    TokenKind terms[] = {TOK_END};
    if (!parser_expect(p, TOK_DO)) {
        *ok = 0;
        return stmt;
    }
    stmt.as.do_stmt.body = parse_block(p, terms, 1, ok);
    if (!*ok || !parser_expect(p, TOK_END)) {
        *ok = 0;
    }
    return stmt;
}

static Stmt parse_assignment_or_call(Parser *p, int *ok) {
    char *name = parse_ident(p, ok);
    Stmt stmt = new_stmt(ST_ASSIGN);
    if (!*ok) return stmt;
    if (parser_matches(p, TOK_LPAREN)) {
        stmt = new_stmt(ST_CALL);
        Expr *call = new_expr(EX_CALL);
        call->as.call.name = name;
        call->as.call.args = parse_args(p, ok);
        stmt.as.call_stmt.expr = call;
        return stmt;
    }
    VEC_PUSH(&stmt.as.assign_stmt.names, name);
    while (parser_eat(p, TOK_COMMA)) {
        VEC_PUSH(&stmt.as.assign_stmt.names, parse_ident(p, ok));
        if (!*ok) return stmt;
    }
    if (!parser_expect(p, TOK_ASSIGN)) {
        *ok = 0;
        return stmt;
    }
    stmt.as.assign_stmt.exprs = parse_expr_list(p, ok);
    return stmt;
}

static Stmt parse_stmt(Parser *p, int *ok) {
    switch (current_token(p).kind) {
        case TOK_LOCAL: return parse_local(p, ok);
        case TOK_IF: return parse_if(p, ok);
        case TOK_WHILE: return parse_while(p, ok);
        case TOK_FOR: return parse_for(p, ok);
        case TOK_FUNCTION: return parse_function_stmt(p, ok);
        case TOK_RETURN: return parse_return(p, ok);
        case TOK_DO: return parse_do(p, ok);
        case TOK_IDENT: return parse_assignment_or_call(p, ok);
        default:
            *ok = 0;
            return new_stmt(ST_DO);
    }
}

static StmtVec parse_block(Parser *p, const TokenKind *terms, size_t nterms, int *ok) {
    StmtVec body = {0};
    while (!is_terminator(p, terms, nterms)) {
        if (parser_matches(p, TOK_EOF)) {
            *ok = 0;
            return body;
        }
        if (parser_eat(p, TOK_SEMI)) {
            continue;
        }
        Stmt stmt = parse_stmt(p, ok);
        if (!*ok) {
            return body;
        }
        VEC_PUSH(&body, stmt);
        while (parser_eat(p, TOK_SEMI)) {
        }
    }
    return body;
}

static int parse_source(const char *src, Chunk *chunk) {
    Parser p;
    memset(&p, 0, sizeof(p));
    if (!tokenize(src, &p.tokens)) {
        return 0;
    }
    int ok = 1;
    TokenKind terms[] = {TOK_EOF};
    chunk->body = parse_block(&p, terms, 1, &ok);
    if (!ok || !parser_expect(&p, TOK_EOF)) {
        return 0;
    }
    return 1;
}

static Binding *binding_find(Binding *items, size_t len, const char *name) {
    for (size_t i = 0; i < len; i++) {
        if (strcmp(items[i].name, name) == 0) {
            return &items[i];
        }
    }
    return NULL;
}

static void bindings_set(Binding **items, size_t *len, size_t *cap, const char *name, Value value) {
    Binding *found = binding_find(*items, *len, name);
    if (found != NULL) {
        found->value = value;
        return;
    }
    *items = grow_array(*items, sizeof(**items), cap, *len + 1);
    (*items)[*len].name = dup_cstr(name);
    (*items)[*len].value = value;
    (*len)++;
}

static void globals_set(const char *name, Value value) {
    bindings_set(&G.globals.items, &G.globals.len, &G.globals.cap, name, value);
}

static Binding *globals_find(const char *name) {
    return binding_find(G.globals.items, G.globals.len, name);
}

static void env_init(Env *env, int depth) {
    memset(env, 0, sizeof(*env));
    env->depth = depth;
    env->scopes = grow_array(env->scopes, sizeof(*env->scopes), &env->cap, 1);
    memset(&env->scopes[0], 0, sizeof(env->scopes[0]));
    env->len = 1;
}

static void env_push(Env *env) {
    env->scopes = grow_array(env->scopes, sizeof(*env->scopes), &env->cap, env->len + 1);
    memset(&env->scopes[env->len], 0, sizeof(env->scopes[env->len]));
    env->len++;
}

static void env_pop(Env *env) {
    if (env->len > 0) {
        env->len--;
    }
}

static void env_define(Env *env, const char *name, Value value) {
    Scope *scope = &env->scopes[env->len - 1];
    bindings_set(&scope->items, &scope->len, &scope->cap, name, value);
}

static void env_assign(Env *env, const char *name, Value value) {
    for (size_t i = env->len; i > 0; i--) {
        Scope *scope = &env->scopes[i - 1];
        Binding *found = binding_find(scope->items, scope->len, name);
        if (found != NULL) {
            found->value = value;
            return;
        }
    }
    globals_set(name, value);
}

static Value env_get(Env *env, const char *name) {
    for (size_t i = env->len; i > 0; i--) {
        Scope *scope = &env->scopes[i - 1];
        Binding *found = binding_find(scope->items, scope->len, name);
        if (found != NULL) {
            return found->value;
        }
    }
    Binding *global = globals_find(name);
    return global != NULL ? global->value : value_nil();
}

static int checked_add_i64(int64_t a, int64_t b, int64_t *out) {
    return !__builtin_add_overflow(a, b, out);
}

static int checked_sub_i64(int64_t a, int64_t b, int64_t *out) {
    return !__builtin_sub_overflow(a, b, out);
}

static int checked_mul_i64(int64_t a, int64_t b, int64_t *out) {
    return !__builtin_mul_overflow(a, b, out);
}

static int expect_int(Value v, int64_t *out) {
    if (v.type != VAL_INT) {
        return 0;
    }
    *out = v.integer;
    return 1;
}

static int floor_div_i64(int64_t a, int64_t b, int64_t *out) {
    if (b == 0 || (a == INT64_MIN && b == -1)) {
        return 0;
    }
    int64_t q = a / b;
    int64_t rem = a % b;
    if (rem != 0 && ((rem > 0) != (b > 0))) {
        if (!checked_sub_i64(q, 1, &q)) {
            return 0;
        }
    }
    *out = q;
    return 1;
}

static int value_to_concat(Value v, char *buf, size_t *len) {
    if (v.type == VAL_STR) {
        size_t n = strlen(v.str);
        if (*len + n > MAX_STRING) {
            return 0;
        }
        memcpy(buf + *len, v.str, n);
        *len += n;
        buf[*len] = '\0';
        return 1;
    }
    if (v.type == VAL_INT) {
        char tmp[32];
        int n = snprintf(tmp, sizeof(tmp), "%lld", (long long)v.integer);
        if (n < 0 || (size_t)n >= sizeof(tmp) || *len + (size_t)n > MAX_STRING) {
            return 0;
        }
        memcpy(buf + *len, tmp, (size_t)n);
        *len += (size_t)n;
        buf[*len] = '\0';
        return 1;
    }
    return 0;
}

static int values_equal(Value a, Value b) {
    if (a.type != b.type) {
        return 0;
    }
    switch (a.type) {
        case VAL_NIL: return 1;
        case VAL_BOOL: return a.boolean == b.boolean;
        case VAL_INT: return a.integer == b.integer;
        case VAL_STR: return strcmp(a.str, b.str) == 0;
        case VAL_FUNCTION: return a.func == b.func;
    }
    return 0;
}

static int eval_expr(Env *env, Expr *expr, Value *out);
static int exec_block(Env *env, StmtVec *body, Flow *flow);

static int call_function(const FunctionDef *func, Value *args, size_t nargs, int depth, Value *out) {
    if (depth > MAX_RECURSION) {
        return ERR_STACK;
    }
    Env env;
    env_init(&env, depth);
    for (size_t i = 0; i < func->params.len; i++) {
        Value v = (i < nargs) ? args[i] : value_nil();
        env_define(&env, func->params.items[i], v);
    }
    Flow flow;
    int err = exec_block(&env, (StmtVec *)&func->body, &flow);
    if (err != 0) {
        return err;
    }
    *out = (flow.kind == FLOW_RETURN) ? flow.value : value_nil();
    return 0;
}

static int eval_list(Env *env, ExprVec *exprs, Value **out_vals, size_t *out_len) {
    Value *vals = NULL;
    if (exprs->len > 0) {
        vals = (Value *)calloc(exprs->len, sizeof(*vals));
        if (vals == NULL) {
            abort();
        }
    }
    for (size_t i = 0; i < exprs->len; i++) {
        int err = eval_expr(env, exprs->items[i], &vals[i]);
        if (err != 0) {
            free(vals);
            return err;
        }
    }
    *out_vals = vals;
    *out_len = exprs->len;
    return 0;
}

static int compare_values(Value l, BinOp op, Value r, Value *out) {
    int result = 0;
    if (l.type == VAL_INT && r.type == VAL_INT) {
        switch (op) {
            case BIN_LT: result = l.integer < r.integer; break;
            case BIN_LE: result = l.integer <= r.integer; break;
            case BIN_GT: result = l.integer > r.integer; break;
            case BIN_GE: result = l.integer >= r.integer; break;
            default: return ERR_RUNTIME;
        }
    } else if (l.type == VAL_STR && r.type == VAL_STR) {
        int cmp = strcmp(l.str, r.str);
        switch (op) {
            case BIN_LT: result = cmp < 0; break;
            case BIN_LE: result = cmp <= 0; break;
            case BIN_GT: result = cmp > 0; break;
            case BIN_GE: result = cmp >= 0; break;
            default: return ERR_RUNTIME;
        }
    } else {
        return ERR_RUNTIME;
    }
    *out = value_bool(result);
    return 0;
}

static int eval_binary(Value l, BinOp op, Value r, Value *out) {
    int64_t a = 0;
    int64_t b = 0;
    int64_t n = 0;
    switch (op) {
        case BIN_ADD:
            if (!expect_int(l, &a) || !expect_int(r, &b) || !checked_add_i64(a, b, &n)) return ERR_RUNTIME;
            *out = value_int(n);
            return 0;
        case BIN_SUB:
            if (!expect_int(l, &a) || !expect_int(r, &b) || !checked_sub_i64(a, b, &n)) return ERR_RUNTIME;
            *out = value_int(n);
            return 0;
        case BIN_MUL:
            if (!expect_int(l, &a) || !expect_int(r, &b) || !checked_mul_i64(a, b, &n)) return ERR_RUNTIME;
            *out = value_int(n);
            return 0;
        case BIN_FLOORDIV:
            if (!expect_int(l, &a) || !expect_int(r, &b) || !floor_div_i64(a, b, &n)) return ERR_RUNTIME;
            *out = value_int(n);
            return 0;
        case BIN_MOD:
            if (!expect_int(l, &a) || !expect_int(r, &b)) return ERR_RUNTIME;
            if (!floor_div_i64(a, b, &n)) return ERR_RUNTIME;
            if (!checked_mul_i64(n, b, &n)) return ERR_RUNTIME;
            if (!checked_sub_i64(a, n, &n)) return ERR_RUNTIME;
            *out = value_int(n);
            return 0;
        case BIN_CONCAT: {
            char buf[MAX_STRING + 1];
            size_t len = 0;
            buf[0] = '\0';
            if (!value_to_concat(l, buf, &len) || !value_to_concat(r, buf, &len)) return ERR_RUNTIME;
            *out = value_str_len(buf, len);
            return 0;
        }
        case BIN_EQ:
            *out = value_bool(values_equal(l, r));
            return 0;
        case BIN_NE:
            *out = value_bool(!values_equal(l, r));
            return 0;
        case BIN_LT:
        case BIN_LE:
        case BIN_GT:
        case BIN_GE:
            return compare_values(l, op, r, out);
        case BIN_AND:
        case BIN_OR:
            return ERR_RUNTIME;
    }
    return ERR_RUNTIME;
}

static int eval_expr(Env *env, Expr *expr, Value *out) {
    switch (expr->kind) {
        case EX_NIL:
            *out = value_nil();
            return 0;
        case EX_BOOL:
            *out = value_bool(expr->as.boolean);
            return 0;
        case EX_INT:
            *out = value_int(expr->as.integer);
            return 0;
        case EX_STR:
            *out = value_str_len(expr->as.text, strlen(expr->as.text));
            return 0;
        case EX_VAR:
            *out = env_get(env, expr->as.text);
            return 0;
        case EX_UNARY: {
            Value v;
            int err = eval_expr(env, expr->as.unary.inner, &v);
            if (err != 0) return err;
            if (expr->as.unary.op == UN_NOT) {
                *out = value_bool(!value_truthy(v));
                return 0;
            }
            if (expr->as.unary.op == UN_LEN) {
                if (v.type != VAL_STR) return ERR_RUNTIME;
                *out = value_int((int64_t)strlen(v.str));
                return 0;
            }
            int64_t n = 0;
            if (!expect_int(v, &n) || n == INT64_MIN) return ERR_RUNTIME;
            *out = value_int(-n);
            return 0;
        }
        case EX_BINARY:
            if (expr->as.binary.op == BIN_AND) {
                Value l;
                int err = eval_expr(env, expr->as.binary.left, &l);
                if (err != 0) return err;
                if (!value_truthy(l)) {
                    *out = l;
                    return 0;
                }
                return eval_expr(env, expr->as.binary.right, out);
            }
            if (expr->as.binary.op == BIN_OR) {
                Value l;
                int err = eval_expr(env, expr->as.binary.left, &l);
                if (err != 0) return err;
                if (value_truthy(l)) {
                    *out = l;
                    return 0;
                }
                return eval_expr(env, expr->as.binary.right, out);
            }
            {
                Value l;
                Value r;
                int err = eval_expr(env, expr->as.binary.left, &l);
                if (err != 0) return err;
                err = eval_expr(env, expr->as.binary.right, &r);
                if (err != 0) return err;
                return eval_binary(l, expr->as.binary.op, r, out);
            }
        case EX_CALL: {
            Value *vals = NULL;
            size_t nvals = 0;
            int err = eval_list(env, &expr->as.call.args, &vals, &nvals);
            if (err != 0) return err;
            Value f = env_get(env, expr->as.call.name);
            if (f.type != VAL_FUNCTION) {
                free(vals);
                return ERR_RUNTIME;
            }
            err = call_function(f.func, vals, nvals, env->depth + 1, out);
            free(vals);
            return err;
        }
    }
    return ERR_RUNTIME;
}

static Flow flow_normal(void) {
    Flow flow;
    flow.kind = FLOW_NORMAL;
    flow.value = value_nil();
    return flow;
}

static Flow flow_return(Value v) {
    Flow flow;
    flow.kind = FLOW_RETURN;
    flow.value = v;
    return flow;
}

static int exec_scoped_block(Env *env, StmtVec *body, Flow *flow) {
    env_push(env);
    int err = exec_block(env, body, flow);
    env_pop(env);
    return err;
}

static int exec_stmt(Env *env, Stmt *stmt, Flow *flow) {
    *flow = flow_normal();
    switch (stmt->kind) {
        case ST_LOCAL: {
            Value *vals = NULL;
            size_t nvals = 0;
            int err = eval_list(env, &stmt->as.local_stmt.exprs, &vals, &nvals);
            if (err != 0) return err;
            for (size_t i = 0; i < stmt->as.local_stmt.names.len; i++) {
                env_define(env, stmt->as.local_stmt.names.items[i], i < nvals ? vals[i] : value_nil());
            }
            free(vals);
            return 0;
        }
        case ST_ASSIGN: {
            Value *vals = NULL;
            size_t nvals = 0;
            int err = eval_list(env, &stmt->as.assign_stmt.exprs, &vals, &nvals);
            if (err != 0) return err;
            for (size_t i = 0; i < stmt->as.assign_stmt.names.len; i++) {
                env_assign(env, stmt->as.assign_stmt.names.items[i], i < nvals ? vals[i] : value_nil());
            }
            free(vals);
            return 0;
        }
        case ST_IF:
            for (size_t i = 0; i < stmt->as.if_stmt.branches.len; i++) {
                Value cond;
                int err = eval_expr(env, stmt->as.if_stmt.branches.items[i].cond, &cond);
                if (err != 0) return err;
                if (value_truthy(cond)) {
                    return exec_scoped_block(env, &stmt->as.if_stmt.branches.items[i].body, flow);
                }
            }
            if (stmt->as.if_stmt.else_body.len > 0) {
                return exec_scoped_block(env, &stmt->as.if_stmt.else_body, flow);
            }
            return 0;
        case ST_WHILE:
            while (1) {
                Value cond;
                int err = eval_expr(env, stmt->as.while_stmt.cond, &cond);
                if (err != 0) return err;
                if (!value_truthy(cond)) {
                    return 0;
                }
                err = exec_scoped_block(env, &stmt->as.while_stmt.body, flow);
                if (err != 0 || flow->kind == FLOW_RETURN) {
                    return err;
                }
            }
        case ST_FOR: {
            Value sv;
            Value lv;
            Value stepv;
            int64_t i = 0;
            int64_t limit = 0;
            int64_t step = 1;
            int err = eval_expr(env, stmt->as.for_stmt.start, &sv);
            if (err != 0) return err;
            err = eval_expr(env, stmt->as.for_stmt.limit, &lv);
            if (err != 0) return err;
            if (!expect_int(sv, &i) || !expect_int(lv, &limit)) return ERR_RUNTIME;
            if (stmt->as.for_stmt.step != NULL) {
                err = eval_expr(env, stmt->as.for_stmt.step, &stepv);
                if (err != 0) return err;
                if (!expect_int(stepv, &step)) return ERR_RUNTIME;
            }
            if (step == 0) return ERR_RUNTIME;
            env_push(env);
            while ((step > 0 && i <= limit) || (step < 0 && i >= limit)) {
                env_define(env, stmt->as.for_stmt.name, value_int(i));
                err = exec_block(env, &stmt->as.for_stmt.body, flow);
                if (err != 0 || flow->kind == FLOW_RETURN) {
                    env_pop(env);
                    return err;
                }
                if (!checked_add_i64(i, step, &i)) {
                    env_pop(env);
                    return ERR_RUNTIME;
                }
            }
            env_pop(env);
            return 0;
        }
        case ST_FUNCTION:
            globals_set(stmt->as.function_stmt.name, value_func(&stmt->as.function_stmt.func));
            return 0;
        case ST_CALL: {
            Value ignored;
            return eval_expr(env, stmt->as.call_stmt.expr, &ignored);
        }
        case ST_RETURN: {
            Value v = value_nil();
            if (stmt->as.return_stmt.has_expr) {
                int err = eval_expr(env, stmt->as.return_stmt.expr, &v);
                if (err != 0) return err;
            }
            *flow = flow_return(v);
            return 0;
        }
        case ST_DO:
            return exec_scoped_block(env, &stmt->as.do_stmt.body, flow);
    }
    return ERR_RUNTIME;
}

static int exec_block(Env *env, StmtVec *body, Flow *flow) {
    *flow = flow_normal();
    for (size_t i = 0; i < body->len; i++) {
        int err = exec_stmt(env, &body->items[i], flow);
        if (err != 0 || flow->kind == FLOW_RETURN) {
            return err;
        }
    }
    return 0;
}

static int run_chunk(int chunk_id, Value *out) {
    if (chunk_id < 0 || (size_t)chunk_id >= G.chunks.len) {
        return ERR_BAD_CHUNK;
    }
    Env env;
    env_init(&env, 0);
    Flow flow;
    int err = exec_block(&env, &G.chunks.items[chunk_id].body, &flow);
    if (err != 0) {
        return err;
    }
    *out = flow.kind == FLOW_RETURN ? flow.value : value_nil();
    return 0;
}

static int valid_cstr(const char *s) {
    return s != NULL;
}

EXPORT void lvm_reset(void) {
    memset(&G, 0, sizeof(G));
    G.last_result = value_nil();
}

EXPORT int lvm_compile(const char *source) {
    if (!valid_cstr(source)) {
        G.last_error = ERR_NULL;
        return -1;
    }
    Chunk chunk;
    memset(&chunk, 0, sizeof(chunk));
    if (!parse_source(source, &chunk)) {
        G.last_error = ERR_SYNTAX;
        return -1;
    }
    G.chunks.items = grow_array(G.chunks.items, sizeof(*G.chunks.items), &G.chunks.cap, G.chunks.len + 1);
    int id = (int)G.chunks.len;
    G.chunks.items[G.chunks.len++] = chunk;
    G.last_error = 0;
    return id;
}

EXPORT int lvm_exec(int chunk_id) {
    Value result;
    int err = run_chunk(chunk_id, &result);
    if (err != 0) {
        G.last_error = err;
        return 0;
    }
    G.last_result = result;
    G.last_error = 0;
    return 1;
}

EXPORT int lvm_get_result(int64_t *out) {
    if (out == NULL) {
        G.last_error = ERR_BAD_POINTER;
        return 0;
    }
    if (G.last_result.type != VAL_INT) {
        G.last_error = 0;
        return 0;
    }
    *out = G.last_result.integer;
    G.last_error = 0;
    return 1;
}

EXPORT int lvm_set_global(const char *name, int64_t value) {
    if (!valid_cstr(name)) {
        G.last_error = ERR_NULL;
        return 0;
    }
    globals_set(name, value_int(value));
    G.last_error = 0;
    return 1;
}

EXPORT int lvm_get_global(const char *name, int64_t *out) {
    if (out == NULL) {
        G.last_error = ERR_BAD_POINTER;
        return 0;
    }
    if (!valid_cstr(name)) {
        G.last_error = ERR_NULL;
        return 0;
    }
    Binding *b = globals_find(name);
    if (b == NULL || b->value.type != VAL_INT) {
        G.last_error = 0;
        return 0;
    }
    *out = b->value.integer;
    G.last_error = 0;
    return 1;
}

EXPORT int lvm_get_global_str(const char *name, char *buf, int max_len) {
    if (buf == NULL || max_len <= 0) {
        G.last_error = ERR_BAD_POINTER;
        return 0;
    }
    if (!valid_cstr(name)) {
        G.last_error = ERR_NULL;
        return 0;
    }
    Binding *b = globals_find(name);
    if (b == NULL || b->value.type != VAL_STR) {
        G.last_error = 0;
        return 0;
    }
    size_t copy_len = strlen(b->value.str);
    if (copy_len > (size_t)(max_len - 1)) {
        copy_len = (size_t)(max_len - 1);
    }
    memcpy(buf, b->value.str, copy_len);
    buf[copy_len] = '\0';
    G.last_error = 0;
    return 1;
}

EXPORT int lvm_call(int chunk_id, const char *func_name, int nargs, const int64_t *args, int64_t *out) {
    if (out == NULL || nargs < 0 || (nargs > 0 && args == NULL)) {
        G.last_error = ERR_BAD_POINTER;
        return 0;
    }
    if (!valid_cstr(func_name)) {
        G.last_error = ERR_NULL;
        return 0;
    }
    if (chunk_id < 0 || (size_t)chunk_id >= G.chunks.len) {
        G.last_error = ERR_BAD_CHUNK;
        return 0;
    }
    Binding *b = globals_find(func_name);
    if (b == NULL || b->value.type != VAL_FUNCTION) {
        G.last_error = ERR_BAD_FUNCTION;
        return 0;
    }
    Value *vals = NULL;
    if (nargs > 0) {
        vals = (Value *)calloc((size_t)nargs, sizeof(*vals));
        if (vals == NULL) {
            abort();
        }
        for (int i = 0; i < nargs; i++) {
            vals[i] = value_int(args[i]);
        }
    }
    Value result;
    int err = call_function(b->value.func, vals, (size_t)nargs, 1, &result);
    free(vals);
    if (err != 0) {
        G.last_error = err;
        return 0;
    }
    if (result.type != VAL_INT) {
        G.last_error = ERR_RUNTIME;
        return 0;
    }
    *out = result.integer;
    G.last_error = 0;
    return 1;
}

EXPORT int lvm_typeof_global(const char *name) {
    if (!valid_cstr(name)) {
        G.last_error = ERR_NULL;
        return 0;
    }
    Binding *b = globals_find(name);
    G.last_error = 0;
    return b == NULL ? 0 : value_type_code(b->value);
}

EXPORT int lvm_last_error(void) {
    return G.last_error;
}
