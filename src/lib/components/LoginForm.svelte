<script lang="ts">
  import type { AuthLoginPayload } from "$lib/types";

  type Props = {
    pending?: boolean;
    error?: string | null;
    codeRequired?: boolean;
    eyebrow?: string;
    title?: string;
    description?: string;
    submitLabel?: string;
    pendingLabel?: string;
    onLogin?: (payload: AuthLoginPayload) => Promise<void> | void;
  };

  let {
    pending = false,
    error = null,
    codeRequired = false,
    eyebrow = "Local Control Room",
    title = "Beget VPS Manager",
    description = "Authenticate once, then review and reconfigure CPU and RAM for every VPS from a single screen.",
    submitLabel = "Enter dashboard",
    pendingLabel = "Signing in...",
    onLogin,
  }: Props = $props();

  let login = $state("");
  let password = $state("");
  let code = $state("");
  let saveMe = $state(true);
  let codeInput = $state<HTMLInputElement | null>(null);

  $effect(() => {
    if (!codeRequired) {
      code = "";
    }
  });

  $effect(() => {
    if (codeRequired && codeInput) {
      codeInput.focus();
    }
  });

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();

    await onLogin?.({
      login,
      password,
      code: codeRequired ? code.trim() || undefined : undefined,
      saveMe,
    });
  }
</script>

<form class="login-card" onsubmit={handleSubmit}>
  <div class="copy">
    <p class="eyebrow">{eyebrow}</p>
    <h1>{title}</h1>
    <p class="lede">{description}</p>
  </div>

  <label class="field">
    <span>Login</span>
    <input
      bind:value={login}
      autocomplete="username"
      name="login"
      placeholder="beget-login"
    >
  </label>

  <label class="field">
    <span>Password</span>
    <input
      bind:value={password}
      autocomplete="current-password"
      name="password"
      placeholder="Password"
      type="password"
    >
  </label>

  {#if codeRequired}
    <label class="field">
      <span>2FA code</span>
      <input
        bind:this={codeInput}
        bind:value={code}
        autocomplete="one-time-code"
        inputmode="numeric"
        name="code"
        placeholder="Enter the confirmation code from Beget"
      >
    </label>
  {/if}

  <label class="check">
    <input bind:checked={saveMe} type="checkbox">
    <span class="check-mark" aria-hidden="true"></span>
    <span class="check-copy">
      <strong>Keep this session on this machine</strong>
      <small>Store the Beget token in this browser for the next visit.</small>
    </span>
  </label>

  {#if error}
    <p class="error">{error}</p>
  {/if}

  <button class="submit" disabled={pending} type="submit">
    {pending ? pendingLabel : submitLabel}
  </button>
</form>

<style>
  .login-card {
    display: grid;
    gap: 1rem;
    padding: 1.6rem;
    border: 1px solid var(--app-panel-border-strong);
    border-radius: 1.5rem;
    background: var(--login-card-bg);
    box-shadow: var(--login-card-shadow);
  }

  .copy {
    display: grid;
    gap: 0.5rem;
    margin-bottom: 0.3rem;
  }

  .eyebrow {
    margin: 0;
    font:
      700 0.75rem / 1 "IBM Plex Mono",
      "SFMono-Regular",
      Consolas,
      monospace;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    color: var(--app-link);
  }

  h1 {
    margin: 0;
    font:
      700 clamp(2rem, 4vw, 3rem) / 0.98 "Space Grotesk",
      "Avenir Next",
      "Segoe UI",
      sans-serif;
    color: var(--app-text-strong);
  }

  .lede {
    margin: 0;
    color: var(--app-text-soft);
    line-height: 1.55;
  }

  .field {
    display: grid;
    gap: 0.45rem;
  }

  .field span,
  .check-copy strong,
  .check-copy small {
    font-size: 0.88rem;
    color: var(--app-text-secondary);
  }

  input {
    width: 100%;
    padding: 0.85rem 0.95rem;
    border: 1px solid var(--app-panel-border);
    border-radius: 0.95rem;
    background: var(--app-field-bg);
    color: var(--app-text-strong);
    font: inherit;
  }

  input:focus {
    outline: 2px solid var(--app-focus-ring);
    outline-offset: 2px;
  }

  .check {
    position: relative;
    display: flex;
    align-items: flex-start;
    gap: 0.85rem;
    padding: 0.9rem 1rem;
    border: 1px solid var(--app-panel-border);
    border-radius: 1rem;
    background: var(--app-panel-bg-soft);
    cursor: pointer;
  }

  .check input {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
  }

  .check-mark {
    position: relative;
    flex: 0 0 1.2rem;
    width: 1.2rem;
    height: 1.2rem;
    padding: 0;
    margin-top: 0.1rem;
    border: 1px solid var(--app-panel-border-strong);
    border-radius: 0.38rem;
    background: var(--app-field-bg);
    transition:
      border-color 160ms ease,
      background 160ms ease,
      box-shadow 160ms ease;
  }

  .check-copy {
    display: grid;
    gap: 0.15rem;
  }

  .check-copy strong {
    font-weight: 600;
  }

  .check-copy small {
    color: var(--app-text-muted);
  }

  .check input:checked + .check-mark {
    border-color: rgba(125, 231, 243, 0.7);
    background: linear-gradient(135deg, #7de7f3 0%, #f8b84b 100%);
    box-shadow: 0 0 0 3px rgba(125, 231, 243, 0.18);
  }

  .check input:checked + .check-mark::after {
    content: "";
    position: absolute;
    inset: 0.2rem 0.35rem 0.28rem;
    border-right: 2px solid #06101c;
    border-bottom: 2px solid #06101c;
    transform: rotate(45deg);
  }

  .error {
    margin: 0;
    padding: 0.85rem 0.95rem;
    border-radius: 1rem;
    background: var(--danger-bg);
    color: var(--danger-text);
  }

  .submit {
    padding: 0.95rem 1.2rem;
    border: 0;
    border-radius: 999px;
    background: linear-gradient(135deg, #ffd37a 0%, #f3a63f 100%);
    color: #181006;
    font:
      700 0.85rem / 1 "IBM Plex Mono",
      "SFMono-Regular",
      Consolas,
      monospace;
    cursor: pointer;
    transition:
      transform 160ms ease,
      box-shadow 160ms ease,
      filter 160ms ease;
    box-shadow: 0 14px 30px rgba(246, 185, 79, 0.28);
  }

  .submit:hover:enabled {
    transform: translateY(-1px);
    filter: brightness(1.03);
  }

  .submit:disabled {
    cursor: progress;
    opacity: 0.75;
  }
</style>
