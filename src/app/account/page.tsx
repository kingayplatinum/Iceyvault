"use client";
import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, ArrowRight, Eye, EyeOff, LockKeyhole, Mail, ShieldCheck, UserRound } from "lucide-react";
import "./account.css";

export default function AccountPage(){
  const [mode,setMode]=useState<"login"|"signup">("signup");
  const [showPassword,setShowPassword]=useState(false);
  return <main className="account-shell">
    <header className="account-header"><Link href="/" className="account-brand"><span>i</span>icey<b>vault</b></Link><Link href="/" className="account-back"><ArrowLeft size={14}/> Back to home</Link></header>
    <div className="account-layout">
      <section className="account-story"><div className="account-kicker"><ShieldCheck size={14}/> YOUR ACCOUNT, YOUR CONTROL</div><h1>A secure home for<br/><span>your number services.</span></h1><p>Manage eligible services, wallet activity and number orders from one organised account.</p><div className="account-benefits"><div><span><LockKeyhole size={17}/></span><section><b>Private account controls</b><small>Account security and access tools in one place.</small></section></div><div><span><WalletIcon/></span><section><b>One wallet view</b><small>Keep track of eligible funding and transactions.</small></section></div><div><span><ShieldCheck size={17}/></span><section><b>Clear activity history</b><small>See order status and account events.</small></section></div></div></section>
      <section className="account-card"><div className="account-card-top"><div><div className="account-card-kicker">ICEYVAULT ACCOUNT</div><h2>{mode==="signup"?"Create your account":"Welcome back"}</h2><p>{mode==="signup"?"Set up your account to manage your services.":"Sign in to continue to your account."}</p></div><div className="account-lock"><LockKeyhole size={19}/></div></div>
        <div className="account-tabs"><button className={mode==="signup"?"selected":""} onClick={()=>setMode("signup")}>Create account</button><button className={mode==="login"?"selected":""} onClick={()=>setMode("login")}>Log in</button></div>
        <form className="account-form" onSubmit={e=>e.preventDefault()}>
          {mode==="signup"&&<label>Full name<div className="account-input"><UserRound size={16}/><input type="text" placeholder="Your full name" autoComplete="name" disabled/></div></label>}
          <label>Email address<div className="account-input"><Mail size={16}/><input type="email" placeholder="you@example.com" autoComplete="email" disabled/></div></label>
          <label>Password<div className="account-input"><LockKeyhole size={16}/><input type={showPassword?"text":"password"} placeholder="Enter your password" autoComplete={mode==="signup"?"new-password":"current-password"} disabled/><button type="button" aria-label={showPassword?"Hide password":"Show password"} onClick={()=>setShowPassword(!showPassword)}>{showPassword?<EyeOff size={16}/>:<Eye size={16}/>}</button></div></label>
          {mode==="signup"&&<label className="account-check"><input type="checkbox" disabled/><span>I agree to the Terms of Service and Privacy Policy.</span></label>}
          <button className="account-submit" disabled>{mode==="signup"?"Create account":"Log in"} <ArrowRight size={16}/></button>
        </form>
        <div className="account-disabled"><ShieldCheck size={16}/><div><b>Account access is not enabled yet</b><span>Authentication will be activated after the secure database connection and account verification flow are completed.</span></div></div>
        <p className="account-switch">{mode==="signup"?"Already have an account?":"New to IceyVault?"} <button onClick={()=>setMode(mode==="signup"?"login":"signup")}>{mode==="signup"?"Log in":"Create an account"}</button></p>
      </section>
    </div>
    <footer className="account-footer"><span>© {new Date().getFullYear()} IceyVault</span><span><ShieldCheck size={13}/> Secure access preview</span></footer>
  </main>;
}
function WalletIcon(){return <LockKeyhole size={17}/>}
