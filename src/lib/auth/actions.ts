"use server";

import { signIn, signOut } from "./index";
import { devLoginEnabled } from "@/lib/env";
import { DEV_LOGIN_PROVIDER } from "./config";

export async function signOutAction() {
  await signOut({ redirectTo: "/" });
}

/** DEV ONLY: sign in as a wisc.edu email without OAuth. No-op unless enabled. */
export async function devSignInAction(formData: FormData) {
  if (!devLoginEnabled) return;
  const email = String(formData.get("email") ?? "");
  await signIn(DEV_LOGIN_PROVIDER, { email, redirectTo: "/me" });
}
