import type { TachyonRequest, TachyonResponse } from "../types.js";

export function handleDisconnect(request: TachyonRequest): TachyonResponse {
    return {
        type: "response",
        messageId: request.messageId,
        commandId: "system/disconnect",
        status: "success",
    };
}
