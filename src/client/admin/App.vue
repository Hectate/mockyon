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

</script>

<template>
    <main class="page">
        <h1>Mockyon Admin</h1>
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
</style>
