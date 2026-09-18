import { broadcastLobbyChange, broadcastLobbyVote, sendLobbyVoteEnded, snapshotLobby } from "./broadcast.js";
import { armVoteTimer, createVote, endVote, updateVote, type LobbyVote, type LobbyVoteInput, type LobbyVoteOutcome } from "./store.js";

/**
 * Single path for ending a vote, shared by the admin routes and the expiry timer so both produce
 * the same event sequence: `lobby/voteEnded` first, then the `lobby/updated` that clears it.
 */
export function finishVote(lobbyId: string, outcome: LobbyVoteOutcome): boolean {
    const before = snapshotLobby(lobbyId);
    const ended = endVote(lobbyId, outcome);
    if (!before || !ended) return false;

    sendLobbyVoteEnded(lobbyId, ended.id, ended.outcome);
    broadcastLobbyChange(before, snapshotLobby(lobbyId));
    return true;
}

export function startVote(lobbyId: string, input: LobbyVoteInput): LobbyVote | undefined {
    const before = snapshotLobby(lobbyId);
    const vote = createVote(lobbyId, input);
    if (!before || !vote) return undefined;

    armVoteTimer(lobbyId, (id) => finishVote(id, "timeout"));
    broadcastLobbyChange(before, snapshotLobby(lobbyId));
    return vote;
}

export function changeVote(lobbyId: string, input: LobbyVoteInput): LobbyVote | undefined {
    const before = snapshotLobby(lobbyId);
    const vote = updateVote(lobbyId, input);
    if (!before || !vote) return undefined;

    if (input.durationSeconds !== undefined) armVoteTimer(lobbyId, (id) => finishVote(id, "timeout"));
    if (input.quorum !== undefined || input.majority !== undefined) broadcastLobbyVote(lobbyId);
    else broadcastLobbyChange(before, snapshotLobby(lobbyId));
    return vote;
}
