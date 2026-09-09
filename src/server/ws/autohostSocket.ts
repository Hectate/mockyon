import type { FastifyInstance, FastifyRequest } from "fastify";
import type { WebSocket } from "ws";
import { registerConnectedAutohost, unregisterConnectedAutohost } from "./connectedAutohosts.js";
import { parseAutohostMessage } from "./tachyon/messages.js";
import type { RawData } from "./tachyon/types.js";

// Handles the Tachyon "autohost" actor once authenticated on the shared /tachyon socket.
export function handleAutohostConnection(app: FastifyInstance, socket: WebSocket, request: FastifyRequest, clientId: string): void {
    app.log.info({ remoteAddress: request.raw.socket.remoteAddress, clientId }, "autohost connected");

    registerConnectedAutohost(clientId, socket);
    const cleanup = () => unregisterConnectedAutohost(socket);
    socket.on("close", cleanup);
    socket.on("error", cleanup);

    socket.on("message", (raw: RawData) => {
        let data: unknown;
        try {
            data = JSON.parse(raw.toString());
        } catch {
            socket.close(1008, "invalid json");
            return;
        }

        // Not yet dispatched anywhere; validation only, matching this repo's "mostly unimplemented" scope.
        if (!parseAutohostMessage(data)) socket.close(1008, "invalid message");
    });
}
