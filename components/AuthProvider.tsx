"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { Authenticator } from "@aws-amplify/ui-react";
import { Amplify } from "aws-amplify";
import outputs from "@/amplify_outputs.json";
import "@aws-amplify/ui-react/styles.css";

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

export default function AuthProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  // Read localStorage after mount only, to avoid SSR/client markup mismatch.
  const [isGuest, setIsGuest] = useState(false);

  useEffect(() => {
    setIsGuest(localStorage.getItem(GUEST_MODE_STORAGE_KEY) === "true");
  }, []);

  const continueAsGuest = () => {
    localStorage.setItem(GUEST_MODE_STORAGE_KEY, "true");
    setIsGuest(true);
  };

  const exitGuestMode = () => {
    localStorage.removeItem(GUEST_MODE_STORAGE_KEY);
    setIsGuest(false);
  };

  const guestModeValue: GuestModeContextValue = {
    isGuest,
    continueAsGuest,
    exitGuestMode,
  };

  // Authenticator.Provider supplies the useAuthenticator() context (used by
  // app/page.tsx, components/Sidebar.tsx, hooks/useAuth.ts) without forcing
  // the default sign-in UI, so guests still get a working (empty) auth
  // context instead of those hooks throwing outside a provider.
  return (
    <Authenticator.Provider>
      <GuestModeContext.Provider value={guestModeValue}>
        {isGuest ? (
          // Guests skip the sign-in UI entirely. fetchAuthSession() will pick
          // up credentials from the Identity Pool's unauthenticated role
          // automatically (enabled via allowUnauthenticatedIdentities in
          // amplify/backend.ts) even with no Cognito user signed in.
          children
        ) : (
          <div className="min-h-screen flex flex-col justify-center items-center bg-background">
            <Authenticator
              components={{
                SignIn: {
                  Footer() {
                    return (
                      <div className="flex justify-center pb-4">
                        <button
                          type="button"
                          onClick={continueAsGuest}
                          className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
                        >
                          Continue as Guest
                        </button>
                      </div>
                    );
                  },
                },
              }}
            >
              {children}
            </Authenticator>
          </div>
        )}
      </GuestModeContext.Provider>
    </Authenticator.Provider>
  );
}
