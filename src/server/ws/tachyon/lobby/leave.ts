import { leaveLobby } from "../../../lobbies/broadcast.js";
import type { TachyonContext, TachyonRequestFor, TachyonResponseFor } from "../types.js";

export function handleLobbyLeave(request: TachyonRequestFor<"lobby/leave">, context: TachyonContext): TachyonResponseFor<"lobby/leave"> {
    if (!leaveLobby(context.userId)) {
        return {
            type: "response",
            messageId: request.messageId,
            commandId: "lobby/leave",
            status: "failed",
            reason: "not_in_lobby",
        };
    }

    return {
        type: "response",
        messageId: request.messageId,
        commandId: "lobby/leave",
        status: "success",
    };
}
