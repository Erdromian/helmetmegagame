import { signInWithDiscord, signInLocally } from "../actions";
import { isLocalMode } from "@lifeweb/db/lib/localMode";

export default function HomeScreen({ turnLabel }) {
  return (
    <main className="relative z-10 flex h-full flex-col items-center justify-center gap-8 px-6 text-center">
      <div className="flex flex-col items-center">
        <h1 className="wordmark text-5xl tracking-widest sm:text-6xl">Bascinet</h1>
        <div className="wordmark-rule my-3" />
        <p className="text-sm tracking-[0.2em] uppercase text-muted">
          {turnLabel}
        </p>
      </div>

      <form action={signInWithDiscord}>
        <button type="submit" className="btn">
          Sign in with Discord
        </button>
      </form>

      {isLocalMode() && (
        <form action={signInLocally}>
          <button type="submit" className="btn-quiet">
            Sign in locally (LOCAL_MODE, no Discord)
          </button>
        </form>
      )}
    </main>
  );
}
