import { useAppAuth } from "@/components/AuthProvider";
import { fetchAuthSession, fetchUserAttributes } from "aws-amplify/auth";

export function useAuth() {
  const { user, signOut } = useAppAuth();

  // Gets the ID token (for user authentication)
  const getIdToken = async () => {
    try {
      const session = await fetchAuthSession();
      return session.tokens?.idToken?.toString();
    } catch (error) {
      console.error("Failed to get ID token:", error);
      return null;
    }
  };

  // Gets the access token (for AgentCore Runtime authentication)
  const getAccessToken = async () => {
    try {
      const session = await fetchAuthSession();
      return session.tokens?.accessToken?.toString();
    } catch (error) {
      console.error("Failed to get access token:", error);
      return null;
    }
  };

  // Gets both tokens at once
  const getAuthTokens = async () => {
    try {
      const session = await fetchAuthSession();
      return {
        idToken: session.tokens?.idToken?.toString(),
        accessToken: session.tokens?.accessToken?.toString(),
      };
    } catch (error) {
      console.error("Failed to get auth tokens:", error);
      return { idToken: null, accessToken: null };
    }
  };

  // Kept for backwards compatibility
  const getAuthToken = getIdToken;

  // Gets detailed user info
  const getUserInfo = async () => {
    if (!user) return null;

    try {
      // Uses fetchUserAttributes to get the user's attributes
      const attributes = await fetchUserAttributes();

      return {
        userId: user.userId,
        username: user.username,
        email: user.signInDetails?.loginId,
        // User attributes (email, name, etc.)
        attributes: attributes,
      };
    } catch (error) {
      console.error("Failed to get user attributes:", error);
      return {
        userId: user.userId,
        username: user.username,
        email: user.signInDetails?.loginId,
        attributes: {},
      };
    }
  };

  return {
    user,
    signOut,
    getAuthToken, // backwards compatible (ID token)
    getIdToken,
    getAccessToken,
    getAuthTokens,
    getUserInfo,
    isAuthenticated: !!user,
  };
}
