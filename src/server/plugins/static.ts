import fastifyStatic from "@fastify/static";
import type { FastifyPluginAsync } from "fastify";
import path from "node:path";
import { config } from "../config.js";

// Serves each built Vue page from its own public subfolder under a matching URL prefix.
export const staticPlugin: FastifyPluginAsync = async (app) => {
    await app.register(fastifyStatic, {
        root: path.join(config.publicDir, "login"),
        prefix: "/login/",
    });

    await app.register(fastifyStatic, {
        root: path.join(config.publicDir, "admin"),
        prefix: "/admin/",
        decorateReply: false,
    });

    // Shared bundle output referenced by built pages via absolute "/assets/..." paths.
    await app.register(fastifyStatic, {
        root: path.join(config.publicDir, "assets"),
        prefix: "/assets/",
        decorateReply: false,
    });
};
