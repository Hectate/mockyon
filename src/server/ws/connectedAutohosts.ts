import { randomUUID } from "node:crypto";
import { serializeOutgoingMessage } from "./tachyon/messages.js";
import type { TachyonAutohostRequestDataFor, TachyonAutohostRequestFor, TachyonAutohostResponse, TachyonAutohostResponseFor } from "./tachyon/types.js";

type AutohostSocket = {
    close: (code?: number, data?: string) => void;
    send: (data: string, callback?: (error?: Error) => void) => void;
};

// Only one autohost connection is supported at a time.
let connected: { clientId: string; socket: AutohostSocket } | undefined;

type PendingRequest = {
    commandId: "autohost/start" | "autohost/subscribeUpdates";
    resolve: (response: TachyonAutohostResponse) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
};

const pendingRequests = new Map<string, PendingRequest>();

function rejectPendingRequests(error: Error): void {
    for (const pending of pendingRequests.values()) {
        clearTimeout(pending.timer);
        pending.reject(error);
    }
    pendingRequests.clear();
}

export function registerConnectedAutohost(clientId: string, socket: AutohostSocket): void {
    if (connected) rejectPendingRequests(new Error("autohost connection replaced"));
    connected?.socket.close(1000, "replaced by a new connection");
    connected = { clientId, socket };
}

export function unregisterConnectedAutohost(socket: AutohostSocket): void {
    if (connected?.socket !== socket) return;
    connected = undefined;
    rejectPendingRequests(new Error("autohost disconnected"));
}

export function isAutohostConnected(): boolean {
    return connected !== undefined;
}

export function requestAutohostStart(data: TachyonAutohostRequestDataFor<"autohost/start">, timeoutMs = 30_000): Promise<TachyonAutohostResponseFor<"autohost/start">> {
    const socket = connected?.socket;
    if (!socket) return Promise.reject(new Error("autohost is not connected"));

    const request: TachyonAutohostRequestFor<"autohost/start"> = {
        type: "request",
        messageId: randomUUID(),
        commandId: "autohost/start",
        data,
    };

    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            pendingRequests.delete(request.messageId);
            reject(new Error("autohost/start timed out"));
        }, timeoutMs);
        timer.unref();
        pendingRequests.set(request.messageId, { commandId: request.commandId, resolve: (response) => resolve(response as TachyonAutohostResponseFor<"autohost/start">), reject, timer });

        socket.send(serializeOutgoingMessage(request), (error) => {
            if (!error) return;
            const pending = pendingRequests.get(request.messageId);
            if (!pending) return;
            clearTimeout(pending.timer);
            pendingRequests.delete(request.messageId);
            pending.reject(error);
        });
    });
}

export function requestAutohostUpdates(since: number, timeoutMs = 30_000): Promise<TachyonAutohostResponseFor<"autohost/subscribeUpdates">> {
    const socket = connected?.socket;
    if (!socket) return Promise.reject(new Error("autohost is not connected"));

    const request: TachyonAutohostRequestFor<"autohost/subscribeUpdates"> = {
        type: "request",
        messageId: randomUUID(),
        commandId: "autohost/subscribeUpdates",
        data: { since },
    };

    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            pendingRequests.delete(request.messageId);
            reject(new Error("autohost/subscribeUpdates timed out"));
        }, timeoutMs);
        timer.unref();
        pendingRequests.set(request.messageId, {
            commandId: request.commandId,
            resolve: (response) => resolve(response as TachyonAutohostResponseFor<"autohost/subscribeUpdates">),
            reject,
            timer,
        });

        socket.send(serializeOutgoingMessage(request), (error) => {
            if (!error) return;
            const pending = pendingRequests.get(request.messageId);
            if (!pending) return;
            clearTimeout(pending.timer);
            pendingRequests.delete(request.messageId);
            pending.reject(error);
        });
    });
}

export function handleAutohostResponse(response: TachyonAutohostResponse): boolean {
    const pending = pendingRequests.get(response.messageId);
    if (!pending || response.commandId !== pending.commandId) return false;

    clearTimeout(pending.timer);
    pendingRequests.delete(response.messageId);
    pending.resolve(response);
    return true;
}
