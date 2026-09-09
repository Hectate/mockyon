type ClientSocket = {
    close: (code?: number, data?: string) => void;
    send: (data: string, callback?: (error?: Error) => void) => void;
};

export type ConnectedClient = {
    username: string;
    userId: string;
};

type ClientEntry = ConnectedClient & { socket: ClientSocket };

const clients = new Map<string, ClientEntry>();

export function registerConnectedClient(client: ConnectedClient, socket: ClientSocket): void {
    const existing = clients.get(client.username);
    clients.set(client.username, { ...client, socket });
    existing?.socket.close(1000, "replaced by a new connection");
}

export function unregisterConnectedClient(username: string, socket: ClientSocket): void {
    if (clients.get(username)?.socket === socket) clients.delete(username);
}

export function getConnectedClientCount(): number {
    return clients.size;
}

export function getConnectedClients(): ConnectedClient[] {
    return [...clients.values()].map(({ username, userId }) => ({ username, userId }));
}

export function broadcastToOtherConnectedClients(username: string, data: unknown): void {
    const message = JSON.stringify(data);
    for (const client of clients.values()) {
        if (client.username !== username) client.socket.send(message);
    }
}
