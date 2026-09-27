import { broadcastLobbyChange, snapshotLobby } from "../../../lobbies/broadcast.js";
import { getBot, getLobby, getLobbyIdForUser, removeBot } from "../../../lobbies/store.js";
import { canManageBot } from "../../../lobbies/updatePolicy.js";
import type { TachyonContext, TachyonRequestFor, TachyonResponseFor } from "../types.js";

type LobbyRemoveBotFailReason = Extract<TachyonResponseFor<"lobby/removeBot">, { status: "failed" }>["reason"];

export function handleLobbyRemoveBot(request: TachyonRequestFor<"lobby/removeBot">, context: TachyonContext): TachyonResponseFor<"lobby/removeBot"> {
    const failed = (reason: LobbyRemoveBotFailReason): TachyonResponseFor<"lobby/removeBot"> => ({
        type: "response",
        messageId: request.messageId,
        commandId: "lobby/removeBot",
        status: "failed",
        reason,
    });

    const lobbyId = getLobbyIdForUser(context.userId);
    const lobby = lobbyId ? getLobby(lobbyId) : undefined;
    if (!lobbyId || !lobby) return failed("not_in_lobby");
    const bot = getBot(lobbyId, request.data.id);
    if (!bot) return failed("invalid_bot");
    if (!canManageBot(lobby, context.userId, bot)) return failed("unauthorized");

    const before = snapshotLobby(lobbyId);
    removeBot(lobbyId, bot.id);
    const after = snapshotLobby(lobbyId);
    setImmediate(() => broadcastLobbyChange(before, after));

    return {
        type: "response",
        messageId: request.messageId,
        commandId: "lobby/removeBot",
        status: "success",
    };
}
