import type { FastifyInstance, FastifyRequest } from "fastify";
import type { WebSocket } from "ws";
import { handleBattleUpdate } from "../battles/launch.js";
import { handleAutohostResponse, registerConnectedAutohost, requestAutohostUpdates, unregisterConnectedAutohost } from "./connectedAutohosts.js";
import { parseAutohostMessage } from "./tachyon/messages.js";
import type { RawData } from "./tachyon/types.js";

// Handles the Tachyon "autohost" actor once authenticated on the shared /tachyon socket.
export function handleAutohostConnection(app: FastifyInstance, socket: WebSocket, request: FastifyRequest, clientId: string): void {
    app.log.info({ remoteAddress: request.raw.socket.remoteAddress, clientId }, "autohost connected");

    registerConnectedAutohost(clientId, socket);
    void requestAutohostUpdates(Math.round(Date.now() * 1000)).then(
        (response) => {
            if (response.status === "failed") app.log.error({ reason: response.reason, details: response.details }, "autohost update subscription failed");
        },
        (error: unknown) => app.log.error({ err: error }, "autohost update subscription failed")
    );
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

        const message = parseAutohostMessage(data);
        if (!message) {
            socket.close(1008, "invalid message");
            return;
        }

        if (message.type === "response" && !handleAutohostResponse(message)) {
            app.log.warn({ commandId: message.commandId, messageId: message.messageId }, "unexpected autohost response");
        }
        if (message.type === "event") {
            app.log.info({ commandId: message.commandId, data: message.data }, "autohost event");
            if (message.commandId === "autohost/update") handleBattleUpdate(message.data, app.log);
        }
    });
}
