import { signOutOfDiscord } from "../actions";

// The last thing on the top bar, pinned to its right edge (AppBar.js). Its own file
// because it sits outside NavLinks' Suspense boundary now — a player should not have to
// wait on a Discord role check to be able to leave.
export default function SignOutButton() {
  return (
    <form action={signOutOfDiscord}>
      <button type="submit" className="nav-link">
        Sign out
      </button>
    </form>
  );
}
