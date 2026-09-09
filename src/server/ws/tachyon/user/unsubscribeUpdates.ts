import type { TachyonRequest, TachyonResponse } from "../types.js";

export function handleUnsubscribeUpdates(request: TachyonRequest): TachyonResponse {
    return {
        type: "response",
        messageId: request.messageId,
        commandId: "user/unsubscribeUpdates",
        status: "success",
    };
}
