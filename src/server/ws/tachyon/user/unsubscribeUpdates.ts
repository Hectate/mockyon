import type { TachyonRequestFor, TachyonSuccessResponseFor } from "../types.js";

export function handleUnsubscribeUpdates(request: TachyonRequestFor<"user/unsubscribeUpdates">): TachyonSuccessResponseFor<"user/unsubscribeUpdates"> {
    return {
        type: "response",
        messageId: request.messageId,
        commandId: "user/unsubscribeUpdates",
        status: "success",
    };
}
