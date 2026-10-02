import { useEffect, useState } from "react";
import { get } from "./api";
import type { User } from "@shared/types";
import AuthScreen from "./auth/AuthScreen";
import Studio from "./studio/Studio";
import BootScreen from "./studio/BootScreen";

type Session = { user: User | null; registrationOpen: boolean };

export default function App() {
  const [session, setSession] = useState<Session | null | "loading">("loading");

  useEffect(() => {
    get<Session>("/api/auth/me")
      .then(setSession)
      .catch(() => setSession({ user: null, registrationOpen: false }));
  }, []);

  if (session === "loading") return <BootScreen />;
  if (!session?.user) {
    return (
      <AuthScreen
        registrationOpen={session?.registrationOpen ?? false}
        onSignedIn={(user) =>
          setSession({ user, registrationOpen: session?.registrationOpen ?? false })
        }
      />
    );
  }
  return (
    <Studio
      user={session.user}
      onSignedOut={() => setSession({ user: null, registrationOpen: session.registrationOpen })}
    />
  );
}
