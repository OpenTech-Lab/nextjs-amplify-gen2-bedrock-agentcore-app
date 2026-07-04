"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { Amplify } from "aws-amplify";
import { Hub } from "aws-amplify/utils";
import { getCurrentUser, signOut as amplifySignOut, type AuthUser } from "aws-amplify/auth";
import outputs from "@/amplify_outputs.json";
import LoginForm from "@/components/LoginForm";

Amplify.configure(outputs);

const GUEST_MODE_STORAGE_KEY = "guestMode";

interface GuestModeContextValue {
  isGuest: boolean;
  continueAsGuest: () => void;
  exitGuestMode: () => void;
}

const GuestModeContext = createContext<GuestModeContextValue>({
  isGuest: false,
  continueAsGuest: () => {},
  exitGuestMode: () => {},
});

/** Whether the current visitor is browsing as a guest (no Cognito sign-in). */
export function useGuestMode() {
  return useContext(GuestModeContext);
}

interface AppAuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  signOut: () => Promise<void>;
}

const AppAuthContext = createContext<AppAuthContextValue>({
  user: null,
  isLoading: true,
  signOut: async () => {},
});

/**
 * Replacement for @aws-amplify/ui-react's useAuthenticator(): same
 * { user, signOut } shape (user has .userId/.username/.signInDetails), but
 * backed by our own custom sign-in UI (components/LoginForm.tsx) instead of
 * the prebuilt <Authenticator> component.
 */
export function useAppAuth() {
  return useContext(AppAuthContext);
}

export default function AuthProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  // Read localStorage after mount only, to avoid SSR/client markup mismatch.
  const [isGuest, setIsGuest] = useState(false);

  useEffect(() => {
    setIsGuest(localStorage.getItem(GUEST_MODE_STORAGE_KEY) === "true");

    const refreshUser = () => {
      getCurrentUser()
        .then(setUser)
        .catch(() => setUser(null))
        .finally(() => setIsLoading(false));
    };

    refreshUser();

    const unsubscribe = Hub.listen("auth", ({ payload }) => {
      if (payload.event === "signedIn" || payload.event === "signedOut") {
        refreshUser();
      }
    });

    return unsubscribe;
  }, []);

  const continueAsGuest = () => {
    localStorage.setItem(GUEST_MODE_STORAGE_KEY, "true");
    setIsGuest(true);
  };

  const exitGuestMode = () => {
    localStorage.removeItem(GUEST_MODE_STORAGE_KEY);
    setIsGuest(false);
  };

  const signOut = async () => {
    await amplifySignOut();
    setUser(null);
  };

  const guestModeValue: GuestModeContextValue = {
    isGuest,
    continueAsGuest,
    exitGuestMode,
  };

  const authValue: AppAuthContextValue = { user, isLoading, signOut };

  let content: React.ReactNode;
  if (isLoading) {
    // Avoid flashing the signed-out login form (or the authenticated app)
    // before we know whether a session already exists.
    content = (
      <div className="min-h-dvh flex items-center justify-center bg-background" />
    );
  } else if (user || isGuest) {
    content = children;
  } else {
    content = <LoginForm />;
  }

  return (
    <AppAuthContext.Provider value={authValue}>
      <GuestModeContext.Provider value={guestModeValue}>
        {content}
      </GuestModeContext.Provider>
    </AppAuthContext.Provider>
  );
}
