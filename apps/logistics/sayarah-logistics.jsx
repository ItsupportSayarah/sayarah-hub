import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { auth, firebaseSignIn, firebaseSignUp, firebaseSignOut, onAuthChange, getUserRole, getUserData, saveAppData, loadAppData, getAllUsers, updateUserPermissions, saveApprovalsFB, loadApprovalsFB, saveActivityLogFB, loadActivityLogFB, uploadFile, deleteFile } from "./src/firebase.js";

const FIREBASE_ENABLED = (() => {
  try { return auth && auth.app && auth.app.options && auth.app.options.apiKey && !auth.app.options.apiKey.startsWith("YOUR_"); } catch { return false; }
})();

// ═══════════════════════════════════════════════════════════════
// SAYARAH LOGISTICS — Industry-Grade Vehicle Shipping Platform
// ═══════════════════════════════════════════════════════════════

// Design tokens — Original Sayarah brand colors
const C={
  navy:"#4A0E0E",navyLight:"#5C1515",navyMid:"#6B2020",
  white:"#FFFFFF",offWhite:"#FAFAF7",bg:"#FAFAF7",
  slate50:"#F9FAFB",slate100:"#F3F4F6",slate200:"#E5E7EB",slate300:"#D1D5DB",slate400:"#9CA3AF",slate500:"#6B7280",slate600:"#4B5563",slate700:"#374151",slate800:"#1F2937",slate900:"#111827",
  blue:"#1E40AF",blueDark:"#1E3A8A",blueLight:"#DBEAFE",blue50:"#EFF6FF",
  emerald:"#166534",emeraldDark:"#14532D",emeraldLight:"#D1FAE5",emerald50:"#F0FDF4",
  amber:"#D97706",amberDark:"#B45309",amberLight:"#FEF3C7",amber50:"#FFFBEB",
  red:"#8B1A1A",redDark:"#6B1010",redLight:"#FDF2F2",red50:"#FEE2E2",
  purple:"#7C3AED",purpleLight:"#EDE9FE",
  teal:"#0D9488",tealLight:"#F0FDFA",
  brandRed:"#8B1A1A",
  black:"#111",
  shadow:"0 1px 3px rgba(0,0,0,.08),0 1px 2px rgba(0,0,0,.06)",
  shadowMd:"0 4px 6px -1px rgba(0,0,0,.07),0 2px 4px -2px rgba(0,0,0,.05)",
  shadowLg:"0 10px 15px -3px rgba(0,0,0,.08),0 4px 6px -4px rgba(0,0,0,.04)",
  shadowXl:"0 20px 25px -5px rgba(0,0,0,.1),0 8px 10px -6px rgba(0,0,0,.08)",
};
const STORAGE_KEY="sayarah-logistics-v5";
const gid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const p=v=>parseFloat(v)||0;
const f$=n=>(n==null||isNaN(n))?"$0":new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",minimumFractionDigits:0,maximumFractionDigits:0}).format(n);
const f$2=n=>(n==null||isNaN(n))?"$0.00":new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(n);
const MO={fontFamily:"'Inter',system-ui,sans-serif",fontVariantNumeric:"tabular-nums"};
const today=()=>new Date().toISOString().slice(0,10);
const daysBetween=(a,b)=>(!a||!b)?0:Math.max(0,Math.round((new Date(b)-new Date(a))/864e5));
const daysAgo=d=>d?Math.max(0,Math.round((new Date()-new Date(d))/864e5)):0;

// ─── Pipeline ─────────────────────────────────────────────────
const STATUSES=[
  {key:"purchased",label:"Purchased",icon:"🏷️",color:"#8B5CF6",bg:"#EDE9FE"},
  {key:"title_pending",label:"Title Pending",icon:"📋",color:"#A855F7",bg:"#F3E8FF"},
  {key:"on_the_way",label:"On The Way",icon:"🚛",color:"#F59E0B",bg:"#FEF3C7"},
  {key:"at_warehouse",label:"At Warehouse",icon:"🏭",color:"#3B82F6",bg:"#DBEAFE"},
  {key:"loading",label:"Loading",icon:"⬆️",color:"#06B6D4",bg:"#CFFAFE"},
  {key:"loaded",label:"Loaded",icon:"📦",color:"#14B8A6",bg:"#CCFBF1"},
  {key:"shipped",label:"Shipped",icon:"🚢",color:"#10B981",bg:"#D1FAE5"},
  {key:"in_transit_sea",label:"In Transit (Sea)",icon:"🌊",color:"#0EA5E9",bg:"#E0F2FE"},
  {key:"arrived_port",label:"Arrived at Port",icon:"⚓",color:"#6366F1",bg:"#E0E7FF"},
  {key:"customs_clearance",label:"Customs Clearance",icon:"🛃",color:"#8B5CF6",bg:"#EDE9FE"},
  {key:"delivered",label:"Delivered",icon:"✅",color:"#059669",bg:"#BBF7D0"},
];
const TITLE_STATUSES=["With Title","Without Title","Title Pending","Title Mailed","Title at Warehouse","Title with Customs"];
const PORTS=[
  {code:"CA",name:"Los Angeles",full:"[CA] LOS ANGELES"},
  {code:"NJ",name:"New Jersey",full:"[NJ] NEW JERSEY"},
  {code:"GA",name:"Savannah",full:"[GA] SAVANNAH"},
  {code:"TX",name:"Houston",full:"[TX] HOUSTON"},
  {code:"FL",name:"Miami",full:"[FL] MIAMI"},
  {code:"WA",name:"Tacoma",full:"[WA] TACOMA"},
];
const DESTS=[
  {code:"UAE",name:"United Arab Emirates",region:"Middle East",port:"JEBEL ALI"},
  {code:"SA",name:"Saudi Arabia",region:"Middle East",port:"DAMMAM"},
  {code:"OM",name:"Oman",region:"Middle East",port:"SOHAR"},
  {code:"QA",name:"Qatar",region:"Middle East",port:"HAMAD"},
  {code:"KW",name:"Kuwait",region:"Middle East",port:"SHUWAIKH"},
  {code:"BH",name:"Bahrain",region:"Middle East",port:"KHALIFA"},
  {code:"JO",name:"Jordan",region:"Middle East",port:"AQABA"},
  {code:"IQ",name:"Iraq",region:"Middle East",port:"UMM QASR"},
  {code:"GE",name:"Georgia",region:"Central Asia",port:"POTI"},
  {code:"KZ",name:"Kazakhstan",region:"Central Asia",port:"AKTAU"},
  {code:"NG",name:"Nigeria",region:"Africa",port:"LAGOS"},
  {code:"GH",name:"Ghana",region:"Africa",port:"TEMA"},
  {code:"BJ",name:"Benin",region:"Africa",port:"COTONOU"},
];
const BASE_RATES={sedan:{"Middle East":1200,"Central Asia":1800,Africa:1500},suv:{"Middle East":1500,"Central Asia":2100,Africa:1800},truck:{"Middle East":1800,"Central Asia":2400,Africa:2100},van:{"Middle East":1600,"Central Asia":2200,Africa:1900},motorcycle:{"Middle East":600,"Central Asia":900,Africa:750},heavy:{"Middle East":2500,"Central Asia":3200,Africa:2800}};
const PORT_SURCH={CA:0,NJ:100,GA:50,TX:50,FL:75,WA:150};
function calcShipRate(vt,dest,port,run){const d=DESTS.find(x=>x.code===dest);const r=d?.region||"Middle East";const b=(BASE_RATES[vt]||BASE_RATES.sedan)[r]||1200;const ps=PORT_SURCH[port]||0;const nr=run?0:250;const ins=Math.round(b*0.03);return{base:b,portSurcharge:ps,nonRunning:nr,insurance:ins,documentation:150,total:b+ps+nr+ins+150};}
function calcTowRate(mi,run,vt){const h=75;const pm=vt==="heavy"?4.5:vt==="suv"||vt==="truck"?3.5:3;const nf=run?0:100;return{total:h+Math.round(mi*pm)+nf+(run?0:50)};}

// ─── Demurrage Engine ─────────────────────────────────────────
const DEMURRAGE_RULES={
  MSC:{freeDays:7,phase1:{days:3,rate:400,noc:158},phase2:{rate:1000,noc:158}},
  Maersk:{freeDays:7,phase1:{days:14,rate:700,noc:0},phase2:{rate:1000,noc:0}},
  "CMA CGM":{freeDays:10,phase1:{days:14,rate:500,noc:100},phase2:{rate:800,noc:100}},
  Default:{freeDays:7,phase1:{days:14,rate:400,noc:0},phase2:{rate:700,noc:0}},
};
function calcDemurrage(carrier,daysAtPort,portStorageRate=164){
  const rules=DEMURRAGE_RULES[carrier]||DEMURRAGE_RULES.Default;
  const overDays=Math.max(0,daysAtPort-rules.freeDays);
  if(overDays===0)return{portStorage:0,detention:0,noc:0,total:0,overDays:0,phase:"free"};
  const portStorage=overDays*portStorageRate;
  let detention=0,noc=0;
  if(overDays<=rules.phase1.days){detention=overDays*rules.phase1.rate;noc=rules.phase1.noc;}
  else{detention=rules.phase1.days*rules.phase1.rate+(overDays-rules.phase1.days)*rules.phase2.rate;noc=rules.phase1.noc+(overDays-rules.phase1.days>0?rules.phase2.noc:0);}
  return{portStorage,detention,noc,total:portStorage+detention+noc,overDays,phase:overDays<=rules.phase1.days?"phase1":"phase2"};
}

// ─── Invoice Fee Columns ──────────────────────────────────────
const FEE_COLS=[
  {key:"transportCost",label:"Transportation Cost",short:"Transport"},
  {key:"towingCost",label:"Towing To Port",short:"Towing"},
  {key:"customsCharges",label:"Customs & Service",short:"Customs"},
  {key:"clearanceFee",label:"Clearance & Unloading",short:"Clearance"},
  {key:"inspectionFee",label:"Inspection Fee",short:"Inspection"},
  {key:"attestationFee",label:"Attestation Fee",short:"Attestation"},
  {key:"hybridCharges",label:"Hybrid Charges",short:"Hybrid"},
];
const INV_STATUSES=[
  {key:"draft",label:"Draft",color:C.slate500,bg:C.slate200},
  {key:"sent",label:"Sent",color:"#2563EB",bg:"#DBEAFE"},
  {key:"partial",label:"Partial",color:"#D97706",bg:"#FEF3C7"},
  {key:"paid",label:"Paid",color:"#059669",bg:"#D1FAE5"},
  {key:"overdue",label:"Overdue",color:"#DC2626",bg:"#FEE2E2"},
];
const PAY_METHODS=["Wire Transfer","Cash","Check","Credit Card","Zelle","PayPal","Bank Transfer"];
const VTYPES=["sedan","suv","truck","van","motorcycle","heavy"];
const CONTAINER_TYPES=["20ft Standard","40ft Standard","40ft High Cube","45ft High Cube","Flat Rack","RoRo"];
const CONTAINER_STATUSES=["Empty","Loading","Full","In Transit","Arrived","Customs Hold","Released","Unloaded"];
const TOW_STATUSES=["Scheduled","Dispatched","Picked Up","In Transit","Delivered","Cancelled"];

// ─── Default Data ─────────────────────────────────────────────
const defaultData=()=>({
  vehicles:[],containers:[],towingJobs:[],invoices:[],payments:[],customers:[],activityLog:[],
  nextVehicleNum:1,nextInvoiceNum:1001,nextContainerNum:1,
  companyInfo:{name:"Sayarah Logistics",address:"275 Grove Street, Suite 2-400",city:"Newton, MA 02466",phone:"+1 (949) 889-5621",email:"support@sayarah.io"},
  bankInfo:{accountNum:"466024356536",routingPaper:"011000138 (paper s& electronic)",routingWire:"026009593 (wires)",titleOnAccount:"Atlantic Car Connect LLC",bankAddress:"207 River, West Newton, MA, 02465",bankMobile:"+1 781 866 3575",bankName:"Bank of America"},
  adminAccounts:[{username:"admin",password:"admin123"},{username:"sayarah",password:"sayarah2025"},{username:"obaidull",password:"obaidull123"}],
});

// ─── Activity Logger ──────────────────────────────────────────
function logActivity(setData,user,action,detail){
  setData(d=>({...d,activityLog:[{id:gid(),date:new Date().toISOString(),user,action,detail},...(d.activityLog||[]).slice(0,199)]}));
}

// ─── Invoice Calc Helpers ─────────────────────────────────────
const lineTotal=li=>FEE_COLS.reduce((s,c)=>s+p(li[c.key]),0);
const colTotal=(items,k)=>items.reduce((s,li)=>s+p(li[k]),0);
const invSubtotal=items=>items.reduce((s,li)=>s+lineTotal(li),0);
const invGrandTotal=inv=>invSubtotal(inv.lineItems||[])+p(inv.containerBookingPrice)-p(inv.discount);
const invPaid=(inv,payments)=>(payments||[]).filter(py=>py.invoiceId===inv.id).reduce((s,py)=>s+p(py.amount),0);
const invBalance=(inv,payments)=>invGrandTotal(inv)-invPaid(inv,payments);

// ═══════════════════════════════════════════════════════════════
// UI PRIMITIVES — Redesigned
// ═══════════════════════════════════════════════════════════════
const iS={border:"1.5px solid "+C.slate200,borderRadius:10,padding:"10px 14px",fontSize:13,outline:"none",boxSizing:"border-box",width:"100%",background:C.white,color:C.black,transition:"border-color .2s,box-shadow .2s",fontFamily:"'Inter',system-ui,sans-serif"};

function Inp({label,value,onChange,type="text",placeholder,readOnly,step,style:sx={}}){
  const[focused,setFocused]=useState(false);
  return <div style={{display:"flex",flexDirection:"column",gap:4,...sx}}>
    {label&&<label style={{fontSize:11,fontWeight:600,color:C.slate500,letterSpacing:"0.02em"}}>{label}</label>}
    <input type={type} value={value??""} placeholder={placeholder} readOnly={readOnly} step={step}
      onFocus={()=>setFocused(true)} onBlur={()=>setFocused(false)}
      onChange={e=>onChange(type==="number"?(e.target.value===""?"":parseFloat(e.target.value)):e.target.value)}
      style={{...iS,...(readOnly?{background:C.slate50,color:C.slate400,cursor:"default"}:{}),
        ...(focused&&!readOnly?{borderColor:C.blue,boxShadow:"0 0 0 3px rgba(59,130,246,.15)"}:{})}}/>
  </div>;
}
function Sel({label,value,onChange,options,placeholder,style:sx={}}){
  return <div style={{display:"flex",flexDirection:"column",gap:4,...sx}}>
    {label&&<label style={{fontSize:11,fontWeight:600,color:C.slate500,letterSpacing:"0.02em"}}>{label}</label>}
    <select value={value??""} onChange={e=>onChange(e.target.value)} style={{...iS,cursor:"pointer",appearance:"auto"}}>
      {placeholder&&<option value="">{placeholder}</option>}
      {options.map(o=>typeof o==="object"?<option key={o.value} value={o.value}>{o.label}</option>:<option key={o} value={o}>{o}</option>)}
    </select>
  </div>;
}
function Btn({children,onClick,v="primary",s="md",disabled,style:sx={}}){
  const[hov,setHov]=useState(false);
  const base={border:"none",borderRadius:10,cursor:disabled?"not-allowed":"pointer",fontWeight:600,display:"inline-flex",alignItems:"center",gap:6,transition:"all .2s ease",opacity:disabled?.5:1,fontFamily:"'Inter',system-ui,sans-serif",letterSpacing:"0.01em",whiteSpace:"nowrap"};
  const szP=s==="sm"?"6px 14px":"10px 20px";
  const szF=s==="sm"?12:13;
  const vs={
    primary:{background:hov?C.redDark:C.red,color:"#fff",padding:szP,fontSize:szF,boxShadow:hov?"0 4px 12px rgba(139,26,26,.35)":"0 2px 6px rgba(139,26,26,.25)"},
    secondary:{background:hov?C.slate50:C.white,color:C.slate700,padding:szP,fontSize:szF,border:"1.5px solid "+C.slate200,boxShadow:hov?C.shadow:"none"},
    danger:{background:hov?"#DC2626":"#EF4444",color:"#fff",padding:"6px 14px",fontSize:12,boxShadow:"0 2px 6px rgba(239,68,68,.25)"},
    ghost:{background:hov?C.slate100:"transparent",color:C.slate500,padding:"6px 10px",fontSize:12,borderRadius:8},
    teal:{background:hov?"#0D9488":"#14B8A6",color:"#fff",padding:szP,fontSize:szF,boxShadow:"0 2px 6px rgba(20,184,166,.25)"},
    success:{background:hov?"#059669":"#10B981",color:"#fff",padding:szP,fontSize:szF,boxShadow:"0 2px 6px rgba(16,185,129,.25)"},
    green:{background:hov?"#059669":"#10B981",color:"#fff",padding:"6px 14px",fontSize:12,boxShadow:"0 2px 6px rgba(16,185,129,.25)"},
  };
  return <button onClick={onClick} disabled={disabled} onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)} style={{...base,...vs[v],...sx}}>{children}</button>;
}
function Card({children,style={}}){return <div style={{background:C.white,borderRadius:16,padding:20,boxShadow:C.shadow,transition:"box-shadow .2s",...style}}>{children}</div>;}
function Modal({title,onClose,children,wide}){
  return <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(15,23,42,.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:16,backdropFilter:"blur(6px)"}}>
    <div onClick={e=>e.stopPropagation()} style={{background:C.white,borderRadius:20,padding:28,width:"100%",maxWidth:wide?960:560,maxHeight:"92vh",overflowY:"auto",boxShadow:C.shadowXl}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20,paddingBottom:16,borderBottom:"1px solid "+C.slate200}}>
        <h3 style={{margin:0,fontSize:18,fontWeight:700,color:C.black}}>{title}</h3>
        <button onClick={onClose} style={{width:32,height:32,borderRadius:8,border:"none",background:C.slate100,color:C.slate500,cursor:"pointer",fontSize:14,display:"flex",alignItems:"center",justifyContent:"center",transition:"all .15s",fontFamily:"inherit"}}>✕</button>
      </div>{children}
    </div>
  </div>;
}
function ConfirmDlg({msg,onOk,onCancel}){return <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1100,backdropFilter:"blur(4px)"}}><div style={{background:C.white,borderRadius:16,padding:28,maxWidth:380,textAlign:"center",boxShadow:C.shadowXl}}><div style={{width:48,height:48,borderRadius:12,background:C.redLight,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 16px",fontSize:22}}>⚠️</div><p style={{color:C.slate700,fontSize:15,fontWeight:500,marginBottom:20,lineHeight:1.5}}>{msg}</p><div style={{display:"flex",justifyContent:"center",gap:10}}><Btn v="secondary" onClick={onCancel}>Cancel</Btn><Btn v="danger" onClick={onOk}>Delete</Btn></div></div></div>;}
function Bdg({children,color,bg}){return <span style={{fontSize:10,fontWeight:700,padding:"4px 10px",borderRadius:20,background:bg,color,letterSpacing:".02em",whiteSpace:"nowrap",display:"inline-flex",alignItems:"center",gap:3}}>{children}</span>;}
function SBdg({statusKey}){const s=STATUSES.find(x=>x.key===statusKey)||STATUSES[0];return <Bdg color={s.color} bg={s.bg}>{s.icon} {s.label}</Bdg>;}
function IBdg({statusKey}){const s=INV_STATUSES.find(x=>x.key===statusKey)||INV_STATUSES[0];return <Bdg color={s.color} bg={s.bg}>{s.label}</Bdg>;}
function Empty({icon,title,sub}){return <div style={{textAlign:"center",padding:"60px 20px"}}><div style={{width:72,height:72,borderRadius:20,background:C.slate100,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 12px",fontSize:32}}>{icon}</div><div style={{fontSize:16,fontWeight:700,color:C.slate700,marginBottom:4}}>{title}</div><div style={{fontSize:13,color:C.slate400}}>{sub}</div></div>;}
function TH({children,right}){return <th style={{textAlign:right?"right":"left",padding:"12px 14px",color:C.slate500,fontSize:11,fontWeight:600,letterSpacing:".03em",background:C.white,position:"sticky",top:0,zIndex:1,borderBottom:"2px solid "+C.slate200}}>{children}</th>;}
function TD({children,style:sx={}}){return <td style={{padding:"12px 14px",fontSize:13,...sx}}>{children}</td>;}
function MiniBar({val,max,color}){const w=max>0?Math.min(100,(val/max)*100):0;return <div style={{height:6,background:C.slate100,borderRadius:3}}><div style={{height:6,background:color||C.blue,borderRadius:3,width:`${w}%`,transition:"width .4s ease"}}/></div>;}
function StatCard({label,value,sub,color,icon}){
  return <Card style={{flex:"1 1 180px",minWidth:160,padding:20}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"start"}}>
      <div>
        <div style={{fontSize:11,color:C.slate400,fontWeight:600,marginBottom:8,letterSpacing:".02em"}}>{label}</div>
        <div style={{fontSize:26,fontWeight:800,color:color||C.black,...MO,lineHeight:1}}>{value}</div>
        {sub&&<div style={{fontSize:11,color:C.slate400,marginTop:6}}>{sub}</div>}
      </div>
      {icon&&<div style={{width:44,height:44,borderRadius:12,background:color?`${color}15`:C.slate100,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20}}>{icon}</div>}
    </div>
  </Card>;
}
function PageHeader({title,subtitle,children}){return <div style={{display:"flex",justifyContent:"space-between",alignItems:"start",marginBottom:24,flexWrap:"wrap",gap:12}}><div><h1 style={{fontSize:24,fontWeight:800,color:C.black,margin:0,lineHeight:1.2}}>{title}</h1>{subtitle&&<p style={{fontSize:13,color:C.slate400,margin:"6px 0 0",fontWeight:500}}>{subtitle}</p>}</div>{children&&<div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>{children}</div>}</div>;}
function Tabs({items,active,onChange}){return <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>{items.map(t=><Btn key={t} v={active===t?"primary":"secondary"} s="sm" onClick={()=>onChange(t)}>{t}</Btn>)}</div>;}

// ═══════════════════════════════════════════════════════════════
// SIDEBAR NAV ICONS (SVG)
// ═══════════════════════════════════════════════════════════════
const NAV_ICONS={
  Dashboard:<svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>,
  Customers:<svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>,
  Vehicles:<svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M5 17h2m10 0h2M2 9l2-5h12l4 5M2 9v8h20V9m-20 0h20"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/></svg>,
  Containers:<svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12"/></svg>,
  Towing:<svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M10 17h4V5H2v12h3m5 0a3 3 0 100-6 3 3 0 000 6zm10 0h1V9h-5l-3-4h-1"/><circle cx="20" cy="17" r="2"/></svg>,
  Rates:<svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>,
  Invoices:<svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M16 13H8m8 4H8m2-8H8"/></svg>,
  Settings:<svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>,
  Users:<svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>,
  "My Shipments":<svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M5 17h2m10 0h2M2 9l2-5h12l4 5M2 9v8h20V9m-20 0h20"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/></svg>,
  "My Invoices":<svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M16 13H8m8 4H8m2-8H8"/></svg>,
};

// ═══════════════════════════════════════════════════════════════
// LOGIN
// ═══════════════════════════════════════════════════════════════
function LoginPage({onLogin,data}){
  const[user,setUser]=useState("");const[pass,setPass]=useState("");const[err,setErr]=useState("");const[loading,setLoading]=useState(false);
  const[isSignUp,setIsSignUp]=useState(false);const[signUpName,setSignUpName]=useState("");

  const go=async()=>{
    if(FIREBASE_ENABLED){
      if(!user.trim()){setErr("Enter your email");return;}
      if(!pass.trim()){setErr("Enter a password");return;}
      setLoading(true);setErr("");
      try{
        if(isSignUp){
          if(!signUpName.trim()){setErr("Enter your name");setLoading(false);return;}
          const cred=await firebaseSignUp(user.trim(),pass,signUpName.trim());
          const role=await getUserRole(cred.uid);
          onLogin(cred.displayName||user.split("@")[0],role,cred.uid,cred.email);
        }else{
          const cred=await firebaseSignIn(user.trim(),pass);
          const role=await getUserRole(cred.uid);
          onLogin(cred.displayName||user.split("@")[0],role,cred.uid,cred.email);
        }
      }catch(e){
        const msg=e.code==="auth/user-not-found"?"No account found with this email"
          :e.code==="auth/wrong-password"?"Incorrect password"
          :e.code==="auth/invalid-email"?"Invalid email format"
          :e.code==="auth/email-already-in-use"?"Email already registered — try signing in"
          :e.code==="auth/weak-password"?"Password must be at least 6 characters"
          :e.code==="auth/invalid-credential"?"Invalid email or password"
          :e.message||"Authentication failed";
        setErr(msg);setLoading(false);
      }
    }else{
      if(!user.trim()){setErr("Please enter your username");return;}
      const admins=data?.adminAccounts||defaultData().adminAccounts;
      const am=admins.find(a=>a.username.toLowerCase()===user.trim().toLowerCase());
      if(am){if(!pass){setErr("Password required for admin");return;}if(pass!==am.password){setErr("Incorrect password");return;}setLoading(true);setErr("");setTimeout(()=>onLogin(user.trim(),"admin",null,""),600);}
      else{setLoading(true);setErr("");setTimeout(()=>onLogin(user.trim(),"customer",null,""),600);}
    }
  };

  return(
    <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Inter',system-ui,sans-serif",background:`linear-gradient(135deg,${C.red} 0%,${C.navy} 50%,${C.navyLight} 100%)`,padding:20}}>
      <div style={{position:"absolute",top:0,left:0,right:0,bottom:0,overflow:"hidden",pointerEvents:"none"}}>
        <div style={{position:"absolute",top:"-20%",right:"-10%",width:"50vw",height:"50vw",borderRadius:"50%",background:"rgba(139,26,26,.1)"}}/>
        <div style={{position:"absolute",bottom:"-15%",left:"-5%",width:"40vw",height:"40vw",borderRadius:"50%",background:"rgba(255,255,255,.03)"}}/>
      </div>
      <div style={{width:"100%",maxWidth:420,position:"relative",zIndex:1}}>
        <div style={{textAlign:"center",marginBottom:36}}>
          <img src="/logo.png" alt="Sayarah Logistics" style={{height:56,objectFit:"contain",marginBottom:8}}/>
          <div style={{fontSize:11,color:"rgba(255,255,255,.3)",letterSpacing:".15em",fontWeight:600}}>VEHICLE SHIPPING PLATFORM</div>
        </div>
        <div style={{background:C.white,borderRadius:24,padding:"36px 32px",boxShadow:"0 25px 50px -12px rgba(0,0,0,.4)"}}>
          <h2 style={{fontSize:22,fontWeight:800,color:C.black,margin:"0 0 4px"}}>{isSignUp?"Create Account":"Welcome back"}</h2>
          <p style={{fontSize:13,color:C.slate400,margin:"0 0 28px"}}>{isSignUp?"Sign up to get started":"Sign in to your account"}</p>
          <div style={{display:"flex",flexDirection:"column",gap:16}}>
            {FIREBASE_ENABLED&&isSignUp&&<Inp label="Full Name" value={signUpName} onChange={setSignUpName} placeholder="Your full name"/>}
            <Inp label={FIREBASE_ENABLED?"Email":"Username"} value={user} onChange={setUser} placeholder={FIREBASE_ENABLED?"you@email.com":"Enter username"}/>
            <Inp label="Password" value={pass} onChange={setPass} type="password" placeholder={isSignUp?"Min 6 characters":"Enter password"}/>
            {err&&<div style={{background:C.redLight,color:C.redDark,padding:"10px 14px",borderRadius:10,fontSize:12,fontWeight:600}}>{err}</div>}
            <button onClick={go} disabled={loading} style={{width:"100%",padding:"13px",background:loading?C.slate400:`linear-gradient(135deg,${C.red},${C.redDark})`,color:"#fff",border:"none",borderRadius:12,fontSize:14,fontWeight:700,cursor:loading?"wait":"pointer",fontFamily:"inherit",boxShadow:"0 4px 14px rgba(139,26,26,.35)",transition:"all .2s"}}>{loading?(isSignUp?"Creating account...":"Signing in..."):(isSignUp?"CREATE ACCOUNT":"SIGN IN")}</button>
            {FIREBASE_ENABLED&&<div style={{textAlign:"center",marginTop:4}}>
              <span style={{fontSize:12,color:C.slate400}}>{isSignUp?"Already have an account? ":"Don't have an account? "}</span>
              <button onClick={()=>{setIsSignUp(!isSignUp);setErr("");}} style={{background:"none",border:"none",color:C.red,fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>{isSignUp?"Sign In":"Sign Up"}</button>
            </div>}
          </div>
        </div>
        <p style={{textAlign:"center",fontSize:11,color:"rgba(255,255,255,.25)",marginTop:28}}>Powered by <span style={{fontWeight:700,color:"rgba(255,255,255,.4)"}}>Sayarah Inc</span></p>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// DASHBOARD — Advanced KPIs
// ═══════════════════════════════════════════════════════════════
function DashboardTab({data,role,username,userEmail}){
  const custNames=useMemo(()=>{if(!userEmail)return[];return(data.customers||[]).filter(c=>c.email?.toLowerCase()===userEmail.toLowerCase()).map(c=>c.name.toLowerCase());},[data.customers,userEmail]);
  const matchCust=v=>{const un=username.toLowerCase();if(userEmail&&v.customerEmail?.toLowerCase()===userEmail.toLowerCase())return true;if(v.customer?.toLowerCase()===un)return true;if(custNames.some(n=>v.customer?.toLowerCase()===n))return true;return false;};
  const matchInvCust=i=>{const un=username.toLowerCase();if(i.customer?.toLowerCase()===un)return true;if(custNames.some(n=>i.customer?.toLowerCase()===n))return true;return false;};
  const vehs=role==="customer"?data.vehicles.filter(matchCust):data.vehicles;
  const invs=role==="customer"?data.invoices.filter(matchInvCust):data.invoices;
  const pays=role==="customer"?data.payments.filter(py=>invs.some(i=>i.id===py.invoiceId)):data.payments;
  const unsold=vehs.filter(v=>v.status!=="delivered");

  const kpi=useMemo(()=>{
    const totalInvoiced=invs.reduce((s,i)=>s+invGrandTotal(i),0);
    const totalPaid=pays.reduce((s,py)=>s+p(py.amount),0);
    const totalBal=totalInvoiced-totalPaid;
    const overdue=invs.filter(i=>i.status==="overdue"||(i.dueDate&&i.dueDate<today()&&invBalance(i,pays)>0));
    const overdueAmt=overdue.reduce((s,i)=>s+invBalance(i,pays),0);
    const aging={cur:0,d30:0,d60:0,d90:0,d90p:0};
    invs.forEach(inv=>{const bal=invBalance(inv,pays);if(bal<=0)return;const days=inv.dueDate?daysAgo(inv.dueDate):0;if(days<=0)aging.cur+=bal;else if(days<=30)aging.d30+=bal;else if(days<=60)aging.d60+=bal;else if(days<=90)aging.d90+=bal;else aging.d90p+=bal;});
    const pipelineVal=unsold.reduce((s,v)=>s+p(v.purchasePrice),0);
    const mo=today().slice(0,7);
    const moRev=pays.filter(py=>py.date?.startsWith(mo)).reduce((s,py)=>s+p(py.amount),0);
    const moInv=invs.filter(i=>i.date?.startsWith(mo)).reduce((s,i)=>s+invGrandTotal(i),0);
    return{totalInvoiced,totalPaid,totalBal,overdueCount:overdue.length,overdueAmt,aging,pipelineVal,moRev,moInv};
  },[invs,pays,unsold]);

  const sCounts=useMemo(()=>{const c={};STATUSES.forEach(s=>{c[s.key]=vehs.filter(v=>v.status===s.key).length;});return c;},[vehs]);
  const portData=useMemo(()=>PORTS.map(port=>{const pv=vehs.filter(v=>v.portLocation===port.code);return{...port,total:pv.length,warehouse:pv.filter(v=>v.status==="at_warehouse").length,shipped:pv.filter(v=>["shipped","in_transit_sea","arrived_port","customs_clearance","delivered"].includes(v.status)).length};}),[vehs]);

  const pipeStages=STATUSES.map(s=>({...s,count:sCounts[s.key]||0})).filter(s=>s.count>0);
  const totalV=vehs.length||1;

  return(
    <div>
      <PageHeader title="Dashboard" subtitle={role==="customer"?`Welcome, ${username} — your shipments and invoices`:"Overview of your logistics operations"}/>

      {/* Pipeline visualization */}
      {vehs.length>0&&<Card style={{marginBottom:20,padding:24}}>
        <div style={{fontSize:12,fontWeight:700,color:C.slate700,marginBottom:14}}>Shipment Pipeline</div>
        <div style={{display:"flex",gap:2,height:40,borderRadius:10,overflow:"hidden",background:C.slate100}}>
          {pipeStages.map((s,i)=><div key={s.key} title={`${s.label}: ${s.count}`} style={{width:`${(s.count/totalV)*100}%`,background:s.color,display:"flex",alignItems:"center",justifyContent:"center",minWidth:s.count>0?28:0,transition:"width .4s ease",borderRadius:i===0?"10px 0 0 10px":i===pipeStages.length-1?"0 10px 10px 0":"0",position:"relative"}}>
            {s.count>0&&<span style={{fontSize:12,fontWeight:700,color:"#fff"}}>{s.count}</span>}
          </div>)}
        </div>
        <div style={{display:"flex",flexWrap:"wrap",gap:12,marginTop:10}}>
          {pipeStages.map(s=><div key={s.key} style={{display:"flex",alignItems:"center",gap:5,fontSize:11}}><span style={{width:10,height:10,borderRadius:3,background:s.color,display:"inline-block"}}/><span style={{color:C.slate500,fontWeight:500}}>{s.label} ({s.count})</span></div>)}
        </div>
      </Card>}

      {/* Top KPI Row */}
      <div style={{display:"flex",flexWrap:"wrap",gap:14,marginBottom:16}}>
        <StatCard label="Total Vehicles" value={vehs.length} icon="🚗" color={C.blue}/>
        <StatCard label="In Transit" value={(sCounts.shipped||0)+(sCounts.in_transit_sea||0)} icon="🚢" color={C.teal}/>
        <StatCard label="At Warehouse" value={sCounts.at_warehouse||0} icon="🏭" color={C.blue}/>
        <StatCard label="Delivered" value={sCounts.delivered||0} icon="✅" color={C.emerald}/>
        <StatCard label="Pipeline Value" value={f$(kpi.pipelineVal)} icon="💰" color={C.amber} sub={`${unsold.length} vehicles`}/>
      </div>

      {/* Financial Row */}
      <div style={{display:"flex",flexWrap:"wrap",gap:14,marginBottom:20}}>
        <StatCard label="Total Invoiced" value={f$(kpi.totalInvoiced)} icon="📄" color={C.slate700}/>
        <StatCard label="Total Received" value={f$(kpi.totalPaid)} icon="💵" color={C.emerald}/>
        <StatCard label="Outstanding" value={f$(kpi.totalBal)} icon="⏳" color={kpi.totalBal>0?C.red:C.emerald}/>
        <StatCard label="Overdue" value={f$(kpi.overdueAmt)} icon="🚨" color={C.red} sub={`${kpi.overdueCount} invoices`}/>
        <StatCard label="This Month" value={f$(kpi.moRev)} icon="📊" color={C.teal} sub={`Invoiced: ${f$(kpi.moInv)}`}/>
      </div>

      {/* Aging + Port side by side */}
      <div style={{display:"flex",flexWrap:"wrap",gap:16,marginBottom:20}}>
        {role==="admin"&&<Card style={{flex:"1 1 300px",padding:24}}>
          <div style={{fontSize:13,fontWeight:700,color:C.slate700,marginBottom:16}}>Receivables Aging</div>
          {[{l:"Current",v:kpi.aging.cur,c:C.emerald},{l:"1-30 Days",v:kpi.aging.d30,c:C.amber},{l:"31-60 Days",v:kpi.aging.d60,c:"#EA580C"},{l:"61-90 Days",v:kpi.aging.d90,c:C.red},{l:"90+ Days",v:kpi.aging.d90p,c:"#991B1B"}].map(r=>(
            <div key={r.l} style={{marginBottom:12}}>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:12,marginBottom:4}}><span style={{color:C.slate600,fontWeight:500}}>{r.l}</span><span style={{fontWeight:700,color:r.c,...MO}}>{f$(r.v)}</span></div>
              <MiniBar val={r.v} max={kpi.totalBal||1} color={r.c}/>
            </div>
          ))}
          <div style={{borderTop:"1px solid "+C.slate200,paddingTop:12,marginTop:8,display:"flex",justifyContent:"space-between",fontSize:14}}>
            <span style={{fontWeight:700,color:C.slate700}}>Total Outstanding</span><span style={{fontWeight:800,color:C.red,...MO}}>{f$(kpi.totalBal)}</span>
          </div>
        </Card>}

        <Card style={{flex:"2 1 400px",padding:0,overflow:"hidden"}}>
          <div style={{padding:"16px 20px",borderBottom:"1px solid "+C.slate200}}><span style={{fontSize:13,fontWeight:700,color:C.slate700}}>Port Summary</span></div>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
              <thead><tr><TH>Port</TH><TH>Warehouse</TH><TH>Shipped</TH><TH right>Total</TH></tr></thead>
              <tbody>{portData.filter(x=>x.total>0).map((port,i)=>(
                <tr key={port.code} style={{background:i%2===0?"transparent":C.slate50}}>
                  <TD style={{fontWeight:600}}>{port.full}</TD>
                  <TD>{port.warehouse>0?<Bdg color={C.blue} bg={C.blueLight}>{port.warehouse}</Bdg>:<span style={{color:C.slate300}}>0</span>}</TD>
                  <TD>{port.shipped>0?<Bdg color={C.emerald} bg={C.emeraldLight}>{port.shipped}</Bdg>:<span style={{color:C.slate300}}>0</span>}</TD>
                  <TD style={{fontWeight:700,...MO}}>{port.total}</TD>
                </tr>
              ))}{portData.filter(x=>x.total>0).length===0&&<tr><td colSpan={4} style={{padding:24,textAlign:"center",color:C.slate400}}>No shipments</td></tr>}</tbody>
            </table>
          </div>
        </Card>
      </div>

      {/* Recent Vehicles */}
      <Card style={{padding:24}}>
        <div style={{fontSize:13,fontWeight:700,color:C.slate700,marginBottom:14}}>Recent Vehicles</div>
        {vehs.length===0?<div style={{color:C.slate400,fontSize:13}}>No vehicles yet</div>:
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:12}}>
          {[...vehs].reverse().slice(0,8).map(v=>(
            <div key={v.id} style={{borderRadius:12,padding:14,background:C.slate50,transition:"all .2s",cursor:"default",borderLeft:`4px solid ${STATUSES.find(s=>s.key===v.status)?.color||C.slate300}`}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"start"}}>
                <div><span style={{color:C.blue,fontSize:11,fontWeight:700,...MO}}>#{v.vehicleNum}</span><div style={{fontSize:13,fontWeight:700,color:C.slate800,marginTop:2}}>{v.year} {v.make} {v.model}</div></div>
                <SBdg statusKey={v.status}/>
              </div>
              <div style={{fontSize:11,color:C.slate400,marginTop:6}}>{v.customer||"—"} · {PORTS.find(x=>x.code===v.portLocation)?.name||"—"} → {v.destination||"—"}</div>
            </div>
          ))}
        </div>}
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// CUSTOMERS TAB
// ═══════════════════════════════════════════════════════════════
function CustomersTab({data,setData}){
  const[showForm,setShowForm]=useState(false);const[editing,setEditing]=useState(null);const[search,setSearch]=useState("");const[viewStmt,setViewStmt]=useState(null);
  const empty=()=>({id:gid(),name:"",company:"",email:"",phone:"",address:"",country:"",notes:"",dateAdded:today()});
  const[form,setForm]=useState(empty());const upd=(k,v)=>setForm(f=>({...f,[k]:v}));
  const save=()=>{if(!form.name.trim())return;if(editing)setData(d=>({...d,customers:d.customers.map(c=>c.id===editing?form:c)}));else setData(d=>({...d,customers:[...d.customers,form]}));setShowForm(false);};
  const del=id=>{setData(d=>({...d,customers:d.customers.filter(c=>c.id!==id)}));setShowForm(false);};

  const custStats=useMemo(()=>{
    return (data.customers||[]).map(c=>{
      const vCount=data.vehicles.filter(v=>v.customer?.toLowerCase()===c.name.toLowerCase()).length;
      const custInvs=data.invoices.filter(i=>i.customer?.toLowerCase()===c.name.toLowerCase());
      const totalInv=custInvs.reduce((s,i)=>s+invGrandTotal(i),0);
      const totalPaid=custInvs.reduce((s,i)=>s+invPaid(i,data.payments),0);
      const bal=totalInv-totalPaid;
      const overdueCount=custInvs.filter(i=>i.dueDate&&i.dueDate<today()&&invBalance(i,data.payments)>0).length;
      return{...c,vCount,totalInv,totalPaid,balance:bal,overdueCount};
    });
  },[data.customers,data.vehicles,data.invoices,data.payments]);

  let filtered=custStats;
  if(search){const s=search.toLowerCase();filtered=filtered.filter(c=>`${c.name} ${c.company} ${c.email}`.toLowerCase().includes(s));}

  return(
    <div>
      <PageHeader title="Customers" subtitle={`${data.customers?.length||0} customers`}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search customers..." style={{...iS,width:220,padding:"8px 14px",fontSize:12}}/>
        <Btn onClick={()=>{setForm(empty());setEditing(null);setShowForm(true);}}>+ Add Customer</Btn>
      </PageHeader>
      {filtered.length===0?<Empty icon="👥" title="No customers" sub="Add your first customer to get started"/>:
      <Card style={{padding:0,overflow:"hidden",borderRadius:16}}><div style={{overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
          <thead><tr><TH>Customer</TH><TH>Contact</TH><TH>Vehicles</TH><TH right>Invoiced</TH><TH right>Paid</TH><TH right>Balance</TH><TH>Status</TH><TH>Actions</TH></tr></thead>
          <tbody>{filtered.map((c,i)=>(
            <tr key={c.id} style={{borderBottom:"1px solid "+C.slate100,background:i%2===0?"transparent":C.slate50,transition:"background .15s"}} onMouseEnter={e=>e.currentTarget.style.background=C.slate50} onMouseLeave={e=>e.currentTarget.style.background=i%2===0?"transparent":C.slate50}>
              <TD><div style={{fontWeight:600,color:C.slate800}}>{c.name}</div>{c.company&&<div style={{fontSize:11,color:C.slate400}}>{c.company}</div>}</TD>
              <TD style={{fontSize:12}}><div>{c.email||"—"}</div><div style={{color:C.slate400}}>{c.phone||""}</div></TD>
              <TD style={{...MO,fontWeight:600}}>{c.vCount}</TD>
              <TD style={{...MO,textAlign:"right"}}>{f$(c.totalInv)}</TD>
              <TD style={{...MO,textAlign:"right",color:C.emerald}}>{f$(c.totalPaid)}</TD>
              <TD style={{...MO,textAlign:"right",fontWeight:700,color:c.balance>0?C.red:C.emerald}}>{f$(c.balance)}</TD>
              <TD>{c.overdueCount>0?<Bdg color={C.red} bg={C.redLight}>{c.overdueCount} Overdue</Bdg>:c.balance>0?<Bdg color={C.amber} bg={C.amberLight}>Open</Bdg>:<Bdg color={C.emerald} bg={C.emeraldLight}>Clear</Bdg>}</TD>
              <TD><div style={{display:"flex",gap:6}}>
                <Btn v="secondary" s="sm" onClick={()=>setViewStmt(c)}>Statement</Btn>
                <Btn v="ghost" s="sm" onClick={()=>{setForm({...c});setEditing(c.id);setShowForm(true);}}>Edit</Btn>
              </div></TD>
            </tr>
          ))}</tbody>
        </table>
      </div></Card>}

      {showForm&&<Modal title={editing?"Edit Customer":"Add Customer"} onClose={()=>setShowForm(false)}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
          <Inp label="Full Name" value={form.name} onChange={v=>upd("name",v)} placeholder="Mohammad Asif"/>
          <Inp label="Company" value={form.company} onChange={v=>upd("company",v)} placeholder="ABC Trading"/>
          <Inp label="Email" value={form.email} onChange={v=>upd("email",v)} placeholder="email@company.com"/>
          <Inp label="Phone" value={form.phone} onChange={v=>upd("phone",v)} placeholder="+1 234 567 8900"/>
          <Inp label="Address" value={form.address} onChange={v=>upd("address",v)} placeholder="Full address"/>
          <Inp label="Country" value={form.country} onChange={v=>upd("country",v)} placeholder="UAE"/>
        </div>
        <Inp label="Notes" value={form.notes} onChange={v=>upd("notes",v)} placeholder="VIP customer..." style={{marginTop:14}}/>
        <div style={{display:"flex",justifyContent:"space-between",marginTop:20}}>
          <div>{editing&&<Btn v="danger" onClick={()=>del(editing)}>Delete</Btn>}</div>
          <div style={{display:"flex",gap:8}}><Btn v="secondary" onClick={()=>setShowForm(false)}>Cancel</Btn><Btn onClick={save}>{editing?"Save Changes":"Add Customer"}</Btn></div>
        </div>
      </Modal>}

      {viewStmt&&<StatementView customer={viewStmt} data={data} onClose={()=>setViewStmt(null)}/>}
    </div>
  );
}

// ─── Statement of Account ─────────────────────────────────────
function StatementView({customer,data,onClose}){
  const ref=useRef();
  const custInvs=data.invoices.filter(i=>i.customer?.toLowerCase()===customer.name.toLowerCase());
  const custPays=data.payments.filter(py=>custInvs.some(i=>i.id===py.invoiceId));
  const txns=[];
  custInvs.forEach(inv=>{txns.push({date:inv.date,type:"Invoice",ref:inv.invoiceNum,debit:invGrandTotal(inv),credit:0});});
  custPays.forEach(py=>{const inv=custInvs.find(i=>i.id===py.invoiceId);txns.push({date:py.date,type:"Payment",ref:inv?inv.invoiceNum:py.reference||"—",debit:0,credit:p(py.amount),method:py.method});});
  txns.sort((a,b)=>a.date.localeCompare(b.date));
  let running=0;const txnsWithBal=txns.map(t=>{running+=t.debit-t.credit;return{...t,balance:running};});
  const totalDebit=txns.reduce((s,t)=>s+t.debit,0);const totalCredit=txns.reduce((s,t)=>s+t.credit,0);
  const co=data.companyInfo||defaultData().companyInfo;

  const handlePrint=()=>{const el=ref.current;if(!el)return;const w=window.open("","_blank");w.document.write(`<html><head><title>Statement - ${customer.name}</title><link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800;900&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet"><style>body{margin:0;padding:20px;font-family:'DM Sans',sans-serif;font-size:12px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:6px 8px;font-size:11px}</style></head><body>${el.outerHTML}</body></html>`);w.document.close();setTimeout(()=>w.print(),500);};

  return(
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(15,23,42,.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:16,backdropFilter:"blur(6px)"}}>
      <div onClick={e=>e.stopPropagation()} style={{background:C.slate100,borderRadius:20,padding:24,maxWidth:800,width:"100%",maxHeight:"94vh",overflowY:"auto",boxShadow:C.shadowXl}}>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:16}}>
          <h3 style={{margin:0,color:C.slate800,fontSize:18,fontWeight:700}}>Statement of Account — {customer.name}</h3>
          <div style={{display:"flex",gap:8}}><Btn v="teal" onClick={handlePrint}>Print</Btn><Btn v="ghost" onClick={onClose}>✕</Btn></div>
        </div>
        <div ref={ref} style={{background:"#fff",borderRadius:4,padding:40,fontFamily:"'DM Sans',sans-serif",fontSize:12}}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:24}}>
            <div><img src="/logo.png" alt="Sayarah Logistics" style={{height:50,objectFit:"contain",marginBottom:6}}/><div style={{fontSize:9,color:C.slate400,letterSpacing:".1em"}}>POWERED BY SAYARAH INC</div><div style={{fontSize:10,color:C.slate400,marginTop:6,lineHeight:1.7}}>{co.name}<br/>{co.address}<br/>{co.city}</div></div>
            <div style={{textAlign:"right"}}><div style={{fontSize:20,fontWeight:900,color:C.brandRed}}>STATEMENT</div><div style={{fontSize:11,marginTop:6,lineHeight:1.8}}><div>Date: {today()}</div><div>Customer: <b>{customer.name}</b></div>{customer.address&&<div>{customer.address}</div>}{customer.phone&&<div>{customer.phone}</div>}</div></div>
          </div>
          <table style={{width:"100%",borderCollapse:"collapse",marginBottom:20,fontSize:11}}>
            <thead><tr style={{background:"#E5E7EB"}}><th style={{border:"1px solid #ccc",padding:"8px",textAlign:"left"}}>Date</th><th style={{border:"1px solid #ccc",padding:"8px",textAlign:"left"}}>Type</th><th style={{border:"1px solid #ccc",padding:"8px",textAlign:"left"}}>Reference</th><th style={{border:"1px solid #ccc",padding:"8px",textAlign:"right"}}>Debit (USD)</th><th style={{border:"1px solid #ccc",padding:"8px",textAlign:"right"}}>Credit (USD)</th><th style={{border:"1px solid #ccc",padding:"8px",textAlign:"right"}}>Balance</th></tr></thead>
            <tbody>
              {txnsWithBal.map((t,i)=><tr key={i} style={{background:t.type==="Payment"?"#F0FDF4":"#fff"}}>
                <td style={{border:"1px solid #ccc",padding:"6px 8px"}}>{t.date}</td>
                <td style={{border:"1px solid #ccc",padding:"6px 8px",fontWeight:600}}>{t.type}</td>
                <td style={{border:"1px solid #ccc",padding:"6px 8px",fontFamily:"'DM Mono',monospace"}}>{t.ref}{t.method?` (${t.method})`:""}</td>
                <td style={{border:"1px solid #ccc",padding:"6px 8px",textAlign:"right",fontFamily:"'DM Mono',monospace"}}>{t.debit>0?f$2(t.debit):""}</td>
                <td style={{border:"1px solid #ccc",padding:"6px 8px",textAlign:"right",fontFamily:"'DM Mono',monospace",color:C.emerald}}>{t.credit>0?f$2(t.credit):""}</td>
                <td style={{border:"1px solid #ccc",padding:"6px 8px",textAlign:"right",fontFamily:"'DM Mono',monospace",fontWeight:700}}>{f$2(t.balance)}</td>
              </tr>)}
              <tr style={{background:"#FEE2E2",fontWeight:800}}>
                <td colSpan={3} style={{border:"1px solid #ccc",padding:"8px",color:C.brandRed}}>TOTALS</td>
                <td style={{border:"1px solid #ccc",padding:"8px",textAlign:"right",fontFamily:"'DM Mono',monospace"}}>{f$2(totalDebit)}</td>
                <td style={{border:"1px solid #ccc",padding:"8px",textAlign:"right",fontFamily:"'DM Mono',monospace",color:C.emerald}}>{f$2(totalCredit)}</td>
                <td style={{border:"1px solid #ccc",padding:"8px",textAlign:"right",fontFamily:"'DM Mono',monospace",fontSize:14,color:C.brandRed}}>{f$2(running)}</td>
              </tr>
            </tbody>
          </table>
          <div style={{textAlign:"center",fontSize:10,color:C.slate400,borderTop:"1px solid #E5E7EB",paddingTop:12}}>{co.name} · {co.email} · {co.phone}</div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// VEHICLES TAB — With Timeline & Bulk Actions
// ═══════════════════════════════════════════════════════════════
function VehiclesTab({data,setData,role,username,userEmail}){
  const[showForm,setShowForm]=useState(false);const[editing,setEditing]=useState(null);const[confirm,setConfirm]=useState(null);const[filter,setFilter]=useState("all");const[search,setSearch]=useState("");const[selected,setSelected]=useState(new Set());const[bulkStatus,setBulkStatus]=useState("");
  const[uploading,setUploading]=useState(false);const[uploadMsg,setUploadMsg]=useState("");const[viewPhoto,setViewPhoto]=useState(null);
  const photoInputRef=useRef(null);const titleInputRef=useRef(null);
  const empty=()=>({id:gid(),vehicleNum:String(data.nextVehicleNum).padStart(3,"0"),year:"",make:"",model:"",trim:"",vin:"",color:"",lotNumber:"",auctionSource:"",purchasePrice:"",vehicleType:"sedan",isRunning:true,status:"purchased",portLocation:"NJ",destination:"UAE",titleStatus:"Without Title",containerNum:"",customer:"",customerEmail:"",notes:"",dateAdded:today(),bookingNumber:"",blNumber:"",timeline:[],photos:[],titleDocs:[]});
  const[form,setForm]=useState(empty());const upd=(k,v)=>setForm(f=>({...f,[k]:v}));

  // File upload handler
  const handleFileUpload=async(files,type)=>{
    if(!files||files.length===0||!FIREBASE_ENABLED)return;
    setUploading(true);setUploadMsg(`Uploading ${files.length} file(s)...`);
    try{
      const urls=[];
      for(const file of files){
        const ext=file.name.split(".").pop();
        const path=`vehicles/${form.vehicleNum}/${type}/${gid()}.${ext}`;
        const url=await uploadFile(path,file);
        urls.push({id:gid(),url,name:file.name,path,uploadedAt:new Date().toISOString()});
      }
      if(type==="photos")setForm(f=>({...f,photos:[...(f.photos||[]),...urls]}));
      else setForm(f=>({...f,titleDocs:[...(f.titleDocs||[]),...urls]}));
      setUploadMsg(`${urls.length} file(s) uploaded!`);setTimeout(()=>setUploadMsg(""),2000);
    }catch(e){setUploadMsg("Upload failed: "+e.message);}
    setUploading(false);
  };

  const removeFile=async(fileObj,type)=>{
    if(FIREBASE_ENABLED&&fileObj.path){try{await deleteFile(fileObj.path);}catch{}}
    if(type==="photos")setForm(f=>({...f,photos:(f.photos||[]).filter(x=>x.id!==fileObj.id)}));
    else setForm(f=>({...f,titleDocs:(f.titleDocs||[]).filter(x=>x.id!==fileObj.id)}));
  };
  const save=()=>{
    if(!form.make&&!form.model&&!form.vin)return;
    const oldV=editing?data.vehicles.find(v=>v.id===editing):null;
    let newForm={...form};
    if(oldV&&oldV.status!==form.status){newForm.timeline=[...(newForm.timeline||[]),{date:new Date().toISOString(),from:oldV.status,to:form.status,by:username||"admin"}];}
    if(editing)setData(d=>({...d,vehicles:d.vehicles.map(v=>v.id===editing?newForm:v)}));
    else{newForm.timeline=[{date:new Date().toISOString(),from:"",to:form.status,by:username||"admin"}];setData(d=>({...d,vehicles:[...d.vehicles,newForm],nextVehicleNum:d.nextVehicleNum+1}));}
    setShowForm(false);
  };
  const del=id=>{setData(d=>({...d,vehicles:d.vehicles.filter(v=>v.id!==id)}));setConfirm(null);setShowForm(false);};
  const bulkUpdate=()=>{if(!bulkStatus||selected.size===0)return;setData(d=>({...d,vehicles:d.vehicles.map(v=>{if(!selected.has(v.id))return v;return{...v,status:bulkStatus,timeline:[...(v.timeline||[]),{date:new Date().toISOString(),from:v.status,to:bulkStatus,by:username||"admin"}]};})}));setSelected(new Set());setBulkStatus("");logActivity(setData,username||"admin","Bulk Update",`${selected.size} vehicles → ${bulkStatus}`);};

  const custNames=useMemo(()=>{if(!userEmail)return[];return(data.customers||[]).filter(c=>c.email?.toLowerCase()===userEmail.toLowerCase()).map(c=>c.name.toLowerCase());},[data.customers,userEmail]);
  const matchCust=v=>{const un=username.toLowerCase();if(userEmail&&v.customerEmail?.toLowerCase()===userEmail.toLowerCase())return true;if(v.customer?.toLowerCase()===un)return true;if(custNames.some(n=>v.customer?.toLowerCase()===n))return true;return false;};
  const allV=role==="customer"?data.vehicles.filter(matchCust):data.vehicles;
  let filt=filter==="all"?allV:allV.filter(v=>v.status===filter);
  if(search){const s=search.toLowerCase();filt=filt.filter(v=>`${v.year} ${v.make} ${v.model} ${v.vin} ${v.lotNumber} ${v.vehicleNum} ${v.customer} ${v.containerNum}`.toLowerCase().includes(s));}

  const toggleSelect=id=>{const n=new Set(selected);n.has(id)?n.delete(id):n.add(id);setSelected(n);};
  const selectAll=()=>{if(selected.size===filt.length)setSelected(new Set());else setSelected(new Set(filt.map(v=>v.id)));};

  // ─── CUSTOMER TRACKING VIEW ───
  if(role==="customer"){
    const custStatusIndex=(key)=>STATUSES.findIndex(s=>s.key===key);
    return(
      <div>
        <PageHeader title="My Shipments" subtitle={`Tracking ${allV.length} vehicle${allV.length!==1?"s":""}`}>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search..." style={{...iS,width:200,padding:"8px 14px",fontSize:12}}/>
        </PageHeader>

        {filt.length===0?<Empty icon="🚗" title="No shipments" sub="No vehicles are assigned to your account yet"/>:
        <div style={{display:"flex",flexDirection:"column",gap:16}}>
          {filt.map(v=>{
            const si=custStatusIndex(v.status);const sInfo=STATUSES.find(s=>s.key===v.status)||STATUSES[0];
            const port=PORTS.find(x=>x.code===v.portLocation);const dest=DESTS.find(d=>d.code===v.destination);
            return(
              <Card key={v.id} style={{padding:0,overflow:"hidden",borderLeft:`4px solid ${sInfo.color}`}}>
                {/* Vehicle header */}
                <div style={{padding:"16px 20px",display:"flex",justifyContent:"space-between",alignItems:"start",flexWrap:"wrap",gap:12}}>
                  <div style={{display:"flex",gap:14,alignItems:"center"}}>
                    {(v.photos||[]).length>0?<img src={v.photos[0].url} alt="" style={{width:64,height:48,borderRadius:8,objectFit:"cover",border:"1px solid "+C.slate200}}/>
                    :<div style={{width:64,height:48,borderRadius:8,background:C.slate100,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20}}>🚗</div>}
                    <div>
                      <div style={{fontSize:16,fontWeight:800,color:C.slate800}}>{v.year} {v.make} {v.model}</div>
                      <div style={{fontSize:11,color:C.slate500,marginTop:2}}>
                        <span style={{...MO,color:C.red,fontWeight:700}}>#{v.vehicleNum}</span>
                        {v.vin&&<span> · VIN: {v.vin.slice(-8)}</span>}
                        {v.color&&<span> · {v.color}</span>}
                      </div>
                    </div>
                  </div>
                  <SBdg statusKey={v.status}/>
                </div>

                {/* Route info */}
                <div style={{padding:"0 20px 12px",display:"flex",gap:20,flexWrap:"wrap",fontSize:12,color:C.slate600}}>
                  <div><span style={{color:C.slate400,fontSize:10,fontWeight:600}}>FROM</span><div style={{fontWeight:700}}>{port?.name||v.portLocation}, USA</div></div>
                  <div style={{display:"flex",alignItems:"center",color:C.slate300,fontSize:18}}>→</div>
                  <div><span style={{color:C.slate400,fontSize:10,fontWeight:600}}>TO</span><div style={{fontWeight:700}}>{dest?.name||v.destination}</div></div>
                  {v.containerNum&&<div><span style={{color:C.slate400,fontSize:10,fontWeight:600}}>CONTAINER</span><div style={{fontWeight:600,...MO}}>{v.containerNum}</div></div>}
                  <div><span style={{color:C.slate400,fontSize:10,fontWeight:600}}>TITLE</span><div><Bdg color={v.titleStatus==="With Title"?C.emerald:C.amber} bg={v.titleStatus==="With Title"?C.emeraldLight:C.amberLight}>{v.titleStatus}</Bdg></div></div>
                  {(v.photos||[]).length>0&&<div><span style={{color:C.slate400,fontSize:10,fontWeight:600}}>PHOTOS</span><div style={{display:"flex",gap:3,marginTop:2}}>{v.photos.slice(0,4).map(ph=><img key={ph.id} src={ph.url} alt="" onClick={()=>setViewPhoto(ph.url)} style={{width:28,height:28,borderRadius:4,objectFit:"cover",cursor:"pointer",border:"1px solid "+C.slate200}}/>)}{v.photos.length>4&&<span style={{fontSize:10,color:C.slate400,alignSelf:"center"}}>+{v.photos.length-4}</span>}</div></div>}
                </div>

                {/* Tracking timeline — horizontal stepper */}
                <div style={{background:C.slate50,padding:"14px 20px",borderTop:"1px solid "+C.slate200}}>
                  <div style={{fontSize:10,fontWeight:700,color:C.slate500,textTransform:"uppercase",letterSpacing:".06em",marginBottom:10}}>Shipment Progress</div>
                  <div style={{display:"flex",alignItems:"center",gap:0,overflowX:"auto",paddingBottom:4}}>
                    {STATUSES.map((st,idx)=>{
                      const done=idx<=si;const current=idx===si;
                      return <div key={st.key} style={{display:"flex",alignItems:"center",flex:idx<STATUSES.length-1?"1":"0"}}>
                        <div style={{display:"flex",flexDirection:"column",alignItems:"center",minWidth:28}}>
                          <div style={{width:current?28:20,height:current?28:20,borderRadius:"50%",background:done?st.color:C.slate200,display:"flex",alignItems:"center",justifyContent:"center",fontSize:current?12:9,transition:"all .3s",boxShadow:current?`0 0 0 4px ${st.bg}`:undefined}}>{done?<span style={{color:"#fff",fontSize:current?11:8}}>{current?st.icon:"✓"}</span>:<span style={{color:C.slate400,fontSize:7}}>○</span>}</div>
                          <div style={{fontSize:7,color:done?st.color:C.slate300,marginTop:3,fontWeight:done?700:400,textAlign:"center",lineHeight:1.1,maxWidth:52,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{st.label}</div>
                        </div>
                        {idx<STATUSES.length-1&&<div style={{flex:1,height:2,background:idx<si?STATUSES[idx+1].color:C.slate200,transition:"background .3s",marginBottom:14,minWidth:8}}/>}
                      </div>;
                    })}
                  </div>
                </div>

                {/* Timeline history */}
                {(v.timeline||[]).length>0&&<div style={{padding:"10px 20px 14px",borderTop:"1px solid "+C.slate100}}>
                  <div style={{fontSize:10,fontWeight:600,color:C.slate400,marginBottom:6}}>History</div>
                  <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                    {[...(v.timeline||[])].reverse().slice(0,5).map((t,i)=><div key={i} style={{fontSize:10,color:C.slate500,background:C.slate50,padding:"3px 8px",borderRadius:4,border:"1px solid "+C.slate200}}>
                      <span style={{color:C.slate400}}>{new Date(t.date).toLocaleDateString()}</span> {t.from&&<><SBdg statusKey={t.from}/> → </>}<SBdg statusKey={t.to}/>
                    </div>)}
                  </div>
                </div>}
              </Card>
            );
          })}
        </div>}

        {/* Photo Lightbox */}
        {viewPhoto&&<div onClick={()=>setViewPhoto(null)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.85)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1200,cursor:"pointer",backdropFilter:"blur(8px)"}}>
          <div style={{position:"relative",maxWidth:"90vw",maxHeight:"90vh"}}>
            <img src={viewPhoto} alt="Vehicle" style={{maxWidth:"90vw",maxHeight:"85vh",borderRadius:12,objectFit:"contain",boxShadow:"0 20px 60px rgba(0,0,0,.5)"}}/>
            <button onClick={()=>setViewPhoto(null)} style={{position:"absolute",top:-12,right:-12,width:32,height:32,borderRadius:"50%",background:C.white,border:"none",fontSize:16,cursor:"pointer",boxShadow:"0 4px 12px rgba(0,0,0,.3)",display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
          </div>
        </div>}
      </div>
    );
  }

  // ─── ADMIN VIEW ───
  return(
    <div>
      <PageHeader title="Vehicles" subtitle={`${allV.length} vehicles tracked`}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search VIN, make, customer..." style={{...iS,width:240,padding:"8px 14px",fontSize:12}}/>
        <Btn onClick={()=>{setForm(empty());setEditing(null);setShowForm(true);}}>+ Add Vehicle</Btn>
      </PageHeader>

      <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:16}}>
        <Btn v={filter==="all"?"primary":"secondary"} s="sm" onClick={()=>setFilter("all")}>All ({allV.length})</Btn>
        {STATUSES.map(s=>{const ct=allV.filter(v=>v.status===s.key).length;return ct>0&&<Btn key={s.key} v={filter===s.key?"primary":"secondary"} s="sm" onClick={()=>setFilter(s.key)}>{s.icon} {ct}</Btn>;})}
      </div>

      {/* Bulk Actions */}
      {selected.size>0&&<Card style={{marginBottom:14,padding:"12px 18px",background:C.red50,border:"1px solid "+C.redLight}}>
        <div style={{display:"flex",alignItems:"center",gap:10,fontSize:13}}>
          <span style={{fontWeight:700,color:C.red}}>{selected.size} selected</span>
          <Sel value={bulkStatus} onChange={setBulkStatus} options={STATUSES.map(s=>({value:s.key,label:s.label}))} placeholder="Change status to..." style={{minWidth:200}}/>
          <Btn v="teal" s="sm" onClick={bulkUpdate} disabled={!bulkStatus}>Apply</Btn>
          <Btn v="ghost" s="sm" onClick={()=>setSelected(new Set())}>Clear</Btn>
        </div>
      </Card>}

      {filt.length===0?<Empty icon="🚗" title="No vehicles" sub="Add vehicles to start tracking"/>:
      <Card style={{padding:0,overflow:"hidden",borderRadius:16}}><div style={{overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
          <thead><tr>
            <th style={{padding:"12px 8px",width:36,background:C.white,position:"sticky",top:0,zIndex:1,borderBottom:"2px solid "+C.slate200}}><input type="checkbox" checked={selected.size===filt.length&&filt.length>0} onChange={selectAll} style={{accentColor:C.red}}/></th>
            <TH>#</TH><TH>Vehicle</TH><TH>VIN</TH><TH>Customer</TH><TH>Port</TH><TH>Dest</TH><TH>Title</TH><TH>Files</TH><TH>Container</TH><TH>Status</TH>
          </tr></thead>
          <tbody>{filt.map((v,i)=>(
            <tr key={v.id} style={{borderBottom:"1px solid "+C.slate100,cursor:"pointer",background:i%2===0?"transparent":C.slate50,transition:"background .15s"}} onClick={()=>{setForm({...v,timeline:v.timeline||[],photos:v.photos||[],titleDocs:v.titleDocs||[]});setEditing(v.id);setShowForm(true);}}
              onMouseEnter={e=>e.currentTarget.style.background=C.slate50} onMouseLeave={e=>e.currentTarget.style.background=i%2===0?"transparent":C.slate50}>
              <td style={{padding:"10px 8px",textAlign:"center"}}><input type="checkbox" checked={selected.has(v.id)} onChange={e=>{e.stopPropagation();toggleSelect(v.id);}} style={{accentColor:C.red}}/></td>
              <TD style={{color:C.blue,fontWeight:700,...MO}}>{v.vehicleNum}</TD>
              <TD>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  {(v.photos||[]).length>0&&<img src={v.photos[0].url} alt="" style={{width:36,height:36,borderRadius:6,objectFit:"cover",border:"1px solid "+C.slate200}}/>}
                  <div><div style={{fontWeight:600,color:C.slate800}}>{v.year} {v.make} {v.model}</div><div style={{fontSize:10,color:C.slate400}}>{v.color}{v.vehicleType!=="sedan"?` · ${v.vehicleType}`:""}</div></div>
                </div>
              </TD>
              <TD style={{...MO,fontSize:11,color:C.slate500}}>{v.vin?v.vin.slice(-8):"—"}</TD>
              <TD style={{fontSize:12}}>{v.customer||"—"}</TD>
              <TD><Bdg color={C.blue} bg={C.blueLight}>{PORTS.find(x=>x.code===v.portLocation)?.name||v.portLocation}</Bdg></TD>
              <TD style={{fontSize:11}}>{v.destination||"—"}</TD>
              <TD><Bdg color={v.titleStatus==="With Title"?C.emerald:C.red} bg={v.titleStatus==="With Title"?C.emeraldLight:C.redLight}>{v.titleStatus}</Bdg></TD>
              <TD><div style={{display:"flex",gap:6,fontSize:10}}>
                {(v.photos||[]).length>0&&<span style={{color:C.blue,fontWeight:600}}>📷{v.photos.length}</span>}
                {(v.titleDocs||[]).length>0&&<span style={{color:C.emerald,fontWeight:600}}>📋{v.titleDocs.length}</span>}
                {!(v.photos||[]).length&&!(v.titleDocs||[]).length&&<span style={{color:C.slate300}}>—</span>}
              </div></TD>
              <TD style={{...MO,fontSize:11,fontWeight:600,color:C.slate500}}>{v.containerNum||"—"}</TD>
              <TD><SBdg statusKey={v.status}/></TD>
            </tr>
          ))}</tbody>
        </table>
      </div></Card>}

      {/* Vehicle Form */}
      {showForm&&<Modal title={editing?"Edit Vehicle":"Add Vehicle"} onClose={()=>setShowForm(false)} wide>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(130px,1fr))",gap:12}}>
          <Inp label="# " value={form.vehicleNum} readOnly onChange={v=>upd("vehicleNum",v)}/>
          <Inp label="Year" value={form.year} onChange={v=>upd("year",v)} type="number" placeholder="2022"/>
          <Inp label="Make" value={form.make} onChange={v=>upd("make",v)} placeholder="Toyota"/>
          <Inp label="Model" value={form.model} onChange={v=>upd("model",v)} placeholder="Camry"/>
          <Inp label="Color" value={form.color} onChange={v=>upd("color",v)}/>
          <Inp label="VIN" value={form.vin} onChange={v=>upd("vin",v)} placeholder="Full VIN"/>
          <Inp label="Lot #" value={form.lotNumber} onChange={v=>upd("lotNumber",v)}/>
          <Sel label="Customer" value={form.customer} onChange={v=>{upd("customer",v);const c=(data.customers||[]).find(x=>x.name===v);if(c)upd("customerEmail",c.email||"");}} options={(data.customers||[]).map(c=>c.name)} placeholder="Select..."/>
        </div>
        <div style={{borderTop:"1px solid "+C.slate200,margin:"16px 0",paddingTop:16}}>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(145px,1fr))",gap:12}}>
            <Inp label="Purchase $" value={form.purchasePrice} onChange={v=>upd("purchasePrice",v)} type="number" step=".01"/>
            <Sel label="Type" value={form.vehicleType} onChange={v=>upd("vehicleType",v)} options={VTYPES.map(t=>({value:t,label:t[0].toUpperCase()+t.slice(1)}))}/>
            <Sel label="Port" value={form.portLocation} onChange={v=>upd("portLocation",v)} options={PORTS.map(x=>({value:x.code,label:x.full}))}/>
            <Sel label="Destination" value={form.destination} onChange={v=>upd("destination",v)} options={DESTS.map(d=>({value:d.code,label:`${d.name} (${d.code})`}))}/>
            <Sel label="Title" value={form.titleStatus} onChange={v=>upd("titleStatus",v)} options={TITLE_STATUSES}/>
            <Sel label="Status" value={form.status} onChange={v=>upd("status",v)} options={STATUSES.map(s=>({value:s.key,label:`${s.icon} ${s.label}`}))}/>
            <Inp label="Container" value={form.containerNum} onChange={v=>upd("containerNum",v)}/>
            <Inp label="Booking #" value={form.bookingNumber} onChange={v=>upd("bookingNumber",v)}/>
            <Inp label="B/L" value={form.blNumber} onChange={v=>upd("blNumber",v)}/>
            <Inp label="Auction" value={form.auctionSource} onChange={v=>upd("auctionSource",v)} placeholder="Copart, IAAI"/>
          </div>
        </div>

        {/* ── Vehicle Photos ── */}
        <div style={{borderTop:"1px solid "+C.slate200,margin:"16px 0",paddingTop:16}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <div><div style={{fontSize:13,fontWeight:700,color:C.slate800}}>📸 Vehicle Photos</div><div style={{fontSize:11,color:C.slate400}}>Upload photos of the vehicle (JPG, PNG, WebP)</div></div>
            <div>
              <input ref={photoInputRef} type="file" accept="image/*" multiple onChange={e=>handleFileUpload(e.target.files,"photos")} style={{display:"none"}}/>
              <Btn v="secondary" s="sm" onClick={()=>photoInputRef.current?.click()} disabled={uploading||!FIREBASE_ENABLED}>+ Upload Photos</Btn>
            </div>
          </div>
          {(form.photos||[]).length>0?(
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))",gap:10}}>
              {(form.photos||[]).map(ph=>(
                <div key={ph.id} style={{position:"relative",borderRadius:10,overflow:"hidden",border:"1px solid "+C.slate200,background:C.slate50,cursor:"pointer"}} onClick={()=>setViewPhoto(ph.url)}>
                  <img src={ph.url} alt={ph.name} style={{width:"100%",height:100,objectFit:"cover",display:"block"}}/>
                  <div style={{padding:"6px 8px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <span style={{fontSize:9,color:C.slate500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:90}}>{ph.name}</span>
                    <button onClick={e=>{e.stopPropagation();removeFile(ph,"photos");}} style={{background:"none",border:"none",color:C.red,cursor:"pointer",fontSize:13,padding:0,lineHeight:1}}>✕</button>
                  </div>
                </div>
              ))}
            </div>
          ):(
            <div style={{border:"2px dashed "+C.slate200,borderRadius:12,padding:"24px 16px",textAlign:"center",cursor:FIREBASE_ENABLED?"pointer":"default"}} onClick={()=>FIREBASE_ENABLED&&photoInputRef.current?.click()}>
              <div style={{fontSize:28,marginBottom:4}}>📷</div>
              <div style={{fontSize:12,color:C.slate400,fontWeight:600}}>No photos yet</div>
              <div style={{fontSize:10,color:C.slate300,marginTop:2}}>{FIREBASE_ENABLED?"Click to upload or drag & drop":"Enable Firebase to upload files"}</div>
            </div>
          )}
        </div>

        {/* ── Title Documents ── */}
        <div style={{borderTop:"1px solid "+C.slate200,margin:"16px 0",paddingTop:16}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <div><div style={{fontSize:13,fontWeight:700,color:C.slate800}}>📋 Title Documents</div><div style={{fontSize:11,color:C.slate400}}>Attach title scans, registration docs (PDF, JPG, PNG)</div></div>
            <div>
              <input ref={titleInputRef} type="file" accept="image/*,.pdf" multiple onChange={e=>handleFileUpload(e.target.files,"titles")} style={{display:"none"}}/>
              <Btn v="secondary" s="sm" onClick={()=>titleInputRef.current?.click()} disabled={uploading||!FIREBASE_ENABLED}>+ Upload Title</Btn>
            </div>
          </div>
          {(form.titleDocs||[]).length>0?(
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              {(form.titleDocs||[]).map(td=>(
                <div key={td.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 14px",borderRadius:10,border:"1px solid "+C.slate200,background:C.slate50}}>
                  <div style={{display:"flex",alignItems:"center",gap:10}}>
                    <div style={{width:36,height:36,borderRadius:8,background:td.name?.toLowerCase().endsWith(".pdf")?C.redLight:C.blueLight,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16}}>{td.name?.toLowerCase().endsWith(".pdf")?"📄":"🖼️"}</div>
                    <div>
                      <div style={{fontSize:12,fontWeight:600,color:C.slate700}}>{td.name}</div>
                      <div style={{fontSize:10,color:C.slate400}}>{new Date(td.uploadedAt).toLocaleDateString()}</div>
                    </div>
                  </div>
                  <div style={{display:"flex",gap:6,alignItems:"center"}}>
                    <a href={td.url} target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()} style={{fontSize:11,color:C.blue,fontWeight:600,textDecoration:"none"}}>View</a>
                    <button onClick={()=>removeFile(td,"titles")} style={{background:"none",border:"none",color:C.red,cursor:"pointer",fontSize:13,padding:0}}>✕</button>
                  </div>
                </div>
              ))}
            </div>
          ):(
            <div style={{border:"2px dashed "+C.slate200,borderRadius:12,padding:"24px 16px",textAlign:"center",cursor:FIREBASE_ENABLED?"pointer":"default"}} onClick={()=>FIREBASE_ENABLED&&titleInputRef.current?.click()}>
              <div style={{fontSize:28,marginBottom:4}}>📋</div>
              <div style={{fontSize:12,color:C.slate400,fontWeight:600}}>No title documents</div>
              <div style={{fontSize:10,color:C.slate300,marginTop:2}}>{FIREBASE_ENABLED?"Click to upload title scans":"Enable Firebase to upload files"}</div>
            </div>
          )}
        </div>

        {/* Upload status message */}
        {uploadMsg&&<div style={{background:uploadMsg.includes("failed")?C.redLight:C.emeraldLight,color:uploadMsg.includes("failed")?C.red:C.emeraldDark,padding:"8px 14px",borderRadius:8,fontSize:12,fontWeight:600,marginTop:8}}>{uploading?"⏳ ":""}{uploadMsg}</div>}

        {/* Timeline */}
        {editing&&form.timeline&&form.timeline.length>0&&<div style={{marginTop:16,background:C.slate50,borderRadius:12,padding:16}}>
          <div style={{fontSize:12,fontWeight:700,color:C.teal,marginBottom:10}}>Status Timeline</div>
          {form.timeline.slice().reverse().map((t,i)=><div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"6px 0",borderBottom:"1px solid "+C.slate200,fontSize:12}}>
            <span style={{color:C.slate400,minWidth:140,fontSize:11}}>{new Date(t.date).toLocaleString()}</span>
            {t.from&&<SBdg statusKey={t.from}/>}<span style={{color:C.slate300}}>→</span><SBdg statusKey={t.to}/>
            <span style={{color:C.slate400,fontSize:11}}>by {t.by}</span>
          </div>)}
        </div>}
        <div style={{display:"flex",justifyContent:"space-between",marginTop:20}}>
          <div>{editing&&<Btn v="danger" onClick={()=>setConfirm(editing)}>Delete</Btn>}</div>
          <div style={{display:"flex",gap:8}}><Btn v="secondary" onClick={()=>setShowForm(false)}>Cancel</Btn><Btn onClick={save}>{editing?"Save Changes":"Add Vehicle"}</Btn></div>
        </div>
      </Modal>}

      {/* Photo Lightbox */}
      {viewPhoto&&<div onClick={()=>setViewPhoto(null)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.85)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1200,cursor:"pointer",backdropFilter:"blur(8px)"}}>
        <div style={{position:"relative",maxWidth:"90vw",maxHeight:"90vh"}}>
          <img src={viewPhoto} alt="Vehicle" style={{maxWidth:"90vw",maxHeight:"85vh",borderRadius:12,objectFit:"contain",boxShadow:"0 20px 60px rgba(0,0,0,.5)"}}/>
          <button onClick={()=>setViewPhoto(null)} style={{position:"absolute",top:-12,right:-12,width:32,height:32,borderRadius:"50%",background:C.white,border:"none",fontSize:16,cursor:"pointer",boxShadow:"0 4px 12px rgba(0,0,0,.3)",display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
        </div>
      </div>}

      {confirm&&<ConfirmDlg msg="Delete this vehicle?" onOk={()=>del(confirm)} onCancel={()=>setConfirm(null)}/>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// CONTAINERS — With Demurrage Calculator
// ═══════════════════════════════════════════════════════════════
function ContainersTab({data,setData}){
  const[showForm,setShowForm]=useState(false);const[editing,setEditing]=useState(null);const[confirm,setConfirm]=useState(null);
  const empty=()=>({id:gid(),containerNum:`CONT-${String(data.nextContainerNum).padStart(3,"0")}`,containerType:"40ft Standard",shippingLine:"",bookingNumber:"",blNumber:"",sealNumber:"",portOrigin:"NJ",destination:"UAE",status:"Empty",departureDate:"",arrivalDate:"",freeDaysStart:"",notes:""});
  const[form,setForm]=useState(empty());const upd=(k,v)=>setForm(f=>({...f,[k]:v}));
  const save=()=>{if(editing)setData(d=>({...d,containers:d.containers.map(c=>c.id===editing?form:c)}));else setData(d=>({...d,containers:[...d.containers,form],nextContainerNum:d.nextContainerNum+1}));setShowForm(false);};
  const del=id=>{setData(d=>({...d,containers:d.containers.filter(c=>c.id!==id)}));setConfirm(null);setShowForm(false);};

  return(
    <div>
      <PageHeader title="Containers" subtitle={`${data.containers.length} containers`}>
        <Btn onClick={()=>{setForm(empty());setEditing(null);setShowForm(true);}}>+ Add Container</Btn>
      </PageHeader>
      {data.containers.length===0?<Empty icon="📦" title="No containers" sub="Create your first container booking"/>:
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(360px,1fr))",gap:14}}>
        {data.containers.map(c=>{
          const vIn=data.vehicles.filter(v=>v.containerNum===c.containerNum);
          const cap=c.containerType==="20ft Standard"?4:c.containerType==="RoRo"?1:c.containerType==="Flat Rack"?2:6;
          const daysAtPort=c.arrivalDate?daysAgo(c.arrivalDate):0;
          const dem=c.arrivalDate&&c.status==="Arrived"?calcDemurrage(c.shippingLine,daysAtPort):null;
          const statusColor=c.status==="In Transit"?C.teal:c.status==="Arrived"?C.amber:C.blue;
          return(
            <Card key={c.id} style={{cursor:"pointer",padding:18,borderLeft:`4px solid ${statusColor}`,transition:"box-shadow .2s"}} onClick={()=>{setForm({...c});setEditing(c.id);setShowForm(true);}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
                <div><div style={{fontSize:16,fontWeight:700,...MO,color:C.slate800}}>{c.containerNum}</div><div style={{fontSize:11,color:C.slate400,marginTop:2}}>{c.containerType} · {c.shippingLine||"—"}</div></div>
                <Bdg color={statusColor} bg={statusColor+"20"}>{c.status}</Bdg>
              </div>
              <div style={{fontSize:11,color:C.slate400,marginBottom:8}}>{PORTS.find(x=>x.code===c.portOrigin)?.name} → {DESTS.find(d=>d.code===c.destination)?.name}</div>
              {c.departureDate&&<div style={{fontSize:11,color:C.slate400}}>ETD: {c.departureDate}{c.arrivalDate?` · ETA: ${c.arrivalDate}`:""}</div>}
              <div style={{display:"flex",justifyContent:"space-between",fontSize:11,marginTop:10,marginBottom:4}}><span style={{color:C.slate500}}>Loaded: {vIn.length}/{cap}</span><span style={{fontWeight:700,color:vIn.length>=cap?C.red:C.emerald}}>{vIn.length>=cap?"FULL":`${cap-vIn.length} left`}</span></div>
              <MiniBar val={vIn.length} max={cap} color={vIn.length>=cap?C.red:C.teal}/>
              {vIn.length>0&&<div style={{marginTop:8,display:"flex",flexWrap:"wrap",gap:4}}>{vIn.map(v=><span key={v.id} style={{fontSize:10,background:C.red50,color:C.blue,padding:"3px 8px",borderRadius:6,fontWeight:600}}>#{v.vehicleNum} {v.make}</span>)}</div>}
              {/* Demurrage Alert */}
              {dem&&dem.overDays>0&&<div style={{marginTop:10,background:C.red50,borderRadius:10,padding:"10px 12px",border:"1px solid #FECACA"}}>
                <div style={{fontSize:11,fontWeight:700,color:C.red,marginBottom:4}}>DEMURRAGE ALERT — {dem.overDays} days over free period</div>
                <div style={{display:"flex",gap:14,fontSize:11,flexWrap:"wrap"}}>
                  <span style={{color:C.slate600}}>Port Storage: <b style={MO}>{f$(dem.portStorage)} AED</b></span>
                  <span style={{color:C.slate600}}>Detention: <b style={MO}>{f$(dem.detention)} AED</b></span>
                  {dem.noc>0&&<span style={{color:C.slate600}}>NOC: <b style={MO}>{f$(dem.noc)} AED</b></span>}
                  <span style={{color:C.red,fontWeight:700}}>Total: <b style={MO}>{f$(dem.total)} AED</b></span>
                </div>
              </div>}
            </Card>
          );
        })}
      </div>}
      {showForm&&<Modal title={editing?"Edit Container":"Add Container"} onClose={()=>setShowForm(false)}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
          <Inp label="Container #" value={form.containerNum} onChange={v=>upd("containerNum",v)} readOnly={!!editing}/>
          <Sel label="Type" value={form.containerType} onChange={v=>upd("containerType",v)} options={CONTAINER_TYPES}/>
          <Inp label="Shipping Line" value={form.shippingLine} onChange={v=>upd("shippingLine",v)} placeholder="MSC, Maersk, CMA CGM..."/>
          <Inp label="Booking #" value={form.bookingNumber} onChange={v=>upd("bookingNumber",v)}/>
          <Inp label="B/L" value={form.blNumber} onChange={v=>upd("blNumber",v)}/>
          <Inp label="Seal #" value={form.sealNumber} onChange={v=>upd("sealNumber",v)}/>
          <Sel label="Port" value={form.portOrigin} onChange={v=>upd("portOrigin",v)} options={PORTS.map(x=>({value:x.code,label:x.full}))}/>
          <Sel label="Destination" value={form.destination} onChange={v=>upd("destination",v)} options={DESTS.map(d=>({value:d.code,label:d.name}))}/>
          <Sel label="Status" value={form.status} onChange={v=>upd("status",v)} options={CONTAINER_STATUSES}/>
          <Inp label="Departure" value={form.departureDate} onChange={v=>upd("departureDate",v)} type="date"/>
          <Inp label="Arrival" value={form.arrivalDate} onChange={v=>upd("arrivalDate",v)} type="date"/>
          <Inp label="Free Days Start" value={form.freeDaysStart} onChange={v=>upd("freeDaysStart",v)} type="date"/>
        </div>
        {/* Demurrage Preview */}
        {form.arrivalDate&&form.shippingLine&&(()=>{const d=calcDemurrage(form.shippingLine,daysAgo(form.arrivalDate));return d.overDays>0?<div style={{background:C.red50,borderRadius:10,padding:14,marginTop:14,border:"1px solid #FECACA",fontSize:12}}>
          <b style={{color:C.red}}>Demurrage Estimate ({form.shippingLine}):</b> {d.overDays} days over · Port: {f$(d.portStorage)} · Det: {f$(d.detention)} · NOC: {f$(d.noc)} · <b>Total: {f$(d.total)} AED</b>
        </div>:<div style={{background:C.emerald50,borderRadius:10,padding:12,marginTop:14,border:"1px solid #BBF7D0",fontSize:12,color:C.emerald}}>Within free days ({daysAgo(form.arrivalDate)} days at port)</div>;})()}
        <div style={{display:"flex",justifyContent:"space-between",marginTop:20}}><div>{editing&&<Btn v="danger" onClick={()=>setConfirm(editing)}>Delete</Btn>}</div><div style={{display:"flex",gap:8}}><Btn v="secondary" onClick={()=>setShowForm(false)}>Cancel</Btn><Btn onClick={save}>{editing?"Save":"Add Container"}</Btn></div></div>
      </Modal>}
      {confirm&&<ConfirmDlg msg="Delete this container?" onOk={()=>del(confirm)} onCancel={()=>setConfirm(null)}/>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// TOWING
// ═══════════════════════════════════════════════════════════════
function TowingTab({data,setData}){
  const[showForm,setShowForm]=useState(false);const[editing,setEditing]=useState(null);const[confirm,setConfirm]=useState(null);
  const empty=()=>({id:gid(),vehicleNum:"",pickupLocation:"",deliveryLocation:"",miles:"",isRunning:true,vehicleType:"sedan",towCompany:"",driverName:"",driverPhone:"",status:"Scheduled",scheduledDate:today(),cost:"",notes:""});
  const[form,setForm]=useState(empty());const upd=(k,v)=>setForm(f=>({...f,[k]:v}));
  const save=()=>{if(editing)setData(d=>({...d,towingJobs:d.towingJobs.map(t=>t.id===editing?form:t)}));else setData(d=>({...d,towingJobs:[...d.towingJobs,form]}));setShowForm(false);};
  const del=id=>{setData(d=>({...d,towingJobs:d.towingJobs.filter(t=>t.id!==id)}));setConfirm(null);setShowForm(false);};
  return(
    <div>
      <PageHeader title="Towing" subtitle={`${data.towingJobs.length} jobs · ${f$(data.towingJobs.reduce((s,t)=>s+p(t.cost),0))} total`}>
        <Btn onClick={()=>{setForm(empty());setEditing(null);setShowForm(true);}}>+ New Tow Job</Btn>
      </PageHeader>
      {data.towingJobs.length===0?<Empty icon="🚛" title="No towing jobs" sub="Schedule your first vehicle pickup"/>:
      <Card style={{padding:0,overflow:"hidden",borderRadius:16}}><div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}><thead><tr>{["Date","Vehicle","Pickup","Delivery","Miles","Company","Cost","Status"].map(h=><TH key={h}>{h}</TH>)}</tr></thead><tbody>
        {[...data.towingJobs].sort((a,b)=>(b.scheduledDate||"").localeCompare(a.scheduledDate||"")).map((t,i)=>{const v=data.vehicles.find(vh=>vh.vehicleNum===t.vehicleNum);return(
          <tr key={t.id} onClick={()=>{setForm({...t});setEditing(t.id);setShowForm(true);}} style={{borderBottom:"1px solid "+C.slate100,cursor:"pointer",background:i%2===0?"transparent":C.slate50,transition:"background .15s"}} onMouseEnter={ev=>ev.currentTarget.style.background=C.slate50} onMouseLeave={ev=>ev.currentTarget.style.background=i%2===0?"transparent":C.slate50}>
            <TD style={{color:C.slate400}}>{t.scheduledDate}</TD><TD><span style={{color:C.blue,fontWeight:700,...MO}}>#{t.vehicleNum}</span>{v&&<div style={{fontSize:10,color:C.slate400}}>{v.year} {v.make}</div>}</TD>
            <TD style={{fontSize:12}}>{t.pickupLocation}</TD><TD style={{fontSize:12}}>{t.deliveryLocation}</TD><TD style={MO}>{t.miles||"—"}</TD><TD>{t.towCompany||"—"}</TD>
            <TD style={{fontWeight:700,...MO}}>{f$(p(t.cost))}</TD><TD><Bdg color={t.status==="Delivered"?C.emerald:C.blue} bg={t.status==="Delivered"?C.emeraldLight:C.blueLight}>{t.status}</Bdg></TD>
          </tr>);})}
      </tbody></table></div></Card>}
      {showForm&&<Modal title={editing?"Edit Tow Job":"New Tow Job"} onClose={()=>setShowForm(false)}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
          <Sel label="Vehicle" value={form.vehicleNum} onChange={v=>upd("vehicleNum",v)} options={data.vehicles.map(v=>({value:v.vehicleNum,label:`#${v.vehicleNum} ${v.year} ${v.make} ${v.model}`}))} placeholder="Select..."/>
          <Inp label="Date" value={form.scheduledDate} onChange={v=>upd("scheduledDate",v)} type="date"/><Inp label="Pickup" value={form.pickupLocation} onChange={v=>upd("pickupLocation",v)}/>
          <Inp label="Delivery" value={form.deliveryLocation} onChange={v=>upd("deliveryLocation",v)}/><Inp label="Miles" value={form.miles} onChange={v=>upd("miles",v)} type="number"/>
          <Inp label="Cost" value={form.cost} onChange={v=>upd("cost",v)} type="number" step=".01"/><Inp label="Company" value={form.towCompany} onChange={v=>upd("towCompany",v)}/>
          <Inp label="Driver" value={form.driverName} onChange={v=>upd("driverName",v)}/><Sel label="Status" value={form.status} onChange={v=>upd("status",v)} options={TOW_STATUSES}/>
        </div>
        {p(form.miles)>0&&<Card style={{marginTop:12,padding:"10px 16px",background:C.red50,border:"1px solid "+C.blueLight}}>
          <span style={{fontSize:12,color:C.slate600}}>Estimated cost: </span><b style={{...MO,color:C.blue}}>{f$(calcTowRate(p(form.miles),form.isRunning,form.vehicleType).total)}</b>
        </Card>}
        <div style={{display:"flex",justifyContent:"space-between",marginTop:20}}><div>{editing&&<Btn v="danger" onClick={()=>setConfirm(editing)}>Delete</Btn>}</div><div style={{display:"flex",gap:8}}><Btn v="secondary" onClick={()=>setShowForm(false)}>Cancel</Btn><Btn onClick={save}>{editing?"Save":"Create Job"}</Btn></div></div>
      </Modal>}
      {confirm&&<ConfirmDlg msg="Delete this tow job?" onOk={()=>del(confirm)} onCancel={()=>setConfirm(null)}/>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// RATES
// ═══════════════════════════════════════════════════════════════
function RatesTab(){
  const[vt,setVt]=useState("sedan");const[port,setPort]=useState("NJ");const[run,setRun]=useState(true);
  return <div>
    <PageHeader title="Shipping Rates" subtitle="Calculate rates for any destination"/>
    <Card style={{marginBottom:18,padding:24}}>
      <div style={{fontSize:13,fontWeight:700,color:C.slate700,marginBottom:14}}>Rate Calculator</div>
      <div style={{display:"flex",flexWrap:"wrap",gap:14,alignItems:"end"}}>
        <Sel label="Vehicle Type" value={vt} onChange={setVt} options={Object.keys(BASE_RATES).map(k=>({value:k,label:k[0].toUpperCase()+k.slice(1)}))} style={{minWidth:140}}/>
        <Sel label="Port of Origin" value={port} onChange={setPort} options={PORTS.map(x=>({value:x.code,label:x.name}))} style={{minWidth:140}}/>
        <div><label style={{fontSize:11,fontWeight:600,color:C.slate500}}>Running?</label><label style={{display:"flex",alignItems:"center",gap:6,fontSize:12,padding:"10px 0",fontWeight:500,color:C.slate600}}><input type="checkbox" checked={run} onChange={e=>setRun(e.target.checked)} style={{accentColor:C.red,width:16,height:16}}/> Yes</label></div>
      </div>
    </Card>
    <Card style={{padding:0,overflow:"hidden",borderRadius:16}}>
      <div style={{padding:"14px 20px",borderBottom:"1px solid "+C.slate200}}><span style={{fontSize:13,fontWeight:700,color:C.slate700}}>All Destinations</span></div>
      <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}><thead><tr>{["Destination","Port","Region","Base","Port Fee","Non-Run","Insurance","Docs","Total"].map(h=><TH key={h}>{h}</TH>)}</tr></thead><tbody>
      {DESTS.map((d,i)=>{const r=calcShipRate(vt,d.code,port,run);return <tr key={d.code} style={{borderBottom:"1px solid "+C.slate100,background:i%2===0?"transparent":C.slate50}}><TD style={{fontWeight:600}}>{d.name}</TD><TD style={{fontSize:11,color:C.slate500}}>{d.port}</TD><TD><Bdg color={C.slate600} bg={C.slate200}>{d.region}</Bdg></TD><TD style={MO}>{f$(r.base)}</TD><TD style={MO}>{r.portSurcharge>0?`+${f$(r.portSurcharge)}`:"—"}</TD><TD style={{...MO,color:r.nonRunning>0?C.red:C.slate300}}>{r.nonRunning>0?`+${f$(r.nonRunning)}`:"—"}</TD><TD style={MO}>{f$(r.insurance)}</TD><TD style={MO}>{f$(r.documentation)}</TD><TD style={{fontWeight:700,color:C.blue,...MO,fontSize:14}}>{f$(r.total)}</TD></tr>;})}
    </tbody></table></div></Card>
  </div>;
}

// ═══════════════════════════════════════════════════════════════
// INVOICES — with auto-fill from container + Sayarah format
// ═══════════════════════════════════════════════════════════════
function InvoicesTab({data,setData,role,username,userEmail}){
  const[showForm,setShowForm]=useState(false);const[editing,setEditing]=useState(null);const[confirm,setConfirm]=useState(null);const[showPay,setShowPay]=useState(null);const[viewInv,setViewInv]=useState(null);
  const isAdmin=role==="admin";
  const eLine=()=>({id:gid(),vehicleNum:"",transportCost:"",towingCost:"",customsCharges:"",clearanceFee:"",inspectionFee:"",attestationFee:"",hybridCharges:""});
  const empty=()=>({id:gid(),invoiceNum:`SA${Date.now().toString().slice(-8)}`,customer:"",customerAddress:"",customerEmail:"",customerPhone:"",date:today(),dueDate:"",status:"draft",containerNum:"",bookingNum:"",origin:"Los Angeles, CA",destination:"JEBEL ALI, UAE",consignee:"",carrierName:"",purchaseDate:"",etd:"",eta:"",containerBookingPrice:"",aedRate:"3.67",currency:"AED",discount:"",paymentTerms:"Net 30",lineItems:[eLine()],notes:""});
  const[form,setForm]=useState(empty());const upd=(k,v)=>setForm(f=>({...f,[k]:v}));
  const updI=(idx,k,v)=>setForm(f=>({...f,lineItems:f.lineItems.map((li,i)=>i===idx?{...li,[k]:v}:li)}));
  const addLine=()=>setForm(f=>({...f,lineItems:[...f.lineItems,eLine()]}));
  const remLine=idx=>setForm(f=>({...f,lineItems:f.lineItems.filter((_,i)=>i!==idx)}));
  const[payForm,setPayForm]=useState({amount:"",date:today(),method:"Wire Transfer",reference:""});

  const autoFillContainer=(contNum)=>{
    const cont=data.containers.find(c=>c.containerNum===contNum);
    if(!cont)return;
    const vehs=data.vehicles.filter(v=>v.containerNum===contNum);
    const dest=DESTS.find(d=>d.code===cont.destination);
    setForm(f=>({...f,containerNum:contNum,bookingNum:cont.bookingNumber||"",origin:PORTS.find(x=>x.code===cont.portOrigin)?.name||"",destination:dest?`${dest.port}, ${dest.name}`:"",carrierName:cont.shippingLine||"",etd:cont.departureDate||"",eta:cont.arrivalDate||"",lineItems:vehs.length>0?vehs.map(v=>({...eLine(),vehicleNum:v.vehicleNum})):f.lineItems}));
  };

  const save=()=>{
    if(editing)setData(d=>({...d,invoices:d.invoices.map(inv=>inv.id===editing?form:inv)}));
    else{setData(d=>({...d,invoices:[...d.invoices,form],nextInvoiceNum:d.nextInvoiceNum+1}));logActivity(setData,username||"admin","Invoice Created",form.invoiceNum);}
    setShowForm(false);
  };
  const del=id=>{setData(d=>({...d,invoices:d.invoices.filter(i=>i.id!==id),payments:d.payments.filter(py=>py.invoiceId!==id)}));setConfirm(null);setShowForm(false);};
  const addPayment=invId=>{
    if(!p(payForm.amount))return;
    setData(d=>{const updated={...d,payments:[...d.payments,{id:gid(),invoiceId:invId,...payForm}]};const inv=updated.invoices.find(i=>i.id===invId);if(inv){const total=invGrandTotal(inv);const pd=updated.payments.filter(py=>py.invoiceId===invId).reduce((s,py)=>s+p(py.amount),0);updated.invoices=updated.invoices.map(i=>i.id===invId?{...i,status:pd>=total?"paid":pd>0?"partial":i.status}:i);}return updated;});
    setShowPay(null);setPayForm({amount:"",date:today(),method:"Wire Transfer",reference:""});
  };

  useEffect(()=>{const now=today();const updates=data.invoices.filter(i=>i.status==="sent"&&i.dueDate&&i.dueDate<now&&invBalance(i,data.payments)>0);if(updates.length>0)setData(d=>({...d,invoices:d.invoices.map(i=>updates.some(u=>u.id===i.id)?{...i,status:"overdue"}:i)}));},[data.invoices]);

  const custNames=useMemo(()=>{if(!userEmail)return[];return(data.customers||[]).filter(c=>c.email?.toLowerCase()===userEmail.toLowerCase()).map(c=>c.name.toLowerCase());},[data.customers,userEmail]);
  const matchInvCust=i=>{const un=username.toLowerCase();if(i.customer?.toLowerCase()===un)return true;if(custNames.some(n=>i.customer?.toLowerCase()===n))return true;return false;};
  const allInvs=isAdmin?data.invoices:data.invoices.filter(matchInvCust);
  const sorted=[...allInvs].sort((a,b)=>(b.date||"").localeCompare(a.date||""));

  return(
    <div>
      <PageHeader title={isAdmin?"Invoices":"My Invoices"} subtitle={`${allInvs.length} invoices`}>
        {isAdmin&&<>
          <Sel value="" onChange={v=>{if(v){setForm({...empty()});autoFillContainer(v);setEditing(null);setShowForm(true);}}} options={data.containers.map(c=>({value:c.containerNum,label:`${c.containerNum} (${data.vehicles.filter(v=>v.containerNum===c.containerNum).length} vehs)`}))} placeholder="Auto from Container..." style={{minWidth:220}}/>
          <Btn onClick={()=>{setForm(empty());setEditing(null);setShowForm(true);}}>Generate Invoice</Btn>
        </>}
      </PageHeader>
      {sorted.length===0?<Empty icon="📄" title="No invoices" sub={isAdmin?"Generate your first invoice":"No invoices yet"}/>:
      <Card style={{padding:0,overflow:"hidden",borderRadius:16}}><div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}><thead><tr>{["#","Date","Customer","Container","Vehs","Total","Paid","Balance","Status",""].map(h=><TH key={h}>{h}</TH>)}</tr></thead><tbody>
        {sorted.map((inv,i)=>{const gt=invGrandTotal(inv);const pd=invPaid(inv,data.payments);const bal=gt-pd;return(
          <tr key={inv.id} style={{borderBottom:"1px solid "+C.slate100,background:i%2===0?"transparent":C.slate50}}>
            <TD style={{fontWeight:700,color:C.blue,...MO}}>{inv.invoiceNum}</TD><TD style={{color:C.slate400}}>{inv.date}</TD><TD style={{fontWeight:600}}>{inv.customer||"—"}</TD>
            <TD style={{...MO,fontSize:11,color:C.slate500}}>{inv.containerNum||"—"}</TD><TD style={MO}>{inv.lineItems?.length||0}</TD>
            <TD style={{...MO,fontWeight:600}}>{f$2(gt)}</TD><TD style={{...MO,color:C.emerald}}>{f$2(pd)}</TD>
            <TD style={{...MO,fontWeight:700,color:bal>0?C.red:C.emerald}}>{f$2(bal)}</TD><TD><IBdg statusKey={inv.status}/></TD>
            <TD><div style={{display:"flex",gap:4}}>
              <Btn v="secondary" s="sm" onClick={()=>setViewInv(inv)}>View</Btn>
              {isAdmin&&<Btn v="ghost" s="sm" onClick={()=>{setForm({...inv,lineItems:inv.lineItems||[eLine()]});setEditing(inv.id);setShowForm(true);}}>Edit</Btn>}
              {isAdmin&&bal>0&&<Btn v="teal" s="sm" onClick={()=>{setShowPay(inv.id);setPayForm(f=>({...f,amount:bal}));}}>Pay</Btn>}
            </div></TD>
          </tr>);})}
      </tbody></table></div></Card>}

      {/* Invoice Generator */}
      {showForm&&isAdmin&&<Modal title={editing?`Edit ${form.invoiceNum}`:"Generate Invoice"} onClose={()=>setShowForm(false)} wide>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:12,marginBottom:16}}>
          <Inp label="Invoice #" value={form.invoiceNum} onChange={v=>upd("invoiceNum",v)} readOnly={!!editing}/><Inp label="Date" value={form.date} onChange={v=>upd("date",v)} type="date"/><Inp label="Due" value={form.dueDate} onChange={v=>upd("dueDate",v)} type="date"/>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}><Sel label="Currency" value={form.currency} onChange={v=>upd("currency",v)} options={["AED","USD","SAR","OMR","QAR","KWD"]}/><Inp label="Rate" value={form.aedRate} onChange={v=>upd("aedRate",v)} type="number" step=".01"/></div>
        </div>
        <Card style={{marginBottom:16,padding:18,background:C.red50,border:"1px solid "+C.blueLight,boxShadow:"none"}}>
          <div style={{fontSize:11,fontWeight:700,color:C.blue,marginBottom:10}}>BILL TO</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            <Sel label="Customer" value={form.customer} onChange={v=>{upd("customer",v);const c=(data.customers||[]).find(x=>x.name===v);if(c){upd("customerAddress",c.address||"");upd("customerPhone",c.phone||"");upd("customerEmail",c.email||"");}}} options={(data.customers||[]).map(c=>c.name)} placeholder="Select customer..."/>
            <Inp label="Phone" value={form.customerPhone} onChange={v=>upd("customerPhone",v)}/><Inp label="Address" value={form.customerAddress} onChange={v=>upd("customerAddress",v)}/><Inp label="Email" value={form.customerEmail} onChange={v=>upd("customerEmail",v)}/>
          </div>
        </Card>
        <Card style={{marginBottom:16,padding:18,background:C.emerald50,border:"1px solid "+C.emeraldLight,boxShadow:"none"}}>
          <div style={{fontSize:11,fontWeight:700,color:C.emerald,marginBottom:10}}>CARGO INFO</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))",gap:12}}>
            <Sel label="Container" value={form.containerNum} onChange={v=>{upd("containerNum",v);if(v)autoFillContainer(v);}} options={data.containers.map(c=>({value:c.containerNum,label:c.containerNum}))} placeholder="Select..."/>
            <Inp label="Booking" value={form.bookingNum} onChange={v=>upd("bookingNum",v)}/><Inp label="Origin" value={form.origin} onChange={v=>upd("origin",v)}/><Inp label="Destination" value={form.destination} onChange={v=>upd("destination",v)}/>
            <Inp label="Consignee" value={form.consignee} onChange={v=>upd("consignee",v)}/><Inp label="Carrier" value={form.carrierName} onChange={v=>upd("carrierName",v)}/><Inp label="ETD" value={form.etd} onChange={v=>upd("etd",v)} type="date"/><Inp label="ETA" value={form.eta} onChange={v=>upd("eta",v)} type="date"/>
          </div>
        </Card>
        {/* Vehicle fee table */}
        <div style={{fontSize:12,fontWeight:700,color:C.slate700,marginBottom:8}}>Vehicle Charges</div>
        <div style={{border:"1px solid "+C.slate200,borderRadius:12,overflow:"hidden",marginBottom:14}}><div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:11,minWidth:860}}>
            <thead><tr style={{background:C.slate50}}><th style={{padding:"10px 8px",textAlign:"left",fontSize:10,fontWeight:600,color:C.slate500,minWidth:130}}>Vehicle</th>{FEE_COLS.map(c=><th key={c.key} style={{padding:"10px 4px",textAlign:"right",fontSize:10,fontWeight:600,color:C.slate500,minWidth:70}}>{c.short}</th>)}<th style={{padding:"10px 4px",textAlign:"right",fontSize:10,fontWeight:600,color:C.slate500,minWidth:70}}>TOTAL</th><th style={{width:28}}></th></tr></thead>
            <tbody>
              {form.lineItems.map((li,idx)=>{const vh=li.vehicleNum?data.vehicles.find(v=>v.vehicleNum===li.vehicleNum):null;return(
                <tr key={li.id} style={{borderBottom:"1px solid "+C.slate100}}>
                  <td style={{padding:6}}><select value={li.vehicleNum} onChange={e=>updI(idx,"vehicleNum",e.target.value)} style={{...iS,padding:"6px 8px",fontSize:11}}><option value="">Select...</option>{data.vehicles.map(v=><option key={v.vehicleNum} value={v.vehicleNum}>#{v.vehicleNum} {v.year} {v.make} {v.model}</option>)}</select>{vh&&<div style={{fontSize:9,color:C.slate400,marginTop:2}}>VIN: {vh.vin||"N/A"}</div>}</td>
                  {FEE_COLS.map(c=><td key={c.key} style={{padding:"6px 4px"}}><input type="number" value={li[c.key]??""} onChange={e=>updI(idx,c.key,e.target.value===""?"":parseFloat(e.target.value))} step=".01" style={{...iS,padding:"6px 4px",fontSize:11,textAlign:"right",...MO,width:"100%"}}/></td>)}
                  <td style={{padding:"6px 4px",textAlign:"right",fontWeight:700,...MO,fontSize:12,color:C.blue}}>{f$2(lineTotal(li))}</td>
                  <td style={{padding:"6px 2px"}}><button onClick={()=>remLine(idx)} style={{background:"transparent",border:"none",color:C.red,cursor:"pointer",fontSize:12,borderRadius:4,width:24,height:24}}>✕</button></td>
                </tr>);})}
              <tr style={{background:C.slate50}}><td style={{padding:"10px 8px",fontSize:10,fontWeight:700,color:C.slate700}}>SUB TOTAL</td>{FEE_COLS.map(c=><td key={c.key} style={{padding:"10px 4px",textAlign:"right",...MO,fontSize:11,color:C.slate700,fontWeight:600}}>{f$2(colTotal(form.lineItems,c.key))}</td>)}<td style={{padding:"10px 4px",textAlign:"right",...MO,fontSize:13,fontWeight:800,color:C.blue}}>{f$2(invSubtotal(form.lineItems))}</td><td/></tr>
            </tbody>
          </table>
        </div><div style={{padding:"8px 12px"}}><Btn v="secondary" s="sm" onClick={addLine}>+ Add Vehicle</Btn></div></div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:12,marginBottom:12}}>
          <Inp label="Container Booking $" value={form.containerBookingPrice} onChange={v=>upd("containerBookingPrice",v)} type="number" step=".01"/><Inp label="Discount" value={form.discount} onChange={v=>upd("discount",v)} type="number" step=".01"/>
          <Sel label="Terms" value={form.paymentTerms} onChange={v=>upd("paymentTerms",v)} options={["Due on Receipt","Net 15","Net 30","Net 45","Net 60"]}/><Sel label="Status" value={form.status} onChange={v=>upd("status",v)} options={INV_STATUSES.map(s=>({value:s.key,label:s.label}))}/>
        </div>
        <Inp label="Notes" value={form.notes} onChange={v=>upd("notes",v)} placeholder="Payment instructions..."/>
        {/* Total bar */}
        <div style={{background:C.navy,borderRadius:14,padding:18,marginTop:16,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div style={{fontSize:12,color:"rgba(255,255,255,.5)"}}>Charges: <span style={{color:"#fff",...MO}}>{f$2(invSubtotal(form.lineItems))}</span>{p(form.containerBookingPrice)>0&&<span> + Container: <span style={{color:"#fff",...MO}}>{f$2(p(form.containerBookingPrice))}</span></span>}{p(form.discount)>0&&<span style={{color:C.amber}}> - {f$2(p(form.discount))}</span>}</div>
          <div style={{textAlign:"right"}}><div style={{fontSize:10,color:"rgba(255,255,255,.4)",fontWeight:600}}>TOTAL DUE</div><div style={{fontSize:28,fontWeight:800,color:"#fff",...MO}}>{f$2(invGrandTotal(form))}</div><div style={{fontSize:12,color:C.emerald,fontWeight:600,...MO}}>{(invGrandTotal(form)*p(form.aedRate||3.67)).toFixed(2)} {form.currency||"AED"}</div></div>
        </div>
        <div style={{display:"flex",justifyContent:"space-between",marginTop:20}}><div>{editing&&<Btn v="danger" onClick={()=>setConfirm(editing)}>Delete</Btn>}</div><div style={{display:"flex",gap:8}}><Btn v="secondary" onClick={()=>setShowForm(false)}>Cancel</Btn><Btn v="teal" onClick={()=>{upd("status","sent");setTimeout(save,50);}}>Save & Send</Btn><Btn onClick={save}>{editing?"Save":"Generate"}</Btn></div></div>
      </Modal>}

      {viewInv&&<InvViewer invoice={viewInv} data={data} onClose={()=>setViewInv(null)}/>}
      {showPay&&isAdmin&&<Modal title="Record Payment" onClose={()=>setShowPay(null)}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}><Inp label="Amount (USD)" value={payForm.amount} onChange={v=>setPayForm(f=>({...f,amount:v}))} type="number" step=".01"/><Inp label="Date" value={payForm.date} onChange={v=>setPayForm(f=>({...f,date:v}))} type="date"/><Sel label="Method" value={payForm.method} onChange={v=>setPayForm(f=>({...f,method:v}))} options={PAY_METHODS}/><Inp label="Ref #" value={payForm.reference} onChange={v=>setPayForm(f=>({...f,reference:v}))}/></div>
        <div style={{display:"flex",justifyContent:"flex-end",marginTop:20,gap:8}}><Btn v="secondary" onClick={()=>setShowPay(null)}>Cancel</Btn><Btn v="teal" onClick={()=>addPayment(showPay)}>Record Payment</Btn></div>
      </Modal>}
      {confirm&&<ConfirmDlg msg="Delete this invoice?" onOk={()=>del(confirm)} onCancel={()=>setConfirm(null)}/>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// INVOICE VIEWER — Sayarah Format + Page 2 Wire Instructions
// ═══════════════════════════════════════════════════════════════
function InvViewer({invoice,data,onClose}){
  const ref=useRef();const co=data.companyInfo||defaultData().companyInfo;const bk=data.bankInfo||defaultData().bankInfo;
  const gt=invGrandTotal(invoice);const aedR=p(invoice.aedRate||3.67);const aedT=gt*aedR;
  const pd=invPaid(invoice,data.payments);const bal=gt-pd;const pastDue=invoice.dueDate?daysAgo(invoice.dueDate):0;
  const invPays=data.payments.filter(py=>py.invoiceId===invoice.id);
  const print=()=>{const el=ref.current;if(!el)return;const w=window.open("","_blank");w.document.write(`<html><head><title>${invoice.invoiceNum}</title><link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800;900&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet"><style>body{margin:0;padding:20px;font-family:'DM Sans',sans-serif;font-size:12px}@media print{[style*="page-break-before"]{page-break-before:always;border-top:none!important;margin-top:0!important;padding-top:20px!important}}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:6px 8px;font-size:11px}ol,ul{margin:0}</style></head><body>${el.outerHTML}</body></html>`);w.document.close();setTimeout(()=>w.print(),500);};
  const L={fontWeight:700,color:"#374151"};

  return(
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(15,23,42,.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:14,backdropFilter:"blur(6px)"}}>
      <div onClick={e=>e.stopPropagation()} style={{background:C.slate100,borderRadius:20,padding:24,maxWidth:920,width:"100%",maxHeight:"94vh",overflowY:"auto",boxShadow:C.shadowXl}}>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:16}}><div style={{display:"flex",alignItems:"center",gap:8}}><h3 style={{margin:0,color:C.slate800,fontSize:18,fontWeight:700}}>{invoice.invoiceNum}</h3><IBdg statusKey={invoice.status}/></div><div style={{display:"flex",gap:8}}><Btn v="teal" onClick={print}>Print / PDF</Btn><Btn v="ghost" onClick={onClose}>✕</Btn></div></div>
        <div ref={ref} style={{background:"#fff",borderRadius:4,padding:"36px 44px",fontFamily:"'DM Sans',sans-serif",fontSize:12,color:"#111"}}>
          {/* Header */}
          <div style={{display:"flex",alignItems:"center",gap:14,marginBottom:20}}><div style={{height:3,flex:1,background:C.brandRed}}/><div style={{textAlign:"center"}}><img src="/logo.png" alt="Sayarah Logistics" style={{height:50,objectFit:"contain"}}/><div style={{fontSize:9,color:C.slate400,letterSpacing:".1em",marginTop:4}}>POWERED BY SAYARAH INC</div></div><div style={{height:3,flex:1,background:C.brandRed}}/></div>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:20}}>
            <div style={{fontSize:11,lineHeight:1.7}}><div style={{fontWeight:800}}>{co.name}</div><div>{co.address}</div><div>{co.city}</div><div>{co.email}</div></div>
            <div style={{textAlign:"right",fontSize:11,lineHeight:1.8}}><div style={{fontSize:18,fontWeight:900,color:C.brandRed,marginBottom:2}}>Invoice</div><div><span style={L}>No.:</span> <b style={MO}>{invoice.invoiceNum}</b></div><div><span style={L}>Date:</span> {invoice.date}</div><div><span style={L}>Due:</span> {invoice.dueDate||"—"}</div><div><span style={L}>Received:</span> [{f$2(pd)}]</div>{pastDue>0&&<div><span style={L}>Past Due:</span> [{pastDue}]</div>}<div><span style={L}>Currency:</span> {invoice.currency||"AED"}</div><div style={{fontWeight:800,fontSize:13,marginTop:3}}>Balance (USD): {f$2(bal)}</div></div>
          </div>
          {/* Bill To */}
          <div style={{marginBottom:14}}><div style={{fontSize:13,fontWeight:800,marginBottom:3}}>Bill To</div><div style={{fontSize:11,lineHeight:1.7}}><div><span style={L}>Customer:</span> {invoice.customer}</div>{invoice.customerAddress&&<div><span style={L}>Address:</span> {invoice.customerAddress}</div>}{invoice.customerPhone&&<div><span style={L}>Phone:</span> {invoice.customerPhone}</div>}</div></div>
          <div style={{display:"flex",justifyContent:"flex-end",marginBottom:6}}><div style={{display:"flex",border:"1px solid #93C5FD",background:"#EFF6FF"}}><div style={{padding:"5px 12px",fontWeight:700,fontSize:10,background:"#BFDBFE"}}>Bill TO:</div><div style={{padding:"5px 12px",fontWeight:800,fontSize:10,color:C.brandRed}}>Balance Due: {aedT.toFixed(2)} {invoice.currency||"AED"}</div></div></div>
          {/* Cargo */}
          <div style={{marginBottom:3}}><div style={{background:"#374151",color:"#fff",padding:"5px 10px",fontWeight:800,fontSize:10,textAlign:"center"}}>Cargo Information</div><div style={{display:"flex",border:"1px solid #ccc",borderTop:"none"}}><div style={{flex:1,padding:"7px 10px",borderRight:"1px solid #ccc",fontSize:10,lineHeight:1.8}}><div><span style={L}>Container:</span> {invoice.containerNum||"—"}</div><div><span style={L}>Booking:</span> {invoice.bookingNum||"—"}</div><div><span style={L}>Origin:</span> {invoice.origin||"—"}</div><div><span style={L}>Destination:</span> {invoice.destination||"—"}</div></div><div style={{flex:1,padding:"7px 10px",fontSize:10,lineHeight:1.8}}><div><span style={L}>Consignee:</span> {invoice.consignee||"—"}</div><div><span style={L}>Carrier:</span> {invoice.carrierName||"—"}</div>{invoice.etd&&<div><span style={L}>ETD:</span> {invoice.etd}</div>}{invoice.eta&&<div><span style={L}>ETA:</span> {invoice.eta}</div>}</div></div></div>
          {/* Items */}
          <table style={{width:"100%",borderCollapse:"collapse",marginTop:6,marginBottom:3,fontSize:10}}><thead><tr style={{background:"#E5E7EB"}}><th style={{border:"1px solid #ccc",padding:"7px 5px",fontSize:9,fontWeight:800,textAlign:"center"}}>#</th><th style={{border:"1px solid #ccc",padding:"7px 5px",fontSize:9,fontWeight:800,textAlign:"center",minWidth:140}}>Description</th>{FEE_COLS.map(c=><th key={c.key} style={{border:"1px solid #ccc",padding:"7px 3px",fontSize:8,fontWeight:800,textAlign:"center"}}>{c.label}</th>)}</tr></thead><tbody>
            {(invoice.lineItems||[]).map((li,idx)=>{const vh=li.vehicleNum?data.vehicles.find(v=>v.vehicleNum===li.vehicleNum):null;return(
              <tr key={li.id||idx}><td style={{border:"1px solid #ccc",padding:"8px 5px",textAlign:"center",fontWeight:600}}>{idx+1}</td><td style={{border:"1px solid #ccc",padding:"8px 6px",textAlign:"center"}}>{vh?<div><div style={{fontWeight:700}}>{vh.year} {vh.make?.toUpperCase()} {vh.model?.toUpperCase()}</div><div style={{fontSize:9,color:C.slate400}}>VIN:{vh.vin||"N/A"}</div></div>:(li.vehicleNum?`#${li.vehicleNum}`:"—")}</td>{FEE_COLS.map(c=><td key={c.key} style={{border:"1px solid #ccc",padding:"6px 5px",textAlign:"right",...MO}}>{p(li[c.key])>0?`$${p(li[c.key]).toFixed(2)}`:""}</td>)}</tr>);})}
            <tr style={{background:"#FEE2E2"}}><td colSpan={2} style={{border:"1px solid #ccc",padding:"7px",fontWeight:800,color:C.brandRed,fontSize:9}}>Sub Total</td>{FEE_COLS.map(c=>{const ct=colTotal(invoice.lineItems||[],c.key);return <td key={c.key} style={{border:"1px solid #ccc",padding:"6px 5px",textAlign:"right",fontWeight:700,color:C.brandRed,...MO}}>{ct>0?`$${ct.toFixed(2)}`:""}</td>;})}</tr>
          </tbody></table>
          {/* Totals */}
          <div style={{display:"flex",justifyContent:"space-between",marginTop:2,marginBottom:16}}>
            <div style={{display:"flex",alignItems:"center",border:"1px solid #ccc"}}><div style={{background:"#E5E7EB",padding:"7px 12px",fontWeight:800,fontSize:10,borderRight:"1px solid #ccc"}}>Container Booking</div><div style={{padding:"7px 14px",fontWeight:700,...MO}}>{f$2(p(invoice.containerBookingPrice))}</div></div>
            <div style={{display:"flex",alignItems:"center",gap:6}}><div style={{display:"flex",border:"1px solid #ccc"}}><div style={{padding:"7px 12px",fontWeight:700,fontSize:10}}>Rate</div><div style={{padding:"7px 12px",borderLeft:"1px solid #ccc",fontWeight:700,...MO}}>{aedR.toFixed(2)}</div></div><div style={{background:C.brandRed,color:"#fff",padding:"7px 16px",fontWeight:900,fontSize:12,...MO}}>Total: {f$2(gt)}USD</div></div>
          </div>
          {invPays.length>0&&<div style={{marginBottom:16,borderTop:"2px solid "+C.emerald,paddingTop:8}}><div style={{fontSize:9,fontWeight:800,color:C.emerald,textTransform:"uppercase",marginBottom:4}}>Payments</div>{invPays.map(py=><div key={py.id} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",borderBottom:"1px solid "+C.slate200,fontSize:10}}><span style={{color:C.slate400}}>{py.date} · {py.method}{py.reference?` · ${py.reference}`:""}</span><span style={{fontWeight:700,color:C.emerald,...MO}}>{f$2(p(py.amount))}</span></div>)}<div style={{textAlign:"right",paddingTop:6,fontSize:13,fontWeight:900,color:bal>0?C.red:C.emerald}}>Balance Due: {f$2(bal)}</div></div>}
          {invoice.notes&&<div style={{background:"#F9FAFB",borderRadius:6,padding:"8px 12px",marginBottom:14,fontSize:10,color:C.slate400,borderLeft:"3px solid "+C.slate200}}><b>Notes:</b> {invoice.notes}</div>}
          <div style={{borderTop:"1px solid #E5E7EB",paddingTop:12,textAlign:"center",fontSize:10,color:C.slate400}}><div style={{fontWeight:800,color:C.brandRed}}>Thank you for your business!</div><div>{co.name} · {co.email} · {co.phone}</div></div>

          {/* ═══ PAGE 2 ═══ */}
          <div style={{pageBreakBefore:"always",borderTop:"3px solid "+C.slate200,marginTop:36,paddingTop:36}}>
            <div style={{display:"flex",alignItems:"center",gap:14,marginBottom:24}}><div style={{height:3,flex:1,background:C.brandRed}}/><div style={{textAlign:"center"}}><img src="/logo.png" alt="Sayarah Logistics" style={{height:50,objectFit:"contain"}}/><div style={{fontSize:9,color:C.slate400,letterSpacing:".1em",marginTop:4}}>POWERED BY SAYARAH INC</div></div><div style={{height:3,flex:1,background:C.brandRed}}/></div>
            <table style={{width:"80%",margin:"0 auto 24px",borderCollapse:"collapse",border:"1px solid #999"}}><thead><tr><th colSpan={2} style={{background:"#D6E8F7",padding:"9px 14px",fontSize:12,fontWeight:800,textAlign:"center",border:"1px solid #999"}}>Wire Instructions (U.S. business bank account)</th></tr></thead><tbody>
              {[["Account number:",bk.accountNum],["Routing number:",bk.routingPaper],["",bk.routingWire],["Title on Account:",bk.titleOnAccount],["Address:",bk.bankAddress],["Mobile:",bk.bankMobile],["Bank:",bk.bankName]].map(([l,v],i)=><tr key={i} style={{background:i%2===0?"#EBF3FA":"#D6E8F7"}}><td style={{padding:"7px 14px",border:"1px solid #999",fontWeight:600,color:"#374151",width:"35%",fontSize:11}}>{l}</td><td style={{padding:"7px 14px",border:"1px solid #999",fontWeight:800,fontSize:11}}>{v}</td></tr>)}
            </tbody></table>
            <div style={{marginTop:24,padding:"0 8px"}}><div style={{fontSize:13,fontWeight:900,marginBottom:6}}>IMPORTANT NOTICE</div><p style={{fontSize:11,lineHeight:1.7,margin:"0 0 14px"}}><b>Please be advised</b> that the containers listed have arrived at <b>{invoice.destination||"Jebel Ali Port"}</b>. While each container comes with a specific number of <u>free storage days</u>, it is <b>very important</b> to note that once these free days expire, <b>Sayarah Inc. will not be held responsible</b> for any <b>Port Storage Charges</b> or <b>Detention Charges</b> imposed by the shipping line.</p>
              <div style={{fontSize:12,fontWeight:800,marginBottom:8}}>Detention and Storage Charges – Please Read Carefully:</div>
              <ol style={{fontSize:11,lineHeight:1.8,paddingLeft:22}}><li style={{marginBottom:6}}><b>Port Storage Charges</b> are applicable at <b>AED 164 per day</b> once free days end.</li><li style={{marginBottom:6}}>For <b>MSC Containers</b>, after <b>Delivery Order (DO)</b> expires:<ul style={{listStyleType:"circle",paddingLeft:20,marginTop:3}}><li>A charge of <b>AED 400 per day</b> will apply.</li><li>Additional <b>NOC Extension Fee</b> of <b>AED 158</b>.</li><li>After 3 days, charges increase to <b>AED 1,000 per day</b> + <b>AED 158 NOC</b>.</li></ul></li><li>For <b>Maersk Containers</b>, after DO expires:<ul style={{listStyleType:"circle",paddingLeft:20,marginTop:3}}><li>First 14 days: <b>AED 700 per day</b>.</li><li>After 14 days: <b>AED 1,000 per day</b>.</li></ul></li></ol>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// SETTINGS — Admin accounts + Activity Log
// ═══════════════════════════════════════════════════════════════
function SettingsTab({data,setData,username}){
  const[newU,setNewU]=useState("");const[newP,setNewP]=useState("");const[confirm,setConfirm]=useState(null);const admins=data.adminAccounts||[];
  const addAdmin=()=>{if(!newU.trim()||!newP.trim())return;if(admins.some(a=>a.username.toLowerCase()===newU.trim().toLowerCase()))return;setData(d=>({...d,adminAccounts:[...(d.adminAccounts||[]),{username:newU.trim(),password:newP}]}));setNewU("");setNewP("");};
  const remAdmin=idx=>{setData(d=>({...d,adminAccounts:d.adminAccounts.filter((_,i)=>i!==idx)}));setConfirm(null);};

  return(
    <div>
      <PageHeader title="Settings" subtitle="Manage admin accounts and view activity"/>
      <Card style={{marginBottom:18,padding:24}}>
        <div style={{fontSize:13,fontWeight:700,color:C.slate700,marginBottom:14}}>Admin Accounts</div>
        <p style={{fontSize:12,color:C.slate400,marginBottom:16,lineHeight:1.6}}>Usernames listed here require a password and get full admin access. Any other username is treated as a customer automatically.</p>
        <div style={{border:"1px solid "+C.slate200,borderRadius:12,overflow:"hidden",marginBottom:16}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}><thead><tr><TH>Username</TH><TH>Password</TH><TH>Actions</TH></tr></thead><tbody>
            {admins.map((a,i)=><tr key={i} style={{borderBottom:"1px solid "+C.slate100,background:i%2===0?"transparent":C.slate50}}><TD style={{fontWeight:600}}>{a.username}</TD><TD style={{color:C.slate400,...MO}}>{"•".repeat(a.password.length)}</TD><TD>{admins.length>1&&<Btn v="danger" s="sm" onClick={()=>setConfirm(i)}>Remove</Btn>}</TD></tr>)}
          </tbody></table>
        </div>
        <div style={{display:"flex",gap:10,alignItems:"end"}}><Inp label="Username" value={newU} onChange={setNewU} placeholder="username" style={{minWidth:160}}/><Inp label="Password" value={newP} onChange={setNewP} placeholder="password" style={{minWidth:160}}/><Btn onClick={addAdmin} style={{marginBottom:1}}>+ Add</Btn></div>
      </Card>

      {/* Activity Log */}
      <Card style={{padding:24}}>
        <div style={{fontSize:13,fontWeight:700,color:C.slate700,marginBottom:14}}>Activity Log</div>
        {(data.activityLog||[]).length===0?<div style={{color:C.slate400,fontSize:13}}>No activity logged yet</div>:
        <div style={{maxHeight:360,overflowY:"auto",borderRadius:10}}>
          {(data.activityLog||[]).slice(0,50).map(a=><div key={a.id} style={{display:"flex",gap:10,padding:"8px 0",borderBottom:"1px solid "+C.slate100,fontSize:12,alignItems:"center"}}>
            <span style={{color:C.slate400,minWidth:140,fontSize:11}}>{new Date(a.date).toLocaleString()}</span>
            <Bdg color={C.blue} bg={C.blueLight}>{a.user}</Bdg>
            <span style={{fontWeight:600,color:C.slate700}}>{a.action}</span>
            <span style={{color:C.slate400}}>{a.detail}</span>
          </div>)}
        </div>}
      </Card>
      {confirm!==null&&<ConfirmDlg msg={`Remove admin "${admins[confirm]?.username}"?`} onOk={()=>remAdmin(confirm)} onCancel={()=>setConfirm(null)}/>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// USERS MANAGEMENT — Admin Only
// ═══════════════════════════════════════════════════════════════
const SUPER_ADMIN="support@sayarah.io";
const ALL_TABS_LIST=["Dashboard","Customers","Vehicles","Containers","Towing","Rates","Invoices","Settings"];
const ROLES=[{key:"admin",label:"Admin",color:"#D97706",bg:"#FEF3C7"},{key:"manager",label:"Manager",color:"#2563EB",bg:"#DBEAFE"},{key:"customer",label:"Customer",color:"#059669",bg:"#D1FAE5"}];

function UsersManagementTab(){
  const[users,setUsers]=useState([]);const[loading,setLoading]=useState(true);const[editUser,setEditUser]=useState(null);const[saving,setSaving]=useState(false);const[msg,setMsg]=useState("");

  const load=async()=>{setLoading(true);try{const u=await getAllUsers();setUsers(u);}catch(e){setMsg("Failed to load users: "+e.message);}setLoading(false);};
  useEffect(()=>{if(FIREBASE_ENABLED)load();},[]);

  const savePerms=async(uid,updates)=>{
    setSaving(true);setMsg("");
    try{await updateUserPermissions(uid,updates);setMsg("Permissions saved!");await load();setTimeout(()=>setMsg(""),2000);}
    catch(e){setMsg("Error: "+e.message);}
    setSaving(false);
  };

  if(!FIREBASE_ENABLED)return <Card><div style={{padding:32,textAlign:"center",color:C.slate400}}>Firebase not configured — user management unavailable</div></Card>;

  return(
    <div>
      <PageHeader title="User Management" subtitle="Control access, roles, and page permissions">
        <Btn v="secondary" onClick={load}>Refresh</Btn>
      </PageHeader>

      {msg&&<div style={{background:msg.startsWith("Error")?C.red50:C.emerald50,color:msg.startsWith("Error")?C.red:C.emerald,padding:"10px 16px",borderRadius:10,fontSize:13,fontWeight:600,marginBottom:16}}>{msg}</div>}

      {loading?<div style={{textAlign:"center",padding:48,color:C.slate400}}>Loading users...</div>:(
        <Card style={{padding:0,overflow:"hidden",borderRadius:16}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
            <thead><tr>
              <TH>User</TH><TH>Email</TH><TH>Role</TH><TH>Allowed Pages</TH><TH>Actions</TH>
            </tr></thead>
            <tbody>
              {users.map((u,i)=>{
                const isSuperAdmin=u.email===SUPER_ADMIN;
                const isEditing=editUser?.id===u.id;
                return(
                  <tr key={u.id} style={{borderBottom:"1px solid "+C.slate100,background:i%2===0?"transparent":C.slate50}}>
                    <TD><div style={{fontWeight:600}}>{u.displayName||"—"}</div>{isSuperAdmin&&<span style={{fontSize:9,background:C.amberLight,color:"#92400E",padding:"2px 8px",borderRadius:6,fontWeight:700}}>SUPER ADMIN</span>}</TD>
                    <TD><span style={{fontSize:12,color:C.slate400}}>{u.email||"—"}</span></TD>
                    <TD>
                      {isEditing&&!isSuperAdmin?(
                        <select value={editUser.role||"customer"} onChange={e=>setEditUser({...editUser,role:e.target.value})} style={{fontSize:12,padding:"6px 10px",borderRadius:8,border:"1px solid "+C.slate200,fontFamily:"inherit"}}>
                          {ROLES.map(r=><option key={r.key} value={r.key}>{r.label}</option>)}
                        </select>
                      ):(
                        <Bdg color={(ROLES.find(r=>r.key===u.role)||ROLES[2]).color} bg={(ROLES.find(r=>r.key===u.role)||ROLES[2]).bg}>{(ROLES.find(r=>r.key===u.role)||ROLES[2]).label}</Bdg>
                      )}
                    </TD>
                    <TD>
                      {isEditing&&!isSuperAdmin?(
                        <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                          {ALL_TABS_LIST.map(t=>{
                            const tabs=editUser.allowedTabs||ALL_TABS_LIST;
                            const on=tabs.includes(t);
                            return <button key={t} onClick={()=>{
                              const cur=editUser.allowedTabs||[...ALL_TABS_LIST];
                              setEditUser({...editUser,allowedTabs:on?cur.filter(x=>x!==t):[...cur,t]});
                            }} style={{fontSize:10,padding:"4px 10px",borderRadius:6,border:"1.5px solid "+(on?C.emerald:C.slate200),background:on?C.emerald50:"transparent",color:on?C.emerald:C.slate400,cursor:"pointer",fontWeight:on?700:500,fontFamily:"inherit",transition:"all .15s"}}>{t}</button>;
                          })}
                        </div>
                      ):(
                        <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                          {(u.role==="admin"||isSuperAdmin)?<span style={{fontSize:10,color:C.emerald,fontWeight:700}}>All Pages</span>
                          :(u.allowedTabs||["Dashboard","Rates"]).map(t=><span key={t} style={{fontSize:10,background:C.slate100,padding:"3px 8px",borderRadius:6,color:C.slate600}}>{t}</span>)}
                        </div>
                      )}
                    </TD>
                    <TD>
                      {isSuperAdmin?<span style={{fontSize:10,color:C.slate400}}>Protected</span>
                      :isEditing?(
                        <div style={{display:"flex",gap:6}}>
                          <Btn v="green" onClick={()=>{savePerms(u.id,{role:editUser.role,allowedTabs:editUser.allowedTabs||ALL_TABS_LIST});setEditUser(null);}} disabled={saving}>{saving?"Saving...":"Save"}</Btn>
                          <Btn v="ghost" onClick={()=>setEditUser(null)}>Cancel</Btn>
                        </div>
                      ):(
                        <Btn v="ghost" onClick={()=>setEditUser({...u})}>Edit</Btn>
                      )}
                    </TD>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {users.length===0&&<div style={{padding:32,textAlign:"center",color:C.slate400,fontSize:13}}>No users found</div>}
        </Card>
      )}

      <Card style={{marginTop:18,padding:18,background:C.red50,border:"1px solid "+C.blueLight,boxShadow:"none"}}>
        <div style={{fontSize:12,fontWeight:700,color:C.blue,marginBottom:6}}>How Permissions Work</div>
        <div style={{fontSize:11,color:C.blueDark,lineHeight:1.7}}>
          <b>Admin</b> — Full access to all pages and user management<br/>
          <b>Manager</b> — Access to assigned pages only (set above)<br/>
          <b>Customer</b> — Dashboard, My Shipments, Rates, My Invoices only<br/>
          <b>Super Admin</b> (support@sayarah.io) — Cannot be modified
        </div>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MAIN APP — Sidebar Navigation Layout
// ═══════════════════════════════════════════════════════════════
const ADMIN_TABS=["Dashboard","Customers","Vehicles","Containers","Towing","Rates","Invoices","Settings","Users"];
const CUST_TABS=["Dashboard","My Shipments","Rates","My Invoices"];

export default function App(){
  const[loggedIn,setLoggedIn]=useState(false);const[username,setUsername]=useState("");const[userEmail,setUserEmail]=useState("");const[role,setRole]=useState("admin");const[tab,setTab]=useState("Dashboard");
  const[data,setData]=useState(defaultData());const[loaded,setLoaded]=useState(true);const[saving,setSaving]=useState(false);
  const[firebaseUid,setFirebaseUid]=useState(null);
  const[allowedTabs,setAllowedTabs]=useState(null);
  const[collapsed,setCollapsed]=useState(false);
  const tabs=role==="admin"?ADMIN_TABS:role==="manager"?(allowedTabs&&allowedTabs.length?allowedTabs.filter(t=>ADMIN_TABS.includes(t)):["Dashboard"]):CUST_TABS;

  // ─── Init: Firebase auth listener OR localStorage fallback ───
  useEffect(()=>{
    if(FIREBASE_ENABLED){
      // Timeout fallback — if Firebase hangs, show login after 5s
      const timeout=setTimeout(()=>{setLoaded(true);},5000);
      const unsub=onAuthChange(async(fbUser)=>{
        try{
          if(fbUser){
            const isSuperAdmin=fbUser.email==="support@sayarah.io";
            const r=isSuperAdmin?"admin":(await getUserRole(fbUser.uid))||"customer";
            setFirebaseUid(fbUser.uid);
            setUsername(fbUser.displayName||fbUser.email.split("@")[0]);
            setUserEmail(fbUser.email||"");
            setRole(r);
            setLoggedIn(true);
            if(r==="manager"){
              const ud=await getUserData(fbUser.uid);
              if(ud){
                const tabs=ud.allowedLogisticsTabs||ud.allowedTabs;
                if(tabs)setAllowedTabs(tabs);
              }
            }else{setAllowedTabs(null);}
            const cloudData=await loadAppData(fbUser.uid);
            if(cloudData)setData({...defaultData(),...cloudData});
          }else{
            setLoggedIn(false);setUsername("");setRole("admin");setFirebaseUid(null);
          }
        }catch(e){console.error("Auth init error:",e);}
        clearTimeout(timeout);
        setLoaded(true);
      });
      return()=>{unsub();clearTimeout(timeout);};
    }else{
      try{const raw=localStorage.getItem(STORAGE_KEY);if(raw)setData({...defaultData(),...JSON.parse(raw)});}catch{}
      try{const s=localStorage.getItem("sayarah-sess-v3");if(s){const x=JSON.parse(s);setLoggedIn(true);setUsername(x.username);setUserEmail(x.email||"");setRole(x.role||"customer");}}catch{}
      setLoaded(true);
    }
  },[]);

  // ─── Save data: Firestore OR localStorage ───
  useEffect(()=>{
    if(!loaded)return;
    if(FIREBASE_ENABLED&&firebaseUid){
      const t=setTimeout(()=>{setSaving(true);saveAppData(firebaseUid,data).then(()=>setTimeout(()=>setSaving(false),400)).catch(()=>setSaving(false));},600);
      return()=>clearTimeout(t);
    }else{
      const t=setTimeout(()=>{try{setSaving(true);localStorage.setItem(STORAGE_KEY,JSON.stringify(data));setTimeout(()=>setSaving(false),400);}catch{setSaving(false);}},400);
      return()=>clearTimeout(t);
    }
  },[data,loaded,firebaseUid]);

  const handleLogin=(u,r,uid,email)=>{setUsername(u);setUserEmail(email||"");setRole(r);setLoggedIn(true);setTab("Dashboard");if(uid)setFirebaseUid(uid);if(!FIREBASE_ENABLED)localStorage.setItem("sayarah-sess-v3",JSON.stringify({username:u,role:r,email:email||""}));};
  const handleLogout=async()=>{if(FIREBASE_ENABLED){try{await firebaseSignOut();}catch{}}setLoggedIn(false);setUsername("");setUserEmail("");setRole("admin");setTab("Dashboard");setFirebaseUid(null);localStorage.removeItem("sayarah-sess-v3");};

  if(!loaded)return <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Inter',system-ui,sans-serif",background:C.navy}}><img src="/logo.png" alt="Sayarah Logistics" style={{height:60,opacity:.8}}/></div>;
  if(!loggedIn)return <div style={{fontFamily:"'Inter',system-ui,sans-serif"}}><link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet"/><LoginPage onLogin={handleLogin} data={data}/></div>;

  const sideW=collapsed?56:240;

  return(
    <div style={{fontFamily:"'Inter',system-ui,sans-serif",display:"flex",minHeight:"100vh",color:C.black}}>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet"/>

      {/* ═══ SIDEBAR ═══ */}
      <aside style={{width:sideW,minHeight:"100vh",background:C.navy,display:"flex",flexDirection:"column",transition:"width .25s ease",overflow:"hidden",position:"fixed",left:0,top:0,bottom:0,zIndex:200}}>
        {/* Logo area */}
        <div style={{padding:collapsed?"14px 8px":"18px 20px",borderBottom:"1px solid rgba(255,255,255,.08)",display:"flex",alignItems:"center",justifyContent:"space-between",minHeight:64}}>
          {!collapsed&&<div style={{display:"flex",alignItems:"center",gap:10}}>
            <img src="/logo.png" alt="" style={{height:32,objectFit:"contain"}}/>
            <div><div style={{fontSize:14,fontWeight:800,color:"#fff",letterSpacing:".02em",lineHeight:1}}>SAYARAH</div><div style={{fontSize:9,color:"rgba(255,255,255,.35)",letterSpacing:".1em",fontWeight:600}}>LOGISTICS</div></div>
          </div>}
          <button onClick={()=>setCollapsed(!collapsed)} style={{background:"rgba(255,255,255,.08)",border:"none",borderRadius:8,width:32,height:32,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",color:"rgba(255,255,255,.5)",fontSize:14,transition:"all .15s",flexShrink:0}} onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,.15)"} onMouseLeave={e=>e.currentTarget.style.background="rgba(255,255,255,.08)"}>{collapsed?"→":"←"}</button>
        </div>

        {/* Nav items */}
        <nav style={{flex:1,padding:"12px 8px",display:"flex",flexDirection:"column",gap:2}}>
          {tabs.map(t=>{
            const active=tab===t;
            return <button key={t} onClick={()=>setTab(t)} style={{
              display:"flex",alignItems:"center",gap:12,padding:collapsed?"10px 0":"10px 14px",borderRadius:10,border:"none",
              background:active?"rgba(139,26,26,.3)":"transparent",
              color:active?"#fff":"rgba(255,255,255,.5)",
              cursor:"pointer",fontFamily:"inherit",fontSize:13,fontWeight:active?600:500,
              transition:"all .15s",width:"100%",textAlign:"left",justifyContent:collapsed?"center":"flex-start",
              minHeight:40,
            }} onMouseEnter={e=>{if(!active)e.currentTarget.style.background="rgba(255,255,255,.06)";e.currentTarget.style.color="#fff";}} onMouseLeave={e=>{if(!active)e.currentTarget.style.background="transparent";if(!active)e.currentTarget.style.color="rgba(255,255,255,.5)";}}>
              <span style={{display:"flex",alignItems:"center",justifyContent:"center",width:20,flexShrink:0,color:active?"#FCA5A5":"inherit"}}>{NAV_ICONS[t]||NAV_ICONS.Dashboard}</span>
              {!collapsed&&<span>{t}</span>}
              {active&&!collapsed&&<div style={{marginLeft:"auto",width:4,height:16,borderRadius:2,background:C.red}}/>}
            </button>;
          })}
        </nav>

        {/* Saving indicator */}
        {saving&&!collapsed&&<div style={{padding:"6px 20px",fontSize:10,color:"rgba(255,255,255,.25)",textAlign:"center"}}>Saving...</div>}

        {/* User section */}
        <div style={{borderTop:"1px solid rgba(255,255,255,.08)",padding:collapsed?"12px 8px":"16px 20px"}}>
          {collapsed?<div style={{display:"flex",justifyContent:"center"}}><div style={{width:32,height:32,borderRadius:10,background:"rgba(139,26,26,.4)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,color:"#fff",fontWeight:700}}>{(username||"U")[0].toUpperCase()}</div></div>:
          <>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
              <div style={{width:36,height:36,borderRadius:10,background:"linear-gradient(135deg,rgba(139,26,26,.5),rgba(16,185,129,.3))",display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,color:"#fff",fontWeight:700}}>{(username||"U")[0].toUpperCase()}</div>
              <div><div style={{fontSize:13,fontWeight:600,color:"#fff",lineHeight:1.2}}>{username}</div>
              <Bdg color={role==="admin"?"#F59E0B":role==="manager"?"#60A5FA":"#34D399"} bg={role==="admin"?"rgba(245,158,11,.15)":role==="manager"?"rgba(96,165,250,.15)":"rgba(52,211,153,.15)"}>{role}</Bdg></div>
            </div>
            <button onClick={handleLogout} style={{width:"100%",padding:"8px 0",background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.1)",borderRadius:8,color:"rgba(255,255,255,.5)",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit",transition:"all .15s"}} onMouseEnter={e=>{e.currentTarget.style.background="rgba(239,68,68,.15)";e.currentTarget.style.color="#FCA5A5";e.currentTarget.style.borderColor="rgba(239,68,68,.3)";}} onMouseLeave={e=>{e.currentTarget.style.background="rgba(255,255,255,.06)";e.currentTarget.style.color="rgba(255,255,255,.5)";e.currentTarget.style.borderColor="rgba(255,255,255,.1)";}}>Sign Out</button>
          </>}
        </div>
      </aside>

      {/* ═══ MAIN CONTENT ═══ */}
      <main style={{flex:1,background:C.bg,overflowY:"auto",marginLeft:sideW,transition:"margin-left .25s ease",minHeight:"100vh"}}>
        <div style={{maxWidth:1200,margin:"0 auto",padding:"28px 32px"}}>
          {tab==="Dashboard"&&<DashboardTab data={data} role={role} username={username} userEmail={userEmail}/>}
          {tab==="Customers"&&role==="admin"&&<CustomersTab data={data} setData={setData}/>}
          {tab==="Vehicles"&&(role==="admin"||role==="manager")&&<VehiclesTab data={data} setData={setData} role={role} username={username} userEmail={userEmail}/>}
          {tab==="Containers"&&(role==="admin"||role==="manager")&&<ContainersTab data={data} setData={setData}/>}
          {tab==="Towing"&&(role==="admin"||role==="manager")&&<TowingTab data={data} setData={setData}/>}
          {tab==="Invoices"&&(role==="admin"||role==="manager")&&<InvoicesTab data={data} setData={setData} role={role} username={username} userEmail={userEmail}/>}
          {tab==="Settings"&&role==="admin"&&<SettingsTab data={data} setData={setData} username={username}/>}
          {tab==="My Shipments"&&role==="customer"&&<VehiclesTab data={data} setData={setData} role={role} username={username} userEmail={userEmail}/>}
          {tab==="My Invoices"&&role==="customer"&&<InvoicesTab data={data} setData={setData} role={role} username={username} userEmail={userEmail}/>}
          {tab==="Rates"&&<RatesTab/>}
          {tab==="Users"&&role==="admin"&&<UsersManagementTab/>}
        </div>
        <div style={{textAlign:"center",padding:"20px 0 32px",fontSize:11,color:C.slate400}}>Powered by <span style={{fontWeight:700}}>Sayarah Inc</span></div>
      </main>
    </div>
  );
}
