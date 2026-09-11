import type { TachyonContext, TachyonRequestFor, TachyonResponseFor } from "../types.js";
import { cancelMatchmaking } from "./matchmaker.js";

export function handleMatchmakingCancel(request: TachyonRequestFor<"matchmaking/cancel">, context: TachyonContext): TachyonResponseFor<"matchmaking/cancel"> {
    if (!cancelMatchmaking(context.username)) {
        return {
            type: "response",
            messageId: request.messageId,
            commandId: "matchmaking/cancel",
            status: "failed",
            reason: "not_queued",
        };
    }

    return {
        type: "response",
        messageId: request.messageId,
        commandId: "matchmaking/cancel",
        status: "success",
    };
}
