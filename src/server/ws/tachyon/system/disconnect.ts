import type { TachyonRequestFor, TachyonSuccessResponseFor } from "../types.js";

export function handleDisconnect(request: TachyonRequestFor<"system/disconnect">): TachyonSuccessResponseFor<"system/disconnect"> {
    return {
        type: "response",
        messageId: request.messageId,
        commandId: "system/disconnect",
        status: "success",
    };
}
