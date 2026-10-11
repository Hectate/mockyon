import { broadcastToConnectedClients } from "../ws/connectedClients.js";
import { createEvent } from "../ws/tachyon/messages.js";
import type { TachyonEventDataFor } from "../ws/tachyon/types.js";

export type LobbyListPatch = TachyonEventDataFor<"lobby/listUpdated">["lobbies"];

export const LIST_UPDATE_INTERVAL_DEFAULT_SECONDS = 2;
export const LIST_UPDATE_INTERVAL_MIN_SECONDS = 1;
export const LIST_UPDATE_INTERVAL_MAX_SECONDS = 10;

let intervalSeconds = LIST_UPDATE_INTERVAL_DEFAULT_SECONDS;
let pending: LobbyListPatch = {};
let hasPending = false;
let lastSentAt = 0;
let timer: NodeJS.Timeout | undefined;

/**
 * Merge patches the way a client applies them in sequence: a removal wins, and a later patch
 * layers over an earlier full overview or patch for the same lobby.
 */
function mergeEntry(previous: LobbyListPatch[string] | undefined, next: LobbyListPatch[string]): LobbyListPatch[string] {
    if (next === null || previous === undefined || previous === null) return next;
    return { ...previous, ...next };
}

function flush(): void {
    clearTimeout(timer);
    timer = undefined;
    if (!hasPending) return;
    const lobbies = pending;
    pending = {};
    hasPending = false;
    lastSentAt = Date.now();
    broadcastToConnectedClients(createEvent("lobby/listUpdated", { lobbies }));
}

function schedule(): void {
    clearTimeout(timer);
    const delayMs = Math.max(0, lastSentAt + intervalSeconds * 1000 - Date.now());
    timer = setTimeout(flush, delayMs);
    // A queued list update must never hold the process open on shutdown.
    timer.unref();
}

/**
 * `lobby/listUpdated` is throttled to one event per interval, independently of how often lobbies
 * change; everything queued in between is merged per lobby into that one event.
 */
export function queueListPatch(lobbies: LobbyListPatch): void {
    for (const [id, entry] of Object.entries(lobbies)) pending[id] = mergeEntry(pending[id], entry);
    hasPending = true;
    if (!timer) schedule();
}

/**
 * A `lobby/listReset` carries the current state, so anything still queued is already included in it.
 */
export function discardQueuedListPatches(): void {
    clearTimeout(timer);
    timer = undefined;
    pending = {};
    hasPending = false;
}

export function getListUpdateIntervalSeconds(): number {
    return intervalSeconds;
}

export function setListUpdateIntervalSeconds(seconds: number): void {
    intervalSeconds = seconds;
    if (timer) schedule();
}
