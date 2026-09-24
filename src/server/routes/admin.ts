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
    deleteVoteHistoryEntry,
    getLobby,
    getVoteDefaults,
    getVoteStartedAt,
    joinAllyTeam,
    setVoteDefaults,
    listLobbies,
    spectate,
    toOverview,
    updateLobbyConfig,
    type LobbyAllyTeamInput,
    type LobbyConfigInput,
    type LobbyState,
    type LobbyStartBox,
    type LobbyVoteAction,
    type LobbyVoteChoice,
    type LobbyVoteInput,
    type LobbyVoteOutcome,
} from "../lobbies/store.js";
import { changeVote, finishVote, startVote } from "../lobbies/votes.js";

const VOTE_CHOICES: LobbyVoteChoice[] = ["pending", "yes", "no", "abstain"];
const VOTE_OUTCOMES: LobbyVoteOutcome[] = ["passed", "failed", "cancelled", "timeout"];

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

function parseVoteAction(value: unknown): LobbyVoteAction | undefined {
    if (typeof value !== "object" || value === null) return undefined;
    const action = value as Record<string, unknown>;
    switch (action.type) {
        case "start":
            return { type: "start" };
        case "changeMap": {
            const newMapName = parseNonEmptyString(action.newMapName);
            return newMapName ? { type: "changeMap", newMapName } : undefined;
        }
        case "appointBoss": {
            const bossId = parseNonEmptyString(action.bossId);
            return bossId ? { type: "appointBoss", bossId } : undefined;
        }
        case "kickban": {
            const userId = parseNonEmptyString(action.userId);
            if (!userId) return undefined;
            if (action.banUntil === undefined || action.banUntil === null) return { type: "kickban", userId };
            const banUntil = Number(action.banUntil);
            return Number.isFinite(banUntil) ? { type: "kickban", userId, banUntil } : undefined;
        }
        default:
            return undefined;
    }
}

function parsePositiveNumber(value: unknown): number | undefined {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

// Returns null (rather than undefined) when a supplied field is malformed, so callers can 400.
function parseVoteInput(body: Record<string, unknown>): LobbyVoteInput | null {
    const input: LobbyVoteInput = {};

    if (body.action !== undefined) {
        const action = parseVoteAction(body.action);
        if (!action) return null;
        input.action = action;
    }
    if (body.initiator !== undefined) {
        const initiator = parseNonEmptyString(body.initiator);
        if (!initiator) return null;
        input.initiator = initiator;
    }
    for (const field of ["durationSeconds", "quorum", "majority"] as const) {
        if (body[field] === undefined) continue;
        const parsed = parsePositiveNumber(body[field]);
        if (parsed === undefined) return null;
        input[field] = parsed;
    }
    if (input.majority !== undefined && input.majority > 1) return null;
    if (body.banMinutes !== undefined && body.banMinutes !== null) {
        const banMinutes = Number(body.banMinutes);
        if (!Number.isInteger(banMinutes) || banMinutes < 1) return null;
        input.banMinutes = banMinutes;
    }
    if (body.fillFromTeams !== undefined) {
        if (typeof body.fillFromTeams !== "boolean") return null;
        input.fillFromTeams = body.fillFromTeams;
    }
    if (body.voters !== undefined) {
        if (typeof body.voters !== "object" || body.voters === null) return null;
        const voters: Record<string, LobbyVoteChoice> = {};
        for (const [userId, choice] of Object.entries(body.voters as Record<string, unknown>)) {
            if (!VOTE_CHOICES.includes(choice as LobbyVoteChoice)) return null;
            voters[userId] = choice as LobbyVoteChoice;
        }
        input.voters = voters;
    }
    if (body.removeVoters !== undefined) {
        if (!Array.isArray(body.removeVoters)) return null;
        const removeVoters: string[] = [];
        for (const userId of body.removeVoters) {
            const parsed = parseNonEmptyString(userId);
            if (!parsed) return null;
            removeVoters.push(parsed);
        }
        input.removeVoters = removeVoters;
    }

    return input;
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
        voteDefaults: getVoteDefaults(lobby.id),
        voteStartedAt: getVoteStartedAt(lobby.id),
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

    app.post("/api/admin/lobbies/:id/vote", async (request, reply) => {
        const { id } = request.params as { id: string };
        if (!getLobby(id)) return reply.code(404).send({ error: "invalid_lobby_id" });

        const input = parseVoteInput((request.body ?? {}) as Record<string, unknown>);
        if (!input) return reply.code(400).send({ error: "invalid_vote" });

        const vote = startVote(id, { ...getVoteDefaults(id), ...input });
        if (!vote) return reply.code(404).send({ error: "invalid_lobby_id" });
        return { vote };
    });

    app.put("/api/admin/lobbies/:id/vote/defaults", async (request, reply) => {
        const { id } = request.params as { id: string };
        const input = parseVoteInput((request.body ?? {}) as Record<string, unknown>);
        if (!input) return reply.code(400).send({ error: "invalid_vote" });
        if (!setVoteDefaults(id, input)) return reply.code(404).send({ error: "invalid_lobby_id" });
        return { voteDefaults: getVoteDefaults(id) };
    });

    app.put("/api/admin/lobbies/:id/vote", async (request, reply) => {
        const { id } = request.params as { id: string };
        if (!getLobby(id)) return reply.code(404).send({ error: "invalid_lobby_id" });

        const input = parseVoteInput((request.body ?? {}) as Record<string, unknown>);
        if (!input) return reply.code(400).send({ error: "invalid_vote" });

        const vote = changeVote(id, input);
        if (!vote) return reply.code(400).send({ error: "no_active_vote" });
        return { vote };
    });

    app.post("/api/admin/lobbies/:id/vote/end", async (request, reply) => {
        const { id } = request.params as { id: string };
        if (!getLobby(id)) return reply.code(404).send({ error: "invalid_lobby_id" });

        const outcome = (request.body as { outcome?: unknown } | undefined)?.outcome as LobbyVoteOutcome;
        if (!VOTE_OUTCOMES.includes(outcome)) return reply.code(400).send({ error: "invalid_outcome" });
        if (!finishVote(id, outcome)) return reply.code(400).send({ error: "no_active_vote" });
        return { success: true };
    });

    app.delete("/api/admin/lobbies/:id/vote/history/:entryId", async (request, reply) => {
        const { id, entryId } = request.params as { id: string; entryId: string };
        const before = snapshotLobby(id);
        if (!before) return reply.code(404).send({ error: "invalid_lobby_id" });
        if (!deleteVoteHistoryEntry(id, entryId)) return reply.code(404).send({ error: "invalid_vote_id" });
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
