import type { ConnectedClient } from "../../connectedClients.js";
import type { TachyonEventFor } from "../types.js";
import { createEvent } from "../messages.js";

export function createUserUpdatedEvent(users: ConnectedClient[]): TachyonEventFor<"user/updated"> {
    return createEvent("user/updated", {
        users: users.map(({ userId, username }) => ({
            userId,
            username,
            displayName: username,
        })),
    });
}
