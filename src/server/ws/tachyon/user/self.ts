import type { TachyonContext, TachyonEventFor } from "../types.js";
import { createEvent } from "../messages.js";

export function createSelfEvent(context: TachyonContext): TachyonEventFor<"user/self"> {
    return createEvent("user/self", {
        user: {
            userId: context.userId,
            username: context.username,
            displayName: context.username,
            clanBaseData: null,
            status: "menu",
            party: null,
            invitedToParties: [],
            friendIds: [],
            outgoingFriendRequest: [],
            incomingFriendRequest: [],
            ignoreIds: [],
            currentLobby: null,
            clanInvites: [],
            matchmaking: { state: "no_matchmaking" },
        },
    });
}
