import type { IncomingMessage } from "node:http";

const supportedMajor = 0;

function selectTachyonProtocol(protocols: Set<string>): string | false {
    const candidates = [...protocols]
        .map((protocol) => {
            const match = /^v(\d+)(?:\.(\d+))?\.tachyon$/.exec(protocol);
            return match ? { protocol, major: Number(match[1]), minor: Number(match[2] ?? 0) } : undefined;
        })
        .filter((candidate) => candidate?.major === supportedMajor)
        .sort((left, right) => (right?.minor ?? 0) - (left?.minor ?? 0));

    return candidates[0]?.protocol ?? false;
}

function verifyTachyonProtocol(
    info: { origin: string; secure: boolean; req: IncomingMessage },
    callback: (result: boolean, code?: number, message?: string, headers?: Record<string, string>) => void
): void {
    if (info.req.url?.split("?", 1)[0] !== "/tachyon") {
        callback(true);
        return;
    }
    const offered = info.req.headers["sec-websocket-protocol"];
    const protocols = new Set(typeof offered === "string" ? offered.split(",").map((value) => value.trim()) : []);
    const selected = selectTachyonProtocol(protocols);
    callback(selected !== false, 426, "a supported Tachyon subprotocol is required");
}

export const websocketOptions = {
    options: {
        handleProtocols: selectTachyonProtocol,
        verifyClient: verifyTachyonProtocol,
    },
};
