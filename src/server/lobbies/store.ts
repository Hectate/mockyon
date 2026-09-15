import { randomUUID } from "node:crypto";
import type { TachyonEventDataFor, TachyonSuccessResponseFor } from "../ws/tachyon/types.js";

export type LobbyState = TachyonSuccessResponseFor<"lobby/join">["data"];
export type LobbyOverview = TachyonEventDataFor<"lobby/listReset">["lobbies"][string];
export type LobbyStartBox = LobbyState["allyTeamConfig"][string]["startBox"];

export type LobbyAllyTeamInput = {
    startBox: LobbyStartBox;
    maxTeams: number;
    teams: { maxPlayers: number }[];
};

export type LobbyConfigInput = {
    name: string;
    mapName: string;
    gameVersion: string;
    engineVersion: string;
    allyTeams: LobbyAllyTeamInput[];
};

export type JoinAllyTeamResult = "ok" | "not_in_lobby" | "invalid_request" | "ally_team_full";

const lobbies = new Map<string, LobbyState>();
// userId -> lobbyId, so membership lookups stay O(1) for the per-request guards.
const memberLobby = new Map<string, string>();

// Map keys represent arrays and must sort lexicographically, so they are zero padded.
function indexKey(index: number): string {
    return String(index).padStart(2, "0");
}

function buildAllyTeamConfig(allyTeams: LobbyAllyTeamInput[]): LobbyState["allyTeamConfig"] {
    const config: LobbyState["allyTeamConfig"] = {};
    allyTeams.forEach((allyTeam, allyTeamIndex) => {
        const teams: LobbyState["allyTeamConfig"][string]["teams"] = {};
        allyTeam.teams.forEach((team, teamIndex) => {
            teams[indexKey(teamIndex)] = { maxPlayers: team.maxPlayers };
        });
        config[indexKey(allyTeamIndex)] = {
            startBox: { ...allyTeam.startBox },
            maxTeams: allyTeam.maxTeams,
            teams,
        };
    });
    return config;
}

export function createLobby(input: LobbyConfigInput): LobbyState {
    const lobby: LobbyState = {
        id: randomUUID(),
        name: input.name,
        mapName: input.mapName,
        engineVersion: input.engineVersion,
        gameVersion: input.gameVersion,
        gameOptions: {},
        allyTeamConfig: buildAllyTeamConfig(input.allyTeams),
        // The admin panel is the boss, so no client is ever appointed one.
        areBossesEnabled: false,
        bosses: {},
        players: {},
        spectators: {},
        bots: {},
    };
    lobbies.set(lobby.id, lobby);
    return lobby;
}

export function getLobby(id: string): LobbyState | undefined {
    return lobbies.get(id);
}

export function listLobbies(): LobbyState[] {
    return [...lobbies.values()];
}

export function getLobbyIdForUser(userId: string): string | undefined {
    return memberLobby.get(userId);
}

export function getLobbyMemberIds(id: string): string[] {
    const lobby = lobbies.get(id);
    return lobby ? [...Object.keys(lobby.players), ...Object.keys(lobby.spectators)] : [];
}

export function setLobbyCurrentBattle(id: string, currentBattle: NonNullable<LobbyState["currentBattle"]> | undefined): LobbyState | undefined {
    const lobby = lobbies.get(id);
    if (!lobby) return undefined;
    if (currentBattle) lobby.currentBattle = currentBattle;
    else delete lobby.currentBattle;
    return lobby;
}

export function updateLobbyConfig(id: string, changes: Partial<LobbyConfigInput>): LobbyState | undefined {
    const lobby = lobbies.get(id);
    if (!lobby) return undefined;

    if (changes.name !== undefined) lobby.name = changes.name;
    if (changes.mapName !== undefined) lobby.mapName = changes.mapName;
    if (changes.gameVersion !== undefined) lobby.gameVersion = changes.gameVersion;
    if (changes.engineVersion !== undefined) lobby.engineVersion = changes.engineVersion;

    if (changes.allyTeams !== undefined) {
        const next = buildAllyTeamConfig(changes.allyTeams);
        if (JSON.stringify(next) !== JSON.stringify(lobby.allyTeamConfig)) {
            lobby.allyTeamConfig = next;
            // Slot assignments can't survive a layout change, so everyone falls back to spectating.
            for (const userId of Object.keys(lobby.players)) {
                delete lobby.players[userId];
                lobby.spectators[userId] = { id: userId };
            }
        }
    }

    return lobby;
}

export function deleteLobby(id: string): string[] | undefined {
    const lobby = lobbies.get(id);
    if (!lobby) return undefined;
    const memberIds = getLobbyMemberIds(id);
    for (const userId of memberIds) memberLobby.delete(userId);
    lobbies.delete(id);
    return memberIds;
}

export function addSpectator(lobbyId: string, userId: string): boolean {
    const lobby = lobbies.get(lobbyId);
    if (!lobby) return false;
    delete lobby.players[userId];
    lobby.spectators[userId] = { id: userId };
    memberLobby.set(userId, lobbyId);
    return true;
}

export function removeMember(userId: string): string | undefined {
    const lobbyId = memberLobby.get(userId);
    if (!lobbyId) return undefined;
    memberLobby.delete(userId);
    const lobby = lobbies.get(lobbyId);
    if (lobby) {
        delete lobby.players[userId];
        delete lobby.spectators[userId];
    }
    return lobbyId;
}

function nextFreePlayerSlot(lobby: LobbyState, allyTeam: string, team: string): string {
    const taken = new Set(
        Object.values(lobby.players)
            .filter((player) => player.allyTeam === allyTeam && player.team === team)
            .map((player) => player.player)
    );
    for (let index = 0; ; index++) {
        const key = indexKey(index);
        if (!taken.has(key)) return key;
    }
}

export function joinAllyTeam(userId: string, allyTeam: string): JoinAllyTeamResult {
    const lobbyId = memberLobby.get(userId);
    const lobby = lobbyId ? lobbies.get(lobbyId) : undefined;
    if (!lobby) return "not_in_lobby";

    const allyTeamConfig = lobby.allyTeamConfig[allyTeam];
    if (!allyTeamConfig) return "invalid_request";

    const teamKey = Object.keys(allyTeamConfig.teams)
        .sort()
        .find((key) => {
            const occupants = Object.values(lobby.players).filter((player) => player.allyTeam === allyTeam && player.team === key && player.id !== userId);
            return occupants.length < allyTeamConfig.teams[key].maxPlayers;
        });
    if (teamKey === undefined) return "ally_team_full";

    delete lobby.players[userId];
    delete lobby.spectators[userId];
    lobby.players[userId] = {
        id: userId,
        allyTeam,
        team: teamKey,
        player: nextFreePlayerSlot(lobby, allyTeam, teamKey),
        isReady: false,
        assetStatus: "complete",
    };
    return "ok";
}

export function spectate(userId: string): boolean {
    const lobbyId = memberLobby.get(userId);
    const lobby = lobbyId ? lobbies.get(lobbyId) : undefined;
    if (!lobby) return false;
    delete lobby.players[userId];
    lobby.spectators[userId] = { id: userId };
    return true;
}

export function toOverview(lobby: LobbyState): LobbyOverview {
    let maxPlayerCount = 0;
    for (const allyTeam of Object.values(lobby.allyTeamConfig)) {
        for (const team of Object.values(allyTeam.teams)) maxPlayerCount += team.maxPlayers;
    }
    return {
        id: lobby.id,
        name: lobby.name,
        // Spectators don't occupy a slot, so they're excluded from the count.
        playerCount: Object.keys(lobby.players).length,
        maxPlayerCount,
        mapName: lobby.mapName,
        engineVersion: lobby.engineVersion,
        gameVersion: lobby.gameVersion,
        currentBattle: lobby.currentBattle ? { startedAt: lobby.currentBattle.startedAt } : null,
    };
}

export function listOverviews(): Record<string, LobbyOverview> {
    const overviews: Record<string, LobbyOverview> = {};
    for (const lobby of lobbies.values()) overviews[lobby.id] = toOverview(lobby);
    return overviews;
}
