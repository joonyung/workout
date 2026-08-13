import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isAbsolute, join, resolve } from "node:path";

export const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
export const stateRoot = resolve(
  process.env.WORKOUT_STATE_ROOT || join(projectRoot, "state")
);
export const dataRoot = resolve(
  process.env.WORKOUT_DATA_DIR || join(stateRoot, "data")
);
export const inbodyRoot = resolve(
  process.env.WORKOUT_INBODY_DIR || join(stateRoot, "inbody")
);

export function resolveStateReference(path: string | undefined): string | null {
  if (!path) return null;
  if (isAbsolute(path)) return path;

  const statePath = resolve(stateRoot, path);
  if (existsSync(statePath)) return statePath;
  return resolve(projectRoot, path);
}
