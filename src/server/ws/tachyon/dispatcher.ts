import { handleMatchmakingList } from "./matchmaking/list.js";
import { handleMatchmakingQueue } from "./matchmaking/queue.js";
import { handleMatchmakingReady } from "./matchmaking/ready.js";
import { handleSubscribeReceived } from "./messaging/subscribeReceived.js";
import { handleDisconnect } from "./system/disconnect.js";
import { handleServerStats } from "./system/serverStats.js";
import { handleSubscribeUpdates } from "./user/subscribeUpdates.js";
import { handleUnsubscribeUpdates } from "./user/unsubscribeUpdates.js";

import { createUnimplementedResponse } from "./messages.js";
import type { TachyonContext, TachyonRequest, TachyonRequestCommandId, TachyonRequestFor, TachyonResponseCommandId, TachyonResponseFor, TachyonResponse } from "./types.js";

type RequestCommandId = TachyonRequestCommandId & TachyonResponseCommandId;
type RequestHandler<CommandId extends RequestCommandId> = (request: TachyonRequestFor<CommandId>, context: TachyonContext) => TachyonResponseFor<CommandId>;
type RequestHandlers = {
    [CommandId in RequestCommandId]?: RequestHandler<CommandId>;
};

const requestHandlers: RequestHandlers = {
    "matchmaking/list": handleMatchmakingList,
    "matchmaking/queue": handleMatchmakingQueue,
    "matchmaking/ready": handleMatchmakingReady,
    "messaging/subscribeReceived": handleSubscribeReceived,
    "system/disconnect": handleDisconnect,
    "system/serverStats": handleServerStats,
    "user/subscribeUpdates": handleSubscribeUpdates,
    "user/unsubscribeUpdates": handleUnsubscribeUpdates,
};

export function handleRequest(request: TachyonRequest, context: TachyonContext): TachyonResponse {
    const handler = requestHandlers[request.commandId] as ((request: TachyonRequest, context: TachyonContext) => TachyonResponse) | undefined;
    return handler?.(request, context) ?? createUnimplementedResponse(request);
}
