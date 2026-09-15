import { getLobbyIdForUser } from "../../../lobbies/store.js";
import type { TachyonContext, TachyonRequestFor, TachyonResponseFor } from "../types.js";

export function handleLobbyStartBattle(request: TachyonRequestFor<"lobby/startBattle">, context: TachyonContext): TachyonResponseFor<"lobby/startBattle"> {
    if (!getLobbyIdForUser(context.userId)) {
        return {
            type: "response",
            messageId: request.messageId,
            commandId: "lobby/startBattle",
            status: "failed",
            reason: "not_in_lobby",
        };
    }

    // TODO: build the autohost/start script from the lobby and hand off to the autohost.
    return {
        type: "response",
        messageId: request.messageId,
        commandId: "lobby/startBattle",
        status: "failed",
        reason: "command_unimplemented",
    };
}
