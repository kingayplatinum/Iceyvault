"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, CheckCircle2, Clock3, RefreshCw, ShieldCheck, Wallet, MapPin, Save, ShoppingBag } from "lucide-react";

type Profile = {
  display_name: string | null;
  phone_e164: string | null;
};
type Transaction = { id: string; direction: string; amount_kobo: number; description: string | null; created_at: string };
type Order = { id: string; status: string; retail_amount_kobo: number; created_at: string; offer_kind: string };
type D = {
  profile?: Profile | null;
  wallet?: { balance_kobo: number; currency: string } | null;
  orders?: Order[];
  messages?: Array<{ id: string; sender: string | null; received_at: string; status: string }>;
  notifications?: Array<{ id: string; title: string; body: string; created_at: string }>;
  transactions?: Transaction[];
  email?: string;
};
type C = { services: Array<{ id: string; display_name: string }>; tiers: Array<{ id: string; service_id: string; tier_label: string; country_iso2: string; country_name?: string | null; retail_price_kobo: number; last_inventory_count: number | null }> };
const pages: Record<string, { title: string; description: string }> = {
  catalog: { title: "Browse services", description: "Choose a verified service and a live, available number." },
  orders: { title: "My orders", description: "Track your number activations and order history." },
  wallet: { title: "Wallet", description: "Manage your NGN balance, fund securely and review every transaction." },
  messages: { title: "SMS inbox", description: "Verification messages for your active number orders." },
  notifications: { title: "Notifications", description: "Important updates about your account and orders." },
  support: { title: "Support centre", description: "Get help with account access, payments and orders." },
  settings: { title: "Account settings", description: "Keep your contact and billing details up to date." },
};
const money = (v: number) => "₦" + (v / 100).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const date = (v: string) => new Date(v).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" });

export default function CustomerSection({ section }: { section: string }) {
  const item = pages[section] || pages.catalog;
  const [d, setD] = useState<D>({});
  const [c, setC] = useState<C>({ services: [], tiers: [] });
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [fundAmount, setFundAmount] = useState("1000");
  const [buying, setBuying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lastOrderId, setLastOrderId] = useState<string | null>(null);
  const [catalogCountry, setCatalogCountry] = useState("US");
  const [catalogService, setCatalogService] = useState("");
  const [catalogProduct, setCatalogProduct] = useState("");

  const catalogCountries = useMemo(() => Array.from(new Map(c.tiers.map(t => [t.country_iso2, { code: t.country_iso2, name: t.country_name || t.country_iso2 }])).values()).sort((a,b) => {
    const rank = (code: string) => code === "US" ? 0 : code === "GB" ? 1 : 2;
    return rank(a.code) - rank(b.code) || a.name.localeCompare(b.name);
  }), [c.tiers]);
  const countryProducts = useMemo(() => c.tiers.filter(t => t.country_iso2 === catalogCountry), [c.tiers, catalogCountry]);
  const countryServices = useMemo(() => c.services.filter(s => countryProducts.some(t => t.service_id === s.id)), [c.services, countryProducts]);
  const serviceProducts = useMemo(() => countryProducts.filter(t => t.service_id === catalogService), [countryProducts, catalogService]);
  const selectedCatalogProduct = c.tiers.find(t => t.id === catalogProduct) || null;

  async function load() {
    try {
      const r = await fetch("/api/account/overview", { cache: "no-store" });
      if (r.ok) {
        const j = await r.json();
        setD(j);
        setName(j.profile?.display_name || "");
        setPhone(j.profile?.phone_e164 || "");
      } else {
        setNotice("We couldn't refresh your account details. Please try again.");
      }
      if (section === "catalog") {
        const q = await fetch("/api/account/catalogue", { cache: "no-store" });
        if (q.ok) setC(await q.json());
      }
    } catch {
      setNotice("Account data is temporarily unavailable. Please retry.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [section]);
  useEffect(() => {
    if (!catalogCountries.some(country => country.code === catalogCountry) && catalogCountries.length) {
      setCatalogCountry(catalogCountries[0].code);
    }
  }, [catalogCountries, catalogCountry]);
  useEffect(() => {
    if (!countryServices.some(service => service.id === catalogService)) {
      setCatalogService(countryServices[0]?.id || "");
    }
  }, [countryServices, catalogService]);
  useEffect(() => {
    if (!serviceProducts.some(product => product.id === catalogProduct)) {
      setCatalogProduct(serviceProducts[0]?.id || "");
    }
  }, [serviceProducts, catalogProduct]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const reference = params.get("reference") || params.get("tx_ref");
    const transactionId = params.get("transaction_id");
    if (section === "wallet" && params.get("payment") === "pending" && reference) {
      const verifyUrl = new URL("/api/account/wallet/verify", window.location.origin);
      verifyUrl.searchParams.set("reference", reference);
      if (transactionId) verifyUrl.searchParams.set("transaction_id", transactionId);
      fetch(verifyUrl.toString(), { cache: "no-store" })
        .then(async (r) => {
          const j = await r.json();
          setNotice(j.status === "successful"
            ? (j.credited ? "Payment confirmed. Your wallet has been credited." : "Payment was already credited.")
            : j.status === "failed"
              ? "Flutterwave marked this payment as failed. No wallet funds were added."
              : "Payment is awaiting Flutterwave confirmation. Your wallet has not been credited yet.");
          if (j.status === "successful" || j.status === "failed") {
            const amount = localStorage.getItem("iceyvault:fund-ref:" + reference);
            if (amount) localStorage.removeItem("iceyvault:fund:" + amount);
            localStorage.removeItem("iceyvault:fund-ref:" + reference);
          }
          await load();
        })
        .catch(() => setNotice("We couldn't verify the payment yet. Your balance has not been changed; refresh shortly."));
    }
  }, [section]);

  async function saveProfile(e?: React.FormEvent) {
    e?.preventDefault();
    setSaving(true);
    try {
      const r = await fetch("/api/account/overview", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          display_name: name,
          phone_e164: phone || null,
        }),
      });
      const j = await r.json();
      setNotice(r.ok ? "Your account details have been saved." : j.error || "Could not save your details.");
      if (r.ok) await load();
    } catch {
      setNotice("Could not reach the account service. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const r = await fetch("/api/account/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const j = await r.json();
      setNotice(r.ok ? "Password updated successfully." : j.error || "Could not update password.");
      if (r.ok) setPassword("");
    } catch {
      setNotice("Could not reach the password service. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function fundWallet() {
    const amountKobo = Math.round(Number(fundAmount) * 100);
    if (!Number.isFinite(amountKobo) || amountKobo < 5000 || amountKobo > 50000000 || amountKobo % 100 !== 0) {
      setNotice("Enter a whole-naira amount between ₦50 and ₦500,000.");
      return;
    }
    setBuying(true);
    setNotice("Preparing your secure Flutterwave checkout…");
    const storageKey = "iceyvault:fund:" + amountKobo;
    try {
      const idempotencyKey = localStorage.getItem(storageKey) || crypto.randomUUID();
      localStorage.setItem(storageKey, idempotencyKey);
      const r = await fetch("/api/account/wallet/fund", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountKobo, idempotencyKey }),
      });
      const j = await r.json();
      if (j.reference) localStorage.setItem("iceyvault:fund-ref:" + j.reference, String(amountKobo));
      if (!r.ok && r.status !== 202) {
        if (r.status === 409 || r.status === 400 || r.status === 502) localStorage.removeItem(storageKey);
        setNotice(j.error || "Could not start checkout.");
        return;
      }
      if (j.checkoutUrl) {
        window.location.assign(j.checkoutUrl);
        return;
      }
      setNotice(j.error || "Your payment request is being reconciled. Do not create another payment yet.");
    } catch {
      setNotice("We couldn't confirm the checkout response. Retry with the same amount so the same request key is reused.");
    } finally {
      setBuying(false);
    }
  }

  async function buyNumber(tierId: string) {
    setBuying(true);
    setNotice("Reserving your number with SMSCode…");
    const storageKey = "iceyvault:order:" + tierId;
    try {
      const idempotencyKey = localStorage.getItem(storageKey) || crypto.randomUUID();
      localStorage.setItem(storageKey, idempotencyKey);
      const r = await fetch("/api/account/orders", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tierId, idempotencyKey }),
      });
      const j = await r.json();
      if (j.orderId) setLastOrderId(j.orderId);
      if (r.status === 201 || r.status === 200) {
        localStorage.removeItem(storageKey);
        setNotice("Number purchased successfully.");
        await load();
      } else {
        if (r.status !== 202 && r.status !== 402) localStorage.removeItem(storageKey);
        setNotice(j.message || j.error || "Could not complete this purchase.");
      }
    } catch {
      setNotice("The request may still be processing. Check My orders before trying again.");
    } finally {
      setBuying(false);
    }
  }

  async function refresh() {
    setLoading(true);
    await load();
  }

  const field = (label: string, value: string, onChange: (v: string) => void, placeholder: string, required = true) => (
    <label className="workspace-field">
      <span>{label}</span>
      <input className="workspace-input" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} required={required} />
    </label>
  );

  return (
    <>
      <section className="workspace-page-heading">
        <div>
          <span className="workspace-eyebrow">YOUR ACCOUNT</span>
          <h1>{item.title}</h1>
          <p>{item.description}</p>
        </div>
        <button className="workspace-quiet-button" onClick={() => void refresh()} disabled={loading} aria-label="Refresh page data">
          <RefreshCw size={16} className={loading ? "workspace-spin" : ""} /> Refresh
        </button>
      </section>

      {section === "wallet" ? (
        <>
          <section className="wallet-overview">
            <div className="wallet-overview-copy">
              <span className="workspace-eyebrow">AVAILABLE BALANCE</span>
              <div className="wallet-amount">{loading ? "—" : d.wallet ? money(d.wallet.balance_kobo) : "₦0.00"}</div>
              <p>NGN wallet · Your balance updates after confirmed payments and purchases.</p>
            </div>
            <div className="wallet-icon"><Wallet size={25} /></div>
          </section>

          <section className="workspace-panel">
            <div className="workspace-section-title">
              <div><h2>Add funds</h2><p>Secure checkout powered by Flutterwave.</p></div>
              <span className="workspace-secure"><ShieldCheck size={15}/> Secure</span>
            </div>
            <div className="workspace-amount-choices">
              {["1000", "2500", "5000", "10000"].map((v) => (
                <button type="button" key={v} className={fundAmount === v ? "workspace-chip selected" : "workspace-chip"} onClick={() => setFundAmount(v)}>₦{Number(v).toLocaleString("en-NG")}</button>
              ))}
            </div>
            <div className="workspace-fund-row">
              <label className="workspace-field workspace-fund-input">
                <span>Amount to add (NGN)</span>
                <div className="workspace-currency-input"><span>₦</span><input className="workspace-input" type="number" min="50" max="500000" step="1" value={fundAmount} onChange={(e) => setFundAmount(e.target.value)} /></div>
              </label>
              <button className="workspace-primary workspace-fund-button" onClick={() => void fundWallet()} disabled={buying || saving}>
                {buying ? "Preparing checkout…" : "Continue to payment"} <ArrowUpRight size={17}/>
              </button>
            </div>
            <p className="workspace-helper">Minimum ₦50 · Maximum ₦500,000. Your wallet is credited only after Flutterwave confirms the exact amount and reference.</p>
          </section>

          <section className="workspace-panel">
            <div className="workspace-section-title"><div><h2>Wallet transactions</h2><p>Your confirmed wallet activity.</p></div><span className="workspace-count">{d.transactions?.length || 0}</span></div>
            {loading ? <Empty text="Loading transactions…"/> : d.transactions?.length ? (
              <div className="workspace-list">{d.transactions.map((t) => (
                <div className="workspace-list-row" key={t.id}>
                  <span className="workspace-list-icon"><Wallet size={17}/></span>
                  <div className="workspace-list-main"><b>{t.description || t.direction}</b><small>{date(t.created_at)}</small></div>
                  <strong className={t.direction === "credit" ? "amount-positive" : "amount-negative"}>{t.direction === "credit" ? "+" : "−"}{money(t.amount_kobo)}</strong>
                </div>
              ))}</div>
            ) : <Empty text="No wallet transactions yet. Your first confirmed top-up will appear here."/>}
          </section>
        </>
      ) : null}

      {section === "settings" ? (
        <>
          <section className="workspace-panel">
            <div className="workspace-section-title"><div><h2>Personal information</h2><p>Keep your account contact details current.</p></div></div>
            <form onSubmit={(e) => void saveProfile(e)} className="workspace-form-grid">
              {field("Display name", name, setName, "Your name")}
              <label className="workspace-field"><span>Email address</span><input className="workspace-input" value={d.email || ""} disabled/></label>
              {field("Phone number", phone, setPhone, "+234…", false)}
              <div className="workspace-form-footer full-width"><button className="workspace-primary" disabled={saving}>{saving ? "Saving…" : "Save changes"}</button></div>
            </form>
          </section>
          <section className="workspace-panel">
            <div className="workspace-section-title"><div><h2>Password & security</h2><p>Choose a strong password you don&apos;t use elsewhere.</p></div><ShieldCheck className="workspace-purple-icon"/></div>
            <form onSubmit={(e) => void changePassword(e)} className="workspace-password-form"><label className="workspace-field"><span>New password</span><input className="workspace-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={10} required placeholder="At least 10 characters"/></label><button className="workspace-secondary" disabled={saving}>{saving ? "Updating…" : "Update password"}</button></form>
          </section>
        </>
      ) : null}

      {section === "catalog" ? (
        <section className="workspace-panel">
          <div className="workspace-section-title"><div><h2>Choose your number</h2><p>Select a country, service and available supplier product. Only verified products with stock and approved retail pricing are shown.</p></div><span className="workspace-count">{c.tiers.length}</span></div>
          {loading ? <Empty text="Checking verified catalogue…"/> : c.tiers.length ? (
            <div className="workspace-catalogue-picker">
              <label className="workspace-field"><span>Country</span><select className="workspace-input" value={catalogCountry} onChange={e=>{setCatalogCountry(e.target.value);setCatalogService("");setCatalogProduct("");}}>{catalogCountries.map(country=><option key={country.code} value={country.code}>{country.name} ({country.code})</option>)}</select></label>
              <label className="workspace-field"><span>Service</span><select className="workspace-input" value={catalogService} onChange={e=>{setCatalogService(e.target.value);setCatalogProduct("");}}><option value="">Choose a service</option>{countryServices.map(service=><option key={service.id} value={service.id}>{service.display_name}</option>)}</select></label>
              <label className="workspace-field"><span>Number type / product</span><select className="workspace-input" value={catalogProduct} onChange={e=>setCatalogProduct(e.target.value)}><option value="">Choose a product</option>{serviceProducts.map(product=><option key={product.id} value={product.id}>{product.tier_label} · {money(product.retail_price_kobo)} · {product.last_inventory_count??0} in stock</option>)}</select></label>
              {selectedCatalogProduct ? (
                <article className="workspace-product-card workspace-selected-product">
                  <div className="workspace-product-top"><span className="workspace-product-icon"><ShoppingBag size={19}/></span><span className="workspace-stock">{selectedCatalogProduct.last_inventory_count??0} in stock</span></div>
                  <span className="workspace-product-country">{selectedCatalogProduct.country_name||selectedCatalogProduct.country_iso2}</span>
                  <h3>{c.services.find(service=>service.id===selectedCatalogProduct.service_id)?.display_name||"Service"}</h3>
                  <p>{selectedCatalogProduct.tier_label}</p>
                  <div className="workspace-product-bottom"><strong>{money(selectedCatalogProduct.retail_price_kobo)}</strong><button className="workspace-primary" disabled={buying||(selectedCatalogProduct.last_inventory_count??0)<1} onClick={()=>void buyNumber(selectedCatalogProduct.id)}>{buying?"Processing…":"Buy number"}</button></div>
                </article>
              ) : <Empty text="No verified products are available for this country and service yet. Choose another option or check back after the supplier catalogue is refreshed."/>}
            </div>
          ) : <Empty text="No verified products are published yet. The supplier catalogue must be synced, priced and activated by an administrator first."/>}
          {lastOrderId ? <p className="workspace-inline-link"><Link href={"/dashboard/orders/" + lastOrderId}>View your new order <ArrowUpRight size={15}/></Link></p> : null}
        </section>
      ) : null}

      {section === "orders" ? (
        <section className="workspace-panel"><div className="workspace-section-title"><div><h2>Order history</h2><p>All your number activations in one place.</p></div><span className="workspace-count">{d.orders?.length || 0}</span></div>
          {loading ? <Empty text="Loading your orders…"/> : d.orders?.length ? <div className="workspace-list">{d.orders.map((o) => <div className="workspace-list-row" key={o.id}><span className="workspace-list-icon"><ShoppingBag size={17}/></span><div className="workspace-list-main"><b>{o.offer_kind.replaceAll("_", " ")} · {o.status.replaceAll("_", " ")}</b><small>{date(o.created_at)}</small><Link href={"/dashboard/orders/" + o.id}>View order details</Link></div><strong>{money(o.retail_amount_kobo)}</strong></div>)}</div> : <Empty text="Your number orders will appear here after your first purchase."/>}
        </section>
      ) : null}

      {section === "messages" ? <section className="workspace-panel"><div className="workspace-section-title"><div><h2>SMS inbox</h2><p>Verification messages linked to your orders.</p></div></div>{loading ? <Empty text="Loading messages…"/> : d.messages?.length ? <div className="workspace-list">{d.messages.map((m) => <div className="workspace-list-row" key={m.id}><span className="workspace-list-icon"><CheckCircle2 size={17}/></span><div className="workspace-list-main"><b>{m.sender || "Message received"}</b><small>{date(m.received_at)}</small></div><span className="workspace-status">{m.status}</span></div>)}</div> : <Empty text="No verification messages yet."/>}</section> : null}

      {section === "notifications" ? <section className="workspace-panel"><div className="workspace-section-title"><div><h2>Notifications</h2><p>Updates about your account and services.</p></div></div>{loading ? <Empty text="Loading notifications…"/> : d.notifications?.length ? <div className="workspace-list">{d.notifications.map((n) => <div className="workspace-list-row" key={n.id}><span className="workspace-list-icon"><Clock3 size={17}/></span><div className="workspace-list-main"><b>{n.title}</b><small>{n.body}</small><small>{date(n.created_at)}</small></div></div>)}</div> : <Empty text="You&apos;re all caught up."/>}</section> : null}

      {section === "support" ? <section className="workspace-panel"><div className="workspace-section-title"><div><h2>Support centre</h2><p>Find help with your payment history, number activations and verification messages.</p></div></div><div className="workspace-form-footer"><Link className="workspace-secondary" href="/dashboard/orders">Review my orders <ArrowUpRight size={15}/></Link><Link className="workspace-secondary" href="/dashboard/messages">Open SMS inbox <ArrowUpRight size={15}/></Link></div></section> : null}

      {notice ? <div className="workspace-notice" role="status"><ShieldCheck size={18}/><span>{notice}</span></div> : null}
    </>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="workspace-empty"><ShieldCheck size={25}/><p>{text}</p></div>;
}
