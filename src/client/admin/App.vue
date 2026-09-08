<script setup lang="ts">
import { onMounted, ref } from "vue";

const password = ref("");
const status = ref("");
const error = ref("");

onMounted(async () => {
    const response = await fetch("/api/admin/password");
    if (response.ok) password.value = (await response.json()).password;
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
</script>

<template>
    <main class="page">
        <h1>Mockyon Admin</h1>
        <p class="notice">This is a stub page &mdash; no live data yet.</p>
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
            <p>No data yet.</p>
        </section>
        <section>
            <h2>Connected Autohosts</h2>
            <p>No data yet.</p>
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
section {
    border-top: 1px solid #ddd;
    padding-top: 1rem;
    margin-top: 1rem;
}
</style>
