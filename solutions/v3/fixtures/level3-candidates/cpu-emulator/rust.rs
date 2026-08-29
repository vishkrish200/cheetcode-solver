#![allow(unknown_lints)]
#![allow(dead_code, unused_assignments, unused_imports, unused_mut, unused_variables, static_mut_refs)]
use std::cell::UnsafeCell;
use std::collections::HashMap;
use std::os::raw::c_char;

struct Cpu {
    mem: [u8; 65_536],
    regs: [u16; 8],
    pc: u16,
    sp: u16,
    flag_z: bool,
    flag_n: bool,
    flag_v: bool,
    halted: bool,
}

impl Cpu {
    const fn new() -> Self {
        Self {
            mem: [0; 65_536],
            regs: [0; 8],
            pc: 0,
            sp: 0xFFFF,
            flag_z: false,
            flag_n: false,
            flag_v: false,
            halted: false,
        }
    }

    fn reset(&mut self) {
        self.mem.fill(0);
        self.regs.fill(0);
        self.pc = 0;
        self.sp = 0xFFFF;
        self.flag_z = false;
        self.flag_n = false;
        self.flag_v = false;
        self.halted = false;
    }

    fn mem_read16_wrap(&self, addr: u16) -> u16 {
        let lo = self.mem[addr as usize] as u16;
        let hi = self.mem[addr.wrapping_add(1) as usize] as u16;
        lo | (hi << 8)
    }

    fn mem_write16_wrap(&mut self, addr: u16, value: u16) {
        self.mem[addr as usize] = (value & 0x00FF) as u8;
        self.mem[addr.wrapping_add(1) as usize] = (value >> 8) as u8;
    }

    fn fetch16(&mut self) -> u16 {
        let word = self.mem_read16_wrap(self.pc);
        self.pc = self.pc.wrapping_add(2);
        word
    }

    fn set_logic_flags(&mut self, value: u16) {
        self.flag_z = value == 0;
        self.flag_n = (value & 0x8000) != 0;
        self.flag_v = false;
    }

    fn set_add_flags(&mut self, a: u16, b: u16, result: u16) {
        self.flag_z = result == 0;
        self.flag_n = (result & 0x8000) != 0;
        self.flag_v = (!((a ^ b) as u32) & ((a ^ result) as u32) & 0x8000) != 0;
    }

    fn set_sub_flags(&mut self, a: u16, b: u16, result: u16) {
        self.flag_z = result == 0;
        self.flag_n = (result & 0x8000) != 0;
        self.flag_v = (((a ^ b) as u32) & ((a ^ result) as u32) & 0x8000) != 0;
    }

    fn run(&mut self, max_cycles: i32) -> i32 {
        if max_cycles <= 0 || self.halted {
            return 0;
        }

        let mut executed = 0;
        while executed < max_cycles && !self.halted {
            let inst = self.fetch16();
            let opcode = (inst >> 11) & 0x1F;
            let rd = ((inst >> 8) & 0x07) as usize;
            let rs = ((inst >> 5) & 0x07) as usize;
            let imm5 = inst & 0x1F;
            let target11 = inst & 0x07FF;

            match opcode {
                0x00 => {}
                0x01 => {
                    self.regs[rd] = self.fetch16();
                }
                0x02 => {
                    self.regs[rd] = self.regs[rs];
                }
                0x03 => {
                    let a = self.regs[rd];
                    let b = self.regs[rs];
                    let result = a.wrapping_add(b);
                    self.regs[rd] = result;
                    self.set_add_flags(a, b, result);
                }
                0x04 => {
                    let a = self.regs[rd];
                    let b = self.regs[rs];
                    let result = a.wrapping_sub(b);
                    self.regs[rd] = result;
                    self.set_sub_flags(a, b, result);
                }
                0x05 => {
                    let result = self.regs[rd] & self.regs[rs];
                    self.regs[rd] = result;
                    self.set_logic_flags(result);
                }
                0x06 => {
                    let result = self.regs[rd] | self.regs[rs];
                    self.regs[rd] = result;
                    self.set_logic_flags(result);
                }
                0x07 => {
                    let result = self.regs[rd] ^ self.regs[rs];
                    self.regs[rd] = result;
                    self.set_logic_flags(result);
                }
                0x08 => {
                    let result = !self.regs[rd];
                    self.regs[rd] = result;
                    self.set_logic_flags(result);
                }
                0x09 => {
                    let value = self.regs[rd];
                    let result = value.wrapping_shl((imm5 & 15) as u32);
                    self.regs[rd] = result;
                    self.set_logic_flags(result);
                }
                0x0A => {
                    let value = self.regs[rd];
                    let result = value >> (imm5 & 15);
                    self.regs[rd] = result;
                    self.set_logic_flags(result);
                }
                0x0B => {
                    let a = self.regs[rd];
                    let b = self.regs[rs];
                    let result = a.wrapping_sub(b);
                    self.set_sub_flags(a, b, result);
                }
                0x0C => {
                    self.pc = target11;
                }
                0x0D => {
                    if self.flag_z {
                        self.pc = target11;
                    }
                }
                0x0E => {
                    if !self.flag_z {
                        self.pc = target11;
                    }
                }
                0x0F => {
                    if self.flag_n {
                        self.pc = target11;
                    }
                }
                0x10 => {
                    self.regs[rd] = self.mem_read16_wrap(self.regs[rs]);
                }
                0x11 => {
                    self.mem_write16_wrap(self.regs[rd], self.regs[rs]);
                }
                0x12 => {
                    self.sp = self.sp.wrapping_sub(2);
                    self.mem_write16_wrap(self.sp, self.regs[rd]);
                }
                0x13 => {
                    self.regs[rd] = self.mem_read16_wrap(self.sp);
                    self.sp = self.sp.wrapping_add(2);
                }
                0x14 => {
                    let target = self.fetch16();
                    self.sp = self.sp.wrapping_sub(2);
                    self.mem_write16_wrap(self.sp, self.pc);
                    self.pc = target;
                }
                0x15 => {
                    self.pc = self.mem_read16_wrap(self.sp);
                    self.sp = self.sp.wrapping_add(2);
                }
                0x16 => {
                    self.halted = true;
                }
                0x17..=0x19 => {
                    if (rd != 0 && rd != 4) || (rs != 0 && rs != 4) {
                        self.halted = true;
                    } else {
                        for lane in 0..4 {
                            let a = self.regs[rd + lane];
                            let b = self.regs[rs + lane];
                            self.regs[rd + lane] = match opcode {
                                0x17 => a.wrapping_add(b),
                                0x18 => a.wrapping_sub(b),
                                _ => a ^ b,
                            };
                        }
                    }
                }
                _ => {
                    self.halted = true;
                }
            }

            executed += 1;
        }

        executed
    }
}

struct GlobalCpu(UnsafeCell<Cpu>);

unsafe impl Sync for GlobalCpu {}

static CPU: GlobalCpu = GlobalCpu(UnsafeCell::new(Cpu::new()));

fn cpu_mut() -> &'static mut Cpu {
    unsafe { &mut *CPU.0.get() }
}

#[no_mangle]
pub extern "C" fn cpu_reset() {
    cpu_mut().reset();
}

#[no_mangle]
pub extern "C" fn cpu_load_word(addr: i32, word: i32) {
    if !(0..=65_534).contains(&addr) {
        return;
    }
    let cpu = cpu_mut();
    let uaddr = addr as u16;
    let uword = word as u16;
    cpu.mem[uaddr as usize] = (uword & 0x00FF) as u8;
    cpu.mem[uaddr.wrapping_add(1) as usize] = (uword >> 8) as u8;
}

#[no_mangle]
pub extern "C" fn cpu_set_reg(idx: i32, value: i32) {
    if (0..8).contains(&idx) {
        cpu_mut().regs[idx as usize] = value as u16;
    }
}

#[no_mangle]
pub extern "C" fn cpu_get_reg(idx: i32) -> i32 {
    if (0..8).contains(&idx) {
        cpu_mut().regs[idx as usize] as i32
    } else {
        0
    }
}

#[no_mangle]
pub extern "C" fn cpu_get_pc() -> i32 {
    cpu_mut().pc as i32
}

#[no_mangle]
pub extern "C" fn cpu_get_sp() -> i32 {
    cpu_mut().sp as i32
}

#[no_mangle]
pub extern "C" fn cpu_get_flag_z() -> i32 {
    i32::from(cpu_mut().flag_z)
}

#[no_mangle]
pub extern "C" fn cpu_get_flag_n() -> i32 {
    i32::from(cpu_mut().flag_n)
}

#[no_mangle]
pub extern "C" fn cpu_get_flag_v() -> i32 {
    i32::from(cpu_mut().flag_v)
}

#[no_mangle]
pub extern "C" fn cpu_mem_read16(addr: i32) -> i32 {
    if !(0..=65_534).contains(&addr) {
        return 0;
    }
    let cpu = cpu_mut();
    let uaddr = addr as u16;
    let lo = cpu.mem[uaddr as usize] as u16;
    let hi = cpu.mem[uaddr.wrapping_add(1) as usize] as u16;
    (lo | (hi << 8)) as i32
}

#[no_mangle]
pub extern "C" fn cpu_run(max_cycles: i32) -> i32 {
    cpu_mut().run(max_cycles)
}

#[derive(Clone, Copy, Eq, PartialEq)]
enum Mnemonic {
    Invalid,
    Nop,
    Load,
    Mov,
    Add,
    Sub,
    And,
    Or,
    Xor,
    Not,
    Shl,
    Shr,
    Cmp,
    Jmp,
    Jz,
    Jnz,
    Jn,
    Ldr,
    Str,
    Push,
    Pop,
    Call,
    Ret,
    Halt,
    Vadd,
    Vsub,
    Vxor,
}

fn decode_mnemonic(token: &str) -> Mnemonic {
    let b = token.as_bytes();
    let up = |i: usize| b[i].to_ascii_uppercase();
    match b.len() {
        2 => match (up(0), up(1)) {
            (b'O', b'R') => Mnemonic::Or,
            (b'J', b'Z') => Mnemonic::Jz,
            (b'J', b'N') => Mnemonic::Jn,
            _ => Mnemonic::Invalid,
        },
        3 => match (up(0), up(1), up(2)) {
            (b'N', b'O', b'P') => Mnemonic::Nop,
            (b'M', b'O', b'V') => Mnemonic::Mov,
            (b'A', b'D', b'D') => Mnemonic::Add,
            (b'S', b'U', b'B') => Mnemonic::Sub,
            (b'A', b'N', b'D') => Mnemonic::And,
            (b'X', b'O', b'R') => Mnemonic::Xor,
            (b'N', b'O', b'T') => Mnemonic::Not,
            (b'S', b'H', b'L') => Mnemonic::Shl,
            (b'S', b'H', b'R') => Mnemonic::Shr,
            (b'C', b'M', b'P') => Mnemonic::Cmp,
            (b'J', b'M', b'P') => Mnemonic::Jmp,
            (b'J', b'N', b'Z') => Mnemonic::Jnz,
            (b'L', b'D', b'R') => Mnemonic::Ldr,
            (b'S', b'T', b'R') => Mnemonic::Str,
            (b'P', b'O', b'P') => Mnemonic::Pop,
            (b'R', b'E', b'T') => Mnemonic::Ret,
            _ => Mnemonic::Invalid,
        },
        4 => match (up(0), up(1), up(2), up(3)) {
            (b'L', b'O', b'A', b'D') => Mnemonic::Load,
            (b'P', b'U', b'S', b'H') => Mnemonic::Push,
            (b'C', b'A', b'L', b'L') => Mnemonic::Call,
            (b'H', b'A', b'L', b'T') => Mnemonic::Halt,
            (b'V', b'A', b'D', b'D') => Mnemonic::Vadd,
            (b'V', b'S', b'U', b'B') => Mnemonic::Vsub,
            (b'V', b'X', b'O', b'R') => Mnemonic::Vxor,
            _ => Mnemonic::Invalid,
        },
        _ => Mnemonic::Invalid,
    }
}
fn opcode_for(mnemonic: Mnemonic) -> u16 {
    match mnemonic {
        Mnemonic::Nop => 0x00,
        Mnemonic::Load => 0x01,
        Mnemonic::Mov => 0x02,
        Mnemonic::Add => 0x03,
        Mnemonic::Sub => 0x04,
        Mnemonic::And => 0x05,
        Mnemonic::Or => 0x06,
        Mnemonic::Xor => 0x07,
        Mnemonic::Not => 0x08,
        Mnemonic::Shl => 0x09,
        Mnemonic::Shr => 0x0A,
        Mnemonic::Cmp => 0x0B,
        Mnemonic::Jmp => 0x0C,
        Mnemonic::Jz => 0x0D,
        Mnemonic::Jnz => 0x0E,
        Mnemonic::Jn => 0x0F,
        Mnemonic::Ldr => 0x10,
        Mnemonic::Str => 0x11,
        Mnemonic::Push => 0x12,
        Mnemonic::Pop => 0x13,
        Mnemonic::Call => 0x14,
        Mnemonic::Ret => 0x15,
        Mnemonic::Halt => 0x16,
        Mnemonic::Vadd => 0x17,
        Mnemonic::Vsub => 0x18,
        Mnemonic::Vxor => 0x19,
        Mnemonic::Invalid => 0xFFFF,
    }
}

fn words_for(mnemonic: Mnemonic) -> i32 {
    if matches!(mnemonic, Mnemonic::Load | Mnemonic::Call) {
        2
    } else {
        1
    }
}

fn trim_ascii(s: &str) -> &str {
    s.trim_matches(|ch: char| ch.is_ascii_whitespace())
}

fn strip_comment(line: &str) -> &str {
    let semi = line.find(';');
    let slash = line.find("//");
    let cut = match (semi, slash) {
        (Some(a), Some(b)) => a.min(b),
        (Some(a), None) => a,
        (None, Some(b)) => b,
        (None, None) => line.len(),
    };
    trim_ascii(&line[..cut])
}

fn is_label_start(byte: u8) -> bool {
    byte.is_ascii_alphabetic() || matches!(byte, b'_' | b'.' | b'$')
}

fn is_label_char(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'.' | b'$')
}

fn consume_label<'a>(mut line: &'a str) -> Option<(&'a str, &'a str)> {
    line = trim_ascii(line);
    let bytes = line.as_bytes();
    if bytes.is_empty() || !is_label_start(bytes[0]) {
        return None;
    }

    let mut ident_end = 1;
    while ident_end < bytes.len() && is_label_char(bytes[ident_end]) {
        ident_end += 1;
    }

    let mut colon_pos = ident_end;
    while colon_pos < bytes.len() && bytes[colon_pos].is_ascii_whitespace() {
        colon_pos += 1;
    }

    if colon_pos >= bytes.len() || bytes[colon_pos] != b':' {
        return None;
    }

    let label = &line[..ident_end];
    let rest = trim_ascii(&line[colon_pos + 1..]);
    Some((label, rest))
}

fn split_mnemonic(line: &str) -> Option<(&str, &str)> {
    let line = trim_ascii(line);
    if line.is_empty() {
        return None;
    }
    let end = line
        .bytes()
        .position(|byte| byte.is_ascii_whitespace())
        .unwrap_or(line.len());
    Some((&line[..end], trim_ascii(&line[end..])))
}

fn parse_zero_operands(rest: &str) -> bool {
    trim_ascii(rest).is_empty()
}

fn parse_one_operand(rest: &str) -> Option<&str> {
    let rest = trim_ascii(rest);
    if rest.is_empty() || rest.contains(',') {
        None
    } else {
        Some(rest)
    }
}

fn parse_two_operands(rest: &str) -> Option<(&str, &str)> {
    let rest = trim_ascii(rest);
    let comma = rest.find(',')?;
    if rest[comma + 1..].contains(',') {
        return None;
    }
    let a = trim_ascii(&rest[..comma]);
    let b = trim_ascii(&rest[comma + 1..]);
    if a.is_empty() || b.is_empty() {
        None
    } else {
        Some((a, b))
    }
}

fn parse_reg(token: &str) -> Option<u16> {
    let bytes = token.as_bytes();
    if bytes.len() == 2
        && bytes[0].to_ascii_uppercase() == b'R'
        && (b'0'..=b'7').contains(&bytes[1])
    {
        Some((bytes[1] - b'0') as u16)
    } else {
        None
    }
}

fn parse_i64(token: &str) -> Option<i64> {
    if token.is_empty() {
        return None;
    }

    let token = token.strip_prefix('#').unwrap_or(token);
    if token.is_empty() {
        return None;
    }

    let bytes = token.as_bytes();
    let mut pos = 0;
    let negative = if matches!(bytes[pos], b'+' | b'-') {
        let neg = bytes[pos] == b'-';
        pos += 1;
        if pos == bytes.len() {
            return None;
        }
        neg
    } else {
        false
    };

    let mut base = 10_u64;
    if pos + 1 < bytes.len() && bytes[pos] == b'0' && matches!(bytes[pos + 1], b'x' | b'X') {
        base = 16;
        pos += 2;
        if pos == bytes.len() {
            return None;
        }
    }

    let mut acc = 0_u64;
    let mut saw_digit = false;
    while pos < bytes.len() {
        let byte = bytes[pos];
        let digit = match byte {
            b'0'..=b'9' => (byte - b'0') as u64,
            b'a'..=b'f' if base == 16 => (10 + byte - b'a') as u64,
            b'A'..=b'F' if base == 16 => (10 + byte - b'A') as u64,
            _ => return None,
        };
        if digit >= base {
            return None;
        }
        let limit = i64::MAX as u64;
        if acc > (limit - digit) / base {
            return None;
        }
        acc = acc * base + digit;
        saw_digit = true;
        pos += 1;
    }

    if !saw_digit {
        return None;
    }
    if negative {
        Some(-(acc as i64))
    } else {
        Some(acc as i64)
    }
}

fn token_must_be_number(token: &str) -> bool {
    token
        .as_bytes()
        .first()
        .is_some_and(|byte| byte.is_ascii_digit() || matches!(byte, b'+' | b'-' | b'#'))
}

fn resolve_u16(token: &str, labels: &HashMap<String, u16>) -> Option<u16> {
    if let Some(parsed) = parse_i64(token) {
        if !(-32_768..=65_535).contains(&parsed) {
            return None;
        }
        return Some(parsed as u16);
    }
    if let Some(label) = token.strip_prefix('#') {
        let label = trim_ascii(label);
        if label.is_empty() || token_must_be_number(label) {
            return None;
        }
        return labels.get(label).copied();
    }
    if token_must_be_number(token) {
        return None;
    }
    labels.get(token).copied()
}

fn resolve_u11(token: &str, labels: &HashMap<String, u16>) -> Option<u16> {
    let raw = resolve_u16(token, labels)?;
    if raw <= 0x07FF {
        Some(raw)
    } else {
        None
    }
}

fn resolve_imm5(token: &str) -> Option<u16> {
    let parsed = parse_i64(token)?;
    if (0..=31).contains(&parsed) {
        Some(parsed as u16)
    } else {
        None
    }
}

fn validate_operand_shape(mnemonic: Mnemonic, rest: &str) -> bool {
    match mnemonic {
        Mnemonic::Nop | Mnemonic::Ret | Mnemonic::Halt => parse_zero_operands(rest),
        Mnemonic::Not
        | Mnemonic::Push
        | Mnemonic::Pop
        | Mnemonic::Call
        | Mnemonic::Jmp
        | Mnemonic::Jz
        | Mnemonic::Jnz
        | Mnemonic::Jn => parse_one_operand(rest).is_some(),
        Mnemonic::Invalid => false,
        _ => parse_two_operands(rest).is_some(),
    }
}

#[no_mangle]
pub extern "C" fn cpu_assemble(
    src: *const c_char,
    src_len: i32,
    out_words: *mut u16,
    max_words: i32,
) -> i32 {
    if src.is_null() || src_len < 0 || max_words < 0 {
        return -1;
    }

    let source = unsafe {
        let bytes = std::slice::from_raw_parts(src.cast::<u8>(), src_len as usize);
        match std::str::from_utf8(bytes) {
            Ok(text) => text.to_owned(),
            Err(_) => return -1,
        }
    };

    let approx_lines = source.bytes().filter(|byte| *byte == b'\n').count() + 1;
    let mut labels: HashMap<String, u16> = HashMap::with_capacity(approx_lines.saturating_mul(2));
    let mut total_words = 0_i32;

    for raw_line in source.split('\n') {
        let mut line = strip_comment(raw_line);
        while let Some((label, rest)) = consume_label(line) {
            if labels
                .insert(label.to_owned(), (total_words.wrapping_mul(2)) as u16)
                .is_some()
            {
                return -1;
            }
            line = rest;
        }

        if !line.is_empty() {
            let (mnemonic_token, rest) = match split_mnemonic(line) {
                Some(parts) => parts,
                None => return -1,
            };
            let mnemonic = decode_mnemonic(mnemonic_token);
            if mnemonic == Mnemonic::Invalid || !validate_operand_shape(mnemonic, rest) {
                return -1;
            }
            total_words = match total_words.checked_add(words_for(mnemonic)) {
                Some(value) => value,
                None => return -1,
            };
        }
    }

    if total_words > max_words {
        return -1;
    }
    if total_words == 0 {
        return 0;
    }
    if out_words.is_null() {
        return -1;
    }

    let mut word_index = 0_isize;
    for raw_line in source.split('\n') {
        let mut line = strip_comment(raw_line);
        while let Some((_label, rest)) = consume_label(line) {
            line = rest;
        }

        if line.is_empty() {
            continue;
        }

        let (mnemonic_token, rest) = match split_mnemonic(line) {
            Some(parts) => parts,
            None => return -1,
        };
        let mnemonic = decode_mnemonic(mnemonic_token);
        if mnemonic == Mnemonic::Invalid {
            return -1;
        }
        let opcode = opcode_for(mnemonic);

        let write_word = |idx: &mut isize, value: u16| {
            unsafe {
                out_words.offset(*idx).write(value);
            }
            *idx += 1;
        };

        match mnemonic {
            Mnemonic::Nop => {
                if !parse_zero_operands(rest) {
                    return -1;
                }
                write_word(&mut word_index, opcode << 11);
            }
            Mnemonic::Load => {
                let (a, b) = match parse_two_operands(rest) {
                    Some(parts) => parts,
                    None => return -1,
                };
                let rd = match parse_reg(a) {
                    Some(reg) => reg,
                    None => return -1,
                };
                let value = match resolve_u16(b, &labels) {
                    Some(value) => value,
                    None => return -1,
                };
                write_word(&mut word_index, (opcode << 11) | (rd << 8));
                write_word(&mut word_index, value);
            }
            Mnemonic::Mov
            | Mnemonic::Add
            | Mnemonic::Sub
            | Mnemonic::And
            | Mnemonic::Or
            | Mnemonic::Xor
            | Mnemonic::Cmp
            | Mnemonic::Ldr
            | Mnemonic::Str => {
                let (a, b) = match parse_two_operands(rest) {
                    Some(parts) => parts,
                    None => return -1,
                };
                let rd = match parse_reg(a) {
                    Some(reg) => reg,
                    None => return -1,
                };
                let rs = match parse_reg(b) {
                    Some(reg) => reg,
                    None => return -1,
                };
                write_word(&mut word_index, (opcode << 11) | (rd << 8) | (rs << 5));
            }
            Mnemonic::Not | Mnemonic::Push | Mnemonic::Pop => {
                let a = match parse_one_operand(rest) {
                    Some(value) => value,
                    None => return -1,
                };
                let rd = match parse_reg(a) {
                    Some(reg) => reg,
                    None => return -1,
                };
                write_word(&mut word_index, (opcode << 11) | (rd << 8));
            }
            Mnemonic::Shl | Mnemonic::Shr => {
                let (a, b) = match parse_two_operands(rest) {
                    Some(parts) => parts,
                    None => return -1,
                };
                let rd = match parse_reg(a) {
                    Some(reg) => reg,
                    None => return -1,
                };
                let value = match resolve_imm5(b) {
                    Some(value) => value,
                    None => return -1,
                };
                write_word(&mut word_index, (opcode << 11) | (rd << 8) | value);
            }
            Mnemonic::Jmp | Mnemonic::Jz | Mnemonic::Jnz | Mnemonic::Jn => {
                let a = match parse_one_operand(rest) {
                    Some(value) => value,
                    None => return -1,
                };
                let value = match resolve_u11(a, &labels) {
                    Some(value) => value,
                    None => return -1,
                };
                write_word(&mut word_index, (opcode << 11) | value);
            }
            Mnemonic::Call => {
                let a = match parse_one_operand(rest) {
                    Some(value) => value,
                    None => return -1,
                };
                let value = match resolve_u16(a, &labels) {
                    Some(value) => value,
                    None => return -1,
                };
                write_word(&mut word_index, opcode << 11);
                write_word(&mut word_index, value);
            }
            Mnemonic::Ret | Mnemonic::Halt => {
                if !parse_zero_operands(rest) {
                    return -1;
                }
                write_word(&mut word_index, opcode << 11);
            }
            Mnemonic::Vadd | Mnemonic::Vsub | Mnemonic::Vxor => {
                let (a, b) = match parse_two_operands(rest) {
                    Some(parts) => parts,
                    None => return -1,
                };
                let rd = match parse_reg(a) {
                    Some(reg) => reg,
                    None => return -1,
                };
                let rs = match parse_reg(b) {
                    Some(reg) => reg,
                    None => return -1,
                };
                if (rd != 0 && rd != 4) || (rs != 0 && rs != 4) {
                    return -1;
                }
                write_word(&mut word_index, (opcode << 11) | (rd << 8) | (rs << 5));
            }
            Mnemonic::Invalid => return -1,
        }
    }

    word_index as i32
}
