import { randomBytes, randomUUID } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import { broadcastLobbyChange, snapshotLobby } from "../lobbies/broadcast.js";
import { getLobby, getRestrictions, setLobbyCurrentBattle, type LobbyBot, type LobbyState } from "../lobbies/store.js";
import { getConnectedClient, getConnectedClientByUserId, sendToConnectedClient, sendToConnectedUsers } from "../ws/connectedClients.js";
import { requestAutohostStart } from "../ws/connectedAutohosts.js";
import { createEvent } from "../ws/tachyon/messages.js";
import type { MatchmakingPlaylist } from "../ws/tachyon/matchmaking/playlists.js";
import type { TachyonAutohostEventDataFor, TachyonEventDataFor, TachyonUserRequestFor } from "../ws/tachyon/types.js";
import {
    applyBattleUpdate,
    createBattle,
    getBattleForUser,
    getBattleJoinInfo,
    listBattles,
    removeBattle,
    setBattleConnection,
    type Battle,
    type BattleSlotKeys,
    type BattleStartScript,
} from "./store.js";

type StartScriptWithoutId = Omit<BattleStartScript, "battleId">;
type StartScriptTeam = BattleStartScript["allyTeams"][number]["teams"][number];
type StartScriptBot = NonNullable<StartScriptTeam["bots"]>[number];

const DUMMY_GAME_ARCHIVE_HASH = "f".repeat(128);
const DUMMY_MAP_ARCHIVE_HASH = "d".repeat(128);

export class BattleLaunchError extends Error {}

function password(): string {
    return randomBytes(18).toString("base64url");
}

function participant(userId: string) {
    const client = getConnectedClientByUserId(userId);
    if (!client) throw new BattleLaunchError(`battle participant ${userId} is not connected`);
    return { userId, name: client.username, password: password() };
}

function startScriptBot(bot: LobbyBot): StartScriptBot {
    return {
        hostUserId: bot.hostUserId,
        aiShortName: bot.shortName,
        ...(bot.name !== undefined && { name: bot.name }),
        ...(bot.version !== undefined && { aiVersion: bot.version }),
        ...(bot.options && { aiOptions: { ...bot.options } }),
    };
}

export function buildLobbyStartScript(lobby: LobbyState): { startScript: StartScriptWithoutId; slotKeys: BattleSlotKeys } {
    const seated = Object.entries(lobby.allyTeamConfig)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([allyTeamKey, allyTeam]) => {
            const teams = Object.keys(allyTeam.teams)
                .sort()
                .map((teamKey) => {
                    const seatedIn = <T extends { allyTeam: string; team: string; player: string }>(occupants: T[]) =>
                        occupants.filter((occupant) => occupant.allyTeam === allyTeamKey && occupant.team === teamKey).sort((left, right) => left.player.localeCompare(right.player));
                    const players = seatedIn(Object.values(lobby.players));
                    const bots = seatedIn(Object.values(lobby.bots));
                    const team: StartScriptTeam = {
                        ...(players.length > 0 && { players: players.map((player) => participant(player.id)) }),
                        ...(bots.length > 0 && { bots: bots.map(startScriptBot) }),
                    };
                    const keys = { team: teamKey, players: players.map((player) => player.player), bots: bots.map((bot) => bot.player) };
                    return { team, keys };
                })
                .filter(({ team }) => team.players || team.bots);
            return { allyTeam: { startBox: allyTeam.startBox, teams: teams.map(({ team }) => team) }, keys: { allyTeam: allyTeamKey, teams: teams.map(({ keys }) => keys) } };
        })
        .filter(({ allyTeam }) => allyTeam.teams.length > 0);
    const allyTeams = seated.map(({ allyTeam }) => allyTeam);
    // Bot hosts are always members, so they are among the players or spectators the autohost requires.
    const spectators = Object.keys(lobby.spectators).sort().map(participant);
    if (allyTeams.length === 0) throw new BattleLaunchError("a battle requires at least one player or bot");
    const restrictions = getRestrictions(lobby.id);

    return {
        startScript: {
            engineVersion: lobby.engineVersion,
            gameName: lobby.gameVersion,
            mapName: lobby.mapName,
            gameArchiveHash: DUMMY_GAME_ARCHIVE_HASH,
            mapArchiveHash: DUMMY_MAP_ARCHIVE_HASH,
            startPosType: "ingame",
            allyTeams,
            spectators,
            gameOptions: Object.fromEntries(Object.entries(lobby.gameOptions).map(([key, option]) => [key, option.value])),
            ...(Object.keys(restrictions).length > 0 && { restrictions }),
        },
        slotKeys: seated.map(({ keys }) => keys),
    };
}

export function buildMatchmakingStartScript(members: string[], playlist: MatchmakingPlaylist): StartScriptWithoutId {
    const expectedPlayers = playlist.numOfTeams * playlist.teamSize;
    if (members.length !== expectedPlayers || expectedPlayers < 1) throw new BattleLaunchError("matchmaking roster does not match the playlist");
    const engine = playlist.engines[0];
    const game = playlist.games[0];
    const map = playlist.maps[0];
    if (!engine || !game || !map) throw new BattleLaunchError("matchmaking playlist has no launch assets");

    const players = members.map((username) => {
        const client = getConnectedClient(username);
        if (!client) throw new BattleLaunchError(`battle participant ${username} is not connected`);
        return { userId: client.userId, name: username, password: password() };
    });
    return {
        engineVersion: engine.version,
        gameName: game.springName,
        mapName: map.springName,
        gameArchiveHash: DUMMY_GAME_ARCHIVE_HASH,
        mapArchiveHash: DUMMY_MAP_ARCHIVE_HASH,
        startPosType: "ingame",
        allyTeams: Array.from({ length: playlist.numOfTeams }, (_, teamIndex) => ({
            teams: [{ players: players.slice(teamIndex * playlist.teamSize, (teamIndex + 1) * playlist.teamSize) }],
        })),
        spectators: [],
        gameOptions: {},
    };
}

export async function launchBattle(source: "lobby" | "matchmaking", startScript: StartScriptWithoutId, sourceId: string, slotKeys?: BattleSlotKeys): Promise<Battle> {
    const userIds = [
        ...startScript.allyTeams.flatMap((allyTeam) => allyTeam.teams.flatMap((team) => (team.players ?? []).map((player) => player.userId))),
        ...(startScript.spectators ?? []).map((spectator) => spectator.userId),
    ];
    if (userIds.some((userId) => getBattleForUser(userId))) throw new BattleLaunchError("a participant is already in an active battle");
    if (source === "lobby" && listBattles().some((battle) => battle.lobbyId === sourceId && battle.status !== "ended")) {
        throw new BattleLaunchError("the lobby already has an active battle");
    }

    const battle = createBattle({ source, startScript, ...(slotKeys && { slotKeys }), ...(source === "lobby" ? { lobbyId: sourceId } : { queueId: sourceId }) });
    try {
        const response = await requestAutohostStart(battle.startScript);
        if (response.status === "failed") throw new BattleLaunchError(response.details ?? response.reason);
        setBattleConnection(battle.battleId, response.data);
        return battle;
    } catch (error) {
        removeBattle(battle.battleId);
        throw error;
    }
}

export function sendBattleStartRequests(battle: Battle): void {
    for (const player of battle.players) {
        const client = getConnectedClientByUserId(player.userId);
        const data = getBattleJoinInfo(battle.battleId, player.userId);
        if (!client || !data) continue;
        const request: TachyonUserRequestFor<"battle/start"> = {
            type: "request",
            messageId: randomUUID(),
            commandId: "battle/start",
            data,
        };
        sendToConnectedClient(client.username, request);
    }
}

// Winners may be empty (the engine quit or crashed without a game over), and every seat may be a bot.
function createBattleEndedData(battle: Battle): TachyonEventDataFor<"battle/ended"> {
    const slots = battle.startScript.allyTeams.flatMap((allyTeam, allyTeamIndex) =>
        allyTeam.teams.map((team, teamIndex) => {
            const allyTeamKeys = battle.slotKeys[allyTeamIndex];
            const teamKeys = allyTeamKeys?.teams[teamIndex];
            return {
                team,
                allyTeam: allyTeamKeys?.allyTeam ?? String(allyTeamIndex),
                teamKey: teamKeys?.team ?? String(teamIndex),
                playerKeys: teamKeys?.players ?? [],
                botKeys: teamKeys?.bots ?? [],
            };
        })
    );
    const players = slots.flatMap(({ team, allyTeam, teamKey, playerKeys }) =>
        (team.players ?? []).map((player, playerIndex) => ({
            userId: player.userId,
            name: player.name,
            allyTeam,
            team: teamKey,
            player: playerKeys[playerIndex] ?? String(playerIndex),
        }))
    );
    const bots = slots.flatMap(({ team, allyTeam, teamKey, botKeys }) =>
        (team.bots ?? []).map((bot, botIndex) => ({
            shortName: bot.aiShortName,
            allyTeam,
            team: teamKey,
            player: botKeys[botIndex] ?? String(botIndex),
        }))
    );
    // The engine reports winners as start script ally team indices.
    const winningAllyTeamIds = (battle.winningAllyTeams ?? []).map((index) => battle.slotKeys[index]?.allyTeam ?? String(index));
    return {
        battleId: battle.battleId,
        players,
        bots,
        spectators: (battle.startScript.spectators ?? []).map((spectator) => ({ userId: spectator.userId, name: spectator.name })),
        winningAllyTeamIds: [...new Set(winningAllyTeamIds)],
    };
}

function updateLobbyBattle(battle: Battle, currentBattle: NonNullable<LobbyState["currentBattle"]> | undefined): void {
    if (!battle.lobbyId || !getLobby(battle.lobbyId)) return;
    const before = snapshotLobby(battle.lobbyId);
    const after = setLobbyCurrentBattle(battle.lobbyId, currentBattle);
    broadcastLobbyChange(before, after && structuredClone(after));
}

export function handleBattleUpdate(data: TachyonAutohostEventDataFor<"autohost/update">, logger: FastifyBaseLogger): void {
    const existing = listBattles().find((battle) => battle.battleId === data.battleId);
    const wasEnded = existing?.status === "ended";
    const battle = applyBattleUpdate(data);
    if (!battle) {
        logger.warn({ battleId: data.battleId, updateType: data.update.type }, "update for unknown battle");
        return;
    }

    if (data.update.type === "start" && battle.lobbyId) {
        updateLobbyBattle(battle, { id: battle.battleId, startedAt: data.time });
    }
    if (!wasEnded && battle.status === "ended") {
        // Spectators are included, which covers bot-only battles through the bots' hosts.
        sendToConnectedUsers(
            battle.players.map((player) => player.userId),
            createEvent("battle/ended", createBattleEndedData(battle))
        );
        updateLobbyBattle(battle, undefined);
    }
}
