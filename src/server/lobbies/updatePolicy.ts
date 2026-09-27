import type { TachyonRequestFor } from "../ws/tachyon/types.js";
import type { LobbyBot, LobbyState } from "./store.js";

export type LobbyUpdateChanges = TachyonRequestFor<"lobby/update">["data"];

/**
 * Whether the user may update the lobby at all. Any member may for now; this is where boss status,
 * player status and user roles will be checked.
 */
export function canUpdateLobby(lobby: LobbyState, userId: string): boolean {
    return userId in lobby.players || userId in lobby.spectators;
}

/**
 * Whether the user may add, remove or update bots in the lobby. Any member may for now; this is where
 * boss status, bot ownership and user roles will be checked. `bot` is absent when adding one.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- the bot is a future input of the check
export function canManageBot(lobby: LobbyState, userId: string, _bot?: LobbyBot): boolean {
    return userId in lobby.players || userId in lobby.spectators;
}

/**
 * Whether the changes must go to a lobby vote instead of being applied directly. No update requires
 * one yet; voting is being reworked in the protocol.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- parameters are the future inputs of the check
export function requiresVote(_lobby: LobbyState, _changes: LobbyUpdateChanges, _userId: string): boolean {
    return false;
}
