import type { TachyonRequest, TachyonResponse } from "../types.js";

export function handleSubscribeUpdates(request: TachyonRequest): TachyonResponse {
    return {
        type: "response",
        messageId: request.messageId,
        commandId: "user/subscribeUpdates",
        status: "success",
    };
}
