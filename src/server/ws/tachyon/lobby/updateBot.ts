import { broadcastLobbyChange, snapshotLobby } from "../../../lobbies/broadcast.js";
import { getBot, getLobby, getLobbyIdForUser, updateBot } from "../../../lobbies/store.js";
import { canManageBot } from "../../../lobbies/updatePolicy.js";
import type { TachyonContext, TachyonRequestFor, TachyonResponseFor } from "../types.js";

type LobbyUpdateBotFailReason = Extract<TachyonResponseFor<"lobby/updateBot">, { status: "failed" }>["reason"];

export function handleLobbyUpdateBot(request: TachyonRequestFor<"lobby/updateBot">, context: TachyonContext): TachyonResponseFor<"lobby/updateBot"> {
    const failed = (reason: LobbyUpdateBotFailReason, details?: string): TachyonResponseFor<"lobby/updateBot"> => ({
        type: "response",
        messageId: request.messageId,
        commandId: "lobby/updateBot",
        status: "failed",
        reason,
        ...(details !== undefined && { details }),
    });

    const lobbyId = getLobbyIdForUser(context.userId);
    const lobby = lobbyId ? getLobby(lobbyId) : undefined;
    if (!lobbyId || !lobby) return failed("not_in_lobby");
    const { id, ...changes } = request.data;
    const bot = getBot(lobbyId, id);
    if (!bot) return failed("invalid_bot");
    if (!canManageBot(lobby, context.userId, bot)) return failed("unauthorized");
    if (changes.shortName !== undefined && changes.shortName.trim().length === 0) return failed("invalid_request", "shortName must not be empty");

    const before = snapshotLobby(lobbyId);
    updateBot(lobbyId, id, changes);
    const after = snapshotLobby(lobbyId);
    setImmediate(() => broadcastLobbyChange(before, after));

    return {
        type: "response",
        messageId: request.messageId,
        commandId: "lobby/updateBot",
        status: "success",
    };
}
