import { getConnectedClientCount } from "../../connectedClients.js";
import type { TachyonRequestFor, TachyonSuccessResponseFor } from "../types.js";

export function handleServerStats(request: TachyonRequestFor<"system/serverStats">): TachyonSuccessResponseFor<"system/serverStats"> {
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
