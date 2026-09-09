type AutohostSocket = {
    close: (code?: number, data?: string) => void;
    send: (data: string, callback?: (error?: Error) => void) => void;
};

// Only one autohost connection is supported at a time.
let connected: { clientId: string; socket: AutohostSocket } | undefined;

export function registerConnectedAutohost(clientId: string, socket: AutohostSocket): void {
    connected?.socket.close(1000, "replaced by a new connection");
    connected = { clientId, socket };
}

export function unregisterConnectedAutohost(socket: AutohostSocket): void {
    if (connected?.socket === socket) connected = undefined;
}

export function isAutohostConnected(): boolean {
    return connected !== undefined;
}
