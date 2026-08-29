import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface LocalCompileResult {
  ok: boolean;
  filePath?: string;
  command?: string[];
  binaryPath?: string;
  binaryBytes?: number;
  error?: string;
}

export async function compileLevel3Source(
  runDir: string,
  label: string,
  language: string,
  code: string
): Promise<LocalCompileResult> {
  const config = compilerConfig(language);
  if (!config) return { ok: true };

  const absoluteRunDir = path.resolve(runDir);
  const filePath = path.join(absoluteRunDir, `compile-check-${label}.${config.extension}`);
  await fs.writeFile(filePath, code);

  const binaryPath = config.output ? path.join(absoluteRunDir, `compile-check-${label}${config.output.extension}`) : undefined;
  const command = [config.bin, ...config.args, filePath, ...(binaryPath ? [...config.output!.args, binaryPath] : [])];
  try {
    await execFileAsync(config.bin, [...config.args, filePath, ...(binaryPath ? [...config.output!.args, binaryPath] : [])], {
      cwd: absoluteRunDir,
      timeout: 10_000,
      maxBuffer: 1024 * 1024
    });

    const binaryBytes = binaryPath ? await estimateBinaryBytes(binaryPath) : undefined;
    const maxBinaryBytes = Number(process.env.LEVEL3_MAX_BINARY_BYTES ?? 128 * 1024 * 1024);
    if (binaryBytes !== undefined && binaryBytes > maxBinaryBytes) {
      return {
        ok: false,
        filePath,
        command,
        binaryPath,
        binaryBytes,
        error: `compiled binary image is too large: ${binaryBytes} bytes exceeds ${maxBinaryBytes} bytes. Avoid dense static arrays; use sparse dynamic storage keyed by registered ids.`
      };
    }

    return { ok: true, filePath, command, binaryPath, binaryBytes };
  } catch (error) {
    const message =
      error && typeof error === "object" && "stderr" in error
        ? String((error as { stderr?: unknown }).stderr)
        : error instanceof Error
          ? error.message
          : String(error);
    return { ok: false, filePath, command, error: message.slice(0, 8000) };
  }
}

function compilerConfig(
  language: string
):
  | {
      bin: string;
      args: string[];
      extension: string;
      output?: {
        args: string[];
        extension: string;
      };
    }
  | undefined {
  if (language === "C++") {
    return {
      bin: "c++",
      args: ["-std=c++17", "-O2", "-Wall", "-Wextra", "-Werror", "-fPIC", "-shared"],
      extension: "cpp",
      output: { args: ["-o"], extension: ".so" }
    };
  }

  if (language === "C") {
    return {
      bin: "cc",
      args: ["-std=c17", "-O2", "-Wall", "-Wextra", "-Werror", "-fPIC", "-shared"],
      extension: "c",
      output: { args: ["-o"], extension: ".so" }
    };
  }

  if (language === "Rust") {
    return {
      bin: "rustc",
      args: ["--edition=2021", "--crate-type=cdylib", "-D", "warnings"],
      extension: "rs",
      output: { args: ["-o"], extension: ".so" }
    };
  }

  return undefined;
}

async function estimateBinaryBytes(binaryPath: string): Promise<number | undefined> {
  try {
    const { stdout } = await execFileAsync("size", [binaryPath], {
      timeout: 5_000,
      maxBuffer: 1024 * 1024
    });
    const parsed = parseSizeOutput(stdout);
    if (parsed !== undefined) return parsed;
  } catch {
    // Fall back to file size below.
  }

  return (await fs.stat(binaryPath)).size;
}

export function parseSizeOutput(output: string): number | undefined {
  const lines = output
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return undefined;

  const last = lines.at(-1);
  if (!last) return undefined;
  const fields = last.split(/\s+/);
  if (fields.length < 3) return undefined;

  const decimal = Number(fields.at(-3));
  return Number.isFinite(decimal) ? decimal : undefined;
}
