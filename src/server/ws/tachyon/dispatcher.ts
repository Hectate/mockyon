import { handleDisconnect } from "./system/disconnect.js";
import { handleServerStats } from "./system/serverStats.js";
import { handleSubscribeUpdates } from "./user/subscribeUpdates.js";
import { handleUnsubscribeUpdates } from "./user/unsubscribeUpdates.js";

import { createUnimplementedResponse } from "./messages.js";
import type { TachyonContext, TachyonRequest, TachyonResponse } from "./types.js";

type RequestHandler = (request: TachyonRequest, context: TachyonContext) => TachyonResponse;

const requestHandlers: Record<string, RequestHandler> = {
    "system/disconnect": handleDisconnect,
    "system/serverStats": handleServerStats,
    "user/subscribeUpdates": handleSubscribeUpdates,
    "user/unsubscribeUpdates": handleUnsubscribeUpdates,
};

export function handleRequest(request: TachyonRequest, context: TachyonContext): TachyonResponse {
    return requestHandlers[request.commandId]?.(request, context) ?? createUnimplementedResponse(request);
}
