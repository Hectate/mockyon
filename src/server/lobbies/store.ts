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

export type LobbyVote = NonNullable<LobbyState["currentVote"]>;
export type LobbyVoteAction = LobbyVote["action"];
export type LobbyVoteChoice = LobbyVote["voters"][string]["vote"];
export type LobbyVoteOutcome = NonNullable<LobbyState["voteHistory"]>[string]["outcome"];

export type LobbyVoteInput = {
    action?: LobbyVoteAction;
    initiator?: string;
    durationSeconds?: number;
    quorum?: number;
    majority?: number;
    // Ids need not belong to a lobby member: simulated voters exist to exercise client rendering.
    voters?: Record<string, LobbyVoteChoice>;
    removeVoters?: string[];
};

/**
 * `quorum`/`majority` only exist on the `lobby/updated` patch schema and the expiry timer has no
 * place on the protocol type, so they are kept beside the lobby rather than on it.
 */
type VoteExtras = { quorum?: number; majority?: number; timer?: NodeJS.Timeout };

const DEFAULT_VOTE_DURATION_SECONDS = 60;

const lobbies = new Map<string, LobbyState>();
// userId -> lobbyId, so membership lookups stay O(1) for the per-request guards.
const memberLobby = new Map<string, string>();
const voteExtras = new Map<string, VoteExtras>();

// Map keys represent arrays and must sort lexicographically, so they are zero padded.
function indexKey(index: number): string {
    return String(index).padStart(2, "0");
}

// Tachyon UnixTime is microseconds.
function unixTimeIn(seconds: number): number {
    return Math.round((Date.now() + seconds * 1000) * 1000);
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
    clearVoteTimer(id);
    voteExtras.delete(id);
    lobbies.delete(id);
    return memberIds;
}

export function getVoteExtras(id: string): { quorum?: number; majority?: number } {
    const extras = voteExtras.get(id);
    return { quorum: extras?.quorum, majority: extras?.majority };
}

function clearVoteTimer(id: string): void {
    const extras = voteExtras.get(id);
    if (extras?.timer) clearTimeout(extras.timer);
    if (extras) delete extras.timer;
}

/**
 * Arms the expiry timer for the lobby's current vote. `onExpiry` is injected so the store stays
 * free of any dependency on the broadcast layer.
 */
export function armVoteTimer(id: string, onExpiry: (lobbyId: string) => void): void {
    const lobby = lobbies.get(id);
    clearVoteTimer(id);
    if (!lobby?.currentVote) return;
    const extras = voteExtras.get(id);
    if (!extras) return;
    const delayMs = Math.max(0, Math.round(lobby.currentVote.until / 1000 - Date.now()));
    extras.timer = setTimeout(() => onExpiry(id), delayMs);
}

/**
 * Mock votes are decoupled from lobby state on purpose: the voter list is a snapshot taken at
 * creation and is never reconciled when members join or leave.
 */
export function createVote(id: string, input: LobbyVoteInput = {}): LobbyVote | undefined {
    const lobby = lobbies.get(id);
    if (!lobby) return undefined;

    const memberIds = getLobbyMemberIds(id).sort();
    const voters: LobbyVote["voters"] = {};
    for (const userId of memberIds) voters[userId] = { vote: input.voters?.[userId] ?? "pending" };

    clearVoteTimer(id);
    lobby.currentVote = {
        id: randomUUID(),
        action: input.action ?? { type: "start" },
        initiator: input.initiator ?? memberIds[0] ?? "",
        voters,
        until: unixTimeIn(input.durationSeconds ?? DEFAULT_VOTE_DURATION_SECONDS),
    };
    voteExtras.set(id, { quorum: input.quorum, majority: input.majority });
    return lobby.currentVote;
}

export function updateVote(id: string, input: LobbyVoteInput): LobbyVote | undefined {
    const lobby = lobbies.get(id);
    const vote = lobby?.currentVote;
    if (!vote) return undefined;

    if (input.action !== undefined) vote.action = input.action;
    if (input.initiator !== undefined) vote.initiator = input.initiator;
    if (input.durationSeconds !== undefined) vote.until = unixTimeIn(input.durationSeconds);
    for (const userId of input.removeVoters ?? []) delete vote.voters[userId];
    for (const [userId, choice] of Object.entries(input.voters ?? {})) vote.voters[userId] = { vote: choice };

    const extras = voteExtras.get(id) ?? {};
    if (input.quorum !== undefined) extras.quorum = input.quorum;
    if (input.majority !== undefined) extras.majority = input.majority;
    voteExtras.set(id, extras);

    return vote;
}

export function endVote(id: string, outcome: LobbyVoteOutcome): { id: string; outcome: LobbyVoteOutcome } | undefined {
    const lobby = lobbies.get(id);
    const vote = lobby?.currentVote;
    if (!lobby || !vote) return undefined;

    clearVoteTimer(id);
    lobby.voteHistory = { ...lobby.voteHistory, [vote.id]: { vote: vote.action, outcome, finishedAt: unixTimeIn(0) } };
    delete lobby.currentVote;
    voteExtras.set(id, {});
    return { id: vote.id, outcome };
}

export function deleteVoteHistoryEntry(id: string, entryId: string): boolean {
    const lobby = lobbies.get(id);
    if (!lobby?.voteHistory?.[entryId]) return false;
    delete lobby.voteHistory[entryId];
    return true;
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
