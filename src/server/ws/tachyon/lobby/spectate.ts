import { broadcastLobbyChange, snapshotLobby } from "../../../lobbies/broadcast.js";
import { getLobbyIdForUser, spectate } from "../../../lobbies/store.js";
import type { TachyonContext, TachyonRequestFor, TachyonResponseFor } from "../types.js";

export function handleLobbySpectate(request: TachyonRequestFor<"lobby/spectate">, context: TachyonContext): TachyonResponseFor<"lobby/spectate"> {
    const lobbyId = getLobbyIdForUser(context.userId);
    if (!lobbyId) {
        return {
            type: "response",
            messageId: request.messageId,
            commandId: "lobby/spectate",
            status: "failed",
            reason: "not_in_lobby",
        };
    }

    const before = snapshotLobby(lobbyId);
    spectate(context.userId);
    const after = snapshotLobby(lobbyId);
    setImmediate(() => broadcastLobbyChange(before, after));

    return {
        type: "response",
        messageId: request.messageId,
        commandId: "lobby/spectate",
        status: "success",
    };
}
