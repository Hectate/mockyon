import type { TachyonRequestFor, TachyonSuccessResponseFor } from "../types.js";

export function handleSubscribeUpdates(request: TachyonRequestFor<"user/subscribeUpdates">): TachyonSuccessResponseFor<"user/subscribeUpdates"> {
    return {
        type: "response",
        messageId: request.messageId,
        commandId: "user/subscribeUpdates",
        status: "success",
    };
}
