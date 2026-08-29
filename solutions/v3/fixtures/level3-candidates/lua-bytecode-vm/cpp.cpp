#include <algorithm>
#include <cstdint>
#include <cstring>
#include <exception>
#include <limits>
#include <memory>
#include <mutex>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

namespace {

constexpr int ERR_NULL = 1;
constexpr int ERR_UTF8 = 2;
constexpr int ERR_SYNTAX = 3;
constexpr int ERR_BAD_CHUNK = 4;
constexpr int ERR_RUNTIME = 5;
constexpr int ERR_BAD_POINTER = 6;
constexpr int ERR_BAD_FUNCTION = 7;
constexpr int ERR_STACK = 8;
constexpr int MAX_RECURSION = 512;

struct LvmError final : public std::exception {
    explicit LvmError(int code_in) : code(code_in) {}
    int code;
};

struct Function;

struct Value {
    enum class Type { Nil, Bool, Int, Str, Function };

    Type type = Type::Nil;
    bool bool_value = false;
    int64_t int_value = 0;
    std::string str_value;
    std::shared_ptr<Function> func_value;

    static Value nil() { return Value(); }

    static Value boolean(bool v) {
        Value out;
        out.type = Type::Bool;
        out.bool_value = v;
        return out;
    }

    static Value integer(int64_t v) {
        Value out;
        out.type = Type::Int;
        out.int_value = v;
        return out;
    }

    static Value string(std::string v) {
        Value out;
        out.type = Type::Str;
        out.str_value = std::move(v);
        return out;
    }

    static Value function(std::shared_ptr<Function> v) {
        Value out;
        out.type = Type::Function;
        out.func_value = std::move(v);
        return out;
    }

    bool truthy() const {
        return !(type == Type::Nil || (type == Type::Bool && !bool_value));
    }

    int type_code() const {
        switch (type) {
            case Type::Nil:
                return 0;
            case Type::Bool:
                return 1;
            case Type::Int:
                return 2;
            case Type::Str:
                return 3;
            case Type::Function:
                return 4;
        }
        return 0;
    }

    std::string to_concat_string() const {
        if (type == Type::Str) {
            return str_value;
        }
        if (type == Type::Int) {
            return std::to_string(int_value);
        }
        throw LvmError(ERR_RUNTIME);
    }
};

bool values_equal(const Value& a, const Value& b) {
    if (a.type != b.type) {
        return false;
    }
    switch (a.type) {
        case Value::Type::Nil:
            return true;
        case Value::Type::Bool:
            return a.bool_value == b.bool_value;
        case Value::Type::Int:
            return a.int_value == b.int_value;
        case Value::Type::Str:
            return a.str_value == b.str_value;
        case Value::Type::Function:
            return a.func_value == b.func_value;
    }
    return false;
}

enum class UnOp { Neg, Not, Len };
enum class BinOp {
    Add,
    Sub,
    Mul,
    FloorDiv,
    Mod,
    Concat,
    Eq,
    Ne,
    Lt,
    Le,
    Gt,
    Ge,
    And,
    Or
};

struct Expr {
    enum class Kind { Nil, Bool, Int, Str, Var, Unary, Binary, Call };

    Kind kind = Kind::Nil;
    bool bool_value = false;
    int64_t int_value = 0;
    std::string text;
    UnOp unop = UnOp::Neg;
    BinOp binop = BinOp::Add;
    std::shared_ptr<Expr> left;
    std::shared_ptr<Expr> right;
    std::vector<Expr> args;

    static Expr nil() { return Expr(); }

    static Expr boolean(bool v) {
        Expr out;
        out.kind = Kind::Bool;
        out.bool_value = v;
        return out;
    }

    static Expr integer(int64_t v) {
        Expr out;
        out.kind = Kind::Int;
        out.int_value = v;
        return out;
    }

    static Expr string(std::string v) {
        Expr out;
        out.kind = Kind::Str;
        out.text = std::move(v);
        return out;
    }

    static Expr var(std::string v) {
        Expr out;
        out.kind = Kind::Var;
        out.text = std::move(v);
        return out;
    }

    static Expr unary(UnOp op, Expr inner) {
        Expr out;
        out.kind = Kind::Unary;
        out.unop = op;
        out.left = std::make_shared<Expr>(std::move(inner));
        return out;
    }

    static Expr binary(Expr lhs, BinOp op, Expr rhs) {
        Expr out;
        out.kind = Kind::Binary;
        out.binop = op;
        out.left = std::make_shared<Expr>(std::move(lhs));
        out.right = std::make_shared<Expr>(std::move(rhs));
        return out;
    }

    static Expr call(std::string name, std::vector<Expr> argv) {
        Expr out;
        out.kind = Kind::Call;
        out.text = std::move(name);
        out.args = std::move(argv);
        return out;
    }
};

struct Stmt {
    enum class Kind { Local, Assign, If, While, For, Function, Call, Return, Do };

    Kind kind = Kind::Do;
    std::vector<std::string> names;
    std::vector<Expr> exprs;
    std::vector<std::pair<Expr, std::vector<Stmt>>> branches;
    std::vector<Stmt> body;
    std::vector<Stmt> else_body;
    std::string name;
    Expr expr;
    Expr start;
    Expr limit;
    Expr step;
    bool has_step = false;
    bool has_return_expr = false;

    static Stmt local(std::vector<std::string> names_in, std::vector<Expr> exprs_in) {
        Stmt out;
        out.kind = Kind::Local;
        out.names = std::move(names_in);
        out.exprs = std::move(exprs_in);
        return out;
    }

    static Stmt assign(std::vector<std::string> names_in, std::vector<Expr> exprs_in) {
        Stmt out;
        out.kind = Kind::Assign;
        out.names = std::move(names_in);
        out.exprs = std::move(exprs_in);
        return out;
    }
};

struct Function {
    std::vector<std::string> params;
    std::vector<Stmt> body;
};

struct Chunk {
    std::vector<Stmt> body;
};

struct State {
    std::vector<Chunk> chunks;
    std::unordered_map<std::string, Value> globals;
    int last_error = 0;
    Value last_result;
};

State g_state;
std::mutex g_mutex;

void set_error(State& st, int code) {
    st.last_error = code;
}

std::string read_c_string(const char* ptr) {
    if (ptr == nullptr) {
        throw LvmError(ERR_NULL);
    }
    std::string out(ptr);
    for (unsigned char ch : out) {
        if (ch >= 0x80U) {
            throw LvmError(ERR_UTF8);
        }
    }
    return out;
}

enum class TokKind {
    Eof,
    Ident,
    Int,
    Str,
    Plus,
    Minus,
    Star,
    FloorDiv,
    Percent,
    DotDot,
    Len,
    EqEq,
    Ne,
    Lt,
    Le,
    Gt,
    Ge,
    Assign,
    LParen,
    RParen,
    Comma,
    Semi,
    And,
    Or,
    Not,
    If,
    Then,
    Elseif,
    Else,
    End,
    While,
    Do,
    For,
    Function,
    Local,
    Return,
    True,
    False,
    Nil
};

struct Token {
    TokKind kind = TokKind::Eof;
    std::string text;
    int64_t int_value = 0;
};

class Lexer {
public:
    explicit Lexer(std::string source) : src_(std::move(source)) {}

    std::vector<Token> tokenize() {
        std::vector<Token> tokens;
        for (;;) {
            skip_ws_and_comments();
            const int ch = peek();
            if (ch < 0) {
                tokens.push_back(Token{TokKind::Eof, {}, 0});
                return tokens;
            }
            Token tok;
            if (is_digit(ch)) {
                tok = lex_int();
            } else if (is_ident_start(ch)) {
                tok = lex_ident();
            } else if (ch == '\'' || ch == '"') {
                tok = lex_string();
            } else {
                tok = lex_punct(ch);
            }
            tokens.push_back(std::move(tok));
        }
    }

private:
    std::string src_;
    std::size_t pos_ = 0;

    int peek() const {
        if (pos_ >= src_.size()) {
            return -1;
        }
        return static_cast<unsigned char>(src_[pos_]);
    }

    bool take2(char first, char second) {
        if (pos_ + 1 < src_.size() && src_[pos_] == first && src_[pos_ + 1] == second) {
            pos_ += 2;
            return true;
        }
        return false;
    }

    static bool is_digit(int ch) {
        return ch >= '0' && ch <= '9';
    }

    static bool is_ident_start(int ch) {
        return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch == '_';
    }

    static bool is_ident_part(int ch) {
        return is_ident_start(ch) || is_digit(ch);
    }

    void skip_ws_and_comments() {
        for (;;) {
            while (peek() == ' ' || peek() == '\n' || peek() == '\r' || peek() == '\t') {
                ++pos_;
            }
            if (pos_ + 1 < src_.size() && src_[pos_] == '-' && src_[pos_ + 1] == '-') {
                pos_ += 2;
                while (peek() >= 0) {
                    const int ch = peek();
                    ++pos_;
                    if (ch == '\n') {
                        break;
                    }
                }
            } else {
                break;
            }
        }
    }

    Token lex_int() {
        const std::size_t start = pos_;
        while (is_digit(peek())) {
            ++pos_;
        }
        const std::string text = src_.substr(start, pos_ - start);
        std::size_t consumed = 0;
        int64_t value = 0;
        try {
            value = std::stoll(text, &consumed, 10);
        } catch (...) {
            throw LvmError(ERR_SYNTAX);
        }
        if (consumed != text.size()) {
            throw LvmError(ERR_SYNTAX);
        }
        return Token{TokKind::Int, {}, value};
    }

    Token lex_ident() {
        const std::size_t start = pos_;
        while (is_ident_part(peek())) {
            ++pos_;
        }
        const std::string text = src_.substr(start, pos_ - start);
        if (text == "and") return Token{TokKind::And, {}, 0};
        if (text == "or") return Token{TokKind::Or, {}, 0};
        if (text == "not") return Token{TokKind::Not, {}, 0};
        if (text == "if") return Token{TokKind::If, {}, 0};
        if (text == "then") return Token{TokKind::Then, {}, 0};
        if (text == "elseif") return Token{TokKind::Elseif, {}, 0};
        if (text == "else") return Token{TokKind::Else, {}, 0};
        if (text == "end") return Token{TokKind::End, {}, 0};
        if (text == "while") return Token{TokKind::While, {}, 0};
        if (text == "do") return Token{TokKind::Do, {}, 0};
        if (text == "for") return Token{TokKind::For, {}, 0};
        if (text == "function") return Token{TokKind::Function, {}, 0};
        if (text == "local") return Token{TokKind::Local, {}, 0};
        if (text == "return") return Token{TokKind::Return, {}, 0};
        if (text == "true") return Token{TokKind::True, {}, 0};
        if (text == "false") return Token{TokKind::False, {}, 0};
        if (text == "nil") return Token{TokKind::Nil, {}, 0};
        return Token{TokKind::Ident, text, 0};
    }

    Token lex_string() {
        const int quote = peek();
        ++pos_;
        std::string out;
        for (;;) {
            const int ch = peek();
            if (ch < 0) {
                throw LvmError(ERR_SYNTAX);
            }
            ++pos_;
            if (ch == quote) {
                break;
            }
            if (ch == '\\') {
                const int esc = peek();
                if (esc < 0) {
                    throw LvmError(ERR_SYNTAX);
                }
                ++pos_;
                switch (esc) {
                    case '\\':
                        out.push_back('\\');
                        break;
                    case '\'':
                        out.push_back('\'');
                        break;
                    case '"':
                        out.push_back('"');
                        break;
                    case 'n':
                        out.push_back('\n');
                        break;
                    case 't':
                        out.push_back('\t');
                        break;
                    default:
                        throw LvmError(ERR_SYNTAX);
                }
            } else {
                out.push_back(static_cast<char>(ch));
            }
            if (out.size() > 127) {
                throw LvmError(ERR_SYNTAX);
            }
        }
        return Token{TokKind::Str, out, 0};
    }

    Token lex_punct(int ch) {
        switch (ch) {
            case '+':
                ++pos_;
                return Token{TokKind::Plus, {}, 0};
            case '-':
                ++pos_;
                return Token{TokKind::Minus, {}, 0};
            case '*':
                ++pos_;
                return Token{TokKind::Star, {}, 0};
            case '%':
                ++pos_;
                return Token{TokKind::Percent, {}, 0};
            case '#':
                ++pos_;
                return Token{TokKind::Len, {}, 0};
            case '/':
                if (take2('/', '/')) return Token{TokKind::FloorDiv, {}, 0};
                break;
            case '.':
                if (take2('.', '.')) return Token{TokKind::DotDot, {}, 0};
                break;
            case '=':
                if (take2('=', '=')) return Token{TokKind::EqEq, {}, 0};
                ++pos_;
                return Token{TokKind::Assign, {}, 0};
            case '~':
                if (take2('~', '=')) return Token{TokKind::Ne, {}, 0};
                break;
            case '<':
                if (take2('<', '=')) return Token{TokKind::Le, {}, 0};
                ++pos_;
                return Token{TokKind::Lt, {}, 0};
            case '>':
                if (take2('>', '=')) return Token{TokKind::Ge, {}, 0};
                ++pos_;
                return Token{TokKind::Gt, {}, 0};
            case '(':
                ++pos_;
                return Token{TokKind::LParen, {}, 0};
            case ')':
                ++pos_;
                return Token{TokKind::RParen, {}, 0};
            case ',':
                ++pos_;
                return Token{TokKind::Comma, {}, 0};
            case ';':
                ++pos_;
                return Token{TokKind::Semi, {}, 0};
            default:
                break;
        }
        throw LvmError(ERR_SYNTAX);
    }
};

class Parser {
public:
    static Chunk parse(const std::string& source) {
        Parser parser(Lexer(source).tokenize());
        Chunk chunk;
        chunk.body = parser.parse_block({TokKind::Eof});
        parser.expect(TokKind::Eof);
        return chunk;
    }

private:
    explicit Parser(std::vector<Token> tokens) : tokens_(std::move(tokens)) {}

    std::vector<Token> tokens_;
    std::size_t pos_ = 0;

    const Token& current() const {
        return tokens_[pos_];
    }

    Token bump() {
        Token tok = tokens_[pos_];
        if (pos_ + 1 < tokens_.size()) {
            ++pos_;
        }
        return tok;
    }

    bool matches(TokKind kind) const {
        return current().kind == kind;
    }

    bool eat(TokKind kind) {
        if (matches(kind)) {
            bump();
            return true;
        }
        return false;
    }

    void expect(TokKind kind) {
        if (!eat(kind)) {
            throw LvmError(ERR_SYNTAX);
        }
    }

    std::string ident() {
        Token tok = bump();
        if (tok.kind != TokKind::Ident) {
            throw LvmError(ERR_SYNTAX);
        }
        return tok.text;
    }

    std::vector<Stmt> parse_block(std::initializer_list<TokKind> terminators) {
        std::vector<Stmt> stmts;
        while (std::find(terminators.begin(), terminators.end(), current().kind) == terminators.end()) {
            if (matches(TokKind::Eof)) {
                throw LvmError(ERR_SYNTAX);
            }
            if (eat(TokKind::Semi)) {
                continue;
            }
            stmts.push_back(parse_stmt());
            while (eat(TokKind::Semi)) {}
        }
        return stmts;
    }

    Stmt parse_stmt() {
        switch (current().kind) {
            case TokKind::Local:
                return parse_local();
            case TokKind::If:
                return parse_if();
            case TokKind::While:
                return parse_while();
            case TokKind::For:
                return parse_for();
            case TokKind::Function:
                return parse_function_stmt();
            case TokKind::Return:
                return parse_return();
            case TokKind::Do:
                return parse_do();
            case TokKind::Ident:
                return parse_assignment_or_call();
            default:
                throw LvmError(ERR_SYNTAX);
        }
    }

    Stmt parse_local() {
        expect(TokKind::Local);
        std::vector<std::string> names{ident()};
        while (eat(TokKind::Comma)) {
            names.push_back(ident());
        }
        std::vector<Expr> exprs;
        if (eat(TokKind::Assign)) {
            exprs = parse_expr_list();
        }
        return Stmt::local(std::move(names), std::move(exprs));
    }

    Stmt parse_if() {
        expect(TokKind::If);
        Expr cond = parse_expr();
        expect(TokKind::Then);
        Stmt out;
        out.kind = Stmt::Kind::If;
        out.branches.push_back({std::move(cond), parse_block({TokKind::Elseif, TokKind::Else, TokKind::End})});
        while (eat(TokKind::Elseif)) {
            Expr branch_cond = parse_expr();
            expect(TokKind::Then);
            out.branches.push_back({std::move(branch_cond), parse_block({TokKind::Elseif, TokKind::Else, TokKind::End})});
        }
        if (eat(TokKind::Else)) {
            out.else_body = parse_block({TokKind::End});
        }
        expect(TokKind::End);
        return out;
    }

    Stmt parse_while() {
        expect(TokKind::While);
        Stmt out;
        out.kind = Stmt::Kind::While;
        out.expr = parse_expr();
        expect(TokKind::Do);
        out.body = parse_block({TokKind::End});
        expect(TokKind::End);
        return out;
    }

    Stmt parse_for() {
        expect(TokKind::For);
        Stmt out;
        out.kind = Stmt::Kind::For;
        out.name = ident();
        expect(TokKind::Assign);
        out.start = parse_expr();
        expect(TokKind::Comma);
        out.limit = parse_expr();
        if (eat(TokKind::Comma)) {
            out.step = parse_expr();
            out.has_step = true;
        }
        expect(TokKind::Do);
        out.body = parse_block({TokKind::End});
        expect(TokKind::End);
        return out;
    }

    Stmt parse_function_stmt() {
        expect(TokKind::Function);
        Stmt out;
        out.kind = Stmt::Kind::Function;
        out.name = ident();
        expect(TokKind::LParen);
        if (!eat(TokKind::RParen)) {
            out.names.push_back(ident());
            while (eat(TokKind::Comma)) {
                out.names.push_back(ident());
            }
            expect(TokKind::RParen);
        }
        if (out.names.size() > 8) {
            throw LvmError(ERR_SYNTAX);
        }
        out.body = parse_block({TokKind::End});
        expect(TokKind::End);
        return out;
    }

    Stmt parse_return() {
        expect(TokKind::Return);
        Stmt out;
        out.kind = Stmt::Kind::Return;
        if (matches(TokKind::Eof) || matches(TokKind::End) || matches(TokKind::Else) ||
            matches(TokKind::Elseif) || matches(TokKind::Semi)) {
            out.has_return_expr = false;
        } else {
            out.expr = parse_expr();
            out.has_return_expr = true;
        }
        return out;
    }

    Stmt parse_do() {
        expect(TokKind::Do);
        Stmt out;
        out.kind = Stmt::Kind::Do;
        out.body = parse_block({TokKind::End});
        expect(TokKind::End);
        return out;
    }

    Stmt parse_assignment_or_call() {
        std::string first = ident();
        if (matches(TokKind::LParen)) {
            Stmt out;
            out.kind = Stmt::Kind::Call;
            out.expr = Expr::call(std::move(first), parse_args());
            return out;
        }
        std::vector<std::string> names{std::move(first)};
        while (eat(TokKind::Comma)) {
            names.push_back(ident());
        }
        expect(TokKind::Assign);
        return Stmt::assign(std::move(names), parse_expr_list());
    }

    std::vector<Expr> parse_expr_list() {
        std::vector<Expr> exprs{parse_expr()};
        while (eat(TokKind::Comma)) {
            exprs.push_back(parse_expr());
        }
        return exprs;
    }

    Expr parse_expr() { return parse_or(); }

    Expr parse_or() {
        Expr expr = parse_and();
        while (eat(TokKind::Or)) {
            expr = Expr::binary(std::move(expr), BinOp::Or, parse_and());
        }
        return expr;
    }

    Expr parse_and() {
        Expr expr = parse_compare();
        while (eat(TokKind::And)) {
            expr = Expr::binary(std::move(expr), BinOp::And, parse_compare());
        }
        return expr;
    }

    Expr parse_compare() {
        Expr expr = parse_concat();
        for (;;) {
            BinOp op = BinOp::Eq;
            if (eat(TokKind::EqEq)) {
                op = BinOp::Eq;
            } else if (eat(TokKind::Ne)) {
                op = BinOp::Ne;
            } else if (eat(TokKind::Lt)) {
                op = BinOp::Lt;
            } else if (eat(TokKind::Le)) {
                op = BinOp::Le;
            } else if (eat(TokKind::Gt)) {
                op = BinOp::Gt;
            } else if (eat(TokKind::Ge)) {
                op = BinOp::Ge;
            } else {
                break;
            }
            expr = Expr::binary(std::move(expr), op, parse_concat());
        }
        return expr;
    }

    Expr parse_concat() {
        Expr left = parse_add();
        if (eat(TokKind::DotDot)) {
            return Expr::binary(std::move(left), BinOp::Concat, parse_concat());
        }
        return left;
    }

    Expr parse_add() {
        Expr expr = parse_mul();
        for (;;) {
            if (eat(TokKind::Plus)) {
                expr = Expr::binary(std::move(expr), BinOp::Add, parse_mul());
            } else if (eat(TokKind::Minus)) {
                expr = Expr::binary(std::move(expr), BinOp::Sub, parse_mul());
            } else {
                break;
            }
        }
        return expr;
    }

    Expr parse_mul() {
        Expr expr = parse_unary();
        for (;;) {
            if (eat(TokKind::Star)) {
                expr = Expr::binary(std::move(expr), BinOp::Mul, parse_unary());
            } else if (eat(TokKind::FloorDiv)) {
                expr = Expr::binary(std::move(expr), BinOp::FloorDiv, parse_unary());
            } else if (eat(TokKind::Percent)) {
                expr = Expr::binary(std::move(expr), BinOp::Mod, parse_unary());
            } else {
                break;
            }
        }
        return expr;
    }

    Expr parse_unary() {
        if (eat(TokKind::Minus)) {
            return Expr::unary(UnOp::Neg, parse_unary());
        }
        if (eat(TokKind::Not)) {
            return Expr::unary(UnOp::Not, parse_unary());
        }
        if (eat(TokKind::Len)) {
            return Expr::unary(UnOp::Len, parse_unary());
        }
        return parse_primary();
    }

    Expr parse_primary() {
        Token tok = bump();
        switch (tok.kind) {
            case TokKind::Nil:
                return Expr::nil();
            case TokKind::True:
                return Expr::boolean(true);
            case TokKind::False:
                return Expr::boolean(false);
            case TokKind::Int:
                return Expr::integer(tok.int_value);
            case TokKind::Str:
                return Expr::string(std::move(tok.text));
            case TokKind::Ident:
                if (matches(TokKind::LParen)) {
                    return Expr::call(std::move(tok.text), parse_args());
                }
                return Expr::var(std::move(tok.text));
            case TokKind::LParen: {
                Expr expr = parse_expr();
                expect(TokKind::RParen);
                return expr;
            }
            default:
                throw LvmError(ERR_SYNTAX);
        }
    }

    std::vector<Expr> parse_args() {
        expect(TokKind::LParen);
        std::vector<Expr> args;
        if (!eat(TokKind::RParen)) {
            args.push_back(parse_expr());
            while (eat(TokKind::Comma)) {
                args.push_back(parse_expr());
            }
            expect(TokKind::RParen);
        }
        return args;
    }
};

struct Env {
    explicit Env(std::size_t depth_in) : depth(depth_in) {
        scopes.emplace_back();
    }

    std::vector<std::unordered_map<std::string, Value>> scopes;
    std::size_t depth = 0;

    void push() { scopes.emplace_back(); }

    void pop() {
        if (!scopes.empty()) {
            scopes.pop_back();
        }
    }

    void define(const std::string& name, Value value) {
        scopes.back()[name] = std::move(value);
    }

    void assign(State& st, const std::string& name, Value value) {
        for (auto it = scopes.rbegin(); it != scopes.rend(); ++it) {
            if (it->find(name) != it->end()) {
                (*it)[name] = std::move(value);
                return;
            }
        }
        st.globals[name] = std::move(value);
    }

    Value get(const State& st, const std::string& name) const {
        for (auto it = scopes.rbegin(); it != scopes.rend(); ++it) {
            const auto found = it->find(name);
            if (found != it->end()) {
                return found->second;
            }
        }
        const auto found = st.globals.find(name);
        if (found != st.globals.end()) {
            return found->second;
        }
        return Value::nil();
    }
};

struct Flow {
    bool is_return = false;
    Value value;

    static Flow normal() { return Flow(); }

    static Flow ret(Value value_in) {
        Flow out;
        out.is_return = true;
        out.value = std::move(value_in);
        return out;
    }
};

int64_t expect_int(const Value& value) {
    if (value.type != Value::Type::Int) {
        throw LvmError(ERR_RUNTIME);
    }
    return value.int_value;
}

int64_t checked_add(int64_t a, int64_t b) {
    int64_t out = 0;
    if (__builtin_add_overflow(a, b, &out)) {
        throw LvmError(ERR_RUNTIME);
    }
    return out;
}

int64_t checked_sub(int64_t a, int64_t b) {
    int64_t out = 0;
    if (__builtin_sub_overflow(a, b, &out)) {
        throw LvmError(ERR_RUNTIME);
    }
    return out;
}

int64_t checked_mul(int64_t a, int64_t b) {
    int64_t out = 0;
    if (__builtin_mul_overflow(a, b, &out)) {
        throw LvmError(ERR_RUNTIME);
    }
    return out;
}

int64_t floor_div(int64_t a, int64_t b) {
    if (b == 0 || (a == std::numeric_limits<int64_t>::min() && b == -1)) {
        throw LvmError(ERR_RUNTIME);
    }
    const int64_t q = a / b;
    const int64_t rem = a % b;
    if (rem != 0 && ((rem > 0) != (b > 0))) {
        return checked_sub(q, 1);
    }
    return q;
}

Value call_function(State& st, const std::shared_ptr<Function>& func, const std::vector<Value>& args, std::size_t depth);
Value eval_expr(State& st, Env& env, const Expr& expr);

std::vector<Value> eval_list(State& st, Env& env, const std::vector<Expr>& exprs) {
    std::vector<Value> values;
    values.reserve(exprs.size());
    for (const Expr& expr : exprs) {
        values.push_back(eval_expr(st, env, expr));
    }
    return values;
}

Value compare_values(const Value& lhs, BinOp op, const Value& rhs) {
    bool result = false;
    if (lhs.type == Value::Type::Int && rhs.type == Value::Type::Int) {
        switch (op) {
            case BinOp::Lt:
                result = lhs.int_value < rhs.int_value;
                break;
            case BinOp::Le:
                result = lhs.int_value <= rhs.int_value;
                break;
            case BinOp::Gt:
                result = lhs.int_value > rhs.int_value;
                break;
            case BinOp::Ge:
                result = lhs.int_value >= rhs.int_value;
                break;
            default:
                throw LvmError(ERR_RUNTIME);
        }
    } else if (lhs.type == Value::Type::Str && rhs.type == Value::Type::Str) {
        switch (op) {
            case BinOp::Lt:
                result = lhs.str_value < rhs.str_value;
                break;
            case BinOp::Le:
                result = lhs.str_value <= rhs.str_value;
                break;
            case BinOp::Gt:
                result = lhs.str_value > rhs.str_value;
                break;
            case BinOp::Ge:
                result = lhs.str_value >= rhs.str_value;
                break;
            default:
                throw LvmError(ERR_RUNTIME);
        }
    } else {
        throw LvmError(ERR_RUNTIME);
    }
    return Value::boolean(result);
}

Value eval_binary(const Value& lhs, BinOp op, const Value& rhs) {
    switch (op) {
        case BinOp::Add:
            return Value::integer(checked_add(expect_int(lhs), expect_int(rhs)));
        case BinOp::Sub:
            return Value::integer(checked_sub(expect_int(lhs), expect_int(rhs)));
        case BinOp::Mul:
            return Value::integer(checked_mul(expect_int(lhs), expect_int(rhs)));
        case BinOp::FloorDiv:
            return Value::integer(floor_div(expect_int(lhs), expect_int(rhs)));
        case BinOp::Mod: {
            const int64_t a = expect_int(lhs);
            const int64_t b = expect_int(rhs);
            return Value::integer(checked_sub(a, checked_mul(floor_div(a, b), b)));
        }
        case BinOp::Concat: {
            std::string out = lhs.to_concat_string();
            out += rhs.to_concat_string();
            if (out.size() > 127) {
                throw LvmError(ERR_RUNTIME);
            }
            return Value::string(std::move(out));
        }
        case BinOp::Eq:
            return Value::boolean(values_equal(lhs, rhs));
        case BinOp::Ne:
            return Value::boolean(!values_equal(lhs, rhs));
        case BinOp::Lt:
        case BinOp::Le:
        case BinOp::Gt:
        case BinOp::Ge:
            return compare_values(lhs, op, rhs);
        case BinOp::And:
        case BinOp::Or:
            throw LvmError(ERR_RUNTIME);
    }
    throw LvmError(ERR_RUNTIME);
}

Value eval_expr(State& st, Env& env, const Expr& expr) {
    switch (expr.kind) {
        case Expr::Kind::Nil:
            return Value::nil();
        case Expr::Kind::Bool:
            return Value::boolean(expr.bool_value);
        case Expr::Kind::Int:
            return Value::integer(expr.int_value);
        case Expr::Kind::Str:
            return Value::string(expr.text);
        case Expr::Kind::Var:
            return env.get(st, expr.text);
        case Expr::Kind::Unary: {
            Value value = eval_expr(st, env, *expr.left);
            switch (expr.unop) {
                case UnOp::Neg: {
                    const int64_t n = expect_int(value);
                    if (n == std::numeric_limits<int64_t>::min()) {
                        throw LvmError(ERR_RUNTIME);
                    }
                    return Value::integer(-n);
                }
                case UnOp::Not:
                    return Value::boolean(!value.truthy());
                case UnOp::Len:
                    if (value.type != Value::Type::Str) {
                        throw LvmError(ERR_RUNTIME);
                    }
                    return Value::integer(static_cast<int64_t>(value.str_value.size()));
            }
            break;
        }
        case Expr::Kind::Binary:
            if (expr.binop == BinOp::And) {
                Value lhs = eval_expr(st, env, *expr.left);
                if (!lhs.truthy()) {
                    return lhs;
                }
                return eval_expr(st, env, *expr.right);
            }
            if (expr.binop == BinOp::Or) {
                Value lhs = eval_expr(st, env, *expr.left);
                if (lhs.truthy()) {
                    return lhs;
                }
                return eval_expr(st, env, *expr.right);
            }
            {
                Value lhs = eval_expr(st, env, *expr.left);
                Value rhs = eval_expr(st, env, *expr.right);
                return eval_binary(lhs, expr.binop, rhs);
            }
        case Expr::Kind::Call: {
            std::vector<Value> values = eval_list(st, env, expr.args);
            Value func_value = env.get(st, expr.text);
            if (func_value.type != Value::Type::Function || !func_value.func_value) {
                throw LvmError(ERR_RUNTIME);
            }
            return call_function(st, func_value.func_value, values, env.depth + 1);
        }
    }
    throw LvmError(ERR_RUNTIME);
}

Flow exec_block(State& st, Env& env, const std::vector<Stmt>& body);

Flow exec_scoped_block(State& st, Env& env, const std::vector<Stmt>& body) {
    env.push();
    try {
        Flow flow = exec_block(st, env, body);
        env.pop();
        return flow;
    } catch (...) {
        env.pop();
        throw;
    }
}

Flow exec_stmt(State& st, Env& env, const Stmt& stmt) {
    switch (stmt.kind) {
        case Stmt::Kind::Local: {
            std::vector<Value> values = eval_list(st, env, stmt.exprs);
            for (std::size_t idx = 0; idx < stmt.names.size(); ++idx) {
                env.define(stmt.names[idx], idx < values.size() ? values[idx] : Value::nil());
            }
            return Flow::normal();
        }
        case Stmt::Kind::Assign: {
            std::vector<Value> values = eval_list(st, env, stmt.exprs);
            for (std::size_t idx = 0; idx < stmt.names.size(); ++idx) {
                env.assign(st, stmt.names[idx], idx < values.size() ? values[idx] : Value::nil());
            }
            return Flow::normal();
        }
        case Stmt::Kind::If:
            for (const auto& branch : stmt.branches) {
                if (eval_expr(st, env, branch.first).truthy()) {
                    return exec_scoped_block(st, env, branch.second);
                }
            }
            if (!stmt.else_body.empty()) {
                return exec_scoped_block(st, env, stmt.else_body);
            }
            return Flow::normal();
        case Stmt::Kind::While:
            while (eval_expr(st, env, stmt.expr).truthy()) {
                Flow flow = exec_scoped_block(st, env, stmt.body);
                if (flow.is_return) {
                    return flow;
                }
            }
            return Flow::normal();
        case Stmt::Kind::For: {
            int64_t index = expect_int(eval_expr(st, env, stmt.start));
            const int64_t limit = expect_int(eval_expr(st, env, stmt.limit));
            const int64_t step = stmt.has_step ? expect_int(eval_expr(st, env, stmt.step)) : 1;
            if (step == 0) {
                throw LvmError(ERR_RUNTIME);
            }
            env.push();
            try {
                for (;;) {
                    const bool keep_going = step > 0 ? index <= limit : index >= limit;
                    if (!keep_going) {
                        break;
                    }
                    env.define(stmt.name, Value::integer(index));
                    Flow flow = exec_block(st, env, stmt.body);
                    if (flow.is_return) {
                        env.pop();
                        return flow;
                    }
                    index = checked_add(index, step);
                }
                env.pop();
            } catch (...) {
                env.pop();
                throw;
            }
            return Flow::normal();
        }
        case Stmt::Kind::Function: {
            auto func = std::make_shared<Function>();
            func->params = stmt.names;
            func->body = stmt.body;
            st.globals[stmt.name] = Value::function(std::move(func));
            return Flow::normal();
        }
        case Stmt::Kind::Call:
            (void)eval_expr(st, env, stmt.expr);
            return Flow::normal();
        case Stmt::Kind::Return:
            if (stmt.has_return_expr) {
                return Flow::ret(eval_expr(st, env, stmt.expr));
            }
            return Flow::ret(Value::nil());
        case Stmt::Kind::Do:
            return exec_scoped_block(st, env, stmt.body);
    }
    throw LvmError(ERR_RUNTIME);
}

Flow exec_block(State& st, Env& env, const std::vector<Stmt>& body) {
    for (const Stmt& stmt : body) {
        Flow flow = exec_stmt(st, env, stmt);
        if (flow.is_return) {
            return flow;
        }
    }
    return Flow::normal();
}

Value call_function(State& st, const std::shared_ptr<Function>& func, const std::vector<Value>& args, std::size_t depth) {
    if (depth > MAX_RECURSION) {
        throw LvmError(ERR_STACK);
    }
    Env env(depth);
    for (std::size_t idx = 0; idx < func->params.size(); ++idx) {
        env.define(func->params[idx], idx < args.size() ? args[idx] : Value::nil());
    }
    Flow flow = exec_block(st, env, func->body);
    if (flow.is_return) {
        return flow.value;
    }
    return Value::nil();
}

Value run_chunk(State& st, int chunk_id) {
    if (chunk_id < 0 || static_cast<std::size_t>(chunk_id) >= st.chunks.size()) {
        throw LvmError(ERR_BAD_CHUNK);
    }
    Chunk chunk = st.chunks[static_cast<std::size_t>(chunk_id)];
    Env env(0);
    Flow flow = exec_block(st, env, chunk.body);
    if (flow.is_return) {
        return flow.value;
    }
    return Value::nil();
}

}  // namespace

#define LVM_EXPORT extern "C" __attribute__((visibility("default")))

LVM_EXPORT void lvm_reset(void) {
    std::lock_guard<std::mutex> lock(g_mutex);
    g_state = State();
}

LVM_EXPORT int lvm_compile(const char* source) {
    std::string src;
    try {
        src = read_c_string(source);
        Chunk chunk = Parser::parse(src);
        std::lock_guard<std::mutex> lock(g_mutex);
        const int id = static_cast<int>(g_state.chunks.size());
        g_state.chunks.push_back(std::move(chunk));
        set_error(g_state, 0);
        return id;
    } catch (const LvmError& err) {
        std::lock_guard<std::mutex> lock(g_mutex);
        set_error(g_state, err.code);
        return -1;
    } catch (...) {
        std::lock_guard<std::mutex> lock(g_mutex);
        set_error(g_state, ERR_RUNTIME);
        return -1;
    }
}

LVM_EXPORT int lvm_exec(int chunk_id) {
    std::lock_guard<std::mutex> lock(g_mutex);
    try {
        g_state.last_result = run_chunk(g_state, chunk_id);
        set_error(g_state, 0);
        return 1;
    } catch (const LvmError& err) {
        set_error(g_state, err.code);
        return 0;
    } catch (...) {
        set_error(g_state, ERR_RUNTIME);
        return 0;
    }
}

LVM_EXPORT int lvm_get_result(int64_t* out) {
    std::lock_guard<std::mutex> lock(g_mutex);
    if (out == nullptr) {
        set_error(g_state, ERR_BAD_POINTER);
        return 0;
    }
    if (g_state.last_result.type == Value::Type::Int) {
        *out = g_state.last_result.int_value;
        set_error(g_state, 0);
        return 1;
    }
    set_error(g_state, 0);
    return 0;
}

LVM_EXPORT int lvm_set_global(const char* name, int64_t value) {
    try {
        std::string key = read_c_string(name);
        std::lock_guard<std::mutex> lock(g_mutex);
        g_state.globals[std::move(key)] = Value::integer(value);
        set_error(g_state, 0);
        return 1;
    } catch (const LvmError& err) {
        std::lock_guard<std::mutex> lock(g_mutex);
        set_error(g_state, err.code);
        return 0;
    }
}

LVM_EXPORT int lvm_get_global(const char* name, int64_t* out) {
    std::lock_guard<std::mutex> lock(g_mutex);
    if (out == nullptr) {
        set_error(g_state, ERR_BAD_POINTER);
        return 0;
    }
    try {
        const std::string key = read_c_string(name);
        const auto found = g_state.globals.find(key);
        if (found != g_state.globals.end() && found->second.type == Value::Type::Int) {
            *out = found->second.int_value;
            set_error(g_state, 0);
            return 1;
        }
        set_error(g_state, 0);
        return 0;
    } catch (const LvmError& err) {
        set_error(g_state, err.code);
        return 0;
    }
}

LVM_EXPORT int lvm_get_global_str(const char* name, char* buf, int max_len) {
    std::lock_guard<std::mutex> lock(g_mutex);
    if (buf == nullptr || max_len <= 0) {
        set_error(g_state, ERR_BAD_POINTER);
        return 0;
    }
    try {
        const std::string key = read_c_string(name);
        const auto found = g_state.globals.find(key);
        if (found != g_state.globals.end() && found->second.type == Value::Type::Str) {
            const std::string& value = found->second.str_value;
            const std::size_t copy_len = std::min(value.size(), static_cast<std::size_t>(max_len - 1));
            std::memcpy(buf, value.data(), copy_len);
            buf[copy_len] = '\0';
            set_error(g_state, 0);
            return 1;
        }
        set_error(g_state, 0);
        return 0;
    } catch (const LvmError& err) {
        set_error(g_state, err.code);
        return 0;
    }
}

LVM_EXPORT int lvm_call(int chunk_id, const char* func_name, int nargs, const int64_t* args, int64_t* out) {
    std::lock_guard<std::mutex> lock(g_mutex);
    if (out == nullptr || nargs < 0 || (nargs > 0 && args == nullptr)) {
        set_error(g_state, ERR_BAD_POINTER);
        return 0;
    }
    try {
        const std::string name = read_c_string(func_name);
        if (chunk_id < 0 || static_cast<std::size_t>(chunk_id) >= g_state.chunks.size()) {
            set_error(g_state, ERR_BAD_CHUNK);
            return 0;
        }
        std::vector<Value> values;
        values.reserve(static_cast<std::size_t>(nargs));
        for (int idx = 0; idx < nargs; ++idx) {
            values.push_back(Value::integer(args[idx]));
        }
        const auto found = g_state.globals.find(name);
        if (found == g_state.globals.end() || found->second.type != Value::Type::Function || !found->second.func_value) {
            set_error(g_state, ERR_BAD_FUNCTION);
            return 0;
        }
        Value result = call_function(g_state, found->second.func_value, values, 1);
        if (result.type != Value::Type::Int) {
            set_error(g_state, ERR_RUNTIME);
            return 0;
        }
        *out = result.int_value;
        set_error(g_state, 0);
        return 1;
    } catch (const LvmError& err) {
        set_error(g_state, err.code);
        return 0;
    } catch (...) {
        set_error(g_state, ERR_RUNTIME);
        return 0;
    }
}

LVM_EXPORT int lvm_typeof_global(const char* name) {
    std::lock_guard<std::mutex> lock(g_mutex);
    try {
        const std::string key = read_c_string(name);
        const auto found = g_state.globals.find(key);
        const int code = found == g_state.globals.end() ? 0 : found->second.type_code();
        set_error(g_state, 0);
        return code;
    } catch (const LvmError& err) {
        set_error(g_state, err.code);
        return 0;
    }
}

LVM_EXPORT int lvm_last_error(void) {
    std::lock_guard<std::mutex> lock(g_mutex);
    return g_state.last_error;
}
