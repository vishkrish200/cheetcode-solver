export function renderCpuEmulatorTemplate(language: string): string {
  if (language === "C") return CPU_EMULATOR_C_SOURCE;
  if (language === "C++") return CPU_EMULATOR_C_SOURCE.replace(/#include <stdint.h>/, "#include <cstdint>\nextern \"C\" {") + "\n}\n";
  throw new Error(`No 16-bit CPU emulator template for ${language}.`);
}

const CPU_EMULATOR_C_SOURCE = String.raw`#include <ctype.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

static uint8_t g_mem[65536];
static uint16_t g_regs[8];
static uint16_t g_pc;
static uint16_t g_sp;
static int g_flag_z;
static int g_flag_n;
static int g_flag_v;
static int g_halted;

static uint16_t mem_read16_wrap(uint16_t addr) {
  uint16_t next = (uint16_t)(addr + 1u);
  return (uint16_t)(g_mem[addr] | ((uint16_t)g_mem[next] << 8));
}

static void mem_write16_wrap(uint16_t addr, uint16_t value) {
  uint16_t next = (uint16_t)(addr + 1u);
  g_mem[addr] = (uint8_t)(value & 0xFFu);
  g_mem[next] = (uint8_t)((value >> 8) & 0xFFu);
}

static void set_logic_flags(uint16_t value) {
  g_flag_z = (value == 0);
  g_flag_n = ((value & 0x8000u) != 0);
  g_flag_v = 0;
}

static void set_add_flags(uint16_t a, uint16_t b, uint16_t result) {
  g_flag_z = (result == 0);
  g_flag_n = ((result & 0x8000u) != 0);
  g_flag_v = (((~(a ^ b)) & (a ^ result) & 0x8000u) != 0);
}

static void set_sub_flags(uint16_t a, uint16_t b, uint16_t result) {
  g_flag_z = (result == 0);
  g_flag_n = ((result & 0x8000u) != 0);
  g_flag_v = ((((a ^ b) & (a ^ result)) & 0x8000u) != 0);
}

static uint16_t fetch16(void) {
  uint16_t word = mem_read16_wrap(g_pc);
  g_pc = (uint16_t)(g_pc + 2u);
  return word;
}

__attribute__((visibility("default"))) void cpu_reset(void) {
  memset(g_mem, 0, sizeof(g_mem));
  memset(g_regs, 0, sizeof(g_regs));
  g_pc = 0;
  g_sp = 0xFFFFu;
  g_flag_z = 0;
  g_flag_n = 0;
  g_flag_v = 0;
  g_halted = 0;
}

__attribute__((visibility("default"))) void cpu_load_word(int addr, int word) {
  if (addr < 0 || addr > 65534) {
    return;
  }
  uint16_t uaddr = (uint16_t)addr;
  uint16_t uword = (uint16_t)word;
  g_mem[uaddr] = (uint8_t)(uword & 0xFFu);
  g_mem[(uint16_t)(uaddr + 1u)] = (uint8_t)((uword >> 8) & 0xFFu);
}

__attribute__((visibility("default"))) void cpu_set_reg(int idx, int value) {
  if (idx < 0 || idx >= 8) {
    return;
  }
  g_regs[idx] = (uint16_t)value;
}

__attribute__((visibility("default"))) int cpu_get_reg(int idx) {
  if (idx < 0 || idx >= 8) {
    return 0;
  }
  return (int)g_regs[idx];
}

__attribute__((visibility("default"))) int cpu_get_pc(void) {
  return (int)g_pc;
}

__attribute__((visibility("default"))) int cpu_get_sp(void) {
  return (int)g_sp;
}

__attribute__((visibility("default"))) int cpu_get_flag_z(void) {
  return g_flag_z ? 1 : 0;
}

__attribute__((visibility("default"))) int cpu_get_flag_n(void) {
  return g_flag_n ? 1 : 0;
}

__attribute__((visibility("default"))) int cpu_get_flag_v(void) {
  return g_flag_v ? 1 : 0;
}

__attribute__((visibility("default"))) int cpu_mem_read16(int addr) {
  if (addr < 0 || addr > 65534) {
    return 0;
  }
  uint16_t uaddr = (uint16_t)addr;
  return (int)(g_mem[uaddr] | ((uint16_t)g_mem[(uint16_t)(uaddr + 1u)] << 8));
}

__attribute__((visibility("default"))) int cpu_run(int max_cycles) {
  if (max_cycles <= 0 || g_halted) {
    return 0;
  }

  int executed = 0;
  while (executed < max_cycles && !g_halted) {
    uint16_t inst = fetch16();
    uint16_t opcode = (uint16_t)((inst >> 11) & 0x1Fu);
    uint16_t rd = (uint16_t)((inst >> 8) & 0x7u);
    uint16_t rs = (uint16_t)((inst >> 5) & 0x7u);
    uint16_t imm5 = (uint16_t)(inst & 0x1Fu);
    uint16_t target11 = (uint16_t)(inst & 0x7FFu);

    switch (opcode) {
      case 0x00:
        break;
      case 0x01:
        g_regs[rd] = fetch16();
        break;
      case 0x02:
        g_regs[rd] = g_regs[rs];
        break;
      case 0x03: {
        uint16_t a = g_regs[rd];
        uint16_t b = g_regs[rs];
        uint16_t result = (uint16_t)(a + b);
        g_regs[rd] = result;
        set_add_flags(a, b, result);
        break;
      }
      case 0x04: {
        uint16_t a = g_regs[rd];
        uint16_t b = g_regs[rs];
        uint16_t result = (uint16_t)(a - b);
        g_regs[rd] = result;
        set_sub_flags(a, b, result);
        break;
      }
      case 0x05: {
        uint16_t result = (uint16_t)(g_regs[rd] & g_regs[rs]);
        g_regs[rd] = result;
        set_logic_flags(result);
        break;
      }
      case 0x06: {
        uint16_t result = (uint16_t)(g_regs[rd] | g_regs[rs]);
        g_regs[rd] = result;
        set_logic_flags(result);
        break;
      }
      case 0x07: {
        uint16_t result = (uint16_t)(g_regs[rd] ^ g_regs[rs]);
        g_regs[rd] = result;
        set_logic_flags(result);
        break;
      }
      case 0x08: {
        uint16_t result = (uint16_t)(~g_regs[rd]);
        g_regs[rd] = result;
        set_logic_flags(result);
        break;
      }
      case 0x09: {
        uint16_t result = (uint16_t)((uint32_t)g_regs[rd] << (imm5 & 15u));
        g_regs[rd] = result;
        set_logic_flags(result);
        break;
      }
      case 0x0A: {
        uint16_t result = (uint16_t)(g_regs[rd] >> (imm5 & 15u));
        g_regs[rd] = result;
        set_logic_flags(result);
        break;
      }
      case 0x0B: {
        uint16_t a = g_regs[rd];
        uint16_t b = g_regs[rs];
        uint16_t result = (uint16_t)(a - b);
        set_sub_flags(a, b, result);
        break;
      }
      case 0x0C:
        g_pc = target11;
        break;
      case 0x0D:
        if (g_flag_z) {
          g_pc = target11;
        }
        break;
      case 0x0E:
        if (!g_flag_z) {
          g_pc = target11;
        }
        break;
      case 0x0F:
        if (g_flag_n) {
          g_pc = target11;
        }
        break;
      case 0x10:
        g_regs[rd] = mem_read16_wrap(g_regs[rs]);
        break;
      case 0x11:
        mem_write16_wrap(g_regs[rd], g_regs[rs]);
        break;
      case 0x12:
        g_sp = (uint16_t)(g_sp - 2u);
        mem_write16_wrap(g_sp, g_regs[rd]);
        break;
      case 0x13:
        g_regs[rd] = mem_read16_wrap(g_sp);
        g_sp = (uint16_t)(g_sp + 2u);
        break;
      case 0x14: {
        uint16_t target = fetch16();
        g_sp = (uint16_t)(g_sp - 2u);
        mem_write16_wrap(g_sp, g_pc);
        g_pc = target;
        break;
      }
      case 0x15:
        g_pc = mem_read16_wrap(g_sp);
        g_sp = (uint16_t)(g_sp + 2u);
        break;
      case 0x16:
        g_halted = 1;
        break;
      case 0x17:
      case 0x18:
      case 0x19:
        if ((rd != 0u && rd != 4u) || (rs != 0u && rs != 4u)) {
          g_halted = 1;
          break;
        }
        for (int lane = 0; lane < 4; ++lane) {
          uint16_t a = g_regs[rd + (uint16_t)lane];
          uint16_t b = g_regs[rs + (uint16_t)lane];
          if (opcode == 0x17u) {
            g_regs[rd + (uint16_t)lane] = (uint16_t)(a + b);
          } else if (opcode == 0x18u) {
            g_regs[rd + (uint16_t)lane] = (uint16_t)(a - b);
          } else {
            g_regs[rd + (uint16_t)lane] = (uint16_t)(a ^ b);
          }
        }
        break;
      default:
        g_halted = 1;
        break;
    }

    ++executed;
  }

  return executed;
}

typedef enum {
  MN_INVALID = 0,
  MN_NOP,
  MN_LOAD,
  MN_MOV,
  MN_ADD,
  MN_SUB,
  MN_AND,
  MN_OR,
  MN_XOR,
  MN_NOT,
  MN_SHL,
  MN_SHR,
  MN_CMP,
  MN_JMP,
  MN_JZ,
  MN_JNZ,
  MN_JN,
  MN_LDR,
  MN_STR,
  MN_PUSH,
  MN_POP,
  MN_CALL,
  MN_RET,
  MN_HALT,
  MN_VADD,
  MN_VSUB,
  MN_VXOR
} Mnemonic;

typedef struct {
  const char *ptr;
  size_t len;
} Slice;

typedef struct {
  Slice key;
  uint16_t value;
  int used;
} LabelEntry;

typedef struct {
  LabelEntry *entries;
  size_t cap;
  size_t len;
} LabelMap;

static int ascii_upper_int(unsigned char ch) {
  return toupper(ch);
}

static int slice_ieq_lit(Slice token, const char *lit) {
  size_t i = 0;
  while (i < token.len && lit[i] != '\0') {
    if (ascii_upper_int((unsigned char)token.ptr[i]) !=
        (unsigned char)lit[i]) {
      return 0;
    }
    ++i;
  }
  return i == token.len && lit[i] == '\0';
}

static Mnemonic decode_mnemonic(Slice token) {
  switch (token.len) {
    case 2:
      if (slice_ieq_lit(token, "OR")) {
        return MN_OR;
      }
      if (slice_ieq_lit(token, "JZ")) {
        return MN_JZ;
      }
      if (slice_ieq_lit(token, "JN")) {
        return MN_JN;
      }
      break;
    case 3:
      if (slice_ieq_lit(token, "NOP")) {
        return MN_NOP;
      }
      if (slice_ieq_lit(token, "MOV")) {
        return MN_MOV;
      }
      if (slice_ieq_lit(token, "ADD")) {
        return MN_ADD;
      }
      if (slice_ieq_lit(token, "SUB")) {
        return MN_SUB;
      }
      if (slice_ieq_lit(token, "AND")) {
        return MN_AND;
      }
      if (slice_ieq_lit(token, "XOR")) {
        return MN_XOR;
      }
      if (slice_ieq_lit(token, "NOT")) {
        return MN_NOT;
      }
      if (slice_ieq_lit(token, "SHL")) {
        return MN_SHL;
      }
      if (slice_ieq_lit(token, "SHR")) {
        return MN_SHR;
      }
      if (slice_ieq_lit(token, "CMP")) {
        return MN_CMP;
      }
      if (slice_ieq_lit(token, "JMP")) {
        return MN_JMP;
      }
      if (slice_ieq_lit(token, "JNZ")) {
        return MN_JNZ;
      }
      if (slice_ieq_lit(token, "LDR")) {
        return MN_LDR;
      }
      if (slice_ieq_lit(token, "STR")) {
        return MN_STR;
      }
      if (slice_ieq_lit(token, "POP")) {
        return MN_POP;
      }
      if (slice_ieq_lit(token, "RET")) {
        return MN_RET;
      }
      break;
    case 4:
      if (slice_ieq_lit(token, "LOAD")) {
        return MN_LOAD;
      }
      if (slice_ieq_lit(token, "PUSH")) {
        return MN_PUSH;
      }
      if (slice_ieq_lit(token, "CALL")) {
        return MN_CALL;
      }
      if (slice_ieq_lit(token, "HALT")) {
        return MN_HALT;
      }
      if (slice_ieq_lit(token, "VADD")) {
        return MN_VADD;
      }
      if (slice_ieq_lit(token, "VSUB")) {
        return MN_VSUB;
      }
      if (slice_ieq_lit(token, "VXOR")) {
        return MN_VXOR;
      }
      break;
    default:
      break;
  }
  return MN_INVALID;
}

static uint16_t opcode_for(Mnemonic mnemonic) {
  switch (mnemonic) {
    case MN_NOP:
      return 0x00u;
    case MN_LOAD:
      return 0x01u;
    case MN_MOV:
      return 0x02u;
    case MN_ADD:
      return 0x03u;
    case MN_SUB:
      return 0x04u;
    case MN_AND:
      return 0x05u;
    case MN_OR:
      return 0x06u;
    case MN_XOR:
      return 0x07u;
    case MN_NOT:
      return 0x08u;
    case MN_SHL:
      return 0x09u;
    case MN_SHR:
      return 0x0Au;
    case MN_CMP:
      return 0x0Bu;
    case MN_JMP:
      return 0x0Cu;
    case MN_JZ:
      return 0x0Du;
    case MN_JNZ:
      return 0x0Eu;
    case MN_JN:
      return 0x0Fu;
    case MN_LDR:
      return 0x10u;
    case MN_STR:
      return 0x11u;
    case MN_PUSH:
      return 0x12u;
    case MN_POP:
      return 0x13u;
    case MN_CALL:
      return 0x14u;
    case MN_RET:
      return 0x15u;
    case MN_HALT:
      return 0x16u;
    case MN_VADD:
      return 0x17u;
    case MN_VSUB:
      return 0x18u;
    case MN_VXOR:
      return 0x19u;
    case MN_INVALID:
      break;
  }
  return 0xFFFFu;
}

static int words_for(Mnemonic mnemonic) {
  return (mnemonic == MN_LOAD || mnemonic == MN_CALL) ? 2 : 1;
}

static Slice make_slice(const char *ptr, size_t len) {
  Slice s;
  s.ptr = ptr;
  s.len = len;
  return s;
}

static int is_space_ch(char ch) {
  return isspace((unsigned char)ch) != 0;
}

static Slice trim_slice(Slice s) {
  while (s.len > 0 && is_space_ch(s.ptr[0])) {
    ++s.ptr;
    --s.len;
  }
  while (s.len > 0 && is_space_ch(s.ptr[s.len - 1u])) {
    --s.len;
  }
  return s;
}

static Slice strip_comment(Slice s) {
  for (size_t i = 0; i < s.len; ++i) {
    if (s.ptr[i] == ';' ||
        (s.ptr[i] == '/' && i + 1u < s.len && s.ptr[i + 1u] == '/')) {
      return trim_slice(make_slice(s.ptr, i));
    }
  }
  return trim_slice(s);
}

static int is_label_start(unsigned char ch) {
  return isalpha(ch) != 0 || ch == '_' || ch == '.' || ch == '$';
}

static int is_label_char(unsigned char ch) {
  return isalnum(ch) != 0 || ch == '_' || ch == '.' || ch == '$';
}

static int consume_label(Slice *line, Slice *label) {
  *line = trim_slice(*line);
  if (line->len == 0 || !is_label_start((unsigned char)line->ptr[0])) {
    return 0;
  }

  size_t ident_end = 1;
  while (ident_end < line->len &&
         is_label_char((unsigned char)line->ptr[ident_end])) {
    ++ident_end;
  }

  size_t colon_pos = ident_end;
  while (colon_pos < line->len && is_space_ch(line->ptr[colon_pos])) {
    ++colon_pos;
  }
  if (colon_pos >= line->len || line->ptr[colon_pos] != ':') {
    return 0;
  }

  *label = make_slice(line->ptr, ident_end);
  *line = trim_slice(make_slice(line->ptr + colon_pos + 1u,
                                line->len - colon_pos - 1u));
  return 1;
}

static int split_mnemonic(Slice line, Slice *mnemonic, Slice *rest) {
  line = trim_slice(line);
  if (line.len == 0) {
    return 0;
  }
  size_t i = 0;
  while (i < line.len && !is_space_ch(line.ptr[i])) {
    ++i;
  }
  *mnemonic = make_slice(line.ptr, i);
  *rest = trim_slice(make_slice(line.ptr + i, line.len - i));
  return 1;
}

static const char *find_comma(Slice s, size_t start) {
  for (size_t i = start; i < s.len; ++i) {
    if (s.ptr[i] == ',') {
      return s.ptr + i;
    }
  }
  return NULL;
}

static int parse_zero_operands(Slice rest) {
  return trim_slice(rest).len == 0;
}

static int parse_one_operand(Slice rest, Slice *a) {
  rest = trim_slice(rest);
  if (rest.len == 0 || find_comma(rest, 0) != NULL) {
    return 0;
  }
  *a = rest;
  return 1;
}

static int parse_two_operands(Slice rest, Slice *a, Slice *b) {
  rest = trim_slice(rest);
  const char *comma = find_comma(rest, 0);
  if (comma == NULL) {
    return 0;
  }
  size_t comma_idx = (size_t)(comma - rest.ptr);
  if (find_comma(rest, comma_idx + 1u) != NULL) {
    return 0;
  }
  *a = trim_slice(make_slice(rest.ptr, comma_idx));
  *b = trim_slice(make_slice(comma + 1, rest.len - comma_idx - 1u));
  return a->len != 0 && b->len != 0;
}

static int parse_reg(Slice token, uint16_t *reg) {
  if (token.len != 2) {
    return 0;
  }
  if (ascii_upper_int((unsigned char)token.ptr[0]) != 'R') {
    return 0;
  }
  if (token.ptr[1] < '0' || token.ptr[1] > '7') {
    return 0;
  }
  *reg = (uint16_t)(token.ptr[1] - '0');
  return 1;
}

static int parse_i64(Slice token, int64_t *value) {
  if (token.len == 0) {
    return 0;
  }

  size_t pos = 0;
  if (token.ptr[pos] == '#') {
    ++pos;
    if (pos == token.len) {
      return 0;
    }
  }
  int negative = 0;
  if (token.ptr[pos] == '+' || token.ptr[pos] == '-') {
    negative = (token.ptr[pos] == '-');
    ++pos;
    if (pos == token.len) {
      return 0;
    }
  }

  int base = 10;
  if (pos + 1u < token.len && token.ptr[pos] == '0' &&
      (token.ptr[pos + 1u] == 'x' || token.ptr[pos + 1u] == 'X')) {
    base = 16;
    pos += 2u;
    if (pos == token.len) {
      return 0;
    }
  }

  uint64_t acc = 0;
  int saw_digit = 0;
  for (; pos < token.len; ++pos) {
    unsigned char ch = (unsigned char)token.ptr[pos];
    int digit = -1;
    if (ch >= '0' && ch <= '9') {
      digit = (int)(ch - '0');
    } else if (base == 16 && ch >= 'a' && ch <= 'f') {
      digit = 10 + (int)(ch - 'a');
    } else if (base == 16 && ch >= 'A' && ch <= 'F') {
      digit = 10 + (int)(ch - 'A');
    } else {
      return 0;
    }
    if (digit >= base) {
      return 0;
    }
    if (acc > ((uint64_t)INT64_MAX - (uint64_t)digit) / (uint64_t)base) {
      return 0;
    }
    acc = acc * (uint64_t)base + (uint64_t)digit;
    saw_digit = 1;
  }

  if (!saw_digit) {
    return 0;
  }
  if (negative) {
    if (acc > (uint64_t)INT64_MAX + 1u) {
      return 0;
    }
    if (acc == (uint64_t)INT64_MAX + 1u) {
      *value = INT64_MIN;
    } else {
      *value = -(int64_t)acc;
    }
  } else {
    *value = (int64_t)acc;
  }
  return 1;
}

static int token_must_be_number(Slice token) {
  if (token.len == 0) {
    return 0;
  }
  unsigned char ch = (unsigned char)token.ptr[0];
  return isdigit(ch) != 0 || ch == '+' || ch == '-' || ch == '#';
}

static uint64_t hash_slice(Slice s) {
  uint64_t h = 1469598103934665603ull;
  for (size_t i = 0; i < s.len; ++i) {
    h ^= (uint64_t)(unsigned char)s.ptr[i];
    h *= 1099511628211ull;
  }
  return h;
}

static int slice_eq(Slice a, Slice b) {
  return a.len == b.len && (a.len == 0 || memcmp(a.ptr, b.ptr, a.len) == 0);
}

static int label_map_init(LabelMap *map, size_t expected) {
  size_t cap = 16;
  size_t need = expected * 4u + 16u;
  while (cap < need) {
    if (cap > ((size_t)-1) / 2u) {
      return 0;
    }
    cap *= 2u;
  }
  map->entries = (LabelEntry *)calloc(cap, sizeof(LabelEntry));
  if (map->entries == NULL) {
    return 0;
  }
  map->cap = cap;
  map->len = 0;
  return 1;
}

static void label_map_free(LabelMap *map) {
  free(map->entries);
  map->entries = NULL;
  map->cap = 0;
  map->len = 0;
}

static int label_map_insert_raw(LabelMap *map, Slice key, uint16_t value) {
  if (map->cap == 0) {
    return 0;
  }
  uint64_t h = hash_slice(key);
  size_t mask = map->cap - 1u;
  size_t idx = (size_t)h & mask;
  for (;;) {
    LabelEntry *entry = &map->entries[idx];
    if (!entry->used) {
      entry->used = 1;
      entry->key = key;
      entry->value = value;
      ++map->len;
      return 1;
    }
    if (slice_eq(entry->key, key)) {
      return 0;
    }
    idx = (idx + 1u) & mask;
  }
}

static int label_map_grow(LabelMap *map) {
  if (map->cap > ((size_t)-1) / 2u) {
    return 0;
  }
  LabelMap bigger;
  bigger.cap = map->cap * 2u;
  bigger.len = 0;
  bigger.entries = (LabelEntry *)calloc(bigger.cap, sizeof(LabelEntry));
  if (bigger.entries == NULL) {
    return 0;
  }

  for (size_t i = 0; i < map->cap; ++i) {
    LabelEntry *entry = &map->entries[i];
    if (entry->used &&
        !label_map_insert_raw(&bigger, entry->key, entry->value)) {
      free(bigger.entries);
      return 0;
    }
  }

  free(map->entries);
  *map = bigger;
  return 1;
}

static int label_map_put(LabelMap *map, Slice key, uint16_t value) {
  if ((map->len + 1u) * 2u >= map->cap && !label_map_grow(map)) {
    return 0;
  }
  return label_map_insert_raw(map, key, value);
}

static int label_map_get(const LabelMap *map, Slice key, uint16_t *value) {
  if (map->cap == 0) {
    return 0;
  }
  uint64_t h = hash_slice(key);
  size_t mask = map->cap - 1u;
  size_t idx = (size_t)h & mask;
  for (;;) {
    const LabelEntry *entry = &map->entries[idx];
    if (!entry->used) {
      return 0;
    }
    if (slice_eq(entry->key, key)) {
      *value = entry->value;
      return 1;
    }
    idx = (idx + 1u) & mask;
  }
}

static int resolve_u16(Slice token, const LabelMap *labels, uint16_t *value) {
  int64_t parsed = 0;
  if (parse_i64(token, &parsed)) {
    if (parsed < -32768 || parsed > 0xFFFF) {
      return 0;
    }
    *value = (uint16_t)parsed;
    return 1;
  }

  Slice label_token = token;
  if (label_token.len > 0 && label_token.ptr[0] == '#') {
    label_token = trim_slice(make_slice(label_token.ptr + 1, label_token.len - 1u));
    if (label_token.len == 0 || token_must_be_number(label_token)) {
      return 0;
    }
    return label_map_get(labels, label_token, value);
  }
  if (token_must_be_number(token)) {
    return 0;
  }
  return label_map_get(labels, token, value);
}

static int resolve_u11(Slice token, const LabelMap *labels, uint16_t *value) {
  uint16_t raw = 0;
  if (!resolve_u16(token, labels, &raw)) {
    return 0;
  }
  if (raw > 0x07FFu) {
    return 0;
  }
  *value = raw;
  return 1;
}

static int resolve_imm5(Slice token, uint16_t *value) {
  int64_t parsed = 0;
  if (!parse_i64(token, &parsed)) {
    return 0;
  }
  if (parsed < 0 || parsed > 31) {
    return 0;
  }
  *value = (uint16_t)parsed;
  return 1;
}

static int validate_operand_shape(Mnemonic mnemonic, Slice rest) {
  Slice a;
  Slice b;
  switch (mnemonic) {
    case MN_NOP:
    case MN_RET:
    case MN_HALT:
      return parse_zero_operands(rest);
    case MN_NOT:
    case MN_PUSH:
    case MN_POP:
    case MN_CALL:
    case MN_JMP:
    case MN_JZ:
    case MN_JNZ:
    case MN_JN:
      return parse_one_operand(rest, &a);
    default:
      return parse_two_operands(rest, &a, &b);
  }
}

static int assemble_line(Slice line, const LabelMap *labels, uint16_t *out_words,
                         int *word_index) {
  Slice label;
  while (consume_label(&line, &label)) {
  }

  if (line.len == 0) {
    return 1;
  }

  Slice mnemonic_token;
  Slice rest;
  if (!split_mnemonic(line, &mnemonic_token, &rest)) {
    return 0;
  }
  Mnemonic mnemonic = decode_mnemonic(mnemonic_token);
  if (mnemonic == MN_INVALID) {
    return 0;
  }

  uint16_t opcode = opcode_for(mnemonic);
  Slice a;
  Slice b;
  uint16_t rd = 0;
  uint16_t rs = 0;
  uint16_t value = 0;

  switch (mnemonic) {
    case MN_NOP:
      if (!parse_zero_operands(rest)) {
        return 0;
      }
      out_words[(*word_index)++] = (uint16_t)(opcode << 11);
      return 1;
    case MN_LOAD:
      if (!parse_two_operands(rest, &a, &b) || !parse_reg(a, &rd) ||
          !resolve_u16(b, labels, &value)) {
        return 0;
      }
      out_words[(*word_index)++] = (uint16_t)((opcode << 11) | (rd << 8));
      out_words[(*word_index)++] = value;
      return 1;
    case MN_MOV:
    case MN_ADD:
    case MN_SUB:
    case MN_AND:
    case MN_OR:
    case MN_XOR:
    case MN_CMP:
    case MN_LDR:
    case MN_STR:
      if (!parse_two_operands(rest, &a, &b) || !parse_reg(a, &rd) ||
          !parse_reg(b, &rs)) {
        return 0;
      }
      out_words[(*word_index)++] =
          (uint16_t)((opcode << 11) | (rd << 8) | (rs << 5));
      return 1;
    case MN_NOT:
    case MN_PUSH:
    case MN_POP:
      if (!parse_one_operand(rest, &a) || !parse_reg(a, &rd)) {
        return 0;
      }
      out_words[(*word_index)++] = (uint16_t)((opcode << 11) | (rd << 8));
      return 1;
    case MN_SHL:
    case MN_SHR:
      if (!parse_two_operands(rest, &a, &b) || !parse_reg(a, &rd) ||
          !resolve_imm5(b, &value)) {
        return 0;
      }
      out_words[(*word_index)++] = (uint16_t)((opcode << 11) | (rd << 8) | value);
      return 1;
    case MN_JMP:
    case MN_JZ:
    case MN_JNZ:
    case MN_JN:
      if (!parse_one_operand(rest, &a) || !resolve_u11(a, labels, &value)) {
        return 0;
      }
      out_words[(*word_index)++] = (uint16_t)((opcode << 11) | value);
      return 1;
    case MN_CALL:
      if (!parse_one_operand(rest, &a) || !resolve_u16(a, labels, &value)) {
        return 0;
      }
      out_words[(*word_index)++] = (uint16_t)(opcode << 11);
      out_words[(*word_index)++] = value;
      return 1;
    case MN_RET:
    case MN_HALT:
      if (!parse_zero_operands(rest)) {
        return 0;
      }
      out_words[(*word_index)++] = (uint16_t)(opcode << 11);
      return 1;
    case MN_VADD:
    case MN_VSUB:
    case MN_VXOR:
      if (!parse_two_operands(rest, &a, &b) || !parse_reg(a, &rd) ||
          !parse_reg(b, &rs)) {
        return 0;
      }
      if ((rd != 0u && rd != 4u) || (rs != 0u && rs != 4u)) {
        return 0;
      }
      out_words[(*word_index)++] =
          (uint16_t)((opcode << 11) | (rd << 8) | (rs << 5));
      return 1;
    case MN_INVALID:
      break;
  }
  return 0;
}

__attribute__((visibility("default"))) int cpu_assemble(const char *src,
                                                        int src_len,
                                                        uint16_t *out_words,
                                                        int max_words) {
  if (src == NULL || src_len < 0 || max_words < 0) {
    return -1;
  }

  char *source = (char *)malloc((size_t)src_len + 1u);
  if (source == NULL) {
    return -1;
  }
  memcpy(source, src, (size_t)src_len);
  source[src_len] = '\0';

  size_t approx_lines = 1;
  for (int i = 0; i < src_len; ++i) {
    if (source[i] == '\n') {
      ++approx_lines;
    }
  }

  LabelMap labels;
  if (!label_map_init(&labels, approx_lines)) {
    free(source);
    return -1;
  }

  int total_words = 0;
  size_t line_start = 0;
  size_t source_len = (size_t)src_len;
  while (line_start <= source_len) {
    size_t end_pos = line_start;
    while (end_pos < source_len && source[end_pos] != '\n' && source[end_pos] != '\r') {
      ++end_pos;
    }

    Slice line = strip_comment(make_slice(source + line_start, end_pos - line_start));
    Slice label;
    while (consume_label(&line, &label)) {
      if (!label_map_put(&labels, label, (uint16_t)(total_words * 2))) {
        label_map_free(&labels);
        free(source);
        return -1;
      }
    }

    if (line.len != 0) {
      Slice mnemonic_token;
      Slice rest;
      if (!split_mnemonic(line, &mnemonic_token, &rest)) {
        label_map_free(&labels);
        free(source);
        return -1;
      }
      Mnemonic mnemonic = decode_mnemonic(mnemonic_token);
      if (mnemonic == MN_INVALID || !validate_operand_shape(mnemonic, rest)) {
        label_map_free(&labels);
        free(source);
        return -1;
      }
      total_words += words_for(mnemonic);
      if (total_words < 0) {
        label_map_free(&labels);
        free(source);
        return -1;
      }
    }

    if (end_pos == source_len) {
      break;
    }
    line_start = end_pos + 1u;
    if (source[end_pos] == '\r' && line_start < source_len && source[line_start] == '\n') {
      line_start += 1u;
    }
  }

  if (total_words > max_words) {
    label_map_free(&labels);
    free(source);
    return -1;
  }
  if (total_words == 0) {
    label_map_free(&labels);
    free(source);
    return 0;
  }
  if (out_words == NULL) {
    label_map_free(&labels);
    free(source);
    return -1;
  }

  int word_index = 0;
  line_start = 0;
  while (line_start <= source_len) {
    size_t end_pos = line_start;
    while (end_pos < source_len && source[end_pos] != '\n' && source[end_pos] != '\r') {
      ++end_pos;
    }
    Slice line = strip_comment(make_slice(source + line_start, end_pos - line_start));
    if (!assemble_line(line, &labels, out_words, &word_index)) {
      label_map_free(&labels);
      free(source);
      return -1;
    }
    if (end_pos == source_len) {
      break;
    }
    line_start = end_pos + 1u;
    if (source[end_pos] == '\r' && line_start < source_len && source[line_start] == '\n') {
      line_start += 1u;
    }
  }

  label_map_free(&labels);
  free(source);
  return word_index;
}
`;
