import type { MatchmakingState } from "../../connectedClients.js";
import { getConnectedClient, getConnectedClientMatchmaking, sendToConnectedClient, setConnectedClientMatchmaking } from "../../connectedClients.js";
import { createEvent } from "../messages.js";
import { findMatchmakingPlaylist } from "./playlists.js";

const DEFAULT_FOUND_TIMEOUT_SECONDS = 20;

let foundTimeoutSeconds = DEFAULT_FOUND_TIMEOUT_SECONDS;

// Usernames in the order they joined a queue; drives match selection.
let queueOrder: string[] = [];

type Match = {
    members: string[];
    readyCount: number;
};

// The match each matched client belongs to, keyed by username.
const matches = new Map<string, Match>();

export function getFoundTimeoutSeconds(): number {
    return foundTimeoutSeconds;
}

export function setFoundTimeoutSeconds(seconds: number): void {
    foundTimeoutSeconds = seconds;
}

export function recordQueued(username: string): void {
    if (!queueOrder.includes(username)) queueOrder.push(username);
}

function isQueuingFor(username: string, queueId: string): boolean {
    const matchmaking = getConnectedClientMatchmaking(username);
    return matchmaking?.state === "queuing" && matchmaking.queues.some((queue) => queue.id === queueId);
}

export function tryFormMatches(queueId: string): void {
    const playlist = findMatchmakingPlaylist(queueId);
    if (!playlist) return;

    const playersPerBattle = playlist.numOfTeams * playlist.teamSize;
    if (playersPerBattle <= 0) return;

    for (;;) {
        const candidates = queueOrder.filter((username) => isQueuingFor(username, queueId));
        if (candidates.length < playersPerBattle) break;

        const timeoutMs = foundTimeoutSeconds * 1000;
        // UnixTime is a microsecond timestamp.
        const timeoutAt = Math.round((Date.now() + timeoutMs) * 1000);
        const match: Match = { members: [], readyCount: 0 };

        for (const username of candidates.slice(0, playersPerBattle)) {
            const client = getConnectedClient(username);
            if (client?.matchmaking.state !== "queuing") continue;

            const matchmaking: MatchmakingState = {
                state: "found",
                queue: { id: playlist.id, version: playlist.version, timeoutAt, hasAlreadyReadied: false },
                otherQueues: client.matchmaking.queues.filter((queue) => queue.id !== queueId),
            };

            setConnectedClientMatchmaking(username, matchmaking);
            match.members.push(username);
            matches.set(username, match);
            sendToConnectedClient(username, createEvent("matchmaking/found", { queueId, timeoutMs }));
        }
    }

    queueOrder = queueOrder.filter((username) => getConnectedClientMatchmaking(username)?.state === "queuing");
}

export function readyUp(username: string): boolean {
    const matchmaking = getConnectedClientMatchmaking(username);
    const match = matches.get(username);
    if (matchmaking?.state !== "found" || !match) return false;
    if (matchmaking.queue.hasAlreadyReadied) return true;

    setConnectedClientMatchmaking(username, { ...matchmaking, queue: { ...matchmaking.queue, hasAlreadyReadied: true } });
    match.readyCount += 1;

    // Deferred so this request's success response reaches the client before the update event.
    const event = createEvent("matchmaking/foundUpdate", { readyCount: match.readyCount });
    setImmediate(() => {
        for (const member of match.members) sendToConnectedClient(member, event);
    });

    return true;
}
