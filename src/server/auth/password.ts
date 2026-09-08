import { timingSafeEqual } from "node:crypto";
import { config } from "../config.js";

let currentPassword = config.initialPassword;

export function getPassword(): string {
    return currentPassword;
}

export function setPassword(password: string): void {
    currentPassword = password;
}

export function verifyPassword(password: string): boolean {
    const expected = Buffer.from(currentPassword);
    const received = Buffer.from(password);
    return expected.length === received.length && timingSafeEqual(expected, received);
}
