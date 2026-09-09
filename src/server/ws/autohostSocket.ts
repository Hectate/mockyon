import type { FastifyPluginAsync } from "fastify";
import { parseAutohostMessage } from "./tachyon/messages.js";
import type { RawData } from "./tachyon/types.js";

const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

// Represents the Tachyon "autohost" actor connection from the local recoil-autohost.
export const autohostSocket: FastifyPluginAsync = async (app) => {
    app.get("/autohost", { websocket: true }, (socket, request) => {
        const remoteAddress = request.socket.remoteAddress;

        // TODO: add shared-secret/token auth once defined; loopback check is a stopgap only.
        if (!remoteAddress || !LOOPBACK_ADDRESSES.has(remoteAddress)) {
            app.log.warn({ remoteAddress }, "rejected non-loopback autohost connection");
            socket.close(1008, "autohost connections must originate from localhost");
            return;
        }

        app.log.info({ remoteAddress }, "autohost connected");

        socket.on("message", (raw: RawData) => {
            let data: unknown;
            try {
                data = JSON.parse(raw.toString());
            } catch {
                socket.close(1008, "invalid json");
                return;
            }

            if (!parseAutohostMessage(data)) socket.close(1008, "invalid message");
        });
    });
};
