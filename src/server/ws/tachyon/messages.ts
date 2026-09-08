import { randomUUID } from "node:crypto";
import type { TachyonEvent, TachyonMessage, TachyonResponse, TachyonRequest } from "./types.js";

export function parseRequest(value: unknown): TachyonRequest | undefined {
    if (typeof value !== "object" || value === null) return undefined;
    const message = value as Partial<TachyonMessage>;
    if (message.type !== "request" || typeof message.messageId !== "string" || typeof message.commandId !== "string") {
        return undefined;
    }
    return message as TachyonRequest;
}

export function createUnimplementedResponse(request: TachyonRequest): TachyonResponse {
    return {
        type: "response",
        messageId: request.messageId,
        commandId: request.commandId,
        status: "failed",
        reason: "command_unimplemented",
    };
}

export function createEvent(commandId: string, data: unknown): TachyonEvent {
    return {
        type: "event",
        messageId: randomUUID(),
        commandId,
        data,
    };
}
