import Link from "next/link";
import { ArrowLeft, SearchX } from "lucide-react";

export default function NotFound() {
  return (
    <main className="route-state">
      <div className="route-state-mark"><SearchX size={23} /></div>
      <span className="eyebrow">404 · PAGE NOT FOUND</span>
      <h1>This page isn’t in the vault.</h1>
      <p>The address may have changed, or the page may not exist yet.</p>
      <Link className="button" href="/"><ArrowLeft size={16} /> Back to IceyVault</Link>
    </main>
  );
}
