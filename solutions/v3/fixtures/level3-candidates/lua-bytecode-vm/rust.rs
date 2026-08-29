use std::collections::HashMap;
use std::ffi::CStr;
use std::os::raw::c_char;
use std::sync::{Mutex, Once};

const ERR_NULL: i32 = 1;
const ERR_UTF8: i32 = 2;
const ERR_SYNTAX: i32 = 3;
const ERR_BAD_CHUNK: i32 = 4;
const ERR_RUNTIME: i32 = 5;
const ERR_BAD_POINTER: i32 = 6;
const ERR_BAD_FUNCTION: i32 = 7;
const ERR_STACK: i32 = 8;

const MAX_RECURSION: usize = 512;

#[derive(Clone, Debug, PartialEq)]
enum Value {
    Nil,
    Bool(bool),
    Int(i64),
    Str(String),
    Function(Function),
}

impl Value {
    fn truthy(&self) -> bool {
        !matches!(self, Value::Nil | Value::Bool(false))
    }

    fn type_code(&self) -> i32 {
        match self {
            Value::Nil => 0,
            Value::Bool(_) => 1,
            Value::Int(_) => 2,
            Value::Str(_) => 3,
            Value::Function(_) => 4,
        }
    }

    fn to_concat_string(&self) -> Result<String, VmError> {
        match self {
            Value::Str(s) => Ok(s.clone()),
            Value::Int(n) => Ok(n.to_string()),
            _ => Err(VmError::Runtime),
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
struct Function {
    params: Vec<String>,
    body: Vec<Stmt>,
}

#[derive(Clone, Debug, PartialEq)]
struct Chunk {
    body: Vec<Stmt>,
}

#[derive(Clone, Debug, PartialEq)]
enum Stmt {
    Local(Vec<String>, Vec<Expr>),
    Assign(Vec<String>, Vec<Expr>),
    If {
        branches: Vec<(Expr, Vec<Stmt>)>,
        else_body: Vec<Stmt>,
    },
    While(Expr, Vec<Stmt>),
    For {
        name: String,
        start: Expr,
        end: Expr,
        step: Option<Expr>,
        body: Vec<Stmt>,
    },
    Function(String, Vec<String>, Vec<Stmt>),
    Call(Expr),
    Return(Option<Expr>),
    Do(Vec<Stmt>),
}

#[derive(Clone, Debug, PartialEq)]
enum Expr {
    Nil,
    Bool(bool),
    Int(i64),
    Str(String),
    Var(String),
    Unary(UnOp, Box<Expr>),
    Binary(Box<Expr>, BinOp, Box<Expr>),
    Call(String, Vec<Expr>),
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum UnOp {
    Neg,
    Not,
    Len,
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum BinOp {
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
    Or,
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum VmError {
    Syntax,
    Runtime,
    Stack,
}

impl VmError {
    fn code(self) -> i32 {
        match self {
            VmError::Syntax => ERR_SYNTAX,
            VmError::Runtime => ERR_RUNTIME,
            VmError::Stack => ERR_STACK,
        }
    }
}

#[derive(Default)]
struct State {
    chunks: Vec<Chunk>,
    globals: HashMap<String, Value>,
    last_error: i32,
    last_result: Value,
}

impl Default for Value {
    fn default() -> Self {
        Value::Nil
    }
}

fn state() -> &'static Mutex<State> {
    static INIT: Once = Once::new();
    static mut STATE: *const Mutex<State> = std::ptr::null();
    unsafe {
        INIT.call_once(|| {
            STATE = Box::into_raw(Box::new(Mutex::new(State::default())));
        });
        &*STATE
    }
}

fn c_string(ptr: *const c_char) -> Result<String, i32> {
    if ptr.is_null() {
        return Err(ERR_NULL);
    }
    let raw = unsafe { CStr::from_ptr(ptr) };
    raw.to_str().map(str::to_owned).map_err(|_| ERR_UTF8)
}

fn set_error(st: &mut State, code: i32) {
    st.last_error = code;
}

#[derive(Clone, Debug, PartialEq)]
enum Tok {
    Eof,
    Ident(String),
    Int(i64),
    Str(String),
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
    Nil,
}

#[derive(Clone, Debug)]
struct Token {
    kind: Tok,
    pos: usize,
}

struct Lexer<'a> {
    bytes: &'a [u8],
    pos: usize,
}

impl<'a> Lexer<'a> {
    fn new(src: &'a str) -> Self {
        Self {
            bytes: src.as_bytes(),
            pos: 0,
        }
    }

    fn tokenize(mut self) -> Result<Vec<Token>, VmError> {
        let mut tokens = Vec::new();
        loop {
            self.skip_ws_and_comments();
            let pos = self.pos;
            let Some(ch) = self.peek() else {
                tokens.push(Token {
                    kind: Tok::Eof,
                    pos,
                });
                return Ok(tokens);
            };
            let kind = match ch {
                b'0'..=b'9' => self.lex_int()?,
                b'a'..=b'z' | b'A'..=b'Z' | b'_' => self.lex_ident(),
                b'\'' | b'"' => self.lex_string()?,
                b'+' => {
                    self.pos += 1;
                    Tok::Plus
                }
                b'-' => {
                    self.pos += 1;
                    Tok::Minus
                }
                b'*' => {
                    self.pos += 1;
                    Tok::Star
                }
                b'%' => {
                    self.pos += 1;
                    Tok::Percent
                }
                b'#' => {
                    self.pos += 1;
                    Tok::Len
                }
                b'/' => {
                    if self.take2(b'/', b'/') {
                        Tok::FloorDiv
                    } else {
                        return Err(VmError::Syntax);
                    }
                }
                b'.' => {
                    if self.take2(b'.', b'.') {
                        Tok::DotDot
                    } else {
                        return Err(VmError::Syntax);
                    }
                }
                b'=' => {
                    if self.take2(b'=', b'=') {
                        Tok::EqEq
                    } else {
                        self.pos += 1;
                        Tok::Assign
                    }
                }
                b'~' => {
                    if self.take2(b'~', b'=') {
                        Tok::Ne
                    } else {
                        return Err(VmError::Syntax);
                    }
                }
                b'<' => {
                    if self.take2(b'<', b'=') {
                        Tok::Le
                    } else {
                        self.pos += 1;
                        Tok::Lt
                    }
                }
                b'>' => {
                    if self.take2(b'>', b'=') {
                        Tok::Ge
                    } else {
                        self.pos += 1;
                        Tok::Gt
                    }
                }
                b'(' => {
                    self.pos += 1;
                    Tok::LParen
                }
                b')' => {
                    self.pos += 1;
                    Tok::RParen
                }
                b',' => {
                    self.pos += 1;
                    Tok::Comma
                }
                b';' => {
                    self.pos += 1;
                    Tok::Semi
                }
                _ => return Err(VmError::Syntax),
            };
            tokens.push(Token { kind, pos });
        }
    }

    fn peek(&self) -> Option<u8> {
        self.bytes.get(self.pos).copied()
    }

    fn take2(&mut self, first: u8, second: u8) -> bool {
        if self.bytes.get(self.pos) == Some(&first) && self.bytes.get(self.pos + 1) == Some(&second)
        {
            self.pos += 2;
            true
        } else {
            false
        }
    }

    fn skip_ws_and_comments(&mut self) {
        loop {
            while matches!(self.peek(), Some(b' ' | b'\n' | b'\r' | b'\t')) {
                self.pos += 1;
            }
            if self.bytes.get(self.pos) == Some(&b'-')
                && self.bytes.get(self.pos + 1) == Some(&b'-')
            {
                self.pos += 2;
                while let Some(ch) = self.peek() {
                    self.pos += 1;
                    if ch == b'\n' {
                        break;
                    }
                }
            } else {
                break;
            }
        }
    }

    fn lex_int(&mut self) -> Result<Tok, VmError> {
        let start = self.pos;
        while matches!(self.peek(), Some(b'0'..=b'9')) {
            self.pos += 1;
        }
        let text =
            std::str::from_utf8(&self.bytes[start..self.pos]).map_err(|_| VmError::Syntax)?;
        let n = text.parse::<i64>().map_err(|_| VmError::Syntax)?;
        Ok(Tok::Int(n))
    }

    fn lex_ident(&mut self) -> Tok {
        let start = self.pos;
        while matches!(
            self.peek(),
            Some(b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'_')
        ) {
            self.pos += 1;
        }
        let text = std::str::from_utf8(&self.bytes[start..self.pos]).unwrap_or("");
        match text {
            "and" => Tok::And,
            "or" => Tok::Or,
            "not" => Tok::Not,
            "if" => Tok::If,
            "then" => Tok::Then,
            "elseif" => Tok::Elseif,
            "else" => Tok::Else,
            "end" => Tok::End,
            "while" => Tok::While,
            "do" => Tok::Do,
            "for" => Tok::For,
            "function" => Tok::Function,
            "local" => Tok::Local,
            "return" => Tok::Return,
            "true" => Tok::True,
            "false" => Tok::False,
            "nil" => Tok::Nil,
            _ => Tok::Ident(text.to_owned()),
        }
    }

    fn lex_string(&mut self) -> Result<Tok, VmError> {
        let quote = self.peek().ok_or(VmError::Syntax)?;
        self.pos += 1;
        let mut out = String::new();
        loop {
            let ch = self.peek().ok_or(VmError::Syntax)?;
            self.pos += 1;
            if ch == quote {
                break;
            }
            if ch == b'\\' {
                let esc = self.peek().ok_or(VmError::Syntax)?;
                self.pos += 1;
                match esc {
                    b'\\' => out.push('\\'),
                    b'\'' => out.push('\''),
                    b'"' => out.push('"'),
                    b'n' => out.push('\n'),
                    b't' => out.push('\t'),
                    _ => return Err(VmError::Syntax),
                }
            } else {
                out.push(ch as char);
            }
            if out.len() > 127 {
                return Err(VmError::Syntax);
            }
        }
        Ok(Tok::Str(out))
    }
}

struct Parser {
    tokens: Vec<Token>,
    pos: usize,
}

impl Parser {
    fn parse(src: &str) -> Result<Chunk, VmError> {
        let tokens = Lexer::new(src).tokenize()?;
        let mut parser = Self { tokens, pos: 0 };
        let body = parser.parse_block(&[Tok::Eof])?;
        parser.expect(&Tok::Eof)?;
        Ok(Chunk { body })
    }

    fn current(&self) -> &Tok {
        &self.tokens[self.pos].kind
    }

    fn bump(&mut self) -> Tok {
        let tok = self.tokens[self.pos].kind.clone();
        if self.pos + 1 < self.tokens.len() {
            self.pos += 1;
        }
        tok
    }

    fn matches(&self, want: &Tok) -> bool {
        same_variant(self.current(), want)
    }

    fn eat(&mut self, want: &Tok) -> bool {
        if self.matches(want) {
            self.bump();
            true
        } else {
            false
        }
    }

    fn expect(&mut self, want: &Tok) -> Result<(), VmError> {
        if self.eat(want) {
            Ok(())
        } else {
            let _pos = self.tokens[self.pos].pos;
            Err(VmError::Syntax)
        }
    }

    fn ident(&mut self) -> Result<String, VmError> {
        match self.bump() {
            Tok::Ident(s) => Ok(s),
            _ => Err(VmError::Syntax),
        }
    }

    fn parse_block(&mut self, terminators: &[Tok]) -> Result<Vec<Stmt>, VmError> {
        let mut stmts = Vec::new();
        while !terminators.iter().any(|t| self.matches(t)) {
            if self.matches(&Tok::Eof) {
                return Err(VmError::Syntax);
            }
            if self.eat(&Tok::Semi) {
                continue;
            }
            stmts.push(self.parse_stmt()?);
            while self.eat(&Tok::Semi) {}
        }
        Ok(stmts)
    }

    fn parse_stmt(&mut self) -> Result<Stmt, VmError> {
        match self.current() {
            Tok::Local => self.parse_local(),
            Tok::If => self.parse_if(),
            Tok::While => self.parse_while(),
            Tok::For => self.parse_for(),
            Tok::Function => self.parse_function_stmt(),
            Tok::Return => self.parse_return(),
            Tok::Do => self.parse_do(),
            Tok::Ident(_) => self.parse_assignment_or_call(),
            _ => Err(VmError::Syntax),
        }
    }

    fn parse_local(&mut self) -> Result<Stmt, VmError> {
        self.expect(&Tok::Local)?;
        let mut names = vec![self.ident()?];
        while self.eat(&Tok::Comma) {
            names.push(self.ident()?);
        }
        let exprs = if self.eat(&Tok::Assign) {
            self.parse_expr_list()?
        } else {
            Vec::new()
        };
        Ok(Stmt::Local(names, exprs))
    }

    fn parse_if(&mut self) -> Result<Stmt, VmError> {
        self.expect(&Tok::If)?;
        let cond = self.parse_expr()?;
        self.expect(&Tok::Then)?;
        let first = self.parse_block(&[Tok::Elseif, Tok::Else, Tok::End])?;
        let mut branches = vec![(cond, first)];
        while self.eat(&Tok::Elseif) {
            let c = self.parse_expr()?;
            self.expect(&Tok::Then)?;
            let body = self.parse_block(&[Tok::Elseif, Tok::Else, Tok::End])?;
            branches.push((c, body));
        }
        let else_body = if self.eat(&Tok::Else) {
            self.parse_block(&[Tok::End])?
        } else {
            Vec::new()
        };
        self.expect(&Tok::End)?;
        Ok(Stmt::If {
            branches,
            else_body,
        })
    }

    fn parse_while(&mut self) -> Result<Stmt, VmError> {
        self.expect(&Tok::While)?;
        let cond = self.parse_expr()?;
        self.expect(&Tok::Do)?;
        let body = self.parse_block(&[Tok::End])?;
        self.expect(&Tok::End)?;
        Ok(Stmt::While(cond, body))
    }

    fn parse_for(&mut self) -> Result<Stmt, VmError> {
        self.expect(&Tok::For)?;
        let name = self.ident()?;
        self.expect(&Tok::Assign)?;
        let start = self.parse_expr()?;
        self.expect(&Tok::Comma)?;
        let end = self.parse_expr()?;
        let step = if self.eat(&Tok::Comma) {
            Some(self.parse_expr()?)
        } else {
            None
        };
        self.expect(&Tok::Do)?;
        let body = self.parse_block(&[Tok::End])?;
        self.expect(&Tok::End)?;
        Ok(Stmt::For {
            name,
            start,
            end,
            step,
            body,
        })
    }

    fn parse_function_stmt(&mut self) -> Result<Stmt, VmError> {
        self.expect(&Tok::Function)?;
        let name = self.ident()?;
        self.expect(&Tok::LParen)?;
        let mut params = Vec::new();
        if !self.eat(&Tok::RParen) {
            params.push(self.ident()?);
            while self.eat(&Tok::Comma) {
                params.push(self.ident()?);
            }
            self.expect(&Tok::RParen)?;
        }
        if params.len() > 8 {
            return Err(VmError::Syntax);
        }
        let body = self.parse_block(&[Tok::End])?;
        self.expect(&Tok::End)?;
        Ok(Stmt::Function(name, params, body))
    }

    fn parse_return(&mut self) -> Result<Stmt, VmError> {
        self.expect(&Tok::Return)?;
        if matches!(
            self.current(),
            Tok::Eof | Tok::End | Tok::Else | Tok::Elseif | Tok::Semi
        ) {
            Ok(Stmt::Return(None))
        } else {
            Ok(Stmt::Return(Some(self.parse_expr()?)))
        }
    }

    fn parse_do(&mut self) -> Result<Stmt, VmError> {
        self.expect(&Tok::Do)?;
        let body = self.parse_block(&[Tok::End])?;
        self.expect(&Tok::End)?;
        Ok(Stmt::Do(body))
    }

    fn parse_assignment_or_call(&mut self) -> Result<Stmt, VmError> {
        let name = self.ident()?;
        if self.matches(&Tok::LParen) {
            let args = self.parse_args()?;
            return Ok(Stmt::Call(Expr::Call(name, args)));
        }
        let mut names = vec![name];
        while self.eat(&Tok::Comma) {
            names.push(self.ident()?);
        }
        self.expect(&Tok::Assign)?;
        let exprs = self.parse_expr_list()?;
        Ok(Stmt::Assign(names, exprs))
    }

    fn parse_expr_list(&mut self) -> Result<Vec<Expr>, VmError> {
        let mut exprs = vec![self.parse_expr()?];
        while self.eat(&Tok::Comma) {
            exprs.push(self.parse_expr()?);
        }
        Ok(exprs)
    }

    fn parse_expr(&mut self) -> Result<Expr, VmError> {
        self.parse_or()
    }

    fn parse_or(&mut self) -> Result<Expr, VmError> {
        let mut expr = self.parse_and()?;
        while self.eat(&Tok::Or) {
            let rhs = self.parse_and()?;
            expr = Expr::Binary(Box::new(expr), BinOp::Or, Box::new(rhs));
        }
        Ok(expr)
    }

    fn parse_and(&mut self) -> Result<Expr, VmError> {
        let mut expr = self.parse_compare()?;
        while self.eat(&Tok::And) {
            let rhs = self.parse_compare()?;
            expr = Expr::Binary(Box::new(expr), BinOp::And, Box::new(rhs));
        }
        Ok(expr)
    }

    fn parse_compare(&mut self) -> Result<Expr, VmError> {
        let mut expr = self.parse_concat()?;
        loop {
            let op = if self.eat(&Tok::EqEq) {
                BinOp::Eq
            } else if self.eat(&Tok::Ne) {
                BinOp::Ne
            } else if self.eat(&Tok::Lt) {
                BinOp::Lt
            } else if self.eat(&Tok::Le) {
                BinOp::Le
            } else if self.eat(&Tok::Gt) {
                BinOp::Gt
            } else if self.eat(&Tok::Ge) {
                BinOp::Ge
            } else {
                break;
            };
            let rhs = self.parse_concat()?;
            expr = Expr::Binary(Box::new(expr), op, Box::new(rhs));
        }
        Ok(expr)
    }

    fn parse_concat(&mut self) -> Result<Expr, VmError> {
        let left = self.parse_add()?;
        if self.eat(&Tok::DotDot) {
            let rhs = self.parse_concat()?;
            Ok(Expr::Binary(Box::new(left), BinOp::Concat, Box::new(rhs)))
        } else {
            Ok(left)
        }
    }

    fn parse_add(&mut self) -> Result<Expr, VmError> {
        let mut expr = self.parse_mul()?;
        loop {
            let op = if self.eat(&Tok::Plus) {
                BinOp::Add
            } else if self.eat(&Tok::Minus) {
                BinOp::Sub
            } else {
                break;
            };
            let rhs = self.parse_mul()?;
            expr = Expr::Binary(Box::new(expr), op, Box::new(rhs));
        }
        Ok(expr)
    }

    fn parse_mul(&mut self) -> Result<Expr, VmError> {
        let mut expr = self.parse_unary()?;
        loop {
            let op = if self.eat(&Tok::Star) {
                BinOp::Mul
            } else if self.eat(&Tok::FloorDiv) {
                BinOp::FloorDiv
            } else if self.eat(&Tok::Percent) {
                BinOp::Mod
            } else {
                break;
            };
            let rhs = self.parse_unary()?;
            expr = Expr::Binary(Box::new(expr), op, Box::new(rhs));
        }
        Ok(expr)
    }

    fn parse_unary(&mut self) -> Result<Expr, VmError> {
        if self.eat(&Tok::Minus) {
            Ok(Expr::Unary(UnOp::Neg, Box::new(self.parse_unary()?)))
        } else if self.eat(&Tok::Not) {
            Ok(Expr::Unary(UnOp::Not, Box::new(self.parse_unary()?)))
        } else if self.eat(&Tok::Len) {
            Ok(Expr::Unary(UnOp::Len, Box::new(self.parse_unary()?)))
        } else {
            self.parse_primary()
        }
    }

    fn parse_primary(&mut self) -> Result<Expr, VmError> {
        match self.bump() {
            Tok::Nil => Ok(Expr::Nil),
            Tok::True => Ok(Expr::Bool(true)),
            Tok::False => Ok(Expr::Bool(false)),
            Tok::Int(n) => Ok(Expr::Int(n)),
            Tok::Str(s) => Ok(Expr::Str(s)),
            Tok::Ident(name) => {
                if self.matches(&Tok::LParen) {
                    Ok(Expr::Call(name, self.parse_args()?))
                } else {
                    Ok(Expr::Var(name))
                }
            }
            Tok::LParen => {
                let e = self.parse_expr()?;
                self.expect(&Tok::RParen)?;
                Ok(e)
            }
            _ => Err(VmError::Syntax),
        }
    }

    fn parse_args(&mut self) -> Result<Vec<Expr>, VmError> {
        self.expect(&Tok::LParen)?;
        let mut args = Vec::new();
        if !self.eat(&Tok::RParen) {
            args.push(self.parse_expr()?);
            while self.eat(&Tok::Comma) {
                args.push(self.parse_expr()?);
            }
            self.expect(&Tok::RParen)?;
        }
        Ok(args)
    }
}

fn same_variant(a: &Tok, b: &Tok) -> bool {
    std::mem::discriminant(a) == std::mem::discriminant(b)
}

struct Env {
    scopes: Vec<HashMap<String, Value>>,
    depth: usize,
}

impl Env {
    fn new(depth: usize) -> Self {
        Self {
            scopes: vec![HashMap::new()],
            depth,
        }
    }

    fn push(&mut self) {
        self.scopes.push(HashMap::new());
    }

    fn pop(&mut self) {
        let _ = self.scopes.pop();
    }

    fn define(&mut self, name: String, value: Value) {
        if let Some(scope) = self.scopes.last_mut() {
            scope.insert(name, value);
        }
    }

    fn assign(&mut self, st: &mut State, name: &str, value: Value) {
        for scope in self.scopes.iter_mut().rev() {
            if scope.contains_key(name) {
                scope.insert(name.to_owned(), value);
                return;
            }
        }
        st.globals.insert(name.to_owned(), value);
    }

    fn get(&self, st: &State, name: &str) -> Value {
        for scope in self.scopes.iter().rev() {
            if let Some(v) = scope.get(name) {
                return v.clone();
            }
        }
        st.globals.get(name).cloned().unwrap_or(Value::Nil)
    }
}

enum Flow {
    Normal,
    Return(Value),
}

fn exec_block(st: &mut State, env: &mut Env, body: &[Stmt]) -> Result<Flow, VmError> {
    for stmt in body {
        match exec_stmt(st, env, stmt)? {
            Flow::Normal => {}
            ret @ Flow::Return(_) => return Ok(ret),
        }
    }
    Ok(Flow::Normal)
}

fn exec_scoped_block(st: &mut State, env: &mut Env, body: &[Stmt]) -> Result<Flow, VmError> {
    env.push();
    let result = exec_block(st, env, body);
    env.pop();
    result
}

fn exec_stmt(st: &mut State, env: &mut Env, stmt: &Stmt) -> Result<Flow, VmError> {
    match stmt {
        Stmt::Local(names, exprs) => {
            let vals = eval_list(st, env, exprs)?;
            for (idx, name) in names.iter().enumerate() {
                env.define(name.clone(), vals.get(idx).cloned().unwrap_or(Value::Nil));
            }
            Ok(Flow::Normal)
        }
        Stmt::Assign(names, exprs) => {
            let vals = eval_list(st, env, exprs)?;
            for (idx, name) in names.iter().enumerate() {
                env.assign(st, name, vals.get(idx).cloned().unwrap_or(Value::Nil));
            }
            Ok(Flow::Normal)
        }
        Stmt::If {
            branches,
            else_body,
        } => {
            for (cond, body) in branches {
                if eval_expr(st, env, cond)?.truthy() {
                    return exec_scoped_block(st, env, body);
                }
            }
            if else_body.is_empty() {
                Ok(Flow::Normal)
            } else {
                exec_scoped_block(st, env, else_body)
            }
        }
        Stmt::While(cond, body) => {
            while eval_expr(st, env, cond)?.truthy() {
                match exec_scoped_block(st, env, body)? {
                    Flow::Normal => {}
                    ret @ Flow::Return(_) => return Ok(ret),
                }
            }
            Ok(Flow::Normal)
        }
        Stmt::For {
            name,
            start,
            end,
            step,
            body,
        } => {
            let mut i = expect_int(eval_expr(st, env, start)?)?;
            let limit = expect_int(eval_expr(st, env, end)?)?;
            let step_value = match step {
                Some(e) => expect_int(eval_expr(st, env, e)?)?,
                None => 1,
            };
            if step_value == 0 {
                return Err(VmError::Runtime);
            }
            env.push();
            loop {
                let keep_going = if step_value > 0 {
                    i <= limit
                } else {
                    i >= limit
                };
                if !keep_going {
                    break;
                }
                env.define(name.clone(), Value::Int(i));
                match exec_block(st, env, body)? {
                    Flow::Normal => {}
                    ret @ Flow::Return(_) => {
                        env.pop();
                        return Ok(ret);
                    }
                }
                i = i.checked_add(step_value).ok_or(VmError::Runtime)?;
            }
            env.pop();
            Ok(Flow::Normal)
        }
        Stmt::Function(name, params, body) => {
            st.globals.insert(
                name.clone(),
                Value::Function(Function {
                    params: params.clone(),
                    body: body.clone(),
                }),
            );
            Ok(Flow::Normal)
        }
        Stmt::Call(expr) => {
            let _ = eval_expr(st, env, expr)?;
            Ok(Flow::Normal)
        }
        Stmt::Return(expr) => {
            let value = match expr {
                Some(e) => eval_expr(st, env, e)?,
                None => Value::Nil,
            };
            Ok(Flow::Return(value))
        }
        Stmt::Do(body) => exec_scoped_block(st, env, body),
    }
}

fn eval_list(st: &mut State, env: &mut Env, exprs: &[Expr]) -> Result<Vec<Value>, VmError> {
    exprs.iter().map(|e| eval_expr(st, env, e)).collect()
}

fn eval_expr(st: &mut State, env: &mut Env, expr: &Expr) -> Result<Value, VmError> {
    match expr {
        Expr::Nil => Ok(Value::Nil),
        Expr::Bool(b) => Ok(Value::Bool(*b)),
        Expr::Int(n) => Ok(Value::Int(*n)),
        Expr::Str(s) => Ok(Value::Str(s.clone())),
        Expr::Var(name) => Ok(env.get(st, name)),
        Expr::Unary(op, inner) => {
            let v = eval_expr(st, env, inner)?;
            match op {
                UnOp::Neg => Ok(Value::Int(
                    expect_int(v)?.checked_neg().ok_or(VmError::Runtime)?,
                )),
                UnOp::Not => Ok(Value::Bool(!v.truthy())),
                UnOp::Len => match v {
                    Value::Str(s) => Ok(Value::Int(s.len() as i64)),
                    _ => Err(VmError::Runtime),
                },
            }
        }
        Expr::Binary(left, BinOp::And, right) => {
            let l = eval_expr(st, env, left)?;
            if !l.truthy() {
                Ok(l)
            } else {
                eval_expr(st, env, right)
            }
        }
        Expr::Binary(left, BinOp::Or, right) => {
            let l = eval_expr(st, env, left)?;
            if l.truthy() {
                Ok(l)
            } else {
                eval_expr(st, env, right)
            }
        }
        Expr::Binary(left, op, right) => {
            let l = eval_expr(st, env, left)?;
            let r = eval_expr(st, env, right)?;
            eval_binary(l, *op, r)
        }
        Expr::Call(name, args) => {
            let vals = eval_list(st, env, args)?;
            let func = env.get(st, name);
            match func {
                Value::Function(f) => call_function(st, f, vals, env.depth + 1),
                _ => Err(VmError::Runtime),
            }
        }
    }
}

fn eval_binary(l: Value, op: BinOp, r: Value) -> Result<Value, VmError> {
    match op {
        BinOp::Add => Ok(Value::Int(
            expect_int(l)?
                .checked_add(expect_int(r)?)
                .ok_or(VmError::Runtime)?,
        )),
        BinOp::Sub => Ok(Value::Int(
            expect_int(l)?
                .checked_sub(expect_int(r)?)
                .ok_or(VmError::Runtime)?,
        )),
        BinOp::Mul => Ok(Value::Int(
            expect_int(l)?
                .checked_mul(expect_int(r)?)
                .ok_or(VmError::Runtime)?,
        )),
        BinOp::FloorDiv => {
            let a = expect_int(l)?;
            let b = expect_int(r)?;
            Ok(Value::Int(floor_div(a, b)?))
        }
        BinOp::Mod => {
            let a = expect_int(l)?;
            let b = expect_int(r)?;
            Ok(Value::Int(
                a.checked_sub(floor_div(a, b)?.checked_mul(b).ok_or(VmError::Runtime)?)
                    .ok_or(VmError::Runtime)?,
            ))
        }
        BinOp::Concat => {
            let mut s = l.to_concat_string()?;
            s.push_str(&r.to_concat_string()?);
            if s.len() > 127 {
                return Err(VmError::Runtime);
            }
            Ok(Value::Str(s))
        }
        BinOp::Eq => Ok(Value::Bool(l == r)),
        BinOp::Ne => Ok(Value::Bool(l != r)),
        BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge => compare_values(l, op, r),
        BinOp::And | BinOp::Or => Err(VmError::Runtime),
    }
}

fn compare_values(l: Value, op: BinOp, r: Value) -> Result<Value, VmError> {
    let result = match (l, r) {
        (Value::Int(a), Value::Int(b)) => match op {
            BinOp::Lt => a < b,
            BinOp::Le => a <= b,
            BinOp::Gt => a > b,
            BinOp::Ge => a >= b,
            _ => return Err(VmError::Runtime),
        },
        (Value::Str(a), Value::Str(b)) => match op {
            BinOp::Lt => a < b,
            BinOp::Le => a <= b,
            BinOp::Gt => a > b,
            BinOp::Ge => a >= b,
            _ => return Err(VmError::Runtime),
        },
        _ => return Err(VmError::Runtime),
    };
    Ok(Value::Bool(result))
}

fn expect_int(v: Value) -> Result<i64, VmError> {
    match v {
        Value::Int(n) => Ok(n),
        _ => Err(VmError::Runtime),
    }
}

fn floor_div(a: i64, b: i64) -> Result<i64, VmError> {
    if b == 0 {
        return Err(VmError::Runtime);
    }
    let q = a / b;
    let rem = a % b;
    if rem != 0 && ((rem > 0) != (b > 0)) {
        q.checked_sub(1).ok_or(VmError::Runtime)
    } else {
        Ok(q)
    }
}

fn call_function(
    st: &mut State,
    func: Function,
    args: Vec<Value>,
    depth: usize,
) -> Result<Value, VmError> {
    if depth > MAX_RECURSION {
        return Err(VmError::Stack);
    }
    let mut env = Env::new(depth);
    for (idx, param) in func.params.iter().enumerate() {
        env.define(param.clone(), args.get(idx).cloned().unwrap_or(Value::Nil));
    }
    match exec_block(st, &mut env, &func.body)? {
        Flow::Normal => Ok(Value::Nil),
        Flow::Return(v) => Ok(v),
    }
}

fn run_chunk(st: &mut State, chunk_id: i32) -> Result<Value, i32> {
    if chunk_id < 0 {
        return Err(ERR_BAD_CHUNK);
    }
    let chunk = st
        .chunks
        .get(chunk_id as usize)
        .cloned()
        .ok_or(ERR_BAD_CHUNK)?;
    let mut env = Env::new(0);
    match exec_block(st, &mut env, &chunk.body).map_err(VmError::code)? {
        Flow::Normal => Ok(Value::Nil),
        Flow::Return(v) => Ok(v),
    }
}

#[no_mangle]
pub extern "C" fn lvm_reset() {
    let mut st = state().lock().unwrap_or_else(|e| e.into_inner());
    *st = State::default();
}

#[no_mangle]
pub extern "C" fn lvm_compile(source: *const c_char) -> i32 {
    let src = match c_string(source) {
        Ok(s) => s,
        Err(code) => {
            let mut st = state().lock().unwrap_or_else(|e| e.into_inner());
            set_error(&mut st, code);
            return -1;
        }
    };
    let chunk = match Parser::parse(&src) {
        Ok(c) => c,
        Err(e) => {
            let mut st = state()
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            set_error(&mut st, e.code());
            return -1;
        }
    };
    let mut st = state().lock().unwrap_or_else(|e| e.into_inner());
    let id = st.chunks.len() as i32;
    st.chunks.push(chunk);
    set_error(&mut st, 0);
    id
}

#[no_mangle]
pub extern "C" fn lvm_exec(chunk_id: i32) -> i32 {
    let mut st = state().lock().unwrap_or_else(|e| e.into_inner());
    match run_chunk(&mut st, chunk_id) {
        Ok(v) => {
            st.last_result = v;
            set_error(&mut st, 0);
            1
        }
        Err(code) => {
            set_error(&mut st, code);
            0
        }
    }
}

#[no_mangle]
pub extern "C" fn lvm_get_result(out: *mut i64) -> i32 {
    if out.is_null() {
        let mut st = state().lock().unwrap_or_else(|e| e.into_inner());
        set_error(&mut st, ERR_BAD_POINTER);
        return 0;
    }
    let mut st = state().lock().unwrap_or_else(|e| e.into_inner());
    match st.last_result {
        Value::Int(n) => {
            unsafe {
                *out = n;
            }
            set_error(&mut st, 0);
            1
        }
        _ => {
            set_error(&mut st, 0);
            0
        }
    }
}

#[no_mangle]
pub extern "C" fn lvm_set_global(name: *const c_char, value: i64) -> i32 {
    let name = match c_string(name) {
        Ok(s) => s,
        Err(code) => {
            let mut st = state().lock().unwrap_or_else(|e| e.into_inner());
            set_error(&mut st, code);
            return 0;
        }
    };
    let mut st = state().lock().unwrap_or_else(|e| e.into_inner());
    st.globals.insert(name, Value::Int(value));
    set_error(&mut st, 0);
    1
}

#[no_mangle]
pub extern "C" fn lvm_get_global(name: *const c_char, out: *mut i64) -> i32 {
    if out.is_null() {
        let mut st = state().lock().unwrap_or_else(|e| e.into_inner());
        set_error(&mut st, ERR_BAD_POINTER);
        return 0;
    }
    let name = match c_string(name) {
        Ok(s) => s,
        Err(code) => {
            let mut st = state().lock().unwrap_or_else(|e| e.into_inner());
            set_error(&mut st, code);
            return 0;
        }
    };
    let mut st = state().lock().unwrap_or_else(|e| e.into_inner());
    let ret = match st.globals.get(&name) {
        Some(Value::Int(n)) => {
            unsafe {
                *out = *n;
            }
            1
        }
        _ => 0,
    };
    set_error(&mut st, 0);
    ret
}

#[no_mangle]
pub extern "C" fn lvm_get_global_str(name: *const c_char, buf: *mut c_char, max_len: i32) -> i32 {
    if buf.is_null() || max_len <= 0 {
        let mut st = state().lock().unwrap_or_else(|e| e.into_inner());
        set_error(&mut st, ERR_BAD_POINTER);
        return 0;
    }
    let name = match c_string(name) {
        Ok(s) => s,
        Err(code) => {
            let mut st = state().lock().unwrap_or_else(|e| e.into_inner());
            set_error(&mut st, code);
            return 0;
        }
    };
    let mut st = state().lock().unwrap_or_else(|e| e.into_inner());
    let ret = match st.globals.get(&name) {
        Some(Value::Str(s)) => {
            let bytes = s.as_bytes();
            let copy_len = bytes.len().min((max_len - 1) as usize);
            unsafe {
                std::ptr::copy_nonoverlapping(bytes.as_ptr(), buf.cast::<u8>(), copy_len);
                *buf.add(copy_len) = 0;
            }
            1
        }
        _ => 0,
    };
    set_error(&mut st, 0);
    ret
}

#[no_mangle]
pub extern "C" fn lvm_call(
    chunk_id: i32,
    func_name: *const c_char,
    nargs: i32,
    args: *const i64,
    out: *mut i64,
) -> i32 {
    if out.is_null() || nargs < 0 || (nargs > 0 && args.is_null()) {
        let mut st = state().lock().unwrap_or_else(|e| e.into_inner());
        set_error(&mut st, ERR_BAD_POINTER);
        return 0;
    }
    let name = match c_string(func_name) {
        Ok(s) => s,
        Err(code) => {
            let mut st = state().lock().unwrap_or_else(|e| e.into_inner());
            set_error(&mut st, code);
            return 0;
        }
    };
    let mut vals = Vec::new();
    for idx in 0..nargs as usize {
        let n = unsafe { *args.add(idx) };
        vals.push(Value::Int(n));
    }
    let mut st = state().lock().unwrap_or_else(|e| e.into_inner());
    if chunk_id < 0 || chunk_id as usize >= st.chunks.len() {
        set_error(&mut st, ERR_BAD_CHUNK);
        return 0;
    }
    let func = match st.globals.get(&name).cloned() {
        Some(Value::Function(f)) => f,
        _ => {
            set_error(&mut st, ERR_BAD_FUNCTION);
            return 0;
        }
    };
    match call_function(&mut st, func, vals, 1) {
        Ok(Value::Int(n)) => {
            unsafe {
                *out = n;
            }
            set_error(&mut st, 0);
            1
        }
        Ok(_) => {
            set_error(&mut st, ERR_RUNTIME);
            0
        }
        Err(e) => {
            set_error(&mut st, e.code());
            0
        }
    }
}

#[no_mangle]
pub extern "C" fn lvm_typeof_global(name: *const c_char) -> i32 {
    let name = match c_string(name) {
        Ok(s) => s,
        Err(code) => {
            let mut st = state().lock().unwrap_or_else(|e| e.into_inner());
            set_error(&mut st, code);
            return 0;
        }
    };
    let mut st = state().lock().unwrap_or_else(|e| e.into_inner());
    let code = st.globals.get(&name).map_or(0, Value::type_code);
    set_error(&mut st, 0);
    code
}

#[no_mangle]
pub extern "C" fn lvm_last_error() -> i32 {
    state().lock().unwrap_or_else(|e| e.into_inner()).last_error
}
