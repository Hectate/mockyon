import type { ConnectedClient } from "../../connectedClients.js";
import type { TachyonEvent } from "../types.js";
import { createEvent } from "../messages.js";

export function createUserUpdatedEvent(users: ConnectedClient[]): TachyonEvent {
    return createEvent("user/updated", {
        users: users.map(({ userId, username }) => ({
            userId,
            username,
            displayName: username,
        })),
    });
}
