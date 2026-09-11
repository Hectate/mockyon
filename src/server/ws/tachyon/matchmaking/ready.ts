import type { TachyonContext, TachyonRequestFor, TachyonResponseFor } from "../types.js";
import { readyUp } from "./matchmaker.js";

export function handleMatchmakingReady(request: TachyonRequestFor<"matchmaking/ready">, context: TachyonContext): TachyonResponseFor<"matchmaking/ready"> {
    if (!readyUp(context.username)) {
        return {
            type: "response",
            messageId: request.messageId,
            commandId: "matchmaking/ready",
            status: "failed",
            reason: "no_match",
        };
    }

    return {
        type: "response",
        messageId: request.messageId,
        commandId: "matchmaking/ready",
        status: "success",
    };
}
