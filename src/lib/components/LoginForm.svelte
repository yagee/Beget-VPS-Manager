<script lang="ts">
import type { AuthLoginPayload } from "$lib/types";

type Props = {
  pending?: boolean;
  error?: string | null;
  codeRequired?: boolean;
  onLogin?: (payload: AuthLoginPayload) => Promise<void> | void;
};

let {
  pending = false,
  error = null,
  codeRequired = false,
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
		<p class="eyebrow">Local Control Room</p>
		<h1>Beget VPS Manager</h1>
		<p class="lede">
			Authenticate once, then review and reconfigure CPU and RAM for every VPS from a single
			screen.
		</p>
	</div>

	<label class="field">
		<span>Login</span>
		<input bind:value={login} autocomplete="username" name="login" placeholder="beget-login" />
	</label>

	<label class="field">
		<span>Password</span>
		<input
			bind:value={password}
			autocomplete="current-password"
			name="password"
			placeholder="Password"
			type="password"
		/>
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
			/>
		</label>
	{/if}

	<label class="check">
		<input bind:checked={saveMe} type="checkbox" />
		<span>Keep this session on this machine</span>
	</label>

	{#if error}
		<p class="error">{error}</p>
	{/if}

	<button class="submit" disabled={pending} type="submit">
		{pending ? 'Signing in...' : 'Enter dashboard'}
	</button>
</form>

<style>
	.login-card {
		display: grid;
		gap: 1rem;
		padding: 1.6rem;
		border: 1px solid rgba(255, 255, 255, 0.14);
		border-radius: 1.5rem;
		background:
			linear-gradient(180deg, rgba(8, 18, 31, 0.96), rgba(5, 11, 22, 0.92)),
			radial-gradient(circle at top right, rgba(27, 190, 214, 0.18), transparent 40%);
		box-shadow:
			0 20px 70px rgba(1, 6, 14, 0.45),
			inset 0 1px 0 rgba(255, 255, 255, 0.05);
	}

	.copy {
		display: grid;
		gap: 0.5rem;
		margin-bottom: 0.3rem;
	}

	.eyebrow {
		margin: 0;
		font: 700 0.75rem/1 'IBM Plex Mono', 'SFMono-Regular', Consolas, monospace;
		text-transform: uppercase;
		letter-spacing: 0.18em;
		color: #7de7f3;
	}

	h1 {
		margin: 0;
		font: 700 clamp(2rem, 4vw, 3rem) / 0.98 'Space Grotesk', 'Avenir Next', 'Segoe UI', sans-serif;
		color: #f3f8fc;
	}

	.lede {
		margin: 0;
		color: rgba(222, 232, 240, 0.78);
		line-height: 1.55;
	}

	.field {
		display: grid;
		gap: 0.45rem;
	}

	.field span,
	.check span {
		font-size: 0.88rem;
		color: rgba(214, 227, 237, 0.86);
	}

	input {
		width: 100%;
		padding: 0.85rem 0.95rem;
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 0.95rem;
		background: rgba(8, 17, 26, 0.84);
		color: #f4f8fb;
		font: inherit;
	}

	input:focus {
		outline: 2px solid rgba(125, 231, 243, 0.55);
		outline-offset: 2px;
	}

	.check {
		display: flex;
		align-items: center;
		gap: 0.7rem;
	}

	.check input {
		width: 1rem;
		height: 1rem;
		padding: 0;
	}

	.error {
		margin: 0;
		padding: 0.8rem 0.9rem;
		border-radius: 0.95rem;
		background: rgba(255, 109, 91, 0.12);
		color: #ffc1b8;
	}

	.submit {
		padding: 0.95rem 1.15rem;
		border: 0;
		border-radius: 999px;
		background: linear-gradient(120deg, #f8b84b, #ffd770);
		color: #111722;
		font: 700 0.98rem/1 'Space Grotesk', 'Avenir Next', 'Segoe UI', sans-serif;
		cursor: pointer;
	}

	.submit:disabled {
		cursor: progress;
		opacity: 0.7;
	}
</style>
