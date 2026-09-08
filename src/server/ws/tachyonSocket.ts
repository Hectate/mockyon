import type { FastifyPluginAsync } from "fastify";

// Matches the shape of ws's RawData without depending on its type package.
type RawData = Buffer | ArrayBuffer | Buffer[];

// Represents the Tachyon "user"/client actor connection: wss://<server>/tachyon
export const tachyonSocket: FastifyPluginAsync = async (app) => {
    app.get("/tachyon", { websocket: true }, (socket, request) => {
        app.log.info({ remoteAddress: request.socket.remoteAddress }, "tachyon client connected");

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
    });
};
