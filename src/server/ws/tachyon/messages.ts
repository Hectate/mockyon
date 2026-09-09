import { randomUUID } from "node:crypto";
import { tachyonMeta } from "tachyon-protocol";
import { validator } from "tachyon-protocol/validators";
import type {
    TachyonAutohostEventCommandId,
    TachyonAutohostIncomingMessage,
    TachyonAutohostResponseCommandId,
    TachyonEventCommandId,
    TachyonEventDataFor,
    TachyonEventFor,
    TachyonOutgoingMessage,
    TachyonRequest,
    TachyonRequestCommandId,
    TachyonResponse,
} from "./types.js";

const requestCommandIds = new Set<string>(tachyonMeta.schema.actors.user.request.send);
const autohostResponseCommandIds = new Set<string>(tachyonMeta.schema.actors.autohost.response.send);
const autohostEventCommandIds = new Set<string>(tachyonMeta.schema.actors.autohost.event.send);

function isRequestCommandId(value: string): value is TachyonRequestCommandId {
    return requestCommandIds.has(value);
}

function isAutohostResponseCommandId(value: string): value is TachyonAutohostResponseCommandId {
    return autohostResponseCommandIds.has(value);
}

function isAutohostEventCommandId(value: string): value is TachyonAutohostEventCommandId {
    return autohostEventCommandIds.has(value);
}

export function parseRequest(value: unknown): TachyonRequest | undefined {
    if (typeof value !== "object" || value === null) return undefined;
    if (!("type" in value) || value.type !== "request" || !("commandId" in value) || typeof value.commandId !== "string") {
        return undefined;
    }
    if (!isRequestCommandId(value.commandId)) return undefined;

    const validate = validator[value.commandId].request;
    return validate(value) ? value : undefined;
}

export function parseAutohostMessage(value: unknown): TachyonAutohostIncomingMessage | undefined {
    if (typeof value !== "object" || value === null || !("type" in value) || !("commandId" in value) || typeof value.commandId !== "string") {
        return undefined;
    }
    if (value.type === "response" && isAutohostResponseCommandId(value.commandId)) {
        return validator[value.commandId].response(value) ? value : undefined;
    }
    if (value.type === "event" && isAutohostEventCommandId(value.commandId)) {
        return validator[value.commandId].event(value) ? value : undefined;
    }
    return undefined;
}

export function createUnimplementedResponse(request: TachyonRequest): TachyonResponse {
    return {
        type: "response",
        messageId: request.messageId,
        commandId: request.commandId,
        status: "failed",
        reason: "command_unimplemented",
    } as TachyonResponse;
}

export function createEvent<CommandId extends TachyonEventCommandId>(commandId: CommandId, data: TachyonEventDataFor<CommandId>): TachyonEventFor<CommandId> {
    return {
        type: "event",
        messageId: randomUUID(),
        commandId,
        data,
    } as unknown as TachyonEventFor<CommandId>;
}

export function serializeOutgoingMessage(message: TachyonOutgoingMessage): string {
    const messageType = message.type;
    const commandId = message.commandId;
    const validate = message.type === "request" ? validator[message.commandId].request : message.type === "response" ? validator[message.commandId].response : validator[message.commandId].event;
    if (!validate(message)) {
        throw new Error(`Invalid Tachyon ${messageType} ${commandId}: ${JSON.stringify(validate.errors)}`);
    }
    return JSON.stringify(message);
}
