"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error("IceyVault application error", error); }, [error]);

  return (
    <main className="route-state">
      <div className="route-state-mark"><AlertTriangle size={22} /></div>
      <h1>Something didn’t load correctly.</h1>
      <p>Your account and order information haven’t been changed by this screen. Try loading the page again.</p>
      <button className="button" onClick={() => reset()}><RefreshCw size={16} /> Try again</button>
    </main>
  );
}
