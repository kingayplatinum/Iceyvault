"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

type Detail = {
  order: { id: string; status: string; retail_amount_kobo: number; currency: string; created_at: string; expires_at: string | null; phoneNumber: string | null; supplierStatus: string | null };
  messages: Array<{ id: string; sender: string | null; content: string; received_at: string }>;
};
const money = (kobo: number) => "₦" + (kobo / 100).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const date = (value: string) => new Date(value).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" });

export default function OrderDetail({ id }: { id: string }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  async function load() {
    const response = await fetch("/api/account/orders/" + encodeURIComponent(id), { cache: "no-store" });
    const json = await response.json();
    if (!response.ok) { setNotice(json.error || "Could not load order."); return; }
    setDetail(json);
  }
  useEffect(() => { void load(); }, [id]);
  async function action(actionName: "cancel" | "finish" | "resend") {
    setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/account/orders/" + encodeURIComponent(id), {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: actionName }),
      });
      const json = await response.json();
      setNotice(response.ok ? (json.message || (actionName === "resend" ? (json.resent ? "SMS resend requested." : "Supplier did not resend the SMS.") : "Order updated.")) : (json.error || "Action failed."));
      await load();
    } catch { setNotice("Could not reach the supplier. Try again shortly."); }
    finally { setBusy(false); }
  }
  const order = detail?.order;
  return <main style={{ maxWidth: 760, margin: "28px auto", padding: "0 18px 40px", color: "#171923" }}>
    <Link href="/dashboard/orders" style={{ color: "#6d5bd0", fontSize: 13 }}>← Back to orders</Link>
    <h1 style={{ margin: "16px 0 6px" }}>Number order</h1>
    <p style={{ color: "#737789", fontSize: 13 }}>Your number, expiry and verification messages.</p>
    {!order ? <p style={{ padding: 20 }}>{notice || "Loading order…"}</p> : <>
      <section style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><b>Order status</b><b>{order.status.replaceAll("_", " ")}</b></div>
        <p style={{ fontSize: 12, color: "#777" }}>Reference {order.id.slice(0, 8)} · {date(order.created_at)}</p>
        <h2 style={{ fontSize: 30, margin: "14px 0 5px" }}>{order.phoneNumber || "Number unavailable"}</h2>
        <p style={{ fontSize: 13, color: "#737789" }}>Purchase amount: {money(order.retail_amount_kobo)}</p>
        {order.expires_at ? <p style={{ fontSize: 13 }}>Expires: {date(order.expires_at)}</p> : null}
      </section>
      <section style={card}>
        <h2>Verification messages</h2>
        {detail?.messages.length ? detail.messages.map(message => <article key={message.id} style={{ padding: "13px 0", borderTop: "1px solid #eceef3" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}><b>{message.sender || "SMS"}</b><small>{date(message.received_at)}</small></div>
          <pre style={{ whiteSpace: "pre-wrap", font: "inherit", background: "#f7f7fb", padding: 12, borderRadius: 9 }}>{message.content}</pre>
        </article>) : <p style={{ color: "#737789", fontSize: 13 }}>No verification SMS has arrived yet. This page updates when the supplier sends a message.</p>}
      </section>
      {["active", "waiting_message"].includes(order.status) ? <section style={{ ...card, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button disabled={busy || order.status !== "waiting_message"} onClick={() => void action("finish")} style={primary}>Finish order</button>
        <button disabled={busy} onClick={() => void action("resend")} style={secondary}>Resend SMS</button>
        <button disabled={busy} onClick={() => void action("cancel")} style={secondary}>Cancel number</button>
      </section> : null}
    </>}
    {notice ? <p role="status" style={card}>{notice}</p> : null}
  </main>;
}
const card: React.CSSProperties = { background: "white", border: "1px solid #e5e7ef", borderRadius: 15, padding: 18, marginTop: 15 };
const primary: React.CSSProperties = { border: 0, borderRadius: 9, background: "#6d5bd0", color: "white", padding: "11px 15px" };
const secondary: React.CSSProperties = { border: "1px solid #ddd", borderRadius: 9, background: "white", padding: "11px 15px" };
