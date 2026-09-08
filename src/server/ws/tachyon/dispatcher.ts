import { handleDisconnect } from "./system/disconnect.js";
import { createUnimplementedResponse } from "./messages.js";
import type { TachyonContext, TachyonRequest, TachyonResponse } from "./types.js";

type RequestHandler = (request: TachyonRequest, context: TachyonContext) => TachyonResponse;

const requestHandlers: Record<string, RequestHandler> = {
    "system/disconnect": handleDisconnect,
};

export function handleRequest(request: TachyonRequest, context: TachyonContext): TachyonResponse {
    return requestHandlers[request.commandId]?.(request, context) ?? createUnimplementedResponse(request);
}
