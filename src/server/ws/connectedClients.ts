import { serializeOutgoingMessage } from "./tachyon/messages.js";
import type { TachyonEvent, TachyonEventDataFor } from "./tachyon/types.js";

export type MatchmakingState = TachyonEventDataFor<"user/self">["user"]["matchmaking"];

type ClientSocket = {
    close: (code?: number, data?: string) => void;
    send: (data: string, callback?: (error?: Error) => void) => void;
};

export type ConnectedClient = {
    username: string;
    userId: string;
};

export type ConnectedClientInfo = ConnectedClient & { matchmaking: MatchmakingState };

type ClientEntry = ConnectedClientInfo & { socket: ClientSocket };

const clients = new Map<string, ClientEntry>();

export function registerConnectedClient(client: ConnectedClient, socket: ClientSocket): void {
    const existing = clients.get(client.username);
    clients.set(client.username, { ...client, matchmaking: { state: "no_matchmaking" }, socket });
    existing?.socket.close(1000, "replaced by a new connection");
}

export function unregisterConnectedClient(username: string, socket: ClientSocket): void {
    if (clients.get(username)?.socket === socket) clients.delete(username);
}

export function getConnectedClientCount(): number {
    return clients.size;
}

export function getConnectedClients(): ConnectedClientInfo[] {
    return [...clients.values()].map(({ username, userId, matchmaking }) => ({ username, userId, matchmaking }));
}

export function getConnectedClient(username: string): ConnectedClientInfo | undefined {
    const client = clients.get(username);
    return client && { username: client.username, userId: client.userId, matchmaking: client.matchmaking };
}

export function getConnectedClientMatchmaking(username: string): MatchmakingState | undefined {
    return clients.get(username)?.matchmaking;
}

export function setConnectedClientMatchmaking(username: string, matchmaking: MatchmakingState): void {
    const client = clients.get(username);
    if (client) client.matchmaking = matchmaking;
}

export function sendToConnectedClient(username: string, event: TachyonEvent): void {
    clients.get(username)?.socket.send(serializeOutgoingMessage(event));
}

export function broadcastToOtherConnectedClients(username: string, event: TachyonEvent): void {
    const message = serializeOutgoingMessage(event);
    for (const client of clients.values()) {
        if (client.username !== username) client.socket.send(message);
    }
}
