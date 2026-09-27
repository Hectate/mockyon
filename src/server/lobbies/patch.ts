import type { TachyonEventDataFor } from "../ws/tachyon/types.js";
import type { LobbyOverview, LobbyState } from "./store.js";

export type LobbyPatch = TachyonEventDataFor<"lobby/updated">;
export type LobbyOverviewPatch = NonNullable<TachyonEventDataFor<"lobby/listUpdated">["lobbies"][string]>;

function equal(a: unknown, b: unknown): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}

// Keyed maps are merge patched: changed/added entries are sent whole, removed entries become null.
function diffKeyedMap<T>(before: Record<string, T>, after: Record<string, T>): Record<string, T | null> | undefined {
    const patch: Record<string, T | null> = {};
    let changed = false;
    for (const [key, value] of Object.entries(after)) {
        if (!equal(before[key], value)) {
            patch[key] = value;
            changed = true;
        }
    }
    for (const key of Object.keys(before)) {
        if (!(key in after)) {
            patch[key] = null;
            changed = true;
        }
    }
    return changed ? patch : undefined;
}

type LobbyBotPatch = NonNullable<NonNullable<LobbyPatch["bots"]>[string]>;

/**
 * Bot entries must always carry `version` and `options`, so they get their own diff: a changed bot sends
 * its changed fields, its current version, and its options as a nested merge patch.
 */
function diffBots(before: LobbyState["bots"], after: LobbyState["bots"]): Record<string, LobbyBotPatch | null> | undefined {
    const patch: Record<string, LobbyBotPatch | null> = {};
    let changed = false;
    for (const [id, bot] of Object.entries(after)) {
        const previous = before[id];
        if (equal(previous, bot)) continue;
        const entry: LobbyBotPatch = { id, version: bot.version ?? null, options: null };
        for (const key of ["hostUserId", "allyTeam", "team", "player", "shortName"] as const) {
            if (previous?.[key] !== bot[key]) entry[key] = bot[key];
        }
        if (previous?.name !== bot.name) entry.name = bot.name ?? null;
        if (bot.options) entry.options = previous ? (diffKeyedMap(previous.options ?? {}, bot.options) ?? {}) : { ...bot.options };
        patch[id] = entry;
        changed = true;
    }
    for (const id of Object.keys(before)) {
        if (!(id in after)) {
            patch[id] = null;
            changed = true;
        }
    }
    return changed ? patch : undefined;
}

/**
 * Tags and restrictions live outside the lobby state, so their patches are supplied by the caller.
 */
export function diffLobby(before: LobbyState, after: LobbyState): LobbyPatch | undefined {
    const patch: LobbyPatch = { id: after.id };
    let changed = false;

    if (before.name !== after.name) {
        patch.name = after.name;
        changed = true;
    }
    if (before.mapName !== after.mapName) {
        patch.mapName = after.mapName;
        changed = true;
    }
    if (before.engineVersion !== after.engineVersion) {
        patch.engineVersion = after.engineVersion;
        changed = true;
    }
    if (before.gameVersion !== after.gameVersion) {
        patch.gameVersion = after.gameVersion;
        changed = true;
    }

    const gameOptions = diffKeyedMap(before.gameOptions, after.gameOptions);
    if (gameOptions) {
        patch.gameOptions = gameOptions;
        changed = true;
    }
    const allyTeamConfig = diffKeyedMap(before.allyTeamConfig, after.allyTeamConfig);
    if (allyTeamConfig) {
        patch.allyTeamConfig = allyTeamConfig;
        changed = true;
    }
    const players = diffKeyedMap(before.players, after.players);
    if (players) {
        patch.players = players;
        changed = true;
    }
    const spectators = diffKeyedMap(before.spectators, after.spectators);
    if (spectators) {
        patch.spectators = spectators;
        changed = true;
    }
    const bots = diffBots(before.bots, after.bots);
    if (bots) {
        patch.bots = bots;
        changed = true;
    }
    if (!equal(before.currentBattle, after.currentBattle)) {
        patch.currentBattle = after.currentBattle ?? null;
        changed = true;
    }
    if (!equal(before.currentVote, after.currentVote)) {
        patch.currentVote = after.currentVote ?? null;
        changed = true;
    }
    const voteHistory = diffKeyedMap(before.voteHistory ?? {}, after.voteHistory ?? {});
    if (voteHistory) {
        patch.voteHistory = voteHistory;
        changed = true;
    }

    return changed ? patch : undefined;
}

export function diffOverview(before: LobbyOverview, after: LobbyOverview): LobbyOverviewPatch | undefined {
    const patch: LobbyOverviewPatch = { id: after.id };
    let changed = false;

    for (const key of ["name", "playerCount", "maxPlayerCount", "mapName", "engineVersion", "gameVersion"] as const) {
        if (before[key] !== after[key]) {
            patch[key] = after[key] as never;
            changed = true;
        }
    }
    if (!equal(before.currentBattle, after.currentBattle)) {
        patch.currentBattle = after.currentBattle;
        changed = true;
    }

    return changed ? patch : undefined;
}
