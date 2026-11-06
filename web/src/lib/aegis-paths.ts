import fs from "fs";
import os from "os";
import path from "path";

/**
 * Preferred location from the Kotha local-dev contract.
 * Some runtimes mount `/tmp` without write permission for the app user.
 * In that case the same filenames are stored under `os.tmpdir()/aegis`.
 */
const PREFERRED_DIR = "/tmp";

export function aegisStatePath(filename: string): string {
  let dir = PREFERRED_DIR;
  try {
    fs.accessSync(PREFERRED_DIR, fs.constants.W_OK);
  } catch {
    dir = path.join(os.tmpdir(), "aegis");
    fs.mkdirSync(dir, { recursive: true });
  }
  return path.join(dir, filename);
}

export function writeJsonFile(file: string, value: unknown): void {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tmp, file);
}
