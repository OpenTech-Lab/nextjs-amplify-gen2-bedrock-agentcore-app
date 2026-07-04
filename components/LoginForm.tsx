"use client";

import { useState } from "react";
import {
  signIn,
  signUp,
  confirmSignUp,
  resendSignUpCode,
  resetPassword,
  confirmResetPassword,
} from "aws-amplify/auth";
import { Sparkles, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { useGuestMode } from "@/components/AuthProvider";

type View = "signin" | "signup" | "confirm" | "forgot" | "forgotConfirm";

const COPY: Record<View, { title: string; subtitle: string }> = {
  signin: {
    title: "Sign in",
    subtitle: "Welcome back to Knowledge Share",
  },
  signup: {
    title: "Create an account",
    subtitle: "Get started with Knowledge Share",
  },
  confirm: {
    title: "Confirm your email",
    subtitle: "Enter the verification code we sent you",
  },
  forgot: {
    title: "Reset your password",
    subtitle: "We'll send a verification code to your email",
  },
  forgotConfirm: {
    title: "Set a new password",
    subtitle: "Enter the code and your new password",
  },
};

export default function LoginForm() {
  const { continueAsGuest } = useGuestMode();

  const [view, setView] = useState<View>("signin");
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const switchView = (next: View) => {
    setView(next);
    setMessage(null);
    setPassword("");
    setCode("");
    setNewPassword("");
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setMessage(null);
    try {
      const { nextStep } = await signIn({ username: email, password });
      if (nextStep.signInStep === "CONFIRM_SIGN_UP") {
        await resendSignUpCode({ username: email });
        setView("confirm");
        setMessage({ type: "success", text: "Your account isn't verified yet. We sent a new code." });
      }
      // On success (DONE), AuthProvider's Hub listener picks up the
      // "signedIn" event and re-renders the app - nothing else to do here.
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to sign in." });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setMessage(null);
    try {
      const { nextStep } = await signUp({
        username: email,
        password,
        options: { userAttributes: { email } },
      });
      if (nextStep.signUpStep === "CONFIRM_SIGN_UP") {
        setView("confirm");
      } else {
        switchView("signin");
        setMessage({ type: "success", text: "Account created. You can now sign in." });
      }
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to sign up." });
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setMessage(null);
    try {
      await confirmSignUp({ username: email, confirmationCode: code });
      switchView("signin");
      setMessage({ type: "success", text: "Email verified. You can now sign in." });
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Invalid code." });
    } finally {
      setIsLoading(false);
    }
  };

  const handleResend = async () => {
    setMessage(null);
    try {
      await resendSignUpCode({ username: email });
      setMessage({ type: "success", text: "A new code has been sent." });
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to resend code." });
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setMessage(null);
    try {
      await resetPassword({ username: email });
      setView("forgotConfirm");
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to send reset code." });
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirmForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setMessage(null);
    try {
      await confirmResetPassword({ username: email, confirmationCode: code, newPassword });
      switchView("signin");
      setMessage({ type: "success", text: "Password updated. You can now sign in." });
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to reset password." });
    } finally {
      setIsLoading(false);
    }
  };

  const { title, subtitle } = COPY[view];

  return (
    <div className="min-h-dvh flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md rounded-2xl shadow-md p-8 space-y-6">
        <div className="text-center space-y-1">
          <div className="mx-auto mb-2 inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 shadow-lg">
            <Sparkles className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-2xl font-semibold">{title}</h1>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>

        {message && (
          <p
            className={`text-center text-sm ${
              message.type === "error" ? "text-destructive" : "text-green-600"
            }`}
          >
            {message.text}
          </p>
        )}

        {view === "signin" && (
          <form className="space-y-4" onSubmit={handleSignIn}>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                <button
                  type="button"
                  onClick={() => switchView("forgot")}
                  className="text-xs text-primary hover:text-primary/80"
                >
                  Forgot password?
                </button>
              </div>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <Button type="submit" disabled={isLoading} className="w-full">
              {isLoading ? <Spinner className="w-4 h-4" /> : "Sign in"}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              Don&apos;t have an account?{" "}
              <button
                type="button"
                onClick={() => switchView("signup")}
                className="text-primary hover:text-primary/80 font-medium"
              >
                Sign up
              </button>
            </p>
          </form>
        )}

        {view === "signup" && (
          <form className="space-y-4" onSubmit={handleSignUp}>
            <div className="space-y-1.5">
              <Label htmlFor="signup-email">Email</Label>
              <Input
                id="signup-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="signup-password">Password</Label>
              <Input
                id="signup-password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">At least 8 characters.</p>
            </div>
            <Button type="submit" disabled={isLoading} className="w-full">
              {isLoading ? <Spinner className="w-4 h-4" /> : "Create account"}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              Already have an account?{" "}
              <button
                type="button"
                onClick={() => switchView("signin")}
                className="text-primary hover:text-primary/80 font-medium"
              >
                Sign in
              </button>
            </p>
          </form>
        )}

        {view === "confirm" && (
          <form className="space-y-4" onSubmit={handleConfirm}>
            <div className="space-y-1.5">
              <Label htmlFor="code">Verification code</Label>
              <Input
                id="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={isLoading} className="w-full">
              {isLoading ? <Spinner className="w-4 h-4" /> : "Verify"}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              Didn&apos;t get a code?{" "}
              <button
                type="button"
                onClick={handleResend}
                className="text-primary hover:text-primary/80 font-medium"
              >
                Resend
              </button>
            </p>
          </form>
        )}

        {view === "forgot" && (
          <form className="space-y-4" onSubmit={handleForgotPassword}>
            <div className="space-y-1.5">
              <Label htmlFor="forgot-email">Email</Label>
              <Input
                id="forgot-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={isLoading} className="w-full">
              {isLoading ? <Spinner className="w-4 h-4" /> : "Send reset code"}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              <button
                type="button"
                onClick={() => switchView("signin")}
                className="text-primary hover:text-primary/80 font-medium"
              >
                Back to sign in
              </button>
            </p>
          </form>
        )}

        {view === "forgotConfirm" && (
          <form className="space-y-4" onSubmit={handleConfirmForgotPassword}>
            <div className="space-y-1.5">
              <Label htmlFor="reset-code">Verification code</Label>
              <Input
                id="reset-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-password">New password</Label>
              <Input
                id="new-password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                required
                minLength={8}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={isLoading} className="w-full">
              {isLoading ? <Spinner className="w-4 h-4" /> : "Reset password"}
            </Button>
          </form>
        )}

        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-border" />
          <span className="text-xs text-muted-foreground">or</span>
          <div className="flex-1 h-px bg-border" />
        </div>

        <button
          type="button"
          onClick={continueAsGuest}
          className="w-full text-center text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
        >
          Continue as Guest
        </button>
      </Card>
    </div>
  );
}
