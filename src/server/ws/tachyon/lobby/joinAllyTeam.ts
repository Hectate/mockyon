import { broadcastLobbyChange, snapshotLobby } from "../../../lobbies/broadcast.js";
import { getLobbyIdForUser, joinAllyTeam } from "../../../lobbies/store.js";
import type { TachyonContext, TachyonRequestFor, TachyonResponseFor } from "../types.js";

export function handleLobbyJoinAllyTeam(request: TachyonRequestFor<"lobby/joinAllyTeam">, context: TachyonContext): TachyonResponseFor<"lobby/joinAllyTeam"> {
    const lobbyId = getLobbyIdForUser(context.userId);
    if (!lobbyId) {
        return {
            type: "response",
            messageId: request.messageId,
            commandId: "lobby/joinAllyTeam",
            status: "failed",
            reason: "not_in_lobby",
        };
    }

    const before = snapshotLobby(lobbyId);
    const result = joinAllyTeam(context.userId, request.data.allyTeam);
    if (result !== "ok") {
        return {
            type: "response",
            messageId: request.messageId,
            commandId: "lobby/joinAllyTeam",
            status: "failed",
            reason: result,
        };
    }

    const after = snapshotLobby(lobbyId);
    setImmediate(() => broadcastLobbyChange(before, after));

    return {
        type: "response",
        messageId: request.messageId,
        commandId: "lobby/joinAllyTeam",
        status: "success",
    };
}
