import { buildMatchmakingStartScript, launchBattle, sendBattleStartRequests } from "../../../battles/launch.js";
import type { MatchmakingState } from "../../connectedClients.js";
import { getConnectedClient, getConnectedClientMatchmaking, sendToConnectedClient, setConnectedClientMatchmaking } from "../../connectedClients.js";
import { createEvent } from "../messages.js";
import { findMatchmakingPlaylist } from "./playlists.js";

const DEFAULT_FOUND_TIMEOUT_SECONDS = 20;

let foundTimeoutSeconds = DEFAULT_FOUND_TIMEOUT_SECONDS;

// Usernames in the order they joined a queue; drives match selection.
let queueOrder: string[] = [];

type Match = {
    queueId: string;
    members: string[];
    readyCount: number;
    timer: NodeJS.Timeout;
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
        const members = candidates.slice(0, playersPerBattle);
        const match: Match = { queueId, members, readyCount: 0, timer: setTimeout(() => expireMatch(match), timeoutMs) };

        for (const username of members) {
            const client = getConnectedClient(username);
            if (client?.matchmaking.state !== "queuing") continue;

            const matchmaking: MatchmakingState = {
                state: "found",
                queue: { id: playlist.id, version: playlist.version, timeoutAt, hasAlreadyReadied: false },
                otherQueues: client.matchmaking.queues.filter((queue) => queue.id !== queueId),
            };

            setConnectedClientMatchmaking(username, matchmaking);
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
    const isReady = match.readyCount >= match.members.length;
    if (isReady) {
        clearTimeout(match.timer);
        for (const member of match.members) {
            matches.delete(member);
            leaveMatchmaking(member);
        }
    }

    // Deferred so this request's success response reaches the client before the update event.
    const event = createEvent("matchmaking/foundUpdate", { readyCount: match.readyCount });
    setImmediate(() => {
        for (const member of match.members) sendToConnectedClient(member, event);
        if (isReady) void launchReadyMatch(match);
    });

    return true;
}

async function launchReadyMatch(match: Match): Promise<void> {
    try {
        const playlist = findMatchmakingPlaylist(match.queueId);
        if (!playlist) throw new Error(`unknown matchmaking playlist ${match.queueId}`);
        const battle = await launchBattle("matchmaking", buildMatchmakingStartScript(match.members, playlist), match.queueId);
        sendBattleStartRequests(battle);
    } catch (error) {
        console.error("failed to launch matchmaking battle", error);
    }
}

export function cancelMatchmaking(username: string): boolean {
    const matchmaking = getConnectedClientMatchmaking(username);
    if (matchmaking?.state !== "queuing" && matchmaking?.state !== "found") return false;

    const match = matches.get(username);
    if (match) {
        dissolveMatch(match, [username], "intentional");
        return true;
    }

    leaveMatchmaking(username);
    const cancelledEvent = createEvent("matchmaking/cancelled", { reason: "intentional" });
    setImmediate(() => sendToConnectedClient(username, cancelledEvent));
    return true;
}

function expireMatch(match: Match): void {
    const timedOut = match.members.filter((member) => {
        const matchmaking = getConnectedClientMatchmaking(member);
        return matchmaking?.state === "found" && !matchmaking.queue.hasAlreadyReadied;
    });
    if (timedOut.length > 0) dissolveMatch(match, timedOut, "ready_timeout");
}

function dissolveMatch(match: Match, cancelledMembers: string[], reason: "intentional" | "ready_timeout"): void {
    clearTimeout(match.timer);
    for (const member of match.members) matches.delete(member);

    const remaining = match.members.filter((member) => !cancelledMembers.includes(member));
    for (const member of cancelledMembers) leaveMatchmaking(member);
    // Reversed so the restored players keep their relative order at the front of the queue.
    for (const member of [...remaining].reverse()) restoreToQueue(member);

    const cancelledEvent = createEvent("matchmaking/cancelled", { reason });
    const lostEvent = createEvent("matchmaking/lost");
    // Deferred so a triggering request's response reaches the client before these events.
    setImmediate(() => {
        for (const member of cancelledMembers) sendToConnectedClient(member, cancelledEvent);
        for (const member of remaining) sendToConnectedClient(member, lostEvent);
        tryFormMatches(match.queueId);
    });
}

function leaveMatchmaking(username: string): void {
    setConnectedClientMatchmaking(username, { state: "no_matchmaking" });
    queueOrder = queueOrder.filter((queued) => queued !== username);
}

function restoreToQueue(username: string): void {
    const matchmaking = getConnectedClientMatchmaking(username);
    if (matchmaking?.state !== "found") return;

    setConnectedClientMatchmaking(username, {
        state: "queuing",
        queues: [{ id: matchmaking.queue.id, version: matchmaking.queue.version }, ...matchmaking.otherQueues],
    });
    // Requeued ahead of newer players, since they were queued before the match formed.
    queueOrder = [username, ...queueOrder.filter((queued) => queued !== username)];
}
