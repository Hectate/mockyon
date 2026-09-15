import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createSocket } from "node:dgram";
import { unlinkSync, writeFileSync } from "node:fs";
import { isIPv4 } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FastifyBaseLogger } from "fastify";
import { clearAutohostCredentials, registerAutohostCredentials } from "../auth/autohostClients.js";
import { config } from "../config.js";

export type AutohostProcessStatus = "stopped" | "starting" | "running" | "stopping";

export type AutohostProcessState = {
    status: AutohostProcessStatus;
    pid?: number;
    startedAt?: number;
    lastExitCode?: number | null;
};

let state: AutohostProcessState = { status: "stopped" };
let child: ChildProcess | undefined;
let exitLogger: FastifyBaseLogger | undefined;

export function getAutohostProcessState(): AutohostProcessState {
    return { ...state };
}

function forwardOutputLines(logger: FastifyBaseLogger, chunk: Buffer): void {
    for (const line of chunk.toString("utf-8").split(/\r?\n/)) {
        if (line.trim().length > 0) logger.info({ tag: "autohost" }, line);
    }
}

async function detectEngineHostIP(): Promise<string> {
    if (config.engineHostIP !== undefined) {
        if (!isIPv4(config.engineHostIP)) throw new Error("ENGINE_HOST_IP must be a valid IPv4 address");
        return config.engineHostIP;
    }

    return new Promise((resolve, reject) => {
        const socket = createSocket("udp4");
        const finish = (error?: Error) => {
            socket.close();
            if (error) reject(error);
        };
        socket.once("error", () => finish(new Error("could not detect a LAN IPv4 address; set ENGINE_HOST_IP explicitly")));
        socket.connect(53, "1.1.1.1", () => {
            const address = socket.address();
            if (typeof address === "string" || !isIPv4(address.address) || address.address.startsWith("127.")) {
                finish(new Error("could not detect a non-loopback LAN IPv4 address; set ENGINE_HOST_IP explicitly"));
                return;
            }
            resolve(address.address);
            finish();
        });
    });
}

export async function startAutohostProcess(logger: FastifyBaseLogger): Promise<{ ok: true } | { ok: false; error: string }> {
    if (state.status !== "stopped") return { ok: false, error: "already_running" };
    state = { status: "starting" };

    let hostingIP: string;
    try {
        hostingIP = await detectEngineHostIP();
    } catch (error) {
        state = { status: "stopped" };
        return { ok: false, error: error instanceof Error ? error.message : "could not detect engine host IP" };
    }

    exitLogger = logger;
    const clientId = `autohost-${randomBytes(6).toString("hex")}`;
    const clientSecret = randomBytes(24).toString("base64url");
    registerAutohostCredentials(clientId, clientSecret);

    // See vendor/recoil-autohost/src/config.ts for the full schema; only the required fields plus
    // the ones needed to point it at this server are set here.
    const autohostConfig = {
        tachyonServer: config.host === "0.0.0.0" ? "localhost" : config.host,
        tachyonServerPort: config.port,
        useSecureConnection: false,
        authClientId: clientId,
        authClientSecret: clientSecret,
        hostingIP,
        engineBindIP: "0.0.0.0",
        enginesPath: config.enginesDir,
        instancesPath: config.instancesDir,
    };
    const configPath = path.join(tmpdir(), `mockyon-autohost-${randomBytes(8).toString("hex")}.json`);
    writeFileSync(configPath, JSON.stringify(autohostConfig, null, 2), "utf-8");

    const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
    child = spawn(npmBin, ["run", "start", "--workspace=vendor/recoil-autohost", "--", configPath], {
        cwd: config.repoRoot,
        stdio: ["ignore", "pipe", "pipe"],
        shell: process.platform === "win32",
        // npm spawns further child processes (tsx, then node); detach so POSIX can signal the whole group.
        detached: process.platform !== "win32",
    });
    state = { status: "starting", pid: child.pid };

    child.stdout?.on("data", (chunk: Buffer) => forwardOutputLines(logger, chunk));
    child.stderr?.on("data", (chunk: Buffer) => forwardOutputLines(logger, chunk));
    child.on("spawn", () => {
        state = { ...state, status: "running", startedAt: Date.now() };
    });
    child.on("error", (err) => logger.error({ err }, "autohost process error"));
    child.on("exit", (code) => {
        state = { status: "stopped", lastExitCode: code };
        clearAutohostCredentials();
        try {
            unlinkSync(configPath);
        } catch {
            // best-effort cleanup only
        }
        child = undefined;
        exitLogger?.info({ tag: "autohost", exitCode: code }, "autohost process stopped");
    });

    return { ok: true };
}

export function stopAutohostProcess(logger: FastifyBaseLogger): { ok: true } | { ok: false; error: string } {
    if (!child || (state.status !== "running" && state.status !== "starting")) {
        return { ok: false, error: "not_running" };
    }
    logger.info({ tag: "autohost", pid: child.pid }, "stopping autohost process");
    state = { ...state, status: "stopping" };
    const current = child;
    const pid = current.pid;
    if (pid) killProcessTree(pid, "SIGTERM");
    setTimeout(() => {
        if (child === current && pid) killProcessTree(pid, "SIGKILL");
    }, 5000).unref();
    return { ok: true };
}

// npm (and on Windows, the cmd.exe shell wrapper) spawns further descendants; killing only the
// tracked pid leaves those running, so the whole tree needs to be targeted.
function killProcessTree(pid: number, signal: "SIGTERM" | "SIGKILL"): void {
    if (process.platform === "win32") {
        spawn("taskkill", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore" });
        return;
    }
    try {
        process.kill(-pid, signal);
    } catch {
        try {
            process.kill(pid, signal);
        } catch {
            // process may have already exited
        }
    }
}
