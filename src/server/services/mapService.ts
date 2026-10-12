import axios from "axios";
import type { FastifyBaseLogger } from "fastify";

// Used when the metadata fetch fails, so mock lobbies still get varied maps offline.
const FALLBACK_MAP_NAMES = [
    "All That Glitters v2.2",
    "Supreme Isthmus v1.8",
    "Comet Catcher Remake 1.8",
    "Throne v8",
    "Red Comet Remake 1.8",
    "Isidis Crack 1.1",
    "Altair Crossing v4.1",
    "Eye of Horus v1.7",
    "Tempest V3",
    "Hellas Basin v1.4",
    "Quicksilver Remake 1.24",
];

// Resolves to undefined when the official list couldn't be fetched.
let officialMapNames: Promise<string[] | undefined> | undefined;
let officialMapSet: Set<string> | undefined;

async function fetchMapNames(mapsMetadataUrl: string, log: FastifyBaseLogger): Promise<string[] | undefined> {
    try {
        const response = await axios.get(mapsMetadataUrl, { timeout: 15000 });
        if (!Array.isArray(response.data)) throw new Error("maps metadata is not an array");
        const names = response.data.map((map: { springName?: unknown }) => map.springName).filter((name): name is string => typeof name === "string" && name.length > 0);
        if (names.length === 0) throw new Error("maps metadata has no map names");
        officialMapSet = new Set(names);
        log.info({ count: names.length }, "loaded map names");
        return names;
    } catch (err) {
        log.warn({ err, url: mapsMetadataUrl }, "failed to load map names, using fallback list and skipping map validation");
        return undefined;
    }
}

/**
 * Starts the one-time map list fetch. The list rarely changes, so it is kept for the server's lifetime.
 */
export function loadMapNames(mapsMetadataUrl: string, log: FastifyBaseLogger): void {
    officialMapNames ??= fetchMapNames(mapsMetadataUrl, log);
}

/**
 * The official map names, or the fallback list when they couldn't be fetched.
 */
export async function getMapNames(): Promise<string[]> {
    return (await officialMapNames) ?? FALLBACK_MAP_NAMES;
}

/**
 * The official map names, or an empty list when they couldn't be fetched.
 */
export async function getOfficialMapNames(): Promise<string[]> {
    return (await officialMapNames) ?? [];
}

/**
 * Without an official list there is nothing to check against, so every map is accepted.
 */
export async function isOfficialMap(name: string): Promise<boolean> {
    await officialMapNames;
    return officialMapSet?.has(name) ?? true;
}
