import { getConnectedClientMatchmaking } from "../../connectedClients.js";
import { broadcastLobbyChange, leaveLobby, snapshotLobby } from "../../../lobbies/broadcast.js";
import { addSpectator, getLobby, getLobbyIdForUser } from "../../../lobbies/store.js";
import type { TachyonContext, TachyonRequestFor, TachyonResponseFor } from "../types.js";

export function handleLobbyJoin(request: TachyonRequestFor<"lobby/join">, context: TachyonContext): TachyonResponseFor<"lobby/join"> {
    const lobby = getLobby(request.data.id);
    if (!lobby) {
        return {
            type: "response",
            messageId: request.messageId,
            commandId: "lobby/join",
            status: "failed",
            reason: "invalid_lobby_id",
        };
    }

    if (getConnectedClientMatchmaking(context.username)?.state !== "no_matchmaking") {
        return {
            type: "response",
            messageId: request.messageId,
            commandId: "lobby/join",
            status: "failed",
            reason: "invalid_request",
            details: "cannot join a lobby while matchmaking",
        };
    }

    if (getLobbyIdForUser(context.userId) !== lobby.id) {
        leaveLobby(context.userId);
        const before = snapshotLobby(lobby.id);
        addSpectator(lobby.id, context.userId);
        const after = snapshotLobby(lobby.id);
        setImmediate(() => broadcastLobbyChange(before, after));
    }

    return {
        type: "response",
        messageId: request.messageId,
        commandId: "lobby/join",
        status: "success",
        data: structuredClone(lobby),
    };
}
