import { broadcastToConnectedClients, getConnectedClientByUserId, sendToConnectedClient, sendToConnectedUsers } from "../ws/connectedClients.js";
import { createEvent } from "../ws/tachyon/messages.js";
import type { TachyonEventDataFor, TachyonEventFor } from "../ws/tachyon/types.js";
import { diffLobby, diffOverview } from "./patch.js";
import { getLobby, getLobbyIdForUser, getLobbyMemberIds, listOverviews, removeMember, toOverview, type LobbyState, type LobbyVoteOutcome } from "./store.js";

type LobbyListPatch = TachyonEventDataFor<"lobby/listUpdated">["lobbies"];

export function snapshotLobby(lobbyId: string): LobbyState | undefined {
    const lobby = getLobby(lobbyId);
    return lobby && structuredClone(lobby);
}

export function createLobbyListResetEvent(): TachyonEventFor<"lobby/listReset"> {
    return createEvent("lobby/listReset", { lobbies: listOverviews() });
}

export function broadcastLobbyListReset(): void {
    broadcastToConnectedClients(createLobbyListResetEvent());
}

function broadcastListPatch(lobbies: LobbyListPatch): void {
    broadcastToConnectedClients(createEvent("lobby/listUpdated", { lobbies }));
}

/**
 * Emits the `lobby/updated` and `lobby/listUpdated` deltas between two snapshots of one lobby.
 * A missing `before` means the lobby was created, a missing `after` means it was deleted.
 * `lobby/updated` only reaches current members; departed members learn from their own response or `lobby/left`.
 */
export function broadcastLobbyChange(before: LobbyState | undefined, after: LobbyState | undefined): void {
    if (!before && after) {
        broadcastListPatch({ [after.id]: toOverview(after) });
        return;
    }
    if (before && !after) {
        broadcastListPatch({ [before.id]: null });
        return;
    }
    if (!before || !after) return;

    const patch = diffLobby(before, after);
    if (patch) sendToConnectedUsers([...Object.keys(after.players), ...Object.keys(after.spectators)], createEvent("lobby/updated", patch));

    const overviewPatch = diffOverview(toOverview(before), toOverview(after));
    if (overviewPatch) broadcastListPatch({ [after.id]: overviewPatch });
}

export function sendLobbyLeft(userId: string, lobbyId: string, reason: string): void {
    const client = getConnectedClientByUserId(userId);
    if (client) sendToConnectedClient(client.username, createEvent("lobby/left", { id: lobbyId, reason }));
}

export function sendLobbyVoteEnded(lobbyId: string, voteId: string, outcome: LobbyVoteOutcome): void {
    sendToConnectedUsers(getLobbyMemberIds(lobbyId), createEvent("lobby/voteEnded", { id: voteId, outcome }));
}

/**
 * Removes a member and defers the resulting events, so a request's own response is sent first.
 */
export function leaveLobby(userId: string): string | undefined {
    const lobbyId = getLobbyIdForUser(userId);
    if (!lobbyId) return undefined;
    const before = snapshotLobby(lobbyId);
    removeMember(userId);
    const after = snapshotLobby(lobbyId);
    setImmediate(() => broadcastLobbyChange(before, after));
    return lobbyId;
}
