import { randomUUID } from "node:crypto";
import type { TachyonAutohostEventDataFor, TachyonAutohostRequestDataFor, TachyonUserRequestDataFor } from "../ws/tachyon/types.js";

export type BattleStartScript = TachyonAutohostRequestDataFor<"autohost/start">;
export type BattleUpdateData = TachyonAutohostEventDataFor<"autohost/update">;
export type BattleJoinInfo = TachyonUserRequestDataFor<"battle/start">;

type StartScriptPlayer = NonNullable<BattleStartScript["spectators"]>[number];

export type BattleSource = "lobby" | "matchmaking";
export type BattleStatus = "pending" | "running" | "ended";
export type BattleEndReason = "engine_quit" | "engine_crash";
export type BattleLeaveReason = "lost_connection" | "left" | "kicked";

export type BattlePlayer = {
    userId: string;
    name: string;
    // Secret used to join the engine server; only ever sent to this player.
    password: string;
    allyTeamIndex: number | null;
    teamIndex: number | null;
    isSpectator: boolean;
    playerNumber: number | null;
    inGame: boolean;
    defeated: boolean;
    leftReason: BattleLeaveReason | null;
};

export type BattleConnection = {
    ips: string[];
    port: number;
};

export type Battle = {
    battleId: string;
    source: BattleSource;
    status: BattleStatus;
    lobbyId: string | null;
    queueId: string | null;
    // Sent to the autohost verbatim; the source of truth for battle settings.
    startScript: BattleStartScript;
    players: BattlePlayer[];
    connection: BattleConnection | null;
    createdAt: number;
    startedAt: number | null;
    endedAt: number | null;
    endReason: BattleEndReason | null;
    winningAllyTeams: number[] | null;
};

export type BattlePlayerSummary = {
    userId: string;
    name: string;
    allyTeamIndex: number | null;
    teamIndex: number | null;
    isSpectator: boolean;
    inGame: boolean;
    defeated: boolean;
};

export type BattleSummary = {
    battleId: string;
    source: BattleSource;
    status: BattleStatus;
    lobbyId: string | null;
    queueId: string | null;
    engine: { version: string };
    game: { springName: string };
    map: { springName: string };
    createdAt: number;
    startedAt: number | null;
    endedAt: number | null;
    endReason: BattleEndReason | null;
    winningAllyTeams: number[] | null;
    players: BattlePlayerSummary[];
};

export type CreateBattleInput = {
    source: BattleSource;
    startScript: Omit<BattleStartScript, "battleId">;
    lobbyId?: string;
    queueId?: string;
};

// Ended battles are retained so their results stay inspectable; use removeBattle to drop them.
const battles = new Map<string, Battle>();

function toBattlePlayer(player: StartScriptPlayer, allyTeamIndex: number | null, teamIndex: number | null, isSpectator: boolean): BattlePlayer {
    return {
        userId: player.userId,
        name: player.name,
        password: player.password,
        allyTeamIndex,
        teamIndex,
        isSpectator,
        playerNumber: null,
        inGame: false,
        defeated: false,
        leftReason: null,
    };
}

function collectPlayers(startScript: BattleStartScript): BattlePlayer[] {
    const players: BattlePlayer[] = [];
    startScript.allyTeams.forEach((allyTeam, allyTeamIndex) => {
        allyTeam.teams.forEach((team, teamIndex) => {
            for (const player of team.players ?? []) players.push(toBattlePlayer(player, allyTeamIndex, teamIndex, false));
        });
    });
    for (const spectator of startScript.spectators ?? []) players.push(toBattlePlayer(spectator, null, null, true));
    return players;
}

function findPlayer(battle: Battle, userId: string): BattlePlayer | undefined {
    return battle.players.find((player) => player.userId === userId);
}

export function createBattle(input: CreateBattleInput): Battle {
    const battleId = randomUUID();
    const startScript: BattleStartScript = { ...input.startScript, battleId };
    const battle: Battle = {
        battleId,
        source: input.source,
        status: "pending",
        lobbyId: input.lobbyId ?? null,
        queueId: input.queueId ?? null,
        startScript,
        players: collectPlayers(startScript),
        connection: null,
        createdAt: Date.now(),
        startedAt: null,
        endedAt: null,
        endReason: null,
        winningAllyTeams: null,
    };
    battles.set(battleId, battle);
    return battle;
}

export function getBattle(battleId: string): Battle | undefined {
    return battles.get(battleId);
}

export function listBattles(): Battle[] {
    return [...battles.values()];
}

export function getBattleForUser(userId: string): Battle | undefined {
    return [...battles.values()].find((battle) => battle.status !== "ended" && findPlayer(battle, userId) !== undefined);
}

export function setBattleConnection(battleId: string, connection: BattleConnection): Battle | undefined {
    const battle = battles.get(battleId);
    if (!battle) return undefined;
    battle.connection = connection;
    return battle;
}

export function removeBattle(battleId: string): boolean {
    return battles.delete(battleId);
}

export function applyBattleUpdate(data: BattleUpdateData): Battle | undefined {
    const battle = battles.get(data.battleId);
    if (!battle) return undefined;

    // Protocol timestamps are microseconds.
    const at = Math.round(data.time / 1000);
    const update = data.update;

    switch (update.type) {
        case "start":
            battle.status = "running";
            battle.startedAt = at;
            break;
        case "finished":
            battle.winningAllyTeams = update.winningAllyTeams;
            break;
        case "player_joined": {
            const player = findPlayer(battle, update.userId);
            if (player) {
                player.inGame = true;
                player.playerNumber = update.playerNumber;
                player.leftReason = null;
            }
            break;
        }
        case "player_left": {
            const player = findPlayer(battle, update.userId);
            if (player) {
                player.inGame = false;
                player.leftReason = update.reason;
            }
            break;
        }
        case "player_defeated": {
            const player = findPlayer(battle, update.userId);
            if (player) player.defeated = true;
            break;
        }
        case "engine_quit":
        case "engine_crash":
            battle.status = "ended";
            battle.endedAt = at;
            battle.endReason = update.type;
            for (const player of battle.players) player.inGame = false;
            break;
        default:
            break;
    }

    return battle;
}

export function getBattleJoinInfo(battleId: string, userId: string): BattleJoinInfo | undefined {
    const battle = battles.get(battleId);
    if (!battle?.connection) return undefined;

    const player = findPlayer(battle, userId);
    if (!player) return undefined;

    return {
        battleId: battle.battleId,
        username: player.name,
        password: player.password,
        ips: battle.connection.ips,
        port: battle.connection.port,
        engine: { version: battle.startScript.engineVersion },
        game: { springName: battle.startScript.gameName },
        map: { springName: battle.startScript.mapName },
    };
}

export function describeBattle(battle: Battle): BattleSummary {
    return {
        battleId: battle.battleId,
        source: battle.source,
        status: battle.status,
        lobbyId: battle.lobbyId,
        queueId: battle.queueId,
        engine: { version: battle.startScript.engineVersion },
        game: { springName: battle.startScript.gameName },
        map: { springName: battle.startScript.mapName },
        createdAt: battle.createdAt,
        startedAt: battle.startedAt,
        endedAt: battle.endedAt,
        endReason: battle.endReason,
        winningAllyTeams: battle.winningAllyTeams,
        players: battle.players.map(({ userId, name, allyTeamIndex, teamIndex, isSpectator, inGame, defeated }) => ({
            userId,
            name,
            allyTeamIndex,
            teamIndex,
            isSpectator,
            inGame,
            defeated,
        })),
    };
}

export function listBattleSummaries(): BattleSummary[] {
    return [...battles.values()].map(describeBattle);
}
