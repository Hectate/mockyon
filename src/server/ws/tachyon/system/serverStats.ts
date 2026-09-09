import { getConnectedClientCount } from "../../connectedClients.js";
import type { TachyonRequest, TachyonResponse } from "../types.js";

export function handleServerStats(request: TachyonRequest): TachyonResponse {
    return {
        type: "response",
        messageId: request.messageId,
        commandId: "system/serverStats",
        status: "success",
        data: {
            userCount: getConnectedClientCount(),
        },
    };
}
