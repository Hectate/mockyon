import type { FastifyPluginAsync } from "fastify";
import { validateAccessToken } from "../auth/store.js";
import { handleRequest } from "./tachyon/dispatcher.js";
import { createSelfEvent } from "./tachyon/user/self.js";
import { parseRequest } from "./tachyon/messages.js";
import type { RawData } from "./tachyon/types.js";

declare module "fastify" {
    interface FastifyRequest {
        tachyonUsername?: string;
    }
}

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
            app.log.info({ remoteAddress: request.raw.socket.remoteAddress, username: request.tachyonUsername }, "tachyon client connected");

            let isAlive = true;
            const heartbeat = setInterval(() => {
                if (!isAlive) {
                    socket.terminate();
                    return;
                }
                isAlive = false;
                socket.ping();
            }, 9000);

            const cleanup = () => clearInterval(heartbeat);
            socket.on("pong", () => {
                isAlive = true;
            });
            socket.on("close", cleanup);
            socket.on("error", cleanup);

            const context = {
                username: request.tachyonUsername ?? "",
            };
            socket.send(JSON.stringify(createSelfEvent(context)));

            socket.on("message", (raw: RawData) => {
                let data: unknown;
                try {
                    data = JSON.parse(raw.toString());
                } catch {
                    socket.close(1008, "invalid json");
                    return;
                }

                const command = parseRequest(data);
                if (!command) {
                    socket.close(1008, "invalid message");
                    return;
                }

                const response = handleRequest(command, context);
                socket.send(JSON.stringify(response), () => {
                    if (command.commandId === "system/disconnect") socket.close(1000, "client requested disconnect");
                });
            });
        }
    );
};
