<script lang="ts">
  const { versions, platform } = window.api;
  const appVersion = window.api.getAppVersion();
</script>

<main
  class="flex min-h-screen flex-col items-center justify-center gap-6 bg-zinc-950 p-8 text-zinc-100"
>
  <h1 class="text-4xl font-semibold tracking-tight">Runbook</h1>
  <p class="text-zinc-400">
    {#await appVersion then version}v{version}{/await} · {platform}
  </p>
  <ul class="grid grid-cols-3 gap-4 text-sm">
    {#each Object.entries(versions) as [name, version] (name)}
      <li class="rounded-lg border border-zinc-800 px-4 py-3 text-center">
        <span class="block text-zinc-500 capitalize">{name}</span>
        <span class="font-mono">{version}</span>
      </li>
    {/each}
  </ul>
</main>
