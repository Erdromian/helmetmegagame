"use server";

import { signIn, signOut } from "@/lib/auth";
import { isLocalMode } from "@lifeweb/db/lib/localMode";

export async function signInWithDiscord() {
  await signIn("discord");
}

// A server action is a public endpoint, so this re-checks LOCAL_MODE itself
// rather than trusting that the button which calls it was only rendered
// under it — belt-and-suspenders alongside auth.js only registering the
// "local" provider under the same flag.
export async function signInLocally() {
  if (!isLocalMode()) throw new Error("Local sign-in is only available under LOCAL_MODE.");
  await signIn("local");
}

export async function signOutOfDiscord() {
  await signOut();
}
