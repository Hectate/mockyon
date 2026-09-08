import type { FastifyPluginAsync } from "fastify";
import { validateAccessToken } from "../auth/store.js";

declare module "fastify" {
    interface FastifyRequest {
        tachyonUsername?: string;
    }
}

// Matches the shape of ws's RawData without depending on its type package.
type RawData = Buffer | ArrayBuffer | Buffer[];

// Represents the Tachyon "user"/client actor connection: wss://<server>/tachyon
export const tachyonSocket: FastifyPluginAsync = async (app) => {
    app.get(
        "/tachyon",
        {
            websocket: true,
            preValidation: async (request, reply) => {
                const match = request.headers.authorization?.match(/^Bearer\s+(.+)$/i);
                const access = match ? validateAccessToken(match[1]) : undefined;
                if (!access) {
                    reply.code(401).header("WWW-Authenticate", 'Bearer realm="tachyon", error="invalid_token"').send({ error: "invalid_token" });
                    return;
                }
                request.tachyonUsername = access.username;
            },
        },
        (socket, request) => {
            app.log.info({ remoteAddress: request.socket.remoteAddress, username: request.tachyonUsername }, "tachyon client connected");

            // Stub only: no schema validation or command routing yet, just echo back as an event.
            socket.on("message", (raw: RawData) => {
                let data: unknown;
                try {
                    data = JSON.parse(raw.toString());
                } catch {
                    socket.close(1008, "invalid json");
                    return;
                }

                socket.send(
                    JSON.stringify({
                        type: "event",
                        commandId: "system/echo",
                        data,
                    })
                );
            });
        }
    );
};
