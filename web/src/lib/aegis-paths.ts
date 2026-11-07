import fs from "fs";
import os from "os";
import path from "path";

/**
 * Preferred location from the Kotha local-dev contract.
 * Vercel can write only under `/tmp`. Never use the home directory or cwd there.
 * A failed write stays in `memoryFiles` so a route can still answer.
 */
const PREFERRED_DIR = "/tmp";
const memoryFiles = new Map<string, string>();
const dirty = new Set<string>();

export function aegisStatePath(filename: string): string {
  const dirs = [PREFERRED_DIR];
  if (!process.env.VERCEL) {
    try {
      dirs.push(path.join(os.tmpdir(), "aegis"));
    } catch {
      // tmpdir() can throw in a locked runtime. /tmp remains the candidate.
    }
  }
  for (const dir of dirs) {
    try {
      if (dir !== PREFERRED_DIR) fs.mkdirSync(dir, { recursive: true });
      fs.accessSync(dir, fs.constants.W_OK);
      return path.join(dir, filename);
    } catch {
      // Try the next directory. The memory map covers a total miss.
    }
  }
  return path.join(PREFERRED_DIR, filename);
}

export function writeJsonFile(file: string, value: unknown): boolean {
  const text = JSON.stringify(value, null, 2);
  memoryFiles.set(file, text);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, text, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(tmp, file);
    dirty.delete(file);
    return true;
  } catch {
    dirty.add(file);
    return false;
  }
}

export function readTextFile(file: string): string {
  if (dirty.has(file)) {
    const cached = memoryFiles.get(file);
    if (cached != null) return cached;
  }
  try {
    return fs.readFileSync(file, "utf8");
  } catch (error) {
    const cached = memoryFiles.get(file);
    if (cached != null) return cached;
    const wrapped = new Error(error instanceof Error ? error.message : "ENOENT") as NodeJS.ErrnoException;
    wrapped.code = "ENOENT";
    throw wrapped;
  }
}
