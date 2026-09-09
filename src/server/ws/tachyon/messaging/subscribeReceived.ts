import type { TachyonRequestFor, TachyonSuccessResponseFor } from "../types.js";

export function handleSubscribeReceived(request: TachyonRequestFor<"messaging/subscribeReceived">): TachyonSuccessResponseFor<"messaging/subscribeReceived"> {
    return {
        type: "response",
        messageId: request.messageId,
        commandId: "messaging/subscribeReceived",
        status: "success",
        data: {
            hasMissedMessages: false,
        },
    };
}
