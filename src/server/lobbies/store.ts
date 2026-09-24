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
    // Whole minutes after the vote started; becomes `banUntil` on a kickban action.
    banMinutes?: number;
    // Derives quorum/majority from the player slots and pads the voters with simulated ones.
    fillFromTeams?: boolean;
    // Ids need not belong to a lobby member: simulated voters exist to exercise client rendering.
    voters?: Record<string, LobbyVoteChoice>;
    removeVoters?: string[];
};

const DEFAULT_VOTE_DURATION_SECONDS = 60;
const DEFAULT_VOTE_QUORUM = 1;
// Fraction (0..1) of non-abstaining votes that must be yes.
const DEFAULT_VOTE_MAJORITY = 0.5;

const lobbies = new Map<string, LobbyState>();
// userId -> lobbyId, so membership lookups stay O(1) for the per-request guards.
const memberLobby = new Map<string, string>();
// The expiry timer, start time and admin defaults have no place on the protocol type, so they are kept beside the lobby.
const voteTimers = new Map<string, NodeJS.Timeout>();
const voteStartedAt = new Map<string, number>();
const voteDefaults = new Map<string, LobbyVoteInput>();

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
    voteStartedAt.delete(id);
    voteDefaults.delete(id);
    lobbies.delete(id);
    return memberIds;
}

export function getVoteDefaults(id: string): LobbyVoteInput {
    return structuredClone(voteDefaults.get(id) ?? {});
}

export function setVoteDefaults(id: string, input: LobbyVoteInput): boolean {
    if (!lobbies.has(id)) return false;
    voteDefaults.set(id, structuredClone(input));
    return true;
}

export function getVoteStartedAt(id: string): number | undefined {
    return lobbies.get(id)?.currentVote ? voteStartedAt.get(id) : undefined;
}

function countPlayerSlots(lobby: LobbyState): number {
    let slots = 0;
    for (const allyTeam of Object.values(lobby.allyTeamConfig)) {
        for (const team of Object.values(allyTeam.teams)) slots += team.maxPlayers;
    }
    return slots;
}

// Unlike the joinable slots, a vote fill counts every team `maxTeams` allows; unlisted teams hold one player.
function countVoteSlots(lobby: LobbyState): number {
    let slots = 0;
    for (const allyTeam of Object.values(lobby.allyTeamConfig)) {
        const teams = Object.values(allyTeam.teams);
        for (const team of teams) slots += team.maxPlayers;
        slots += Math.max(0, allyTeam.maxTeams - teams.length);
    }
    return slots;
}

function withBanUntil(action: LobbyVoteAction, banMinutes: number | undefined, startedAt: number): LobbyVoteAction {
    if (action.type !== "kickban" || banMinutes === undefined) return action;
    return { ...action, banUntil: startedAt + banMinutes * 60 * 1000 * 1000 };
}

function simulatedVoterId(voters: LobbyVote["voters"]): string {
    let userId: string;
    do {
        userId = String(Math.floor(Math.random() * 1000000)).padStart(6, "0");
    } while (userId in voters);
    return userId;
}

function clearVoteTimer(id: string): void {
    clearTimeout(voteTimers.get(id));
    voteTimers.delete(id);
}

/**
 * Arms the expiry timer for the lobby's current vote. `onExpiry` is injected so the store stays
 * free of any dependency on the broadcast layer.
 */
export function armVoteTimer(id: string, onExpiry: (lobbyId: string) => void): void {
    const lobby = lobbies.get(id);
    clearVoteTimer(id);
    if (!lobby?.currentVote) return;
    const delayMs = Math.max(0, Math.round(lobby.currentVote.until / 1000 - Date.now()));
    voteTimers.set(
        id,
        setTimeout(() => onExpiry(id), delayMs)
    );
}

/**
 * Mock votes are decoupled from lobby state on purpose: the voter list is a snapshot taken at
 * creation and is never reconciled when members join or leave.
 */
export function createVote(id: string, input: LobbyVoteInput = {}): LobbyVote | undefined {
    const lobby = lobbies.get(id);
    if (!lobby) return undefined;

    // Filling models player slots, so spectators are left out of the vote.
    const memberIds = (input.fillFromTeams ? Object.keys(lobby.players) : getLobbyMemberIds(id)).sort();
    const voters: LobbyVote["voters"] = {};
    for (const userId of memberIds) voters[userId] = { vote: input.voters?.[userId] ?? "pending" };

    let quorum = input.quorum ?? DEFAULT_VOTE_QUORUM;
    let majority = input.majority ?? DEFAULT_VOTE_MAJORITY;
    if (input.fillFromTeams) {
        // Real players take the first slots; simulated voters fill whatever is left.
        const slots = countVoteSlots(lobby);
        while (Object.keys(voters).length < slots) voters[simulatedVoterId(voters)] = { vote: "pending" };
        quorum = Math.ceil(slots / 2);
        majority = 0.5;
    }

    clearVoteTimer(id);
    const startedAt = unixTimeIn(0);
    voteStartedAt.set(id, startedAt);
    lobby.currentVote = {
        id: randomUUID(),
        action: withBanUntil(input.action ?? { type: "start" }, input.banMinutes, startedAt),
        initiator: input.initiator ?? memberIds[0] ?? "",
        voters,
        until: unixTimeIn(input.durationSeconds ?? DEFAULT_VOTE_DURATION_SECONDS),
        quorum,
        majority,
    };
    return lobby.currentVote;
}

export function updateVote(id: string, input: LobbyVoteInput): LobbyVote | undefined {
    const lobby = lobbies.get(id);
    const vote = lobby?.currentVote;
    if (!vote) return undefined;

    if (input.action !== undefined || input.banMinutes !== undefined) {
        vote.action = withBanUntil(input.action ?? vote.action, input.banMinutes, voteStartedAt.get(id) ?? unixTimeIn(0));
    }
    if (input.initiator !== undefined) vote.initiator = input.initiator;
    if (input.durationSeconds !== undefined) vote.until = unixTimeIn(input.durationSeconds);
    if (input.quorum !== undefined) vote.quorum = input.quorum;
    if (input.majority !== undefined) vote.majority = input.majority;
    for (const userId of input.removeVoters ?? []) delete vote.voters[userId];
    for (const [userId, choice] of Object.entries(input.voters ?? {})) vote.voters[userId] = { vote: choice };

    return vote;
}

export function endVote(id: string, outcome: LobbyVoteOutcome): { id: string; outcome: LobbyVoteOutcome } | undefined {
    const lobby = lobbies.get(id);
    const vote = lobby?.currentVote;
    if (!lobby || !vote) return undefined;

    clearVoteTimer(id);
    lobby.voteHistory = { ...lobby.voteHistory, [vote.id]: { vote: vote.action, outcome, finishedAt: unixTimeIn(0) } };
    delete lobby.currentVote;
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
    const maxPlayerCount = countPlayerSlots(lobby);
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
