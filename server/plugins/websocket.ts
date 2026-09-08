import fastifyWebsocket from "@fastify/websocket";
import type { FastifyPluginAsync } from "fastify";

export const websocketPlugin: FastifyPluginAsync = async (app) => {
    await app.register(fastifyWebsocket);
};
