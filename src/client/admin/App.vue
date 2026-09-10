<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";

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

const password = ref("");
const status = ref("");
const error = ref("");
const clientError = ref("");
const connectedClients = ref<{ username: string; userId: string }[]>([]);
const autohost = ref<AutohostStatus>({ status: "stopped", connected: false });
const autohostError = ref("");
const autohostActionPending = ref(false);
const engines = ref<Engine[]>([]);
const engineVersion = ref("");
const engineDownloadStatus = ref("");
const engineDownloadError = ref("");
const engineDownloadPending = ref(false);
const shutdownConfirmationOpen = ref(false);
let statusTimer: ReturnType<typeof setInterval> | undefined;

async function loadStatus() {
    const response = await fetch("/api/admin/status");
    if (!response.ok) throw new Error("Unable to load server status");
    const data = (await response.json()) as { clients?: { username: string; userId: string }[]; autohost?: AutohostStatus };
    connectedClients.value = data.clients ?? [];
    if (data.autohost) autohost.value = data.autohost;
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

onMounted(async () => {
    const response = await fetch("/api/admin/password");
    if (response.ok) password.value = (await response.json()).password;
    try {
        await loadStatus();
        await loadInstalledEngines();
        statusTimer = setInterval(() => {
            void loadStatus().catch(() => (clientError.value = "Unable to load server status."));
            void loadInstalledEngines();
        }, 5000);
    } catch {
        clientError.value = "Unable to load server status.";
    }
});

onUnmounted(() => clearInterval(statusTimer));

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
                <li v-for="client in connectedClients" :key="client.userId">{{ client.username }} (ID: {{ client.userId }})</li>
            </ul>
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
    z-index: 1000;
}
.modal {
    background-color: white;
    border-radius: 8px;
    padding: 2rem;
    max-width: 400px;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
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
