import { broadcastLobbyChange, snapshotLobby } from "../../../lobbies/broadcast.js";
import { addBot, getLobby, getLobbyIdForUser } from "../../../lobbies/store.js";
import { canManageBot } from "../../../lobbies/updatePolicy.js";
import type { TachyonContext, TachyonRequestFor, TachyonResponseFor } from "../types.js";

type LobbyAddBotFailReason = Extract<TachyonResponseFor<"lobby/addBot">, { status: "failed" }>["reason"];

export function handleLobbyAddBot(request: TachyonRequestFor<"lobby/addBot">, context: TachyonContext): TachyonResponseFor<"lobby/addBot"> {
    const failed = (reason: LobbyAddBotFailReason, details?: string): TachyonResponseFor<"lobby/addBot"> => ({
        type: "response",
        messageId: request.messageId,
        commandId: "lobby/addBot",
        status: "failed",
        reason,
        ...(details !== undefined && { details }),
    });

    const lobbyId = getLobbyIdForUser(context.userId);
    const lobby = lobbyId ? getLobby(lobbyId) : undefined;
    if (!lobbyId || !lobby) return failed("not_in_lobby");
    if (!canManageBot(lobby, context.userId)) return failed("unauthorized");
    if (request.data.shortName.trim().length === 0) return failed("invalid_request", "shortName must not be empty");

    const before = snapshotLobby(lobbyId);
    const result = addBot(context.userId, request.data);
    if ("error" in result) return failed(result.error, result.error === "invalid_request" ? "unknown allyTeam" : undefined);

    const after = snapshotLobby(lobbyId);
    setImmediate(() => broadcastLobbyChange(before, after));

    return {
        type: "response",
        messageId: request.messageId,
        commandId: "lobby/addBot",
        status: "success",
        data: { id: result.bot.id },
    };
}
