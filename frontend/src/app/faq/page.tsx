'use client';
import React, { useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ArrowLeft } from 'lucide-react';

const items=[
['How does LIFE-LINK connect donors, hospitals, and blood banks?','LIFE-LINK connects the three groups through a centralized platform. Hospitals can raise requests, blood banks can update availability, and eligible donors can receive compatible emergency alerts.'],
['How are donors verified?','Donor access and eligibility are handled through the application and its verified account workflow.'],
['How does an emergency blood request work?','A hospital creates a request with the required blood group, resource type, quantity, and urgency. The platform then coordinates available resources through its emergency resolution workflow.'],
['Can a donor accept or decline an alert?','Yes. Donor dispatches provide a response flow so a notified donor can accept or decline an emergency request.'],
['How are blood-bank transfers handled?','Blood banks can coordinate peer transfer offers for emergency hospital requests, subject to the backend authorization and workflow rules.'],
['Does LIFE-LINK use passwords?','The current frontend uses passwordless email OTP authentication.'],
];

export default function FAQPage(){
 const [open,setOpen]=useState<number|null>(0);
 return <div className="lifelink-page min-h-screen"><header className="public-header"><div className="lifelink-container h-16 flex items-center justify-between"><Link href="/" className="brand-mark"><span className="brand-mark-icon">+</span><span className="brand-mark-word">LIFE LINK</span></Link><nav className="hidden sm:flex gap-7"><Link href="/about" className="public-nav-link">About</Link><Link href="/faq" className="public-nav-link active">FAQ</Link><Link href="/contact" className="public-nav-link">Contact</Link></nav><Link href="/choose-role" className="h-9 px-4 rounded-lg bg-blue-600 text-white text-xs font-semibold flex items-center">Get started</Link></div></header><main className="lifelink-container py-12 sm:py-16"><Link href="/" className="inline-flex items-center gap-1 text-xs text-slate-400"><ArrowLeft className="w-3.5 h-3.5"/> Back to Home</Link><div className="max-w-2xl mx-auto pt-12"><h1 className="public-section-title text-center text-4xl">Frequently Asked Questions</h1><p className="mt-3 text-center public-section-copy">A few common questions about the LIFE-LINK network.</p><div className="mt-9 space-y-2">{items.map(([q,a],i)=><div className="public-card overflow-hidden" key={q}><button onClick={()=>setOpen(open===i?null:i)} className="w-full flex items-center justify-between gap-4 p-5 text-left text-sm font-semibold text-slate-900"><span>{q}</span><ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${open===i?'rotate-180':''}`}/></button>{open===i&&<div className="px-5 pb-5 text-sm leading-6 text-slate-500">{a}</div>}</div>)}</div></div></main><footer className="border-t border-slate-200 bg-white"><div className="lifelink-container py-7 text-xs text-slate-500 flex justify-between"><span>© {new Date().getFullYear()} LIFE-LINK</span><Link href="/contact" className="hover:text-blue-600">Contact</Link></div></footer></div>;
}
