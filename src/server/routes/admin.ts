import type { FastifyPluginAsync } from "fastify";
import { getPassword, setPassword } from "../auth/password.js";
import { getAutohostProcessState, startAutohostProcess, stopAutohostProcess } from "../autohost/process.js";
import { getConnectedClientByUserId, getConnectedClientCount, getConnectedClients } from "../ws/connectedClients.js";
import { isAutohostConnected } from "../ws/connectedAutohosts.js";
import { config } from "../config.js";
import { downloadAndExtractEngine, listInstalledEngines } from "../services/engineService.js";
import { getFoundTimeoutSeconds, setFoundTimeoutSeconds } from "../ws/tachyon/matchmaking/matchmaker.js";
import { broadcastLobbyChange, broadcastLobbyListReset, sendLobbyLeft, snapshotLobby } from "../lobbies/broadcast.js";
import { getLobbyDefaults, setLobbyDefaults, type LobbyDefaults } from "../lobbies/defaults.js";
import {
    createLobby,
    deleteLobby,
    getLobby,
    joinAllyTeam,
    listLobbies,
    spectate,
    toOverview,
    updateLobbyConfig,
    type LobbyAllyTeamInput,
    type LobbyConfigInput,
    type LobbyState,
    type LobbyStartBox,
} from "../lobbies/store.js";

function parseStartBox(value: unknown): LobbyStartBox | undefined {
    if (typeof value !== "object" || value === null) return undefined;
    const box = value as Record<string, unknown>;
    const parsed = { top: Number(box.top), bottom: Number(box.bottom), left: Number(box.left), right: Number(box.right) };
    return Object.values(parsed).every((side) => Number.isFinite(side)) ? parsed : undefined;
}

function parseAllyTeams(value: unknown): LobbyAllyTeamInput[] | undefined {
    if (!Array.isArray(value) || value.length < 1) return undefined;
    const allyTeams: LobbyAllyTeamInput[] = [];
    for (const entry of value) {
        if (typeof entry !== "object" || entry === null) return undefined;
        const { startBox, maxTeams, teams } = entry as Record<string, unknown>;
        if (!Array.isArray(teams) || teams.length < 1) return undefined;

        const parsedTeams: { maxPlayers: number }[] = [];
        for (const team of teams) {
            const maxPlayers = Number((team as Record<string, unknown> | null)?.maxPlayers);
            if (!Number.isInteger(maxPlayers) || maxPlayers < 1) return undefined;
            parsedTeams.push({ maxPlayers });
        }

        const parsedMaxTeams = Number(maxTeams);
        if (!Number.isInteger(parsedMaxTeams) || parsedMaxTeams < parsedTeams.length) return undefined;

        const parsedStartBox = parseStartBox(startBox);
        if (!parsedStartBox) return undefined;

        allyTeams.push({ startBox: parsedStartBox, maxTeams: parsedMaxTeams, teams: parsedTeams });
    }
    return allyTeams;
}

function parseNonEmptyString(value: unknown): string | undefined {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

async function isEngineInstalled(version: string): Promise<boolean> {
    const engines = await listInstalledEngines(config.enginesDir);
    return engines.some((engine) => engine.version === version && engine.exists);
}

// The admin panel needs usernames, which the protocol lobby state deliberately omits.
function describeLobby(lobby: LobbyState) {
    const withUsername = (userId: string) => ({ userId, username: getConnectedClientByUserId(userId)?.username ?? null });
    return {
        ...lobby,
        overview: toOverview(lobby),
        members: [
            ...Object.values(lobby.players).map((player) => ({ ...withUsername(player.id), allyTeam: player.allyTeam, team: player.team })),
            ...Object.values(lobby.spectators).map((spectator) => ({ ...withUsername(spectator.id), allyTeam: null, team: null })),
        ],
    };
}

export const adminRoutes: FastifyPluginAsync = async (app) => {
    app.get("/api/admin/status", async () => ({
        connectedClients: getConnectedClientCount(),
        clients: getConnectedClients(),
        autohost: { ...getAutohostProcessState(), connected: isAutohostConnected() },
        matchmaking: { foundTimeoutSeconds: getFoundTimeoutSeconds() },
    }));

    app.put("/api/admin/matchmaking/timeout", async (request, reply) => {
        const seconds = Number((request.body as { foundTimeoutSeconds?: unknown } | undefined)?.foundTimeoutSeconds);
        if (!Number.isFinite(seconds) || seconds <= 0) {
            return reply.code(400).send({ error: "invalid_timeout" });
        }
        setFoundTimeoutSeconds(seconds);
        return { foundTimeoutSeconds: getFoundTimeoutSeconds() };
    });

    app.get("/api/admin/password", async () => ({ password: getPassword() }));

    app.put("/api/admin/password", async (request, reply) => {
        const password = (request.body as { password?: string }).password ?? "";
        if (password.length < 1 || password.length > 256) {
            return reply.code(400).send({ error: "invalid_password" });
        }
        setPassword(password);
        return { password };
    });

    app.post("/api/admin/autohost/start", async (request, reply) => {
        const result = await startAutohostProcess(app.log);
        if (!result.ok) return reply.code(409).send({ error: result.error });
        return { ...getAutohostProcessState(), connected: isAutohostConnected() };
    });

    app.post("/api/admin/autohost/stop", async (request, reply) => {
        const result = stopAutohostProcess(app.log);
        if (!result.ok) return reply.code(409).send({ error: result.error });
        return { ...getAutohostProcessState(), connected: isAutohostConnected() };
    });

    app.get("/api/admin/engines/installed", async () => {
        const engines = await listInstalledEngines(config.enginesDir);
        return { engines };
    });

    app.get("/api/admin/lobbies", async () => ({
        lobbies: listLobbies().map(describeLobby),
        defaults: getLobbyDefaults(),
    }));

    app.put("/api/admin/lobbies/defaults", async (request, reply) => {
        const body = (request.body ?? {}) as Record<string, unknown>;
        const current = getLobbyDefaults();
        const next: LobbyDefaults = {
            mapName: parseNonEmptyString(body.mapName) ?? current.mapName,
            gameVersion: parseNonEmptyString(body.gameVersion) ?? current.gameVersion,
            engineVersion: parseNonEmptyString(body.engineVersion) ?? current.engineVersion,
        };
        if (!(await isEngineInstalled(next.engineVersion))) {
            return reply.code(400).send({ error: "invalid_engine_version" });
        }
        setLobbyDefaults(next);
        return { defaults: getLobbyDefaults() };
    });

    app.post("/api/admin/lobbies/reset", async () => {
        broadcastLobbyListReset();
        return { success: true };
    });

    app.post("/api/admin/lobbies", async (request, reply) => {
        const body = (request.body ?? {}) as Record<string, unknown>;
        const defaults = getLobbyDefaults();
        const input: LobbyConfigInput = {
            name: parseNonEmptyString(body.name) ?? "",
            mapName: parseNonEmptyString(body.mapName) ?? defaults.mapName,
            gameVersion: parseNonEmptyString(body.gameVersion) ?? defaults.gameVersion,
            engineVersion: parseNonEmptyString(body.engineVersion) ?? defaults.engineVersion,
            allyTeams: parseAllyTeams(body.allyTeams) ?? [],
        };
        if (input.name.length === 0 || input.allyTeams.length === 0) {
            return reply.code(400).send({ error: "invalid_lobby_config" });
        }
        if (!(await isEngineInstalled(input.engineVersion))) {
            return reply.code(400).send({ error: "invalid_engine_version" });
        }

        const lobby = createLobby(input);
        broadcastLobbyChange(undefined, lobby);
        return { lobby: describeLobby(lobby) };
    });

    app.put("/api/admin/lobbies/:id", async (request, reply) => {
        const { id } = request.params as { id: string };
        if (!getLobby(id)) return reply.code(404).send({ error: "invalid_lobby_id" });

        const body = (request.body ?? {}) as Record<string, unknown>;
        const changes: Partial<LobbyConfigInput> = {};

        for (const field of ["name", "mapName", "gameVersion", "engineVersion"] as const) {
            if (body[field] === undefined) continue;
            const parsed = parseNonEmptyString(body[field]);
            if (!parsed) return reply.code(400).send({ error: "invalid_lobby_config" });
            changes[field] = parsed;
        }
        if (body.allyTeams !== undefined) {
            const allyTeams = parseAllyTeams(body.allyTeams);
            if (!allyTeams) return reply.code(400).send({ error: "invalid_lobby_config" });
            changes.allyTeams = allyTeams;
        }
        if (changes.engineVersion !== undefined && !(await isEngineInstalled(changes.engineVersion))) {
            return reply.code(400).send({ error: "invalid_engine_version" });
        }

        const before = snapshotLobby(id);
        const lobby = updateLobbyConfig(id, changes);
        if (!lobby) return reply.code(404).send({ error: "invalid_lobby_id" });
        broadcastLobbyChange(before, snapshotLobby(id));
        return { lobby: describeLobby(lobby) };
    });

    app.delete("/api/admin/lobbies/:id", async (request, reply) => {
        const { id } = request.params as { id: string };
        const before = snapshotLobby(id);
        const memberIds = deleteLobby(id);
        if (!memberIds || !before) return reply.code(404).send({ error: "invalid_lobby_id" });

        for (const userId of memberIds) sendLobbyLeft(userId, id, "lobby_closed");
        broadcastLobbyChange(before, undefined);
        return { success: true };
    });

    app.post("/api/admin/lobbies/:id/members/:userId/allyTeam", async (request, reply) => {
        const { id, userId } = request.params as { id: string; userId: string };
        const allyTeam = parseNonEmptyString((request.body as Record<string, unknown> | undefined)?.allyTeam);
        if (!allyTeam) return reply.code(400).send({ error: "invalid_ally_team" });

        const before = snapshotLobby(id);
        if (!before) return reply.code(404).send({ error: "invalid_lobby_id" });

        const result = joinAllyTeam(userId, allyTeam);
        if (result !== "ok") return reply.code(400).send({ error: result });
        broadcastLobbyChange(before, snapshotLobby(id));
        return { success: true };
    });

    app.post("/api/admin/lobbies/:id/members/:userId/spectate", async (request, reply) => {
        const { id, userId } = request.params as { id: string; userId: string };
        const before = snapshotLobby(id);
        if (!before) return reply.code(404).send({ error: "invalid_lobby_id" });
        if (!spectate(userId)) return reply.code(400).send({ error: "not_in_lobby" });
        broadcastLobbyChange(before, snapshotLobby(id));
        return { success: true };
    });

    app.post("/api/admin/engines/download", async (request, reply) => {
        const { version } = (request.body as { version?: string }) ?? {};
        if (!version || typeof version !== "string" || version.length === 0) {
            return reply.code(400).send({ error: "invalid_version" });
        }

        try {
            await downloadAndExtractEngine(version, config.engineReleaseUrl, config.enginesDir);
            const engines = await listInstalledEngines(config.enginesDir);
            return { success: true, engines };
        } catch (error) {
            app.log.error(error);
            return reply.code(500).send({
                error: "download_failed",
                message: error instanceof Error ? error.message : String(error),
            });
        }
    });

    app.post("/api/admin/shutdown", async (request, reply) => {
        // Stop autohost if running
        stopAutohostProcess(app.log);

        // Send success response before shutting down
        reply.code(200).send({ success: true });

        // Give the response time to send, then gracefully shutdown
        setTimeout(() => {
            app.log.info("Server shutting down on admin request");
            app.close().catch((err) => {
                app.log.error(err, "Error closing server");
                process.exit(1);
            });
        }, 100);
    });
};
