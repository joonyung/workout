import { createServer } from "node:http";
import type { IncomingMessage, OutgoingHttpHeaders, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import {
  createReadStream,
  existsSync,
  readdirSync
} from "node:fs";
import {
  mkdir,
  readFile,
  rename,
  writeFile
} from "node:fs/promises";
import { networkInterfaces } from "node:os";
import {
  extname,
  join,
  relative,
  resolve,
  sep
} from "node:path";
import {
  dataRoot,
  inbodyRoot,
  projectRoot,
  stateRoot
} from "./runtime-paths.ts";
import type { Gym, Profile, WorkoutSession } from "../src/types.ts";

interface InBodyImportPayload {
  content?: string;
  filename?: string;
}

interface DeletedWorkouts {
  ids: string[];
}

const port = Number(process.env.PORT || 5002);
const host = process.env.HOST || "127.0.0.1";
const staticRoot = resolve(process.env.WORKOUT_STATIC_ROOT || join(projectRoot, "dist"));
const requireOrigin = process.env.REQUIRE_ORIGIN === "true";
const requireAccess = process.env.REQUIRE_CF_ACCESS === "true";
const allowedOrigins = new Set(
  String(process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
);
const maxBodyBytes = 5 * 1024 * 1024;

const staticFiles = new Map([
  ["/", "index.html"],
  ["/index.html", "index.html"],
  ["/manifest.webmanifest", "manifest.webmanifest"],
  ["/sw.js", "sw.js"],
  ["/assets/app.js", "assets/app.js"],
  ["/assets/app.js.map", "assets/app.js.map"],
  ["/assets/styles.css", "assets/styles.css"],
  ["/assets/icon.svg", "assets/icon.svg"]
]);

const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".csv": "text/csv; charset=utf-8"
};

function securityHeaders(request: IncomingMessage | null = null): OutgoingHttpHeaders {
  const headers: OutgoingHttpHeaders = {
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY"
  };
  if (request?.headers["x-forwarded-proto"] === "https") {
    headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";
  }
  return headers;
}

function sendJson(
  request: IncomingMessage,
  response: ServerResponse,
  status: number,
  value: unknown
): void {
  response.writeHead(status, {
    ...securityHeaders(request),
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(value));
}

function sendError(
  request: IncomingMessage,
  response: ServerResponse,
  status: number,
  message: string
): void {
  sendJson(request, response, status, { error: message });
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  await mkdir(resolve(path, ".."), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
}

function readRequestJson<T>(request: IncomingMessage): Promise<T> {
  return new Promise<T>((resolveBody, rejectBody) => {
    let size = 0;
    const chunks: Buffer[] = [];

    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBodyBytes) {
        rejectBody(new Error("Request body is too large."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });

    request.on("end", () => {
      try {
        resolveBody(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        rejectBody(new Error("Request body must be valid JSON."));
      }
    });

    request.on("error", rejectBody);
  });
}

function safeId(value: unknown, fallback: string): string {
  const cleaned = String(value || "").replace(/[^a-zA-Z0-9_-]/g, "");
  return cleaned || fallback;
}

function safeCsvName(value: unknown): string {
  const basename = String(value || "inbody.csv").split(/[/\\]/).at(-1) || "inbody.csv";
  const cleaned = basename.replace(/[^a-zA-Z0-9._-]/g, "-");
  return cleaned.toLowerCase().endsWith(".csv") ? cleaned : `${cleaned}.csv`;
}

async function listWorkoutRecords(): Promise<WorkoutSession[]> {
  const directory = join(dataRoot, "workouts");
  if (!existsSync(directory)) return [];

  const records = await Promise.all(readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .map((name) => readJson<WorkoutSession | null>(join(directory, name), null)));
  return records.filter((record): record is WorkoutSession => Boolean(record));
}

function listCsvUrls(directory = inbodyRoot): string[] {
  if (!existsSync(directory)) return [];
  const urls = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      urls.push(...listCsvUrls(path));
    } else if (entry.name.toLowerCase().endsWith(".csv")) {
      const pathFromRoot = relative(inbodyRoot, path).split(sep).map(encodeURIComponent).join("/");
      urls.push(`/api/inbody/${pathFromRoot}`);
    }
  }

  return urls.sort();
}

function requestOrigin(request: IncomingMessage): string | null {
  const origin = request.headers.origin;
  if (!origin) return null;
  try {
    return new URL(origin).origin;
  } catch {
    return "invalid";
  }
}

function expectedOrigins(request: IncomingMessage): Set<string> {
  const values = new Set(allowedOrigins);
  const hostname = request.headers["x-forwarded-host"] || request.headers.host;
  if (hostname) {
    const protocol = request.headers["x-forwarded-proto"] || "http";
    values.add(`${protocol}://${hostname}`);
  }
  return values;
}

function isWriteRequestAllowed(request: IncomingMessage): boolean {
  const origin = requestOrigin(request);
  if (!origin) return !requireOrigin;
  return expectedOrigins(request).has(origin);
}

function hasAccessAssertion(request: IncomingMessage): boolean {
  return Boolean(request.headers["cf-access-jwt-assertion"]);
}

function resolveInside(directory: string, requestedPath: string): string | null {
  const resolved = resolve(directory, requestedPath);
  if (resolved === directory || resolved.startsWith(`${directory}${sep}`)) return resolved;
  return null;
}

async function handleApi(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string
): Promise<boolean> {
  if (request.method === "GET" && pathname === "/api/health") {
    sendJson(request, response, 200, { ok: true, serverTime: new Date().toISOString() });
    return true;
  }

  if (requireAccess && !hasAccessAssertion(request)) {
    sendError(request, response, 403, "Cloudflare Access authentication is required.");
    return true;
  }

  if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method || "") && !isWriteRequestAllowed(request)) {
    sendError(request, response, 403, "Request origin is not allowed.");
    return true;
  }

  if (request.method === "GET" && pathname === "/api/bootstrap") {
    const [profile, gym, plan, sessions, deletedWorkouts] = await Promise.all([
      readJson<Partial<Profile>>(join(dataRoot, "profile.json"), {}),
      readJson<Partial<Gym>>(join(dataRoot, "gyms", "current.json"), {}),
      readJson(join(dataRoot, "plans", "current.json"), null),
      listWorkoutRecords(),
      readJson<DeletedWorkouts>(join(dataRoot, "deleted-workouts.json"), { ids: [] })
    ]);

    sendJson(request, response, 200, {
      profile,
      gym,
      plan,
      sessions,
      deletedWorkoutIds: deletedWorkouts.ids || [],
      inbodyFiles: listCsvUrls(),
      serverTime: new Date().toISOString()
    });
    return true;
  }

  if (request.method === "GET" && pathname.startsWith("/api/inbody/")) {
    const relativePath = pathname.slice("/api/inbody/".length);
    const filePath = resolveInside(inbodyRoot, relativePath);
    if (!filePath || extname(filePath).toLowerCase() !== ".csv" || !existsSync(filePath)) {
      sendError(request, response, 404, "InBody file not found.");
      return true;
    }
    response.writeHead(200, {
      ...securityHeaders(request),
      "Content-Type": contentTypes[".csv"],
      "Cache-Control": "no-store"
    });
    createReadStream(filePath).pipe(response);
    return true;
  }

  if (request.method === "POST" && pathname === "/api/workouts") {
    const session = await readRequestJson<WorkoutSession>(request);
    if (!session?.id || !session?.date || !Array.isArray(session.exercises)) {
      sendError(request, response, 400, "Workout id, date, and exercises are required.");
      return true;
    }

    const deletedWorkouts = await readJson<DeletedWorkouts>(
      join(dataRoot, "deleted-workouts.json"),
      { ids: [] }
    );
    if ((deletedWorkouts.ids || []).includes(session.id)) {
      sendJson(request, response, 200, { ok: true, discarded: true, reason: "deleted" });
      return true;
    }

    const filename = `${safeId(session.id, `workout-${Date.now()}`)}.json`;
    const workoutPath = join(dataRoot, "workouts", filename);
    const existing = await readJson<WorkoutSession | null>(workoutPath, null);
    const existingTime = Date.parse(existing?.updatedAt || "1970-01-01");
    const incomingTime = Date.parse(session.updatedAt || "");
    if (existing && (!Number.isFinite(incomingTime) || incomingTime < existingTime)) {
      sendJson(request, response, 200, {
        ok: true,
        discarded: true,
        reason: "stale",
        currentUpdatedAt: existing.updatedAt || null
      });
      return true;
    }
    await atomicWriteJson(workoutPath, session);
    sendJson(request, response, 200, { ok: true, savedAt: new Date().toISOString() });
    return true;
  }

  if (request.method === "PUT" && pathname === "/api/profile") {
    const profile = await readRequestJson<Profile>(request);
    if (!profile || typeof profile !== "object") {
      sendError(request, response, 400, "A profile object is required.");
      return true;
    }

    profile.schemaVersion = 1;
    profile.updatedAt = new Date().toISOString();
    await atomicWriteJson(join(dataRoot, "profile.json"), profile);
    sendJson(request, response, 200, { ok: true, profile });
    return true;
  }

  if (request.method === "PUT" && pathname === "/api/gym") {
    const gym = await readRequestJson<Gym>(request);
    if (!gym?.id || !Array.isArray(gym.equipment)) {
      sendError(request, response, 400, "Gym id and equipment are required.");
      return true;
    }

    gym.schemaVersion = 1;
    gym.updatedAt = new Date().toISOString();
    const currentPath = join(dataRoot, "gyms", "current.json");
    const previousGym = await readJson<Gym | null>(currentPath, null);
    if (previousGym?.id && previousGym.id !== gym.id) {
      const previousName = `${safeId(previousGym.id, "previous-gym")}.json`;
      await atomicWriteJson(join(dataRoot, "gyms", previousName), previousGym);
    }
    const gymName = `${safeId(gym.id, "current-gym")}.json`;
    await atomicWriteJson(join(dataRoot, "gyms", gymName), gym);
    await atomicWriteJson(currentPath, gym);
    sendJson(request, response, 200, { ok: true, gym });
    return true;
  }

  if (request.method === "POST" && pathname === "/api/inbody-import") {
    const body = await readRequestJson<InBodyImportPayload>(request);
    if (!body?.content || typeof body.content !== "string") {
      sendError(request, response, 400, "CSV content is required.");
      return true;
    }

    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
    const filename = `${stamp}-${safeCsvName(body.filename)}`;
    const directory = join(inbodyRoot, "imports");
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, filename), body.content, "utf8");
    sendJson(request, response, 201, {
      ok: true,
      url: `/api/inbody/imports/${encodeURIComponent(filename)}`
    });
    return true;
  }

  return false;
}

function resolveRequest(pathname: string): string | null {
  const configuredPath = staticFiles.get(pathname);
  if (configuredPath) return resolveInside(staticRoot, configuredPath);
  if (!extname(pathname) && !pathname.startsWith("/api/")) {
    return resolveInside(staticRoot, "index.html");
  }
  return null;
}

function localNetworkUrls(): string[] {
  const addresses = [];
  for (const interfaces of Object.values(networkInterfaces())) {
    for (const item of interfaces || []) {
      if (item.family === "IPv4" && !item.internal) {
        addresses.push(`http://${item.address}:${port}/`);
      }
    }
  }
  return addresses;
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${host}:${port}`);
    const pathname = decodeURIComponent(url.pathname);

    if (pathname.startsWith("/api/")) {
      const handled = await handleApi(request, response, pathname);
      if (!handled) sendError(request, response, 404, "API route not found.");
      return;
    }

    const filePath = resolveRequest(pathname);
    if (!filePath || !existsSync(filePath)) {
      response.writeHead(404, securityHeaders(request));
      response.end("Not found");
      return;
    }

    response.writeHead(200, {
      ...securityHeaders(request),
      "Content-Type": contentTypes[extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    createReadStream(filePath).pipe(response);
  } catch (error) {
    sendError(
      request,
      response,
      500,
      error instanceof Error ? error.message : "Unexpected server error."
    );
  }
});

server.listen(port, host, () => {
  const listeningPort = (server.address() as AddressInfo).port;
  console.log(`Workout OS running at http://127.0.0.1:${listeningPort}/`);
  if (host !== "127.0.0.1" && host !== "localhost") {
    for (const url of localNetworkUrls()) console.log(`Phone on the same Wi-Fi: ${url}`);
  }
  console.log(`Static root: ${staticRoot}`);
  console.log(`Data root: ${dataRoot}`);
  console.log(`InBody root: ${inbodyRoot}`);
});
