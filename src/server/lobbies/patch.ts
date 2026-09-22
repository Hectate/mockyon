import type { TachyonEventDataFor } from "../ws/tachyon/types.js";
import { getVoteExtras, type LobbyOverview, type LobbyState } from "./store.js";

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

/**
 * Tags, restrictions, game options and bots are intentionally never diffed: those features
 * aren't implemented, so their state can never change.
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
    if (!equal(before.currentBattle, after.currentBattle)) {
        patch.currentBattle = after.currentBattle ?? null;
        changed = true;
    }
    const currentVoteChanged = !equal(before.currentVote, after.currentVote);
    if (currentVoteChanged) {
        changed = true;
    }
    const voteHistory = diffKeyedMap(before.voteHistory ?? {}, after.voteHistory ?? {});
    if (voteHistory) {
        patch.voteHistory = voteHistory;
        changed = true;
    }
    if (currentVoteChanged || (changed && after.currentVote)) {
        // quorum/majority have no slot in the full lobby state, so they ride along on the patch only.
        const extras = getVoteExtras(after.id);
        patch.currentVote = after.currentVote
            ? { ...after.currentVote, ...(extras.quorum !== undefined && { quorum: extras.quorum }), ...(extras.majority !== undefined && { majority: extras.majority }) }
            : null;
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
