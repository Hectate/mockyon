<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";

type AutohostStatus = {
    status: "stopped" | "starting" | "running" | "stopping";
    pid?: number;
    startedAt?: number;
    connected: boolean;
};

type Engine = {
    version: string;
    exists: boolean;
};

type MatchmakingState =
    | { state: "no_matchmaking" }
    | { state: "queuing"; queues: { id: string; version: string }[] }
    | { state: "found"; queue: { id: string; version: string; timeoutAt: number; hasAlreadyReadied: boolean } };

type ConnectedClient = {
    username: string;
    userId: string;
    matchmaking?: MatchmakingState;
};

type LobbyStartBox = { top: number; bottom: number; left: number; right: number };
type LobbyAllyTeamForm = { startBox: LobbyStartBox; maxTeams: number; teams: { maxPlayers: number }[] };
type LobbyMember = { userId: string; username: string | null; allyTeam: string | null; team: string | null };
type LobbyBot = {
    id: string;
    hostUserId: string;
    allyTeam: string;
    team: string;
    player: string;
    name?: string;
    shortName: string;
    version?: string;
};
type LobbyDefaults = { mapName: string; gameVersion: string; engineVersion: string };
type MockLobbyStatus = { running: boolean; count: number; current: number; inBattle: number; ratePerSecond: number };
type VoteChoice = "pending" | "yes" | "no" | "abstain";
type VoteOutcome = "passed" | "failed" | "cancelled" | "timeout";
type VoteActionType = "start" | "changeMap" | "appointBoss" | "kickban";
type VoteAction =
    | { type: "start" }
    | { type: "changeMap"; newMapName: string }
    | { type: "appointBoss"; bossId: string }
    | { type: "kickban"; userId: string; banUntil?: number };
type LobbyVote = {
    id: string;
    action: VoteAction;
    initiator: string;
    voters: Record<string, { vote: VoteChoice }>;
    until: number;
    quorum?: number;
    majority?: number;
};
type VoteHistoryEntry = { vote: VoteAction; outcome: VoteOutcome; finishedAt: number };
type VoteDefaults = {
    action?: VoteAction;
    banMinutes?: number;
    initiator?: string;
    durationSeconds?: number;
    quorum?: number;
    majority?: number;
    fillFromTeams?: boolean;
};
type VoteActionFields = {
    actionType: VoteActionType;
    newMapName: string;
    bossId: string;
    kickUserId: string;
    // Whole minutes after the vote starts; "" means kick only, so the target may rejoin.
    banMinutes: number | "";
};
type VoteConfigForm = VoteActionFields & {
    lobbyId: string;
    // "" lets the server pick the first lobby member.
    initiator: string;
    durationSeconds: number;
    quorum: number;
    majority: number;
    fillFromTeams: boolean;
};
type VoteForm = VoteActionFields & {
    voteId: string;
    initiator: string;
    durationSeconds: number;
    quorum: number;
    majority: number;
    voters: Record<string, VoteChoice>;
    newVoterChoice: VoteChoice;
};
type Lobby = {
    id: string;
    name: string;
    mapName: string;
    engineVersion: string;
    gameVersion: string;
    allyTeamConfig: Record<string, { startBox: LobbyStartBox; maxTeams: number; teams: Record<string, { maxPlayers: number }> }>;
    overview: { playerCount: number; maxPlayerCount: number };
    members: LobbyMember[];
    bots: Record<string, LobbyBot>;
    currentVote?: LobbyVote;
    voteHistory?: Record<string, VoteHistoryEntry>;
    voteDefaults: VoteDefaults;
    voteStartedAt?: number;
};
type LobbyForm = LobbyDefaults & { editingId: string | null; name: string; allyTeams: LobbyAllyTeamForm[] };
type BattleEndedSlotKind = "client" | "mock" | "bot";
// Every kind's fields are kept so switching kinds back and forth doesn't lose what was typed.
type BattleEndedSlot = { kind: BattleEndedSlotKind; clientId: string; mockUserId: string; mockName: string; botShortName: string };
type BattleEndedAllyTeam = { winner: boolean; teams: { slots: BattleEndedSlot[] }[] };
type BattleEndedForm = {
    // "" lets the server generate a fresh id on every send.
    battleId: string;
    allyTeams: BattleEndedAllyTeam[];
    spectators: BattleEndedSlot[];
    recipients: string[];
};
type BattleEndedData = {
    battleId: string;
    players: { userId: string; name: string; allyTeam: string; team: string; player: string }[];
    bots: { shortName: string; allyTeam: string; team: string; player: string }[];
    spectators: { userId: string; name: string }[];
    winningAllyTeamIds: string[];
};

const REFRESH_SECONDS = 5;
const BATTLE_ENDED_STORAGE_KEY = "mockyon.admin.battleEndedForm";

const password = ref("");
const status = ref("");
const error = ref("");
const clientError = ref("");
const connectedClients = ref<ConnectedClient[]>([]);
const autohost = ref<AutohostStatus>({ status: "stopped", connected: false });
const autohostError = ref("");
const autohostActionPending = ref(false);
const engines = ref<Engine[]>([]);
// Official map names; empty when the server could not fetch them, which leaves the map fields free text.
const officialMaps = ref<string[]>([]);
const engineVersion = ref("");
const engineDownloadStatus = ref("");
const engineDownloadError = ref("");
const engineDownloadPending = ref(false);
const shutdownConfirmationOpen = ref(false);
const foundTimeoutSeconds = ref(20);
const matchmakingStatus = ref("");
const matchmakingError = ref("");
const lobbies = ref<Lobby[]>([]);
const lobbyDefaults = ref<LobbyDefaults>({ mapName: "", gameVersion: "", engineVersion: "" });
const lobbyStatus = ref("");
const lobbyError = ref("");
const mockLobbyStatus = ref<MockLobbyStatus | null>(null);
const mockLobbyForm = ref({ count: 100, ratePerSecond: 10 });
const mockLobbyPending = ref(false);
const listUpdateIntervalSeconds = ref(2);
const lobbyFormOpen = ref(false);
const lobbyForm = ref<LobbyForm>(emptyLobbyForm());
const lobbyDeleteTarget = ref<Lobby | null>(null);
const voteForms = ref<Record<string, VoteForm>>({});
const voteConfigForm = ref<VoteConfigForm | null>(null);
const VOTE_OUTCOMES: VoteOutcome[] = ["passed", "failed", "cancelled", "timeout"];
const VOTE_CHOICES: VoteChoice[] = ["pending", "yes", "no", "abstain"];
const battleEndedForm = ref<BattleEndedForm>(loadBattleEndedForm());
const battleEndedStatus = ref("");
const battleEndedError = ref("");
const refreshCountdown = ref(REFRESH_SECONDS);
const installedEngines = computed(() => engines.value.filter((engine) => engine.exists));
let statusTimer: ReturnType<typeof setInterval> | undefined;
let countdownTimer: ReturnType<typeof setInterval> | undefined;

function emptyLobbyForm(): LobbyForm {
    return {
        editingId: null,
        name: "",
        mapName: "",
        gameVersion: "",
        engineVersion: "",
        allyTeams: [
            { startBox: { top: 0, bottom: 1, left: 0, right: 0.25 }, maxTeams: 1, teams: [{ maxPlayers: 1 }] },
            { startBox: { top: 0, bottom: 1, left: 0.75, right: 1 }, maxTeams: 1, teams: [{ maxPlayers: 1 }] },
        ],
    };
}

function mockUserId(): string {
    return String(Math.floor(Math.random() * 1000000)).padStart(6, "0");
}

function emptyBattleEndedSlot(mockNumber: number): BattleEndedSlot {
    return { kind: "mock", clientId: "", mockUserId: mockUserId(), mockName: `MockPlayer${mockNumber}`, botShortName: "BARb" };
}

function emptyBattleEndedForm(): BattleEndedForm {
    return {
        battleId: "",
        allyTeams: [
            { winner: true, teams: [{ slots: [emptyBattleEndedSlot(1)] }] },
            { winner: false, teams: [{ slots: [emptyBattleEndedSlot(2)] }] },
        ],
        spectators: [],
        recipients: [],
    };
}

// Browser storage can be unavailable (private windows, blocked site data), so the form falls back to the 1v1 default.
function loadBattleEndedForm(): BattleEndedForm {
    try {
        const stored = localStorage.getItem(BATTLE_ENDED_STORAGE_KEY);
        if (stored) return { ...emptyBattleEndedForm(), ...(JSON.parse(stored) as Partial<BattleEndedForm>) };
    } catch {
        /* ignore */
    }
    return emptyBattleEndedForm();
}

watch(
    battleEndedForm,
    (form) => {
        try {
            localStorage.setItem(BATTLE_ENDED_STORAGE_KEY, JSON.stringify(form));
        } catch {
            /* ignore */
        }
    },
    { deep: true }
);

function resetBattleEndedForm() {
    battleEndedForm.value = emptyBattleEndedForm();
    battleEndedStatus.value = "Battle ended configuration reset to 1v1.";
    battleEndedError.value = "";
}

function battleEndedSlotCount(): number {
    const form = battleEndedForm.value;
    return form.allyTeams.flatMap((allyTeam) => allyTeam.teams.flatMap((team) => team.slots)).length + form.spectators.length;
}

// Grows or shrinks a list in place, keeping the entries that remain.
function resizeList<T>(list: T[], value: string, min: number, create: () => T) {
    const length = Math.max(min, Math.floor(Number(value)) || min);
    if (list.length > length) list.splice(length);
    while (list.length < length) list.push(create());
}

function resizeBattleEndedAllyTeams(value: string) {
    resizeList(battleEndedForm.value.allyTeams, value, 1, () => ({
        winner: false,
        teams: [{ slots: [emptyBattleEndedSlot(battleEndedSlotCount() + 1)] }],
    }));
}

function resizeBattleEndedTeams(allyTeam: BattleEndedAllyTeam, value: string) {
    resizeList(allyTeam.teams, value, 1, () => ({ slots: [emptyBattleEndedSlot(battleEndedSlotCount() + 1)] }));
}

function resizeBattleEndedSlots(team: { slots: BattleEndedSlot[] }, value: string) {
    resizeList(team.slots, value, 1, () => emptyBattleEndedSlot(battleEndedSlotCount() + 1));
}

function addBattleEndedSpectator() {
    battleEndedForm.value.spectators.push(emptyBattleEndedSlot(battleEndedSlotCount() + 1));
}

function clientName(userId: string): string {
    return connectedClients.value.find((client) => client.userId === userId)?.username ?? userId;
}

function isConnected(userId: string): boolean {
    return connectedClients.value.some((client) => client.userId === userId);
}

function battleEndedUser(slot: BattleEndedSlot): { userId: string; name: string } {
    return slot.kind === "client"
        ? { userId: slot.clientId, name: clientName(slot.clientId) }
        : { userId: slot.mockUserId, name: slot.mockName };
}

// Ids mirror the matchmaking battles: ally team, team and slot indices. Players and bots share a team's slots.
const battleEndedData = computed((): BattleEndedData => {
    const form = battleEndedForm.value;
    const data: BattleEndedData = { battleId: form.battleId.trim(), players: [], bots: [], spectators: [], winningAllyTeamIds: [] };
    form.allyTeams.forEach((allyTeam, allyTeamIndex) => {
        if (allyTeam.winner) data.winningAllyTeamIds.push(String(allyTeamIndex));
        allyTeam.teams.forEach((team, teamIndex) => {
            team.slots.forEach((slot, slotIndex) => {
                const seat = { allyTeam: String(allyTeamIndex), team: String(teamIndex), player: String(slotIndex) };
                if (slot.kind === "bot") data.bots.push({ shortName: slot.botShortName, ...seat });
                else data.players.push({ ...battleEndedUser(slot), ...seat });
            });
        });
    });
    data.spectators = form.spectators.map(battleEndedUser);
    return data;
});

const battleEndedParticipantClients = computed(() => {
    const data = battleEndedData.value;
    return [...data.players, ...data.spectators].map((user) => user.userId).filter(isConnected);
});

function selectBattleEndedRecipients(userIds: string[]) {
    battleEndedForm.value.recipients = [...new Set(userIds)];
}

async function sendBattleEnded() {
    battleEndedStatus.value = "";
    battleEndedError.value = "";
    // Recipients chosen earlier may have disconnected since; they are skipped rather than failing the send.
    const recipients = battleEndedForm.value.recipients.filter(isConnected);
    if (recipients.length === 0) {
        battleEndedError.value = "Select at least one connected client to send to.";
        return;
    }
    const response = await fetch("/api/admin/battles/ended", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipients, event: battleEndedData.value }),
    });
    const data = (await response.json().catch(() => ({}))) as { error?: string; message?: string; event?: { data: BattleEndedData } };
    if (response.ok) {
        const names = recipients.map(clientName).join(", ");
        battleEndedStatus.value = `battle/ended ${data.event?.data.battleId ?? ""} sent to ${names}.`;
    } else {
        battleEndedError.value = `battle/ended rejected (${data.error ?? response.status})${data.message ? `: ${data.message}` : "."}`;
    }
}

function describeMatchmaking(matchmaking?: MatchmakingState): string {
    if (matchmaking?.state === "queuing") return `queuing: ${matchmaking.queues.map((queue) => queue.id).join(", ")}`;
    if (matchmaking?.state === "found") return `match found: ${matchmaking.queue.id}`;
    return "not queued";
}

async function saveMatchmakingTimeout() {
    matchmakingStatus.value = "";
    matchmakingError.value = "";
    try {
        const response = await fetch("/api/admin/matchmaking/timeout", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ foundTimeoutSeconds: Number(foundTimeoutSeconds.value) }),
        });
        if (!response.ok) throw new Error("Timeout must be a positive number of seconds.");
        const data = (await response.json()) as { foundTimeoutSeconds: number };
        foundTimeoutSeconds.value = data.foundTimeoutSeconds;
        matchmakingStatus.value = "Match found timeout saved.";
    } catch (e) {
        matchmakingError.value = e instanceof Error ? e.message : "Failed to save timeout.";
    }
}

async function loadStatus() {
    const response = await fetch("/api/admin/status");
    if (!response.ok) throw new Error("Unable to load server status");
    const data = (await response.json()) as {
        clients?: ConnectedClient[];
        autohost?: AutohostStatus;
        matchmaking?: { foundTimeoutSeconds: number };
    };
    connectedClients.value = data.clients ?? [];
    if (data.autohost) autohost.value = data.autohost;
    if (data.matchmaking && document.activeElement?.id !== "found-timeout")
        foundTimeoutSeconds.value = data.matchmaking.foundTimeoutSeconds;
}

async function loadInstalledEngines() {
    try {
        const response = await fetch("/api/admin/engines/installed");
        if (response.ok) {
            const data = (await response.json()) as { engines: Engine[] };
            engines.value = data.engines;
        }
    } catch {
        /* ignore */
    }
}

async function loadOfficialMaps() {
    try {
        const response = await fetch("/api/admin/maps");
        if (response.ok) officialMaps.value = ((await response.json()) as { maps: string[] }).maps;
    } catch {
        /* ignore */
    }
}

async function loadLobbies() {
    try {
        const response = await fetch("/api/admin/lobbies");
        if (!response.ok) return;
        const data = (await response.json()) as {
            lobbies: Lobby[];
            defaults: LobbyDefaults;
            mock: MockLobbyStatus;
            listUpdateIntervalSeconds: number;
        };
        lobbies.value = data.lobbies;
        mockLobbyStatus.value = data.mock;
        if (document.activeElement?.id !== "list-update-interval") listUpdateIntervalSeconds.value = data.listUpdateIntervalSeconds;
        syncVoteForms(data.lobbies);
        // Don't overwrite a field the admin is currently typing into.
        if (!document.activeElement?.id?.startsWith("lobby-default-")) lobbyDefaults.value = data.defaults;
    } catch {
        /* ignore */
    }
}

function buildVoteForm(lobby: Lobby, vote: LobbyVote): VoteForm {
    const voters: Record<string, VoteChoice> = {};
    for (const member of lobby.members) voters[member.userId] = vote.voters[member.userId]?.vote ?? "pending";
    // Simulated voters aren't lobby members, so they only appear in the vote itself.
    for (const [userId, voter] of Object.entries(vote.voters)) voters[userId] ??= voter.vote;
    const banUntil = vote.action.type === "kickban" ? vote.action.banUntil : undefined;
    const banMinutes =
        banUntil !== undefined && lobby.voteStartedAt !== undefined ? Math.round((banUntil - lobby.voteStartedAt) / 60000000) : "";
    return {
        voteId: vote.id,
        ...actionFields(lobby, vote.action, banMinutes),
        initiator: vote.initiator,
        durationSeconds: secondsRemaining(vote.until),
        quorum: vote.quorum ?? 6,
        majority: vote.majority ?? 0.5,
        voters,
        newVoterChoice: "yes",
    };
}

function isLobbyMember(lobby: Lobby, userId: string): boolean {
    return lobby.members.some((member) => member.userId === userId);
}

function voterLabel(lobby: Lobby, userId: string): string {
    return lobby.members.find((member) => member.userId === userId)?.username ?? userId;
}

// Seated in slot order, so the list reads the same way the battle start script is built.
function sortedBots(lobby: Lobby): LobbyBot[] {
    return Object.values(lobby.bots).sort(
        (left, right) =>
            left.allyTeam.localeCompare(right.allyTeam) || left.team.localeCompare(right.team) || left.player.localeCompare(right.player)
    );
}

function addSimulatedVoter(lobby: Lobby) {
    const form = voteForms.value[lobby.id];
    if (!form) return;
    let userId: string;
    do {
        userId = String(Math.floor(Math.random() * 1000000)).padStart(6, "0");
    } while (userId in form.voters);
    form.voters[userId] = form.newVoterChoice;
}

function removeVoter(lobby: Lobby, userId: string) {
    const form = voteForms.value[lobby.id];
    if (form) delete form.voters[userId];
}

// The 5s poll must not clobber an edit in progress, so forms are only rebuilt when the vote changes.
function syncVoteForms(nextLobbies: Lobby[]) {
    const forms: Record<string, VoteForm> = {};
    for (const lobby of nextLobbies) {
        if (!lobby.currentVote) continue;
        const existing = voteForms.value[lobby.id];
        forms[lobby.id] = existing?.voteId === lobby.currentVote.id ? existing : buildVoteForm(lobby, lobby.currentVote);
    }
    voteForms.value = forms;
}

function secondsRemaining(until: number): number {
    return Math.max(0, Math.round(until / 1000000 - Date.now() / 1000));
}

function describeVoteAction(action: VoteAction): string {
    switch (action.type) {
        case "changeMap":
            return `change map to ${action.newMapName}`;
        case "appointBoss":
            return `appoint boss ${action.bossId}`;
        case "kickban":
            return action.banUntil === undefined ? `kick ${action.userId} (may rejoin)` : `kickban ${action.userId}`;
        default:
            return "start";
    }
}

function actionFields(lobby: Lobby, action: VoteAction, banMinutes: number | ""): VoteActionFields {
    return {
        actionType: action.type,
        newMapName: action.type === "changeMap" ? action.newMapName : lobby.mapName,
        bossId: action.type === "appointBoss" ? action.bossId : (lobby.members[0]?.userId ?? ""),
        kickUserId: action.type === "kickban" ? action.userId : (lobby.members[0]?.userId ?? ""),
        banMinutes,
    };
}

// Sent beside the action so the server can anchor the ban to the vote's start time.
function banMinutesField(form: VoteActionFields): { banMinutes?: number } {
    return form.actionType === "kickban" && typeof form.banMinutes === "number" ? { banMinutes: form.banMinutes } : {};
}

function voteFormAction(form: VoteActionFields): VoteAction {
    switch (form.actionType) {
        case "changeMap":
            return { type: "changeMap", newMapName: form.newMapName };
        case "appointBoss":
            return { type: "appointBoss", bossId: form.bossId };
        case "kickban":
            return { type: "kickban", userId: form.kickUserId };
        default:
            return { type: "start" };
    }
}

async function voteRequest(url: string, method: string, body?: unknown, successMessage?: string) {
    lobbyStatus.value = "";
    lobbyError.value = "";
    const response = await fetch(url, {
        method,
        ...(body !== undefined && { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    });
    if (response.ok) lobbyStatus.value = successMessage ?? "";
    else {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        lobbyError.value = `Vote request rejected (${data.error ?? response.status}).`;
    }
    await loadLobbies();
}

async function startVote(lobby: Lobby) {
    await voteRequest(`/api/admin/lobbies/${lobby.id}/vote`, "POST", {}, "Mock vote started.");
}

function describeVoteDefaults(lobby: Lobby): string {
    const defaults = lobby.voteDefaults;
    const parts = [describeVoteAction(defaults.action ?? { type: "start" })];
    if (defaults.action?.type === "kickban") parts.push(defaults.banMinutes === undefined ? "kick only" : `ban ${defaults.banMinutes} min`);
    parts.push(`${defaults.durationSeconds ?? 60}s`);
    if (defaults.fillFromTeams) parts.push("filled from team slots");
    else parts.push(`quorum ${defaults.quorum ?? 1}, majority ${defaults.majority ?? 0.5}`);
    return parts.join(" · ");
}

function openVoteConfig(lobby: Lobby) {
    const defaults = lobby.voteDefaults;
    voteConfigForm.value = {
        lobbyId: lobby.id,
        ...actionFields(lobby, defaults.action ?? { type: "start" }, defaults.banMinutes ?? ""),
        initiator: defaults.initiator ?? "",
        durationSeconds: defaults.durationSeconds ?? 60,
        quorum: defaults.quorum ?? 1,
        majority: defaults.majority ?? 0.5,
        fillFromTeams: defaults.fillFromTeams ?? false,
    };
}

const voteConfigLobby = computed(() => lobbies.value.find((lobby) => lobby.id === voteConfigForm.value?.lobbyId));

async function saveVoteConfig() {
    const form = voteConfigForm.value;
    if (!form) return;
    const body = {
        action: voteFormAction(form),
        ...banMinutesField(form),
        ...(form.initiator && { initiator: form.initiator }),
        durationSeconds: form.durationSeconds,
        fillFromTeams: form.fillFromTeams,
        ...(!form.fillFromTeams && { quorum: form.quorum, majority: form.majority }),
    };
    voteConfigForm.value = null;
    await voteRequest(`/api/admin/lobbies/${form.lobbyId}/vote/defaults`, "PUT", body, "Mock vote defaults saved.");
}

async function saveVote(lobby: Lobby) {
    const form = voteForms.value[lobby.id];
    if (!form) return;
    const body = {
        action: voteFormAction(form),
        ...banMinutesField(form),
        initiator: form.initiator,
        durationSeconds: form.durationSeconds,
        quorum: form.quorum,
        majority: form.majority,
        voters: form.voters,
        // The form holds the authoritative voter set, so anything missing from it was removed.
        removeVoters: Object.keys(lobby.currentVote?.voters ?? {}).filter((userId) => !(userId in form.voters)),
    };
    await voteRequest(`/api/admin/lobbies/${lobby.id}/vote`, "PUT", body, "Vote updated.");
}

async function endVote(lobby: Lobby, outcome: VoteOutcome) {
    await voteRequest(`/api/admin/lobbies/${lobby.id}/vote/end`, "POST", { outcome }, `Vote ended as ${outcome}.`);
}

async function deleteVoteHistoryEntry(lobby: Lobby, entryId: string) {
    await voteRequest(`/api/admin/lobbies/${lobby.id}/vote/history/${entryId}`, "DELETE", undefined, "History entry deleted.");
}

async function saveLobbyDefaults() {
    lobbyStatus.value = "";
    lobbyError.value = "";
    const response = await fetch("/api/admin/lobbies/defaults", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(lobbyDefaults.value),
    });
    if (response.ok) lobbyStatus.value = "Lobby defaults saved.";
    else {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        lobbyError.value =
            data.error === "invalid_map_name" ? "That map is not an official map." : "Lobby defaults rejected (is the engine installed?).";
    }
}

function openCreateLobby() {
    lobbyForm.value = { ...emptyLobbyForm(), ...lobbyDefaults.value, name: `Lobby ${lobbies.value.length + 1}` };
    lobbyFormOpen.value = true;
}

function openEditLobby(lobby: Lobby) {
    lobbyForm.value = {
        editingId: lobby.id,
        name: lobby.name,
        mapName: lobby.mapName,
        gameVersion: lobby.gameVersion,
        engineVersion: lobby.engineVersion,
        allyTeams: Object.keys(lobby.allyTeamConfig)
            .sort()
            .map((key) => {
                const allyTeam = lobby.allyTeamConfig[key];
                return {
                    startBox: { ...allyTeam.startBox },
                    maxTeams: allyTeam.maxTeams,
                    teams: Object.keys(allyTeam.teams)
                        .sort()
                        .map((teamKey) => ({ maxPlayers: allyTeam.teams[teamKey].maxPlayers })),
                };
            }),
    };
    lobbyFormOpen.value = true;
}

function addFormAllyTeam() {
    lobbyForm.value.allyTeams.push({ startBox: { top: 0, bottom: 1, left: 0, right: 0.25 }, maxTeams: 1, teams: [{ maxPlayers: 1 }] });
}

function removeFormAllyTeam(index: number) {
    if (lobbyForm.value.allyTeams.length > 1) lobbyForm.value.allyTeams.splice(index, 1);
}

function addFormTeam(allyTeam: LobbyAllyTeamForm) {
    allyTeam.teams.push({ maxPlayers: 1 });
    allyTeam.maxTeams = Math.max(allyTeam.maxTeams, allyTeam.teams.length);
}

function removeFormTeam(allyTeam: LobbyAllyTeamForm, index: number) {
    if (allyTeam.teams.length > 1) allyTeam.teams.splice(index, 1);
}

async function submitLobbyForm() {
    lobbyStatus.value = "";
    lobbyError.value = "";
    const { editingId, ...body } = lobbyForm.value;
    const response = await fetch(editingId ? `/api/admin/lobbies/${editingId}` : "/api/admin/lobbies", {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        lobbyError.value =
            data.error === "invalid_engine_version"
                ? "That engine version is not installed."
                : data.error === "invalid_map_name"
                  ? "That map is not an official map."
                  : "Lobby configuration rejected.";
        return;
    }
    lobbyFormOpen.value = false;
    lobbyStatus.value = editingId ? "Lobby updated." : "Lobby created.";
    await loadLobbies();
}

async function deleteLobby() {
    const target = lobbyDeleteTarget.value;
    lobbyDeleteTarget.value = null;
    if (!target) return;
    lobbyStatus.value = "";
    lobbyError.value = "";
    const response = await fetch(`/api/admin/lobbies/${target.id}`, { method: "DELETE" });
    if (response.ok) lobbyStatus.value = "Lobby deleted.";
    else lobbyError.value = "Could not delete lobby.";
    await loadLobbies();
}

async function moveMember(lobby: Lobby, member: LobbyMember, allyTeam: string) {
    lobbyStatus.value = "";
    lobbyError.value = "";
    const url = `/api/admin/lobbies/${lobby.id}/members/${member.userId}/${allyTeam === "spectator" ? "spectate" : "allyTeam"}`;
    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allyTeam }),
    });
    if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        lobbyError.value = data.error === "ally_team_full" ? "That ally team is full." : "Could not move that client.";
    }
    await loadLobbies();
}

async function resetLobbyList() {
    lobbyStatus.value = "";
    lobbyError.value = "";
    const response = await fetch("/api/admin/lobbies/reset", { method: "POST" });
    if (response.ok) lobbyStatus.value = "Lobby list resent to all connected clients.";
    else lobbyError.value = "Could not reset the lobby list.";
}

async function saveListUpdateInterval() {
    lobbyStatus.value = "";
    lobbyError.value = "";
    const response = await fetch("/api/admin/lobbies/listUpdateInterval", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seconds: Number(listUpdateIntervalSeconds.value) }),
    });
    const data = (await response.json().catch(() => ({}))) as { listUpdateIntervalSeconds?: number; min?: number; max?: number };
    if (response.ok && data.listUpdateIntervalSeconds !== undefined) {
        listUpdateIntervalSeconds.value = data.listUpdateIntervalSeconds;
        lobbyStatus.value = "List update interval saved.";
    } else {
        lobbyError.value = `List update interval must be from ${data.min ?? 1} to ${data.max ?? 10} seconds.`;
    }
}

async function mockLobbyRequest(action: "start" | "stop") {
    lobbyStatus.value = "";
    lobbyError.value = "";
    mockLobbyPending.value = true;
    try {
        const response = await fetch(`/api/admin/lobbies/mock/${action}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(action === "start" ? mockLobbyForm.value : {}),
        });
        const data = (await response.json().catch(() => ({}))) as { mock?: MockLobbyStatus; error?: string; min?: number; max?: number };
        if (response.ok && data.mock) {
            mockLobbyStatus.value = data.mock;
            lobbyStatus.value = action === "start" ? "Mock lobbies generating." : "Mock lobbies removed.";
        } else if (data.error === "invalid_mock_count") {
            lobbyError.value = `Mock lobby count must be a whole number from ${data.min} to ${data.max}.`;
        } else if (data.error === "invalid_mock_rate") {
            lobbyError.value = `Updates per second must be above 0 and at most ${data.max}.`;
        } else {
            lobbyError.value = `Could not ${action} mock lobbies.`;
        }
    } finally {
        mockLobbyPending.value = false;
    }
}

function refreshAll() {
    refreshCountdown.value = REFRESH_SECONDS;
    void loadStatus().catch(() => (clientError.value = "Unable to load server status."));
    void loadInstalledEngines();
    void loadLobbies();
}

onMounted(async () => {
    const response = await fetch("/api/admin/password");
    if (response.ok) password.value = (await response.json()).password;
    try {
        await loadStatus();
        await loadInstalledEngines();
        await loadLobbies();
        // The map list is fixed for the server's lifetime, so it is not part of the refresh cycle.
        void loadOfficialMaps();
        refreshCountdown.value = REFRESH_SECONDS;
        statusTimer = setInterval(refreshAll, REFRESH_SECONDS * 1000);
        countdownTimer = setInterval(() => {
            refreshCountdown.value = Math.max(0, refreshCountdown.value - 1);
        }, 1000);
    } catch {
        clientError.value = "Unable to load server status.";
    }
});

onUnmounted(() => {
    clearInterval(statusTimer);
    clearInterval(countdownTimer);
});

async function savePassword() {
    status.value = "";
    error.value = "";
    const response = await fetch("/api/admin/password", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: password.value }),
    });
    if (response.ok) status.value = "Password updated.";
    else error.value = "Password could not be updated.";
}

async function startAutohost() {
    autohostError.value = "";
    autohostActionPending.value = true;
    try {
        const response = await fetch("/api/admin/autohost/start", { method: "POST" });
        if (response.ok) autohost.value = await response.json();
        else autohostError.value = "Could not start autohost.";
    } finally {
        autohostActionPending.value = false;
    }
}

async function stopAutohost() {
    autohostError.value = "";
    autohostActionPending.value = true;
    try {
        const response = await fetch("/api/admin/autohost/stop", { method: "POST" });
        if (response.ok) autohost.value = await response.json();
        else autohostError.value = "Could not stop autohost.";
    } finally {
        autohostActionPending.value = false;
    }
}

async function downloadEngine() {
    if (!engineVersion.value) {
        engineDownloadError.value = "Please enter an engine version.";
        return;
    }

    engineDownloadStatus.value = "";
    engineDownloadError.value = "";
    engineDownloadPending.value = true;

    try {
        const response = await fetch("/api/admin/engines/download", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ version: engineVersion.value }),
        });

        if (response.ok) {
            const data = (await response.json()) as { engines: Engine[] };
            engines.value = data.engines;
            engineDownloadStatus.value = `Engine ${engineVersion.value} downloaded successfully.`;
            engineVersion.value = "";
        } else {
            const data = (await response.json()) as { error: string; message?: string };
            engineDownloadError.value = data.message || "Failed to download engine.";
        }
    } catch (e) {
        engineDownloadError.value = e instanceof Error ? e.message : "Failed to download engine.";
    } finally {
        engineDownloadPending.value = false;
    }
}

async function shutdownServer() {
    try {
        await fetch("/api/admin/shutdown", { method: "POST" });
        // Server will shut down after a brief delay
        // Optionally redirect or show message
        setTimeout(() => {
            clientError.value = "Server has been shut down.";
        }, 500);
    } catch (e) {
        clientError.value = e instanceof Error ? e.message : "Failed to shut down server.";
    }
}

function openShutdownConfirmation() {
    shutdownConfirmationOpen.value = true;
}

function cancelShutdown() {
    shutdownConfirmationOpen.value = false;
}

function confirmShutdown() {
    shutdownConfirmationOpen.value = false;
    void shutdownServer();
}
</script>

<template>
    <main class="page">
        <div class="header">
            <h1>Mockyon Admin</h1>
            <span class="countdown">Refreshing in {{ refreshCountdown }}s</span>
            <button type="button" class="shutdown-button" @click="openShutdownConfirmation">Shut Down Server</button>
        </div>
        <p class="notice">A web interface for managing the Mockyon server.</p>
        <section>
            <h2>Server Password</h2>
            <form @submit.prevent="savePassword">
                <label>
                    Password
                    <input v-model="password" type="text" autocomplete="off" />
                </label>
                <button type="submit">Save password</button>
            </form>
            <p v-if="status" class="success">{{ status }}</p>
            <p v-if="error" class="error">{{ error }}</p>
        </section>
        <section>
            <h2>Connected Clients</h2>
            <p v-if="clientError" class="error">{{ clientError }}</p>
            <p v-else-if="connectedClients.length === 0">No clients connected.</p>
            <ul v-else>
                <li v-for="client in connectedClients" :key="client.userId">
                    {{ client.username }} (ID: {{ client.userId }})
                    <span class="matchmaking">{{ describeMatchmaking(client.matchmaking) }}</span>
                </li>
            </ul>
        </section>
        <section>
            <h2>Matchmaking</h2>
            <form @submit.prevent="saveMatchmakingTimeout">
                <label>
                    Match found timeout (seconds)
                    <input id="found-timeout" v-model.number="foundTimeoutSeconds" type="number" min="0.1" step="0.1" />
                </label>
                <button type="submit">Save timeout</button>
            </form>
            <p v-if="matchmakingStatus" class="success">{{ matchmakingStatus }}</p>
            <p v-if="matchmakingError" class="error">{{ matchmakingError }}</p>
        </section>
        <section>
            <h2>Autohost</h2>
            <p>
                Status: <strong>{{ autohost.connected ? "connected" : autohost.status }}</strong>
                <span v-if="autohost.pid"> (pid {{ autohost.pid }})</span>
            </p>
            <button type="button" :disabled="autohostActionPending || autohost.status !== 'stopped'" @click="startAutohost">
                Start autohost
            </button>
            <button type="button" :disabled="autohostActionPending || autohost.status === 'stopped'" @click="stopAutohost">
                Stop autohost
            </button>
            <p v-if="autohostError" class="error">{{ autohostError }}</p>
        </section>
        <section>
            <h2>Engines</h2>
            <div class="engines-list">
                <p v-if="engines.length === 0">No engines installed.</p>
                <ul v-else>
                    <li v-for="engine in engines" :key="engine.version">
                        {{ engine.version }}
                        <span v-if="!engine.exists" class="warning">(missing executable)</span>
                    </li>
                </ul>
            </div>
            <form @submit.prevent="downloadEngine" class="download-form">
                <label>
                    Engine Version
                    <input v-model="engineVersion" type="text" placeholder="e.g., 2025.01.02" :disabled="engineDownloadPending" />
                </label>
                <button type="submit" :disabled="engineDownloadPending">
                    {{ engineDownloadPending ? "Downloading..." : "Download Engine" }}
                </button>
            </form>
            <p v-if="engineDownloadStatus" class="success">{{ engineDownloadStatus }}</p>
            <p v-if="engineDownloadError" class="error">{{ engineDownloadError }}</p>
        </section>

        <section>
            <h2>Lobbies</h2>
            <datalist id="official-maps">
                <option v-for="map in officialMaps" :key="map" :value="map" />
            </datalist>
            <form class="download-form" @submit.prevent="saveLobbyDefaults">
                <label>
                    Default map
                    <input id="lobby-default-map" v-model="lobbyDefaults.mapName" type="text" list="official-maps" />
                </label>
                <label>
                    Default game
                    <input id="lobby-default-game" v-model="lobbyDefaults.gameVersion" type="text" />
                </label>
                <label>
                    Default engine
                    <select id="lobby-default-engine" v-model="lobbyDefaults.engineVersion">
                        <option v-for="engine in installedEngines" :key="engine.version" :value="engine.version">
                            {{ engine.version }}
                        </option>
                    </select>
                </label>
                <button type="submit">Save lobby defaults</button>
            </form>
            <div class="lobby-actions">
                <button type="button" :disabled="installedEngines.length === 0" @click="openCreateLobby">Create lobby</button>
                <button type="button" @click="resetLobbyList">Resend lobby list to all clients</button>
            </div>
            <form class="lobby-actions" @submit.prevent="mockLobbyRequest('start')">
                <label>
                    Mock lobbies
                    <input v-model.number="mockLobbyForm.count" type="number" min="20" step="1" />
                </label>
                <label>
                    Updates/sec
                    <input v-model.number="mockLobbyForm.ratePerSecond" type="number" min="0.1" step="0.1" />
                </label>
                <button type="submit" :disabled="mockLobbyPending">
                    {{ mockLobbyStatus?.running ? "Apply and regenerate mock lobbies" : "Start mock lobbies" }}
                </button>
                <button type="button" :disabled="mockLobbyPending || !mockLobbyStatus?.running" @click="mockLobbyRequest('stop')">
                    Stop mock lobbies
                </button>
                <span v-if="mockLobbyStatus?.running" class="notice">
                    Running: {{ mockLobbyStatus.current }}/{{ mockLobbyStatus.count }} ({{ mockLobbyStatus.inBattle }} in battle) at
                    {{ mockLobbyStatus.ratePerSecond }}/s
                </span>
            </form>
            <form class="lobby-actions" @submit.prevent="saveListUpdateInterval">
                <label>
                    Send lobby/listUpdated at most every (seconds)
                    <input id="list-update-interval" v-model.number="listUpdateIntervalSeconds" type="number" min="1" max="10" step="0.5" />
                </label>
                <button type="submit">Save interval</button>
            </form>
            <p v-if="installedEngines.length === 0" class="warning">Install an engine before creating a lobby.</p>
            <p v-if="lobbies.length === 0">No lobbies.</p>
            <div v-for="lobby in lobbies" :key="lobby.id" class="lobby">
                <h3>{{ lobby.name }}</h3>
                <p class="notice">
                    {{ lobby.mapName }} &middot; {{ lobby.gameVersion }} &middot; engine {{ lobby.engineVersion }} &middot;
                    {{ lobby.overview.playerCount }}/{{ lobby.overview.maxPlayerCount }} players
                </p>
                <ul class="ally-teams">
                    <li v-for="(allyTeam, key) in lobby.allyTeamConfig" :key="key">
                        Ally team {{ key }}: {{ Object.keys(allyTeam.teams).length }}/{{ allyTeam.maxTeams }} teams, box [{{
                            allyTeam.startBox.left
                        }}, {{ allyTeam.startBox.top }}, {{ allyTeam.startBox.right }}, {{ allyTeam.startBox.bottom }}]
                    </li>
                </ul>
                <p v-if="lobby.members.length === 0">No clients in this lobby.</p>
                <ul v-else class="lobby-members">
                    <li v-for="member in lobby.members" :key="member.userId">
                        {{ member.username ?? member.userId }}
                        <span class="matchmaking">{{
                            member.allyTeam === null ? "spectating" : `ally team ${member.allyTeam}, team ${member.team}`
                        }}</span>
                        <select
                            :value="member.allyTeam ?? 'spectator'"
                            @change="moveMember(lobby, member, ($event.target as HTMLSelectElement).value)"
                        >
                            <option value="spectator">Spectator</option>
                            <option v-for="key in Object.keys(lobby.allyTeamConfig)" :key="key" :value="key">Ally team {{ key }}</option>
                        </select>
                    </li>
                </ul>
                <ul v-if="Object.keys(lobby.bots).length > 0" class="lobby-members">
                    <li v-for="bot in sortedBots(lobby)" :key="bot.id">
                        {{ bot.name ?? bot.shortName }}
                        <span class="matchmaking">
                            bot<template v-if="bot.name"> ({{ bot.shortName }}{{ bot.version ? ` ${bot.version}` : "" }})</template>
                            &middot; hosted by {{ voterLabel(lobby, bot.hostUserId) }} &middot; ally team {{ bot.allyTeam }}, team
                            {{ bot.team }}, slot
                            {{ bot.player }}
                        </span>
                    </li>
                </ul>
                <div class="lobby-actions">
                    <button type="button" @click="openEditLobby(lobby)">Edit</button>
                    <button type="button" class="shutdown-button" @click="lobbyDeleteTarget = lobby">Delete</button>
                </div>

                <h4>Mock vote</h4>
                <template v-if="!lobby.currentVote">
                    <p>
                        No active vote.
                        <span class="matchmaking">Default: {{ describeVoteDefaults(lobby) }}</span>
                    </p>
                    <div class="lobby-actions">
                        <button type="button" @click="startVote(lobby)">Start mock vote</button>
                        <button type="button" @click="openVoteConfig(lobby)">Configure default mock vote</button>
                    </div>
                </template>
                <template v-else-if="voteForms[lobby.id]">
                    <form class="download-form" @submit.prevent="saveVote(lobby)">
                        <label>
                            Action
                            <select :id="`lobby-vote-${lobby.id}-action`" v-model="voteForms[lobby.id].actionType">
                                <option value="start">Start battle</option>
                                <option value="changeMap">Change map</option>
                                <option value="appointBoss">Appoint boss</option>
                                <option value="kickban">Kickban</option>
                            </select>
                        </label>
                        <label v-if="voteForms[lobby.id].actionType === 'changeMap'">
                            New map name
                            <input :id="`lobby-vote-${lobby.id}-map`" v-model="voteForms[lobby.id].newMapName" type="text" />
                        </label>
                        <label v-if="voteForms[lobby.id].actionType === 'appointBoss'">
                            Boss
                            <select :id="`lobby-vote-${lobby.id}-boss`" v-model="voteForms[lobby.id].bossId">
                                <option v-for="member in lobby.members" :key="member.userId" :value="member.userId">
                                    {{ member.username ?? member.userId }}
                                </option>
                            </select>
                        </label>
                        <label v-if="voteForms[lobby.id].actionType === 'kickban'">
                            Target
                            <select :id="`lobby-vote-${lobby.id}-kick`" v-model="voteForms[lobby.id].kickUserId">
                                <option v-for="member in lobby.members" :key="member.userId" :value="member.userId">
                                    {{ member.username ?? member.userId }}
                                </option>
                            </select>
                        </label>
                        <label v-if="voteForms[lobby.id].actionType === 'kickban'">
                            Ban for (minutes after vote start, blank = kick only, may rejoin)
                            <input
                                :id="`lobby-vote-${lobby.id}-ban-minutes`"
                                v-model.number="voteForms[lobby.id].banMinutes"
                                type="number"
                                min="1"
                                step="1"
                            />
                        </label>
                        <label>
                            Initiator
                            <select :id="`lobby-vote-${lobby.id}-initiator`" v-model="voteForms[lobby.id].initiator">
                                <option v-for="(choice, userId) in voteForms[lobby.id].voters" :key="userId" :value="userId">
                                    {{ voterLabel(lobby, String(userId)) }}
                                </option>
                            </select>
                        </label>
                        <label>
                            Seconds remaining (saving restarts the timer)
                            <input
                                :id="`lobby-vote-${lobby.id}-duration`"
                                v-model.number="voteForms[lobby.id].durationSeconds"
                                type="number"
                                min="0"
                            />
                        </label>
                        <label>
                            Quorum
                            <input
                                :id="`lobby-vote-${lobby.id}-quorum`"
                                v-model.number="voteForms[lobby.id].quorum"
                                type="number"
                                min="0"
                            />
                        </label>
                        <label>
                            Majority
                            <input
                                :id="`lobby-vote-${lobby.id}-majority`"
                                v-model.number="voteForms[lobby.id].majority"
                                type="number"
                                min="0"
                                max="1"
                                step="0.01"
                            />
                        </label>
                        <ul class="lobby-members">
                            <li v-for="(choice, userId) in voteForms[lobby.id].voters" :key="userId">
                                {{ voterLabel(lobby, String(userId)) }}
                                <span v-if="!isLobbyMember(lobby, String(userId))" class="matchmaking">simulated</span>
                                <select :id="`lobby-vote-${lobby.id}-voter-${userId}`" v-model="voteForms[lobby.id].voters[userId]">
                                    <option v-for="option in VOTE_CHOICES" :key="option" :value="option">{{ option }}</option>
                                </select>
                                <button type="button" class="shutdown-button" @click="removeVoter(lobby, String(userId))">Remove</button>
                            </li>
                        </ul>
                        <div class="lobby-actions">
                            <select :id="`lobby-vote-${lobby.id}-new-voter`" v-model="voteForms[lobby.id].newVoterChoice">
                                <option v-for="option in VOTE_CHOICES" :key="option" :value="option">{{ option }}</option>
                            </select>
                            <button type="button" @click="addSimulatedVoter(lobby)">Add simulated voter</button>
                        </div>
                        <button type="submit">Save vote</button>
                    </form>
                    <div class="lobby-actions">
                        <button v-for="outcome in VOTE_OUTCOMES" :key="outcome" type="button" @click="endVote(lobby, outcome)">
                            End as {{ outcome }}
                        </button>
                    </div>
                </template>

                <h4>Vote history</h4>
                <p v-if="!lobby.voteHistory || Object.keys(lobby.voteHistory).length === 0">No finished votes.</p>
                <ul v-else class="lobby-members">
                    <li v-for="(entry, entryId) in lobby.voteHistory" :key="entryId">
                        {{ describeVoteAction(entry.vote) }}
                        <span class="matchmaking"
                            >{{ entry.outcome }} &middot; {{ new Date(entry.finishedAt / 1000).toLocaleTimeString() }}</span
                        >
                        <button type="button" class="shutdown-button" @click="deleteVoteHistoryEntry(lobby, String(entryId))">
                            Delete
                        </button>
                    </li>
                </ul>
            </div>
            <p v-if="lobbyStatus" class="success">{{ lobbyStatus }}</p>
            <p v-if="lobbyError" class="error">{{ lobbyError }}</p>
        </section>

        <section>
            <h2>Battle Ended Event</h2>
            <p class="notice">
                Real battles send <code>battle/ended</code> on their own. This sends a custom one; it need not match any battle.
            </p>
            <form class="download-form" @submit.prevent="sendBattleEnded">
                <label>
                    Battle ID (blank = random on each send)
                    <input v-model="battleEndedForm.battleId" type="text" autocomplete="off" />
                </label>
                <label>
                    Ally teams
                    <input
                        :value="battleEndedForm.allyTeams.length"
                        type="number"
                        min="1"
                        step="1"
                        @change="resizeBattleEndedAllyTeams(($event.target as HTMLInputElement).value)"
                    />
                </label>
                <div v-for="(allyTeam, allyTeamIndex) in battleEndedForm.allyTeams" :key="allyTeamIndex" class="ally-team-editor">
                    <div class="lobby-actions">
                        <strong>Ally team {{ allyTeamIndex }}</strong>
                        <label class="checkbox-label">
                            <input v-model="allyTeam.winner" type="checkbox" />
                            Winner
                        </label>
                    </div>
                    <label>
                        Teams
                        <input
                            :value="allyTeam.teams.length"
                            type="number"
                            min="1"
                            step="1"
                            @change="resizeBattleEndedTeams(allyTeam, ($event.target as HTMLInputElement).value)"
                        />
                    </label>
                    <div v-for="(team, teamIndex) in allyTeam.teams" :key="teamIndex" class="battle-ended-team">
                        <label>
                            Team {{ teamIndex }} slots
                            <input
                                :value="team.slots.length"
                                type="number"
                                min="1"
                                step="1"
                                @change="resizeBattleEndedSlots(team, ($event.target as HTMLInputElement).value)"
                            />
                        </label>
                        <div v-for="(slot, slotIndex) in team.slots" :key="slotIndex" class="lobby-actions">
                            <span class="matchmaking">Slot {{ slotIndex }}</span>
                            <select v-model="slot.kind">
                                <option value="client">Connected client</option>
                                <option value="mock">Mock user</option>
                                <option value="bot">Bot</option>
                            </select>
                            <select v-if="slot.kind === 'client'" v-model="slot.clientId" required>
                                <option value="" disabled>Choose a client</option>
                                <option v-if="slot.clientId && !isConnected(slot.clientId)" :value="slot.clientId">
                                    {{ slot.clientId }} (disconnected)
                                </option>
                                <option v-for="client in connectedClients" :key="client.userId" :value="client.userId">
                                    {{ client.username }}
                                </option>
                            </select>
                            <template v-else-if="slot.kind === 'mock'">
                                <input v-model="slot.mockUserId" type="text" placeholder="User ID" required />
                                <input v-model="slot.mockName" type="text" placeholder="Name" required />
                            </template>
                            <input v-else v-model="slot.botShortName" type="text" placeholder="Bot short name" required />
                        </div>
                    </div>
                </div>

                <strong>Spectators</strong>
                <p v-if="battleEndedForm.spectators.length === 0" class="notice">No spectators.</p>
                <div v-for="(spectator, spectatorIndex) in battleEndedForm.spectators" :key="spectatorIndex" class="lobby-actions">
                    <select v-model="spectator.kind">
                        <option value="client">Connected client</option>
                        <option value="mock">Mock user</option>
                    </select>
                    <select v-if="spectator.kind === 'client'" v-model="spectator.clientId" required>
                        <option value="" disabled>Choose a client</option>
                        <option v-if="spectator.clientId && !isConnected(spectator.clientId)" :value="spectator.clientId">
                            {{ spectator.clientId }} (disconnected)
                        </option>
                        <option v-for="client in connectedClients" :key="client.userId" :value="client.userId">
                            {{ client.username }}
                        </option>
                    </select>
                    <template v-else>
                        <input v-model="spectator.mockUserId" type="text" placeholder="User ID" required />
                        <input v-model="spectator.mockName" type="text" placeholder="Name" required />
                    </template>
                    <button type="button" class="shutdown-button" @click="battleEndedForm.spectators.splice(spectatorIndex, 1)">
                        Remove
                    </button>
                </div>
                <div class="lobby-actions">
                    <button type="button" @click="addBattleEndedSpectator">Add spectator</button>
                </div>

                <strong>Send to</strong>
                <p v-if="connectedClients.length === 0" class="notice">No clients connected.</p>
                <label v-for="client in connectedClients" :key="client.userId" class="checkbox-label">
                    <input v-model="battleEndedForm.recipients" type="checkbox" :value="client.userId" />
                    {{ client.username }}
                </label>
                <div class="lobby-actions">
                    <button type="button" @click="selectBattleEndedRecipients(connectedClients.map((client) => client.userId))">
                        All clients
                    </button>
                    <button type="button" @click="selectBattleEndedRecipients(battleEndedParticipantClients)">Participating clients</button>
                    <button type="button" @click="selectBattleEndedRecipients([])">None</button>
                </div>

                <details>
                    <summary>Event preview</summary>
                    <pre class="battle-ended-preview">{{ JSON.stringify(battleEndedData, null, 2) }}</pre>
                </details>
                <div class="lobby-actions">
                    <button type="submit">Send battle/ended</button>
                    <button type="button" class="shutdown-button" @click="resetBattleEndedForm">Reset to 1v1</button>
                </div>
            </form>
            <p v-if="battleEndedStatus" class="success">{{ battleEndedStatus }}</p>
            <p v-if="battleEndedError" class="error">{{ battleEndedError }}</p>
        </section>

        <!-- Shutdown Confirmation Dialog -->
        <div v-if="shutdownConfirmationOpen" class="modal-overlay">
            <div class="modal">
                <h2>Confirm Server Shutdown</h2>
                <p>This will:</p>
                <ul>
                    <li>Stop the autohost if running</li>
                    <li>Cancel any in-progress engine downloads</li>
                    <li>Gracefully shut down the server</li>
                </ul>
                <p><strong>Are you sure?</strong></p>
                <div class="modal-buttons">
                    <button type="button" class="cancel-button" @click="cancelShutdown">Cancel</button>
                    <button type="button" class="confirm-button" @click="confirmShutdown">Shut Down Server</button>
                </div>
            </div>
        </div>
        <div v-if="lobbyFormOpen" class="modal-overlay">
            <div class="modal modal-wide">
                <h2>{{ lobbyForm.editingId ? "Edit Lobby" : "Create Lobby" }}</h2>
                <form class="download-form" @submit.prevent="submitLobbyForm">
                    <label>
                        Name
                        <input v-model="lobbyForm.name" type="text" required />
                    </label>
                    <label>
                        Map
                        <input v-model="lobbyForm.mapName" type="text" list="official-maps" required />
                    </label>
                    <label>
                        Game
                        <input v-model="lobbyForm.gameVersion" type="text" required />
                    </label>
                    <label>
                        Engine
                        <select v-model="lobbyForm.engineVersion" required>
                            <option v-for="engine in installedEngines" :key="engine.version" :value="engine.version">
                                {{ engine.version }}
                            </option>
                        </select>
                    </label>
                    <div v-for="(allyTeam, allyTeamIndex) in lobbyForm.allyTeams" :key="allyTeamIndex" class="ally-team-editor">
                        <div class="lobby-actions">
                            <strong>Ally team {{ allyTeamIndex }}</strong>
                            <button type="button" :disabled="lobbyForm.allyTeams.length <= 1" @click="removeFormAllyTeam(allyTeamIndex)">
                                Remove ally team
                            </button>
                        </div>
                        <label>
                            Max teams
                            <input v-model.number="allyTeam.maxTeams" type="number" :min="allyTeam.teams.length" step="1" />
                        </label>
                        <div class="start-box">
                            <label v-for="side in ['left', 'top', 'right', 'bottom'] as const" :key="side">
                                {{ side }}
                                <input v-model.number="allyTeam.startBox[side]" type="number" min="0" max="1" step="0.05" />
                            </label>
                        </div>
                        <div v-for="(team, teamIndex) in allyTeam.teams" :key="teamIndex" class="lobby-actions">
                            <label>
                                Team {{ teamIndex }} max players
                                <input v-model.number="team.maxPlayers" type="number" min="1" step="1" />
                            </label>
                            <button type="button" :disabled="allyTeam.teams.length <= 1" @click="removeFormTeam(allyTeam, teamIndex)">
                                Remove team
                            </button>
                        </div>
                        <button type="button" @click="addFormTeam(allyTeam)">Add team</button>
                    </div>
                    <button type="button" @click="addFormAllyTeam">Add ally team</button>
                    <div class="modal-buttons">
                        <button type="button" class="cancel-button" @click="lobbyFormOpen = false">Cancel</button>
                        <button type="submit" class="confirm-button">{{ lobbyForm.editingId ? "Save lobby" : "Create lobby" }}</button>
                    </div>
                </form>
            </div>
        </div>

        <div v-if="voteConfigForm && voteConfigLobby" class="modal-overlay">
            <div class="modal modal-wide">
                <h2>Default Mock Vote</h2>
                <p>Used by "Start mock vote" in {{ voteConfigLobby.name }}.</p>
                <form class="download-form" @submit.prevent="saveVoteConfig">
                    <label>
                        Action
                        <select v-model="voteConfigForm.actionType">
                            <option value="start">Start battle</option>
                            <option value="changeMap">Change map</option>
                            <option value="appointBoss">Appoint boss</option>
                            <option value="kickban">Kickban</option>
                        </select>
                    </label>
                    <label v-if="voteConfigForm.actionType === 'changeMap'">
                        New map name
                        <input v-model="voteConfigForm.newMapName" type="text" required />
                    </label>
                    <label v-if="voteConfigForm.actionType === 'appointBoss'">
                        Boss
                        <select v-model="voteConfigForm.bossId" required>
                            <option v-for="member in voteConfigLobby.members" :key="member.userId" :value="member.userId">
                                {{ member.username ?? member.userId }}
                            </option>
                        </select>
                    </label>
                    <template v-if="voteConfigForm.actionType === 'kickban'">
                        <label>
                            Target
                            <select v-model="voteConfigForm.kickUserId" required>
                                <option v-for="member in voteConfigLobby.members" :key="member.userId" :value="member.userId">
                                    {{ member.username ?? member.userId }}
                                </option>
                            </select>
                        </label>
                        <label>
                            Ban for (minutes after vote start, blank = kick only, may rejoin)
                            <input v-model.number="voteConfigForm.banMinutes" type="number" min="1" step="1" />
                        </label>
                    </template>
                    <label>
                        Initiator
                        <select v-model="voteConfigForm.initiator">
                            <option value="">First lobby member</option>
                            <option v-for="member in voteConfigLobby.members" :key="member.userId" :value="member.userId">
                                {{ member.username ?? member.userId }}
                            </option>
                        </select>
                    </label>
                    <label>
                        Duration (seconds)
                        <input v-model.number="voteConfigForm.durationSeconds" type="number" min="1" step="1" />
                    </label>
                    <label class="checkbox-label">
                        <input v-model="voteConfigForm.fillFromTeams" type="checkbox" />
                        Fill based on current team configuration
                    </label>
                    <p v-if="voteConfigForm.fillFromTeams" class="notice">
                        Quorum becomes half the player slots (rounded up) and majority 0.5. Players in the lobby vote; spectators are left
                        out, and simulated pending voters fill the remaining slots.
                    </p>
                    <template v-else>
                        <label>
                            Quorum
                            <input v-model.number="voteConfigForm.quorum" type="number" min="0" step="1" />
                        </label>
                        <label>
                            Majority
                            <input v-model.number="voteConfigForm.majority" type="number" min="0" max="1" step="0.01" />
                        </label>
                    </template>
                    <div class="modal-buttons">
                        <button type="button" class="cancel-button" @click="voteConfigForm = null">Cancel</button>
                        <button type="submit" class="confirm-button">Save defaults</button>
                    </div>
                </form>
            </div>
        </div>

        <div v-if="lobbyDeleteTarget" class="modal-overlay">
            <div class="modal">
                <h2>Delete Lobby</h2>
                <p>
                    Delete <strong>{{ lobbyDeleteTarget.name }}</strong
                    >? Any clients in it will be sent a <code>lobby/left</code> event.
                </p>
                <div class="modal-buttons">
                    <button type="button" class="cancel-button" @click="lobbyDeleteTarget = null">Cancel</button>
                    <button type="button" class="confirm-button" @click="deleteLobby">Delete lobby</button>
                </div>
            </div>
        </div>
    </main>
</template>

<style>
.page {
    font-family: system-ui, sans-serif;
    max-width: 40rem;
    margin: 4rem auto;
    padding: 0 1rem;
}
.notice {
    color: #666;
}
.success {
    color: #067647;
}
.error {
    color: #b42318;
}
.warning {
    color: #bf8700;
    font-size: 0.9em;
}
.matchmaking {
    color: #666;
    font-size: 0.9em;
}
.countdown {
    color: #666;
    font-size: 0.9em;
    white-space: nowrap;
}
.lobby {
    border: 1px solid #ddd;
    border-radius: 4px;
    padding: 0.75rem;
    margin-bottom: 0.75rem;
}
.lobby h3 {
    margin: 0;
}
.lobby-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
    margin: 0.5rem 0;
}
.ally-teams,
.lobby-members {
    list-style: none;
    padding: 0;
    font-size: 0.95em;
}
.lobby-members li {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.25rem 0;
}
.ally-team-editor {
    border: 1px solid #ddd;
    border-radius: 4px;
    padding: 0.5rem;
}
.battle-ended-team {
    border-left: 2px solid #ddd;
    padding-left: 0.5rem;
    margin-top: 0.5rem;
}
.battle-ended-team input,
.battle-ended-team select {
    min-width: 0;
}
.battle-ended-preview {
    background-color: #f5f5f5;
    padding: 0.5rem;
    border-radius: 4px;
    overflow-x: auto;
    font-size: 0.85em;
}
.start-box {
    display: flex;
    gap: 0.5rem;
}
.start-box label {
    flex: 1;
}
section {
    border-top: 1px solid #ddd;
    padding-top: 1rem;
    margin-top: 1rem;
}
.engines-list {
    margin-bottom: 1rem;
}
.engines-list ul {
    list-style: none;
    padding: 0;
}
.engines-list li {
    padding: 0.5rem 0;
    font-family: monospace;
    font-size: 0.95em;
}
.download-form {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}
.download-form label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
}
.download-form label.checkbox-label {
    flex-direction: row;
    align-items: center;
    gap: 0.5rem;
}
.download-form input {
    padding: 0.5rem;
    border: 1px solid #ccc;
    border-radius: 4px;
    font-family: monospace;
}
.download-form input:disabled {
    background-color: #f5f5f5;
    cursor: not-allowed;
}
.download-form button {
    padding: 0.5rem 1rem;
    background-color: #0969da;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-weight: 500;
}
.download-form button:disabled {
    background-color: #6e7681;
    cursor: not-allowed;
}
.download-form button:hover:not(:disabled) {
    background-color: #0860ca;
}
.header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1rem;
}
.header h1 {
    margin: 0;
    flex: 1;
}
.shutdown-button {
    padding: 0.5rem 1rem;
    background-color: #da2e1f;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-weight: 600;
    white-space: nowrap;
}
.shutdown-button:hover {
    background-color: #c41409;
}
.shutdown-button:active {
    background-color: #a30e05;
}
.modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: rgba(0, 0, 0, 0.5);
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 1.5rem;
    z-index: 1000;
}
.modal {
    background-color: white;
    border-radius: 8px;
    padding: 2rem;
    max-width: 400px;
    max-height: 100%;
    overflow-y: auto;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
}
.modal-wide {
    width: 40rem;
    max-width: 100%;
}
.modal h2 {
    margin-top: 0;
    color: #d1242f;
}
.modal p {
    margin: 0.5rem 0;
}
.modal ul {
    margin: 0.5rem 0;
    padding-left: 1.5rem;
}
.modal-buttons {
    display: flex;
    gap: 1rem;
    justify-content: flex-end;
    margin-top: 1.5rem;
    position: sticky;
    bottom: -2rem;
    padding: 1rem 0;
    background-color: white;
}
.cancel-button {
    padding: 0.5rem 1rem;
    background-color: #6e7681;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-weight: 500;
}
.cancel-button:hover {
    background-color: #57606a;
}
.confirm-button {
    padding: 0.5rem 1rem;
    background-color: #da2e1f;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-weight: 600;
}
.confirm-button:hover {
    background-color: #c41409;
}
</style>
