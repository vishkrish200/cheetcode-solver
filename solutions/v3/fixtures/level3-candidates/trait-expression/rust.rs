use std::collections::HashMap;
use std::ffi::CStr;
use std::os::raw::c_char;
use std::sync::{LazyLock, Mutex};

#[repr(C)]
pub struct ExprAuditView {
    pub exists: i32,
    pub kind: i32,
    pub string_evaluable: i32,
    pub match_evaluable: i32,
    pub constant_expr: i32,
    pub namespace_error: i32,
    pub matched: i32,
    pub output_string_id: i32,
}

const KIND_LITERAL: i32 = 1;
const KIND_VAR: i32 = 2;
const KIND_EMAIL_LOCAL: i32 = 3;
const KIND_REPLACE: i32 = 4;
const KIND_MATCH: i32 = 5;

const ERR_NONE: i32 = 0;
const ERR_DUPLICATE_ID: i32 = 1;
const ERR_UNKNOWN_EXPR: i32 = 2;
const ERR_INVALID_KIND: i32 = 3;
const ERR_NULL_POINTER: i32 = 4;
const ERR_UNKNOWN_VAR: i32 = 5;
const ERR_UNKNOWN_STRING: i32 = 6;
const ERR_NAMESPACE: i32 = 7;
const ERR_REGEX: i32 = 8;

static STATE: LazyLock<Mutex<State>> = LazyLock::new(|| Mutex::new(State::new()));

#[derive(Clone)]
struct VarRecord {
    namespace_kind: i32,
    string_id: i32,
}

#[derive(Clone)]
struct ExprRecord {
    kind: i32,
    string_id: i32,
    var_id: i32,
    child_id: i32,
    input_id: i32,
    pattern_id: i32,
    replacement_id: i32,
    negate: bool,
    has_input: bool,
    constant_expr: bool,
    namespace_error: bool,
    matched: bool,
    output_string_id: i32,
}

impl ExprRecord {
    fn new(kind: i32) -> Self {
        Self {
            kind,
            string_id: -1,
            var_id: -1,
            child_id: -1,
            input_id: -1,
            pattern_id: -1,
            replacement_id: -1,
            negate: false,
            has_input: false,
            constant_expr: false,
            namespace_error: false,
            matched: false,
            output_string_id: -1,
        }
    }
}

struct State {
    strings: HashMap<i32, String>,
    string_to_id: HashMap<String, i32>,
    vars: HashMap<i32, VarRecord>,
    exprs: HashMap<i32, ExprRecord>,
    last_error: i32,
    next_auto_string_id: i32,
}

impl State {
    fn new() -> Self {
        Self {
            strings: HashMap::new(),
            string_to_id: HashMap::new(),
            vars: HashMap::new(),
            exprs: HashMap::new(),
            last_error: ERR_NONE,
            next_auto_string_id: 1,
        }
    }

    fn reset(&mut self) {
        *self = Self::new();
    }

    fn set_error(&mut self, err: i32) {
        self.last_error = err;
    }

    fn add_string_with_id(&mut self, string_id: i32, value: String) -> i32 {
        if self.strings.contains_key(&string_id) {
            self.set_error(ERR_DUPLICATE_ID);
            return 0;
        }
        self.string_to_id.entry(value.clone()).or_insert(string_id);
        self.strings.insert(string_id, value);
        if string_id >= self.next_auto_string_id {
            self.next_auto_string_id = string_id + 1;
        }
        self.set_error(ERR_NONE);
        1
    }

    fn intern_string(&mut self, value: &str) -> Result<i32, i32> {
        if let Some(id) = self.string_to_id.get(value).copied() {
            return Ok(id);
        }
        while self.strings.contains_key(&self.next_auto_string_id) {
            self.next_auto_string_id += 1;
        }
        let id = self.next_auto_string_id;
        self.next_auto_string_id += 1;
        self.strings.insert(id, value.to_string());
        self.string_to_id.insert(value.to_string(), id);
        Ok(id)
    }

    fn add_expr(&mut self, expr_id: i32, record: ExprRecord) -> i32 {
        if self.exprs.contains_key(&expr_id) {
            self.set_error(ERR_DUPLICATE_ID);
            return 0;
        }
        self.exprs.insert(expr_id, record);
        self.set_error(ERR_NONE);
        1
    }
}

fn valid_namespace(namespace_kind: i32) -> bool {
    matches!(namespace_kind, 1..=3)
}

fn bool_i32(value: bool) -> i32 {
    if value {
        1
    } else {
        0
    }
}

fn default_audit_view() -> ExprAuditView {
    ExprAuditView {
        exists: 0,
        kind: 0,
        string_evaluable: 0,
        match_evaluable: 0,
        constant_expr: 0,
        namespace_error: 0,
        matched: 0,
        output_string_id: -1,
    }
}

fn expr_kind(state: &State, expr_id: i32) -> Result<i32, i32> {
    state
        .exprs
        .get(&expr_id)
        .map(|expr| expr.kind)
        .ok_or(ERR_UNKNOWN_EXPR)
}

fn eval_string_inner(state: &mut State, expr_id: i32) -> Result<i32, i32> {
    let expr = state.exprs.get(&expr_id).cloned().ok_or(ERR_UNKNOWN_EXPR)?;
    if expr.kind == KIND_MATCH {
        return Err(ERR_INVALID_KIND);
    }
    if expr.output_string_id >= 0 && !expr.namespace_error {
        return Ok(expr.output_string_id);
    }

    match expr.kind {
        KIND_LITERAL => {
            if !state.strings.contains_key(&expr.string_id) {
                return Err(ERR_UNKNOWN_STRING);
            }
            if let Some(current) = state.exprs.get_mut(&expr_id) {
                current.output_string_id = expr.string_id;
                current.namespace_error = false;
            }
            Ok(expr.string_id)
        }
        KIND_VAR => {
            let var = state.vars.get(&expr.var_id).cloned().ok_or(ERR_UNKNOWN_VAR)?;
            if !state.strings.contains_key(&var.string_id) {
                return Err(ERR_UNKNOWN_STRING);
            }
            if let Some(current) = state.exprs.get_mut(&expr_id) {
                current.output_string_id = var.string_id;
                current.namespace_error = !valid_namespace(var.namespace_kind);
            }
            if !valid_namespace(var.namespace_kind) {
                return Err(ERR_NAMESPACE);
            }
            Ok(var.string_id)
        }
        KIND_EMAIL_LOCAL => {
            let child_id = match eval_string_inner(state, expr.child_id) {
                Ok(id) => id,
                Err(err) => {
                    propagate_namespace_error(state, expr_id, expr.child_id);
                    return Err(err);
                }
            };
            if child_has_namespace_error(state, expr.child_id) {
                mark_namespace_error(state, expr_id);
                return Err(ERR_NAMESPACE);
            }
            let value = state
                .strings
                .get(&child_id)
                .cloned()
                .ok_or(ERR_UNKNOWN_STRING)?;
            let local = value.split_once('@').map_or(value.as_str(), |(left, _)| left);
            let output_id = if local == value {
                child_id
            } else {
                state.intern_string(local)?
            };
            if let Some(current) = state.exprs.get_mut(&expr_id) {
                current.output_string_id = output_id;
                current.namespace_error = false;
            }
            Ok(output_id)
        }
        KIND_REPLACE => {
            let input_id = match eval_string_inner(state, expr.input_id) {
                Ok(id) => id,
                Err(err) => {
                    propagate_namespace_error(state, expr_id, expr.input_id);
                    return Err(err);
                }
            };
            if child_has_namespace_error(state, expr.input_id) {
                mark_namespace_error(state, expr_id);
                return Err(ERR_NAMESPACE);
            }
            let input = state
                .strings
                .get(&input_id)
                .cloned()
                .ok_or(ERR_UNKNOWN_STRING)?;
            let pattern = state
                .strings
                .get(&expr.pattern_id)
                .cloned()
                .ok_or(ERR_UNKNOWN_STRING)?;
            let replacement = state
                .strings
                .get(&expr.replacement_id)
                .cloned()
                .ok_or(ERR_UNKNOWN_STRING)?;
            let replaced = regex_replace_all(&input, &pattern, &replacement)?;
            let output_id = state.intern_string(&replaced)?;
            if let Some(current) = state.exprs.get_mut(&expr_id) {
                current.output_string_id = output_id;
                current.namespace_error = false;
            }
            Ok(output_id)
        }
        _ => Err(ERR_INVALID_KIND),
    }
}

fn eval_match_inner(state: &mut State, expr_id: i32, matcher_string_id: i32) -> Result<bool, i32> {
    let expr = state.exprs.get(&expr_id).cloned().ok_or(ERR_UNKNOWN_EXPR)?;
    if expr.kind != KIND_MATCH {
        return Err(ERR_INVALID_KIND);
    }

    let input_id = if expr.has_input {
        match eval_string_inner(state, expr.input_id) {
            Ok(id) => id,
            Err(err) => {
                propagate_namespace_error(state, expr_id, expr.input_id);
                return Err(err);
            }
        }
    } else {
        matcher_string_id
    };

    if expr.has_input && child_has_namespace_error(state, expr.input_id) {
        mark_namespace_error(state, expr_id);
        return Err(ERR_NAMESPACE);
    }

    let input = state
        .strings
        .get(&input_id)
        .cloned()
        .ok_or(ERR_UNKNOWN_STRING)?;
    let pattern = state
        .strings
        .get(&expr.pattern_id)
        .cloned()
        .ok_or(ERR_UNKNOWN_STRING)?;
    let raw_match = regex_is_match(&input, &pattern)?;
    let matched = if expr.negate { !raw_match } else { raw_match };
    if let Some(current) = state.exprs.get_mut(&expr_id) {
        current.matched = matched;
        current.namespace_error = false;
    }
    Ok(matched)
}

fn mark_namespace_error(state: &mut State, expr_id: i32) {
    if let Some(expr) = state.exprs.get_mut(&expr_id) {
        expr.namespace_error = true;
    }
}

fn child_has_namespace_error(state: &State, expr_id: i32) -> bool {
    state
        .exprs
        .get(&expr_id)
        .map(|expr| expr.namespace_error)
        .unwrap_or(false)
}

fn propagate_namespace_error(state: &mut State, expr_id: i32, child_id: i32) {
    if child_has_namespace_error(state, child_id) {
        mark_namespace_error(state, expr_id);
    }
}

#[derive(Clone)]
enum Atom {
    Literal(char),
    Any,
    Class { negated: bool, ranges: Vec<(char, char)> },
    End,
}

#[derive(Clone, Copy)]
enum Quantifier {
    One,
    ZeroOrMore,
    OneOrMore,
    ZeroOrOne,
}

#[derive(Clone)]
struct Token {
    atom: Atom,
    quantifier: Quantifier,
}

#[derive(Clone)]
struct CompiledPattern {
    anchored: bool,
    alternatives: Vec<Vec<Token>>,
}

fn regex_is_match(input: &str, pattern: &str) -> Result<bool, i32> {
    let compiled = compile_pattern(pattern)?;
    let chars: Vec<char> = input.chars().collect();
    Ok(find_match(&chars, &compiled, 0).is_some())
}

fn regex_replace_all(input: &str, pattern: &str, replacement: &str) -> Result<String, i32> {
    let compiled = compile_pattern(pattern)?;
    let chars: Vec<char> = input.chars().collect();
    let mut out = String::new();
    let mut cursor = 0;

    while cursor <= chars.len() {
        let found = find_match(&chars, &compiled, cursor);
        let Some((start, end)) = found else {
            out.extend(chars[cursor..].iter());
            break;
        };

        out.extend(chars[cursor..start].iter());
        out.push_str(replacement);
        if end == start {
            if end >= chars.len() {
                break;
            }
            out.push(chars[end]);
            cursor = end + 1;
        } else {
            cursor = end;
        }
    }

    Ok(out)
}

fn find_match(chars: &[char], pattern: &CompiledPattern, from: usize) -> Option<(usize, usize)> {
    let start = if pattern.anchored { 0 } else { from };
    if pattern.anchored && from > 0 {
        return None;
    }

    for pos in start..=chars.len() {
        if pos < from {
            continue;
        }
        for alternative in &pattern.alternatives {
            if let Some(end) = match_tokens(alternative, chars, 0, pos) {
                return Some((pos, end));
            }
        }
        if pattern.anchored {
            break;
        }
    }
    None
}

fn match_tokens(tokens: &[Token], chars: &[char], token_index: usize, pos: usize) -> Option<usize> {
    if token_index == tokens.len() {
        return Some(pos);
    }

    let token = &tokens[token_index];
    match token.quantifier {
        Quantifier::One => {
            let next = match_atom_once(&token.atom, chars, pos)?;
            match_tokens(tokens, chars, token_index + 1, next)
        }
        Quantifier::ZeroOrMore => {
            let positions = repeated_positions(&token.atom, chars, pos, 0);
            for next in positions.into_iter().rev() {
                if let Some(end) = match_tokens(tokens, chars, token_index + 1, next) {
                    return Some(end);
                }
            }
            None
        }
        Quantifier::OneOrMore => {
            let positions = repeated_positions(&token.atom, chars, pos, 1);
            for next in positions.into_iter().rev() {
                if let Some(end) = match_tokens(tokens, chars, token_index + 1, next) {
                    return Some(end);
                }
            }
            None
        }
        Quantifier::ZeroOrOne => {
            if let Some(next) = match_atom_once(&token.atom, chars, pos) {
                if let Some(end) = match_tokens(tokens, chars, token_index + 1, next) {
                    return Some(end);
                }
            }
            match_tokens(tokens, chars, token_index + 1, pos)
        }
    }
}

fn repeated_positions(atom: &Atom, chars: &[char], pos: usize, min_count: usize) -> Vec<usize> {
    let mut positions = Vec::new();
    let mut cursor = pos;
    let mut count = 0;
    if min_count == 0 {
        positions.push(cursor);
    }
    while let Some(next) = match_atom_once(atom, chars, cursor) {
        if next == cursor {
            break;
        }
        cursor = next;
        count += 1;
        if count >= min_count {
            positions.push(cursor);
        }
    }
    positions
}

fn match_atom_once(atom: &Atom, chars: &[char], pos: usize) -> Option<usize> {
    match atom {
        Atom::End => {
            if pos == chars.len() {
                Some(pos)
            } else {
                None
            }
        }
        Atom::Any => {
            if pos < chars.len() {
                Some(pos + 1)
            } else {
                None
            }
        }
        Atom::Literal(expected) => {
            if chars.get(pos) == Some(expected) {
                Some(pos + 1)
            } else {
                None
            }
        }
        Atom::Class { negated, ranges } => {
            let actual = *chars.get(pos)?;
            let contained = ranges
                .iter()
                .any(|(start, end)| *start <= actual && actual <= *end);
            if contained ^ *negated {
                Some(pos + 1)
            } else {
                None
            }
        }
    }
}

fn compile_pattern(pattern: &str) -> Result<CompiledPattern, i32> {
    let parts = split_alternatives(pattern)?;
    let mut anchored = false;
    let mut alternatives = Vec::new();

    for part in parts {
        let (part_anchored, tokens) = compile_sequence(&part)?;
        anchored |= part_anchored;
        alternatives.push(tokens);
    }

    if alternatives.is_empty() {
        alternatives.push(Vec::new());
    }

    Ok(CompiledPattern {
        anchored,
        alternatives,
    })
}

fn split_alternatives(pattern: &str) -> Result<Vec<String>, i32> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut escaped = false;
    let mut in_class = false;

    for ch in pattern.chars() {
        if escaped {
            current.push(ch);
            escaped = false;
            continue;
        }
        if ch == '\\' {
            current.push(ch);
            escaped = true;
            continue;
        }
        if ch == '[' {
            in_class = true;
            current.push(ch);
            continue;
        }
        if ch == ']' {
            in_class = false;
            current.push(ch);
            continue;
        }
        if ch == '|' && !in_class {
            parts.push(current);
            current = String::new();
            continue;
        }
        current.push(ch);
    }

    if escaped || in_class {
        return Err(ERR_REGEX);
    }
    parts.push(current);
    Ok(parts)
}

fn compile_sequence(pattern: &str) -> Result<(bool, Vec<Token>), i32> {
    let chars: Vec<char> = pattern.chars().collect();
    let mut index = 0;
    let mut anchored = false;
    let mut tokens = Vec::new();

    if chars.first() == Some(&'^') {
        anchored = true;
        index = 1;
    }

    while index < chars.len() {
        let (atom, next_index) = parse_atom(&chars, index)?;
        index = next_index;
        let quantifier = if let Some(ch) = chars.get(index) {
            match *ch {
                '*' => {
                    index += 1;
                    Quantifier::ZeroOrMore
                }
                '+' => {
                    index += 1;
                    Quantifier::OneOrMore
                }
                '?' => {
                    index += 1;
                    Quantifier::ZeroOrOne
                }
                _ => Quantifier::One,
            }
        } else {
            Quantifier::One
        };
        tokens.push(Token { atom, quantifier });
    }

    Ok((anchored, tokens))
}

fn parse_atom(chars: &[char], index: usize) -> Result<(Atom, usize), i32> {
    let ch = *chars.get(index).ok_or(ERR_REGEX)?;
    match ch {
        '.' => Ok((Atom::Any, index + 1)),
        '$' if index + 1 == chars.len() => Ok((Atom::End, index + 1)),
        '\\' => {
            let escaped = *chars.get(index + 1).ok_or(ERR_REGEX)?;
            Ok((Atom::Literal(escaped), index + 2))
        }
        '[' => parse_class(chars, index + 1),
        '(' | ')' | '{' | '}' => Err(ERR_REGEX),
        '*' | '+' | '?' => Err(ERR_REGEX),
        _ => Ok((Atom::Literal(ch), index + 1)),
    }
}

fn parse_class(chars: &[char], mut index: usize) -> Result<(Atom, usize), i32> {
    let mut negated = false;
    if chars.get(index) == Some(&'^') {
        negated = true;
        index += 1;
    }

    let mut ranges = Vec::new();
    let mut previous: Option<char> = None;
    let mut closed = false;

    while index < chars.len() {
        let ch = chars[index];
        if ch == ']' {
            if let Some(prev) = previous.take() {
                ranges.push((prev, prev));
            }
            closed = true;
            index += 1;
            break;
        }

        let actual = if ch == '\\' {
            index += 1;
            *chars.get(index).ok_or(ERR_REGEX)?
        } else {
            ch
        };

        if chars.get(index + 1) == Some(&'-') && chars.get(index + 2) != Some(&']') {
            if let Some(prev) = previous.take() {
                ranges.push((prev, prev));
            }
            let end_index = index + 2;
            let end = if chars.get(end_index) == Some(&'\\') {
                *chars.get(end_index + 1).ok_or(ERR_REGEX)?
            } else {
                *chars.get(end_index).ok_or(ERR_REGEX)?
            };
            let final_index = if chars.get(end_index) == Some(&'\\') {
                end_index + 2
            } else {
                end_index + 1
            };
            if actual > end {
                return Err(ERR_REGEX);
            }
            ranges.push((actual, end));
            index = final_index;
        } else {
            if let Some(prev) = previous.replace(actual) {
                ranges.push((prev, prev));
            }
            index += 1;
        }
    }

    if !closed || ranges.is_empty() {
        return Err(ERR_REGEX);
    }

    Ok((Atom::Class { negated, ranges }, index))
}

#[no_mangle]
pub extern "C" fn expr_reset() {
    let mut state = STATE.lock().unwrap();
    state.reset();
}

#[no_mangle]
pub extern "C" fn expr_register_string(string_id: i32, value: *const c_char) -> i32 {
    let mut state = STATE.lock().unwrap();
    if value.is_null() {
        state.set_error(ERR_NULL_POINTER);
        return 0;
    }
    let value = unsafe { CStr::from_ptr(value) }
        .to_string_lossy()
        .into_owned();
    state.add_string_with_id(string_id, value)
}

#[no_mangle]
pub extern "C" fn expr_register_var(var_id: i32, namespace_kind: i32, string_id: i32) -> i32 {
    let mut state = STATE.lock().unwrap();
    if state.vars.contains_key(&var_id) {
        state.set_error(ERR_DUPLICATE_ID);
        return 0;
    }
    if !state.strings.contains_key(&string_id) {
        state.set_error(ERR_UNKNOWN_STRING);
        return 0;
    }
    state.vars.insert(
        var_id,
        VarRecord {
            namespace_kind,
            string_id,
        },
    );
    state.set_error(ERR_NONE);
    1
}

#[no_mangle]
pub extern "C" fn expr_compile_literal(expr_id: i32, string_id: i32) -> i32 {
    let mut state = STATE.lock().unwrap();
    if !state.strings.contains_key(&string_id) {
        state.set_error(ERR_UNKNOWN_STRING);
        return 0;
    }
    let mut record = ExprRecord::new(KIND_LITERAL);
    record.string_id = string_id;
    record.constant_expr = true;
    state.add_expr(expr_id, record)
}

#[no_mangle]
pub extern "C" fn expr_compile_var(expr_id: i32, var_id: i32) -> i32 {
    let mut state = STATE.lock().unwrap();
    let Some(var) = state.vars.get(&var_id) else {
        state.set_error(ERR_UNKNOWN_VAR);
        return 0;
    };
    let mut record = ExprRecord::new(KIND_VAR);
    record.var_id = var_id;
    record.string_id = var.string_id;
    state.add_expr(expr_id, record)
}

#[no_mangle]
pub extern "C" fn expr_compile_email_local(expr_id: i32, child_expr_id: i32) -> i32 {
    let mut state = STATE.lock().unwrap();
    let kind = match expr_kind(&state, child_expr_id) {
        Ok(kind) => kind,
        Err(err) => {
            state.set_error(err);
            return 0;
        }
    };
    if kind == KIND_MATCH {
        state.set_error(ERR_INVALID_KIND);
        return 0;
    }
    let mut record = ExprRecord::new(KIND_EMAIL_LOCAL);
    record.child_id = child_expr_id;
    record.constant_expr = state
        .exprs
        .get(&child_expr_id)
        .map(|expr| expr.constant_expr)
        .unwrap_or(false);
    state.add_expr(expr_id, record)
}

#[no_mangle]
pub extern "C" fn expr_compile_regex_replace(
    expr_id: i32,
    input_expr_id: i32,
    pattern_string_id: i32,
    replacement_string_id: i32,
) -> i32 {
    let mut state = STATE.lock().unwrap();
    let input = match state.exprs.get(&input_expr_id).cloned() {
        Some(input) => input,
        None => {
            state.set_error(ERR_UNKNOWN_EXPR);
            return 0;
        }
    };
    if input.kind == KIND_MATCH {
        state.set_error(ERR_INVALID_KIND);
        return 0;
    }
    if !state.strings.contains_key(&pattern_string_id)
        || !state.strings.contains_key(&replacement_string_id)
    {
        state.set_error(ERR_UNKNOWN_STRING);
        return 0;
    }
    let mut record = ExprRecord::new(KIND_REPLACE);
    record.input_id = input_expr_id;
    record.pattern_id = pattern_string_id;
    record.replacement_id = replacement_string_id;
    record.constant_expr = input.constant_expr;
    state.add_expr(expr_id, record)
}

#[no_mangle]
pub extern "C" fn expr_compile_regex_match(
    expr_id: i32,
    input_expr_id: i32,
    pattern_string_id: i32,
    negate: i32,
) -> i32 {
    let mut state = STATE.lock().unwrap();
    let has_input = input_expr_id > 0;
    let mut constant_expr = false;
    if has_input {
        let Some(input) = state.exprs.get(&input_expr_id) else {
            state.set_error(ERR_UNKNOWN_EXPR);
            return 0;
        };
        if input.kind == KIND_MATCH {
            state.set_error(ERR_INVALID_KIND);
            return 0;
        }
        constant_expr = input.constant_expr;
    }
    if !state.strings.contains_key(&pattern_string_id) {
        state.set_error(ERR_UNKNOWN_STRING);
        return 0;
    }
    let mut record = ExprRecord::new(KIND_MATCH);
    record.input_id = input_expr_id;
    record.has_input = has_input;
    record.pattern_id = pattern_string_id;
    record.negate = negate != 0;
    record.constant_expr = has_input && constant_expr;
    state.add_expr(expr_id, record)
}

#[no_mangle]
pub extern "C" fn expr_evaluate_string(expr_id: i32, out_string_id: *mut i32) -> i32 {
    let mut state = STATE.lock().unwrap();
    if out_string_id.is_null() {
        state.set_error(ERR_NULL_POINTER);
        return 0;
    }
    match eval_string_inner(&mut state, expr_id) {
        Ok(id) => {
            unsafe {
                *out_string_id = id;
            }
            state.set_error(ERR_NONE);
            1
        }
        Err(err) => {
            state.set_error(err);
            0
        }
    }
}

#[no_mangle]
pub extern "C" fn expr_evaluate_match(expr_id: i32, matcher_string_id: i32) -> i32 {
    let mut state = STATE.lock().unwrap();
    match eval_match_inner(&mut state, expr_id, matcher_string_id) {
        Ok(matched) => {
            state.set_error(ERR_NONE);
            bool_i32(matched)
        }
        Err(err) => {
            state.set_error(err);
            0
        }
    }
}

#[no_mangle]
pub extern "C" fn expr_audit_get(
    expr_id: i32,
    matcher_string_id: i32,
    out_view: *mut ExprAuditView,
) -> i32 {
    let mut state = STATE.lock().unwrap();
    if out_view.is_null() {
        state.set_error(ERR_NULL_POINTER);
        return 0;
    }

    let Some(expr) = state.exprs.get(&expr_id).cloned() else {
        unsafe {
            *out_view = default_audit_view();
        }
        state.set_error(ERR_NONE);
        return 0;
    };

    let mut view = default_audit_view();
    view.exists = 1;
    view.kind = expr.kind;
    view.string_evaluable = bool_i32(expr.kind != KIND_MATCH);
    view.match_evaluable = bool_i32(expr.kind == KIND_MATCH);
    view.constant_expr = bool_i32(expr.constant_expr);

    if expr.kind == KIND_MATCH {
        let _ = eval_match_inner(&mut state, expr_id, matcher_string_id);
        if let Some(updated) = state.exprs.get(&expr_id) {
            view.matched = bool_i32(updated.matched);
            view.namespace_error = bool_i32(updated.namespace_error);
        }
    } else {
        if let Ok(output_id) = eval_string_inner(&mut state, expr_id) {
            view.output_string_id = output_id;
        }
        if let Some(updated) = state.exprs.get(&expr_id) {
            view.namespace_error = bool_i32(updated.namespace_error);
            if updated.output_string_id >= 0 {
                view.output_string_id = updated.output_string_id;
            }
        }
    }

    unsafe {
        *out_view = view;
    }
    state.set_error(ERR_NONE);
    1
}

#[no_mangle]
pub extern "C" fn expr_last_error() -> i32 {
    STATE.lock().unwrap().last_error
}
