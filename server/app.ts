import Fastify, { type FastifyInstance } from "fastify";
import { staticPlugin } from "./plugins/static.js";
import { websocketPlugin } from "./plugins/websocket.js";
import { tachyonSocket } from "./ws/tachyonSocket.js";
import { autohostSocket } from "./ws/autohostSocket.js";
import { authRoutes } from "./routes/auth.js";
import { adminRoutes } from "./routes/admin.js";

export async function buildApp(): Promise<FastifyInstance> {
    const app = Fastify({ logger: true });

    await app.register(staticPlugin);
    await app.register(websocketPlugin);
    await app.register(tachyonSocket);
    await app.register(autohostSocket);
    await app.register(authRoutes);
    await app.register(adminRoutes);

    return app;
}
