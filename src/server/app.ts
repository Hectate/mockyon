import Fastify, { type FastifyInstance } from "fastify";
import formbody from "@fastify/formbody";
import fastifyWebsocket from "@fastify/websocket";
import { staticPlugin } from "./plugins/static.js";
import { websocketOptions } from "./plugins/websocket.js";
import { tachyonSocket } from "./ws/tachyonSocket.js";
import { autohostSocket } from "./ws/autohostSocket.js";
import { authRoutes } from "./routes/auth.js";
import { adminRoutes } from "./routes/admin.js";
import { oauthRoutes } from "./routes/oauth.js";

export async function buildApp(): Promise<FastifyInstance> {
    const app = Fastify({ logger: true });

    await app.register(formbody);
    await app.register(staticPlugin);
    await app.register(fastifyWebsocket, websocketOptions);
    await app.register(tachyonSocket);
    await app.register(autohostSocket);
    await app.register(authRoutes);
    await app.register(adminRoutes);
    await app.register(oauthRoutes);

    return app;
}
