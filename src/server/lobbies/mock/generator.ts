import { randomUUID } from "node:crypto";
import { config } from "../../config.js";
import { listInstalledEngines } from "../../services/engineService.js";
import { broadcastListPatch, broadcastLobbyListReset, type LobbyListPatch } from "../broadcast.js";
import { getLobbyDefaults } from "../defaults.js";
import { diffOverview } from "../patch.js";
import type { LobbyOverview } from "../store.js";
import { randomMockName } from "./names.js";

export type MockLobbySettings = {
    count: number;
    ratePerSecond: number;
};

export type MockLobbyStatus = MockLobbySettings & {
    running: boolean;
    current: number;
    inBattle: number;
};

export const MOCK_LOBBY_DEFAULTS: MockLobbySettings = { count: 100, ratePerSecond: 10 };
// Below this the percentage thresholds (removal floor, battle share) round too coarsely to behave.
export const MOCK_LOBBY_MIN_COUNT = 20;
export const MOCK_LOBBY_MAX_COUNT = 10000;
export const MOCK_LOBBY_MAX_RATE = 1000;

const MIN_TICK_MS = 50;
// Removals stop once the list shrinks to this share of the target count.
const MIN_COUNT_RATIO = 0.9;
const SEED_BATTLE_CHANCE = 0.25;
// Battle starts get likelier as the in-battle share drops toward the low mark, and stop at the high mark.
const BATTLE_SHARE_LOW = 0.1;
const BATTLE_SHARE_HIGH = 0.5;
const BATTLE_MAX_AGE_MS = 50 * 60 * 1000;
const BATTLE_MIN_DURATION_MS = 5 * 60 * 1000;
// Sampling tries before falling back to a full scan for an endable battle.
const SAMPLE_TRIES = 20;

const MAX_PLAYER_COUNTS = [2, 4, 6, 8, 10, 12, 16, 32];
const MAP_NAMES = [
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

type Operation = "add" | "remove" | "endBattle" | "modify";
type MockProperty = "playerCount" | "mapName" | "name" | "maxPlayerCount" | "gameVersion" | "engineVersion";

const OPERATION_WEIGHTS: Record<Operation, number> = { add: 1, remove: 1, endBattle: 1, modify: 6 };
// Engine and game versions are meant to change rarely, the engine least of all.
const PROPERTY_WEIGHTS: Record<MockProperty, number> = { playerCount: 60, mapName: 12, name: 8, maxPlayerCount: 8, gameVersion: 4, engineVersion: 1 };
const PROPERTIES_PER_MODIFY_WEIGHTS: Record<string, number> = { 1: 70, 2: 20, 3: 10 };

/**
 * An id set with O(1) random picks, so per-operation target selection doesn't scan every mock.
 */
class IdBag {
    private ids: string[] = [];
    private index = new Map<string, number>();

    get size(): number {
        return this.ids.length;
    }

    add(id: string): void {
        if (this.index.has(id)) return;
        this.index.set(id, this.ids.length);
        this.ids.push(id);
    }

    delete(id: string): void {
        const position = this.index.get(id);
        if (position === undefined) return;
        const last = this.ids.pop()!;
        if (last !== id) {
            this.ids[position] = last;
            this.index.set(last, position);
        }
        this.index.delete(id);
    }

    random(): string | undefined {
        return this.ids.length > 0 ? pick(this.ids) : undefined;
    }

    values(): readonly string[] {
        return this.ids;
    }

    clear(): void {
        this.ids = [];
        this.index.clear();
    }
}

type ValuePools = { maps: string[]; engines: string[]; games: string[] };

const mocks = new Map<string, LobbyOverview>();
const idle = new IdBag();
const battling = new IdBag();
let settings: MockLobbySettings = { ...MOCK_LOBBY_DEFAULTS };
let pools: ValuePools = { maps: [], engines: [], games: [] };
let timer: NodeJS.Timeout | undefined;
let lastTickAt = 0;
// Fractional operations left over from previous ticks, so the average rate is exact.
let operationCarry = 0;

function pick<T>(items: readonly T[]): T {
    return items[Math.floor(Math.random() * items.length)];
}

function pickOther<T>(items: readonly T[], current: T): T {
    const others = items.filter((item) => item !== current);
    return others.length > 0 ? pick(others) : current;
}

function pickWeighted<K extends string>(weights: Partial<Record<K, number>>): K | undefined {
    const entries = Object.entries(weights) as [K, number][];
    let roll = Math.random() * entries.reduce((sum, [, weight]) => sum + weight, 0);
    for (const [key, weight] of entries) {
        roll -= weight;
        if (roll < 0) return key;
    }
    return entries.at(-1)?.[0];
}

function randomInt(min: number, max: number): number {
    return min + Math.floor(Math.random() * (max - min + 1));
}

function randomHex(length: number): string {
    let hex = "";
    while (hex.length < length) hex += Math.floor(Math.random() * 16).toString(16);
    return hex;
}

function dedupe(values: string[]): string[] {
    return [...new Set(values)];
}

// Synthetic engine versions follow the YYYY.MM.DD release naming.
function syntheticEngineVersions(count: number): string[] {
    const versions: string[] = [];
    for (let index = 0; index < count; index++) {
        const date = new Date(Date.now() - randomInt(30, 400) * 24 * 60 * 60 * 1000);
        versions.push(`${date.getUTCFullYear()}.${String(date.getUTCMonth() + 1).padStart(2, "0")}.${String(date.getUTCDate()).padStart(2, "0")}`);
    }
    return versions;
}

// Synthetic game versions are nearby test builds of the default, e.g. "Beyond All Reason test-30903-2990072".
function syntheticGameVersions(defaultGame: string, count: number): string[] {
    const match = /^(.*test-)(\d+)-[0-9a-f]+$/.exec(defaultGame);
    const prefix = match?.[1] ?? "Beyond All Reason test-";
    const build = Number(match?.[2] ?? 30000);
    const versions: string[] = [];
    for (let index = 0; index < count; index++) versions.push(`${prefix}${build - randomInt(1, 400)}-${randomHex(7)}`);
    return versions;
}

async function buildValuePools(): Promise<ValuePools> {
    const defaults = getLobbyDefaults();
    const installed = (await listInstalledEngines(config.enginesDir).catch(() => [])).map((engine) => engine.version);
    return {
        maps: dedupe([defaults.mapName, ...MAP_NAMES]),
        engines: dedupe([defaults.engineVersion, ...installed, ...syntheticEngineVersions(3)]),
        games: dedupe([defaults.gameVersion, ...syntheticGameVersions(defaults.gameVersion, 4)]),
    };
}

// Tachyon UnixTime is microseconds; mock battles claim to have started some time in the last 50 minutes.
function randomBattle(): NonNullable<LobbyOverview["currentBattle"]> {
    return { startedAt: Math.round((Date.now() - Math.random() * BATTLE_MAX_AGE_MS) * 1000) };
}

function battleChance(): number {
    const share = mocks.size > 0 ? battling.size / mocks.size : 0;
    return Math.min(1, Math.max(0, (BATTLE_SHARE_HIGH - share) / (BATTLE_SHARE_HIGH - BATTLE_SHARE_LOW)));
}

function canEndBattle(id: string, now: number): boolean {
    const startedAt = mocks.get(id)?.currentBattle?.startedAt;
    return startedAt !== undefined && now - startedAt / 1000 >= BATTLE_MIN_DURATION_MS;
}

function findEndableBattle(now: number): string | undefined {
    for (let attempt = 0; attempt < SAMPLE_TRIES; attempt++) {
        const id = battling.random();
        if (id === undefined) return undefined;
        if (canEndBattle(id, now)) return id;
    }
    return battling.values().find((id) => canEndBattle(id, now));
}

function track(lobby: LobbyOverview): void {
    if (lobby.currentBattle) {
        idle.delete(lobby.id);
        battling.add(lobby.id);
    } else {
        battling.delete(lobby.id);
        idle.add(lobby.id);
    }
}

function createMock(battleChance: number): LobbyOverview {
    const maxPlayerCount = pick(MAX_PLAYER_COUNTS);
    const lobby: LobbyOverview = {
        id: randomUUID(),
        name: randomMockName(),
        playerCount: randomInt(0, maxPlayerCount),
        maxPlayerCount,
        mapName: pick(pools.maps),
        engineVersion: pick(pools.engines),
        gameVersion: pick(pools.games),
        currentBattle: Math.random() < battleChance ? randomBattle() : null,
    };
    mocks.set(lobby.id, lobby);
    track(lobby);
    return lobby;
}

function removeMock(id: string): void {
    mocks.delete(id);
    idle.delete(id);
    battling.delete(id);
}

function modifyProperty(lobby: LobbyOverview, property: MockProperty): void {
    switch (property) {
        case "playerCount": {
            const delta = pick([-2, -1, 1, 2]);
            lobby.playerCount = Math.min(lobby.maxPlayerCount, Math.max(0, lobby.playerCount + delta));
            break;
        }
        case "maxPlayerCount":
            lobby.maxPlayerCount = pickOther(MAX_PLAYER_COUNTS, lobby.maxPlayerCount);
            lobby.playerCount = Math.min(lobby.playerCount, lobby.maxPlayerCount);
            break;
        case "mapName":
            lobby.mapName = pickOther(pools.maps, lobby.mapName);
            break;
        case "name":
            lobby.name = randomMockName();
            break;
        case "gameVersion":
            lobby.gameVersion = pickOther(pools.games, lobby.gameVersion);
            break;
        case "engineVersion":
            lobby.engineVersion = pickOther(pools.engines, lobby.engineVersion);
            break;
    }
}

/**
 * In-battle mocks behave like a real running lobby: they are frozen until the battle ends, and a
 * battle only ends once it has run for at least five minutes.
 */
function modifyMock(lobby: LobbyOverview): void {
    if (Math.random() < battleChance()) {
        lobby.currentBattle = randomBattle();
        track(lobby);
        return;
    }
    const weights: Partial<Record<MockProperty, number>> = { ...PROPERTY_WEIGHTS };
    const propertyCount = Number(pickWeighted(PROPERTIES_PER_MODIFY_WEIGHTS) ?? 1);
    for (let index = 0; index < propertyCount; index++) {
        const property = pickWeighted(weights);
        if (!property) break;
        delete weights[property];
        modifyProperty(lobby, property);
    }
}

function runOperation(now: number, touch: (id: string, added?: boolean) => void): void {
    const endable = findEndableBattle(now);
    const weights: Partial<Record<Operation, number>> = {};
    if (mocks.size < settings.count) weights.add = OPERATION_WEIGHTS.add;
    if (mocks.size > Math.floor(settings.count * MIN_COUNT_RATIO) && idle.size > 0) weights.remove = OPERATION_WEIGHTS.remove;
    if (endable !== undefined) weights.endBattle = OPERATION_WEIGHTS.endBattle;
    if (idle.size > 0) weights.modify = OPERATION_WEIGHTS.modify;

    switch (pickWeighted(weights)) {
        case "add": {
            const lobby = createMock(battleChance() / 4);
            touch(lobby.id, true);
            break;
        }
        case "remove": {
            const id = idle.random()!;
            touch(id);
            removeMock(id);
            break;
        }
        case "endBattle": {
            const lobby = mocks.get(endable!)!;
            touch(lobby.id);
            lobby.currentBattle = null;
            track(lobby);
            break;
        }
        case "modify": {
            const lobby = mocks.get(idle.random()!)!;
            touch(lobby.id);
            modifyMock(lobby);
            break;
        }
        default:
            // Nothing is eligible, e.g. every mock is in a battle younger than five minutes.
            break;
    }
}

// A tick's operations are folded into a single `lobby/listUpdated`, keyed by lobby id.
function tick(): void {
    const now = Date.now();
    operationCarry += ((now - lastTickAt) / 1000) * settings.ratePerSecond;
    lastTickAt = now;
    // A stalled event loop shouldn't release a burst bigger than the whole list.
    const operations = Math.min(Math.floor(operationCarry), settings.count);
    operationCarry = Math.min(operationCarry - operations, 1);

    // The snapshot from before a lobby's first change this tick; undefined for lobbies added this tick.
    const before = new Map<string, LobbyOverview | undefined>();
    const touch = (id: string, added = false) => {
        if (!before.has(id)) before.set(id, added ? undefined : structuredClone(mocks.get(id)));
    };
    for (let index = 0; index < operations; index++) runOperation(now, touch);

    const patch: LobbyListPatch = {};
    for (const [id, previous] of before) {
        const current = mocks.get(id);
        if (!previous && current) patch[id] = structuredClone(current);
        else if (previous && !current) patch[id] = null;
        else if (previous && current) {
            const diff = diffOverview(previous, current);
            if (diff) patch[id] = diff;
        }
    }
    if (Object.keys(patch).length > 0) broadcastListPatch(patch);
}

function clearMocks(): void {
    clearInterval(timer);
    timer = undefined;
    mocks.clear();
    idle.clear();
    battling.clear();
}

/**
 * Starting while already running reseeds the list with the new settings.
 */
export async function startMockLobbies(next: MockLobbySettings): Promise<MockLobbyStatus> {
    const nextPools = await buildValuePools();
    clearMocks();
    settings = { ...next };
    pools = nextPools;
    for (let index = 0; index < settings.count; index++) createMock(SEED_BATTLE_CHANCE);

    lastTickAt = Date.now();
    operationCarry = 0;
    timer = setInterval(tick, Math.max(MIN_TICK_MS, 1000 / settings.ratePerSecond));
    // The generator must never hold the process open on shutdown.
    timer.unref();
    broadcastLobbyListReset();
    return getMockLobbyStatus();
}

export function stopMockLobbies(): MockLobbyStatus {
    const wasRunning = timer !== undefined;
    clearMocks();
    if (wasRunning) broadcastLobbyListReset();
    return getMockLobbyStatus();
}

export function isMockLobby(id: string): boolean {
    return mocks.has(id);
}

export function listMockOverviews(): Record<string, LobbyOverview> {
    const overviews: Record<string, LobbyOverview> = {};
    for (const lobby of mocks.values()) overviews[lobby.id] = structuredClone(lobby);
    return overviews;
}

export function getMockLobbyStatus(): MockLobbyStatus {
    return { ...settings, running: timer !== undefined, current: mocks.size, inBattle: battling.size };
}
