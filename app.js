'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const fieldIds = ['price','pre','fees','ltv','rate','term','handover','saleDate','sale','salePercent','saleFixed','rent','service','rentDelay','vacancy','goodSale','goodRent','badSale','badDelay','badRent'];
  const STORAGE_KEY = 'alreeman-investment-v1';
  const defaults = [
    {name:'الشريك الأول', share:25, saved:0, budget:5000},
    {name:'الشريك الثاني',share:25, saved:0, budget:5000},
    {name:'الشريك الثالث',share:25,saved:0,budget:5000},
    {name:'الشريك الرابع',share:25,saved:0,budget:5000}
  ];
  const format = n => Math.round(n).toLocaleString('en-US');
  const signed = n => `${n < 0 ? '−' : ''}${format(Math.abs(n))}`;
  const money = n => `${signed(n)} د.إ`;
  const html = s => String(s).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const numeric = id => {const v = Number($(id).value);return Number.isFinite(v) ? v : 0;};
  const monthIndex = str => {let [y,m] = String(str).split('-').map(Number);return y*12+m-1;};
  const monthLabel = index => `${String(index%12+1).padStart(2,'0')}/${Math.floor(index/12)}`;
  const START = monthIndex('2026-11');
  const DEVELOPER_DATES = ['2026-12','2027-04','2027-08','2027-12'].map(monthIndex);
  let lastResult = null;

  function makePartners() {
    $('partnerInputs').innerHTML = defaults.map((p,i) => `<tr><td>${i+1}</td><td><input aria-label="اسم الشريك ${i+1}" id="name${i}" type="text" value="${html(p.name)}"></td><td><input aria-label="ملكية الشريك ${i+1}" id="share${i}" type="number" min="0" max="100" step="0.1" value="${p.share}"></td><td><input aria-label="مدخرات الشريك ${i+1}" id="saved${i}" type="number" min="0" step="500" value="${p.saved}"></td><td><input aria-label="ميزانية الشريك ${i+1}" id="budget${i}" type="number" min="0" step="100" value="${p.budget}"></td></tr>`).join('');
  }
  function partners() {return defaults.map((_,i) => ({name:$(`name${i}`).value.trim() || `الشريك ${i+1}`, share:Number($(`share${i}`).value)||0,saved:Number($(`saved${i}`).value)||0,budget:Number($(`budget${i}`).value)||0}));}
  function payment(principal, rate, months) {
    if (principal <= 0 || months <= 0) return 0;
    const r=rate/1200;
    return r===0 ? principal/months : principal*r/(1-Math.pow(1+r,-months));
  }
  function assumptions() {
    return {
      price:numeric('price'), pre:numeric('pre'), fees:numeric('fees'), ltv:numeric('ltv'), rate:numeric('rate'), term:numeric('term'),
      handover:monthIndex($('handover').value), saleDate:monthIndex($('saleDate').value), sale:numeric('sale'),
      salePercent:numeric('salePercent'),saleFixed:numeric('saleFixed'),rent:numeric('rent'),service:numeric('service'),
      rentDelay:numeric('rentDelay'),vacancy:numeric('vacancy')
    };
  }
  function simulate(settings, overrides={}) {
    const s={...settings,...overrides};
    const loan=Math.min(Math.max(s.price*s.ltv/100,0), Math.max(s.price-s.pre,0));
    const equity=s.price-loan;
    const cashAtHandover=Math.max(0,equity-s.pre)+s.fees;
    const cashBeforeHandover=s.pre;
    const installment=payment(loan,s.rate,s.term*12);
    const schedule=[];
    let balance=loan, totalInterest=0,totalRent=0,totalServices=0,totalMortgage=0,totalDev=0,totalAtHandover=0;
    const end=Math.max(START,Math.min(s.saleDate, monthIndex('2050-12')));
    for(let m=START;m<=end;m++) {
      const developer=m<s.handover && DEVELOPER_DATES.includes(m)?s.pre/4:0;
      const atHandover=m===s.handover?cashAtHandover:0;
      let mortgage=0, interest=0, rent=0, services=0;
      if(m>=s.handover) {
        services=s.service/12;
        const sinceRent=m-s.handover-s.rentDelay;
        if(sinceRent>=0 && sinceRent%12 < 12-s.vacancy)rent=s.rent/12;
        if(balance>0.00001) {
          interest=balance*s.rate/1200;
          const principal=Math.min(balance,Math.max(0,installment-interest));
          mortgage=principal+interest;
          balance=Math.max(0,balance-principal);
        }
      }
      const required=developer+atHandover+mortgage+services-rent;
      schedule.push({m,developer,atHandover,mortgage,interest,rent,services,required,balance});
      totalInterest+=interest;totalRent+=rent;totalServices+=services;totalMortgage+=mortgage;totalDev+=developer;totalAtHandover+=atHandover;
    }
    const saleCosts=s.sale*s.salePercent/100+s.saleFixed;
    const saleNet=s.sale-saleCosts-balance;
    // Accounting identity: sum of signed monthly cash needs + net sale proceeds = purchase P&L.
    const equityProfit=s.sale+totalRent-s.price-totalInterest-totalServices-s.fees-saleCosts;
    return {s,loan,equity,cashBeforeHandover,cashAtHandover,installment,schedule,balance,totalInterest,totalRent,totalServices,totalMortgage,totalDev,totalAtHandover,saleCosts,saleNet,equityProfit};
  }
  function partnerLiquidity(p, model) {
    let cash=p.saved, minCash=cash, shortfall=0;
    let atHandoverCash=0;
    const ratio=p.share/100;
    for(const row of model.schedule) {
      if(row.m>model.s.handover)break;
      // Monthly budget is a new contribution into the partner's investment reserve.
      cash+=p.budget;
      // During construction the rent is zero; expenses are covered from reserve.
      cash-=(row.developer+row.atHandover+row.mortgage+row.services-row.rent)*ratio;
      minCash=Math.min(minCash,cash);
      if(row.m===model.s.handover)atHandoverCash=cash;
      if(cash<0){shortfall=Math.max(shortfall,-cash);}
    }
    return {cash,atHandoverCash,minCash,shortfall};
  }
  function stat(label,value){return `<article class="stat"><small>${html(label)}</small><strong>${html(value)}</strong></article>`;}
  function render() {
    const a=assumptions(),people=partners(), shareTotal=people.reduce((s,p)=>s+p.share,0),bad=[];
    if (a.price<=0)bad.push('أدخل سعر عقار أكبر من صفر.');
    if (a.pre<0||a.pre>a.price)bad.push('دفعات المطور يجب أن تكون بين صفر وسعر العقار.');
    if (a.ltv<0||a.ltv>100)bad.push('نسبة الرهن يجب أن تكون بين 0 و100%.');
    if (a.rate<0||a.rate>30)bad.push('أدخل نسبة فائدة بين 0 و30%.');
    if (a.term<4||a.term>7)bad.push('مدة الرهن يجب أن تكون من 4 إلى 7 سنوات.');
    if (!Number.isFinite(a.handover)||!Number.isFinite(a.saleDate))bad.push('حدد تواريخ الاستلام والبيع.');
    if (a.handover<=START)bad.push('تاريخ الاستلام يجب أن يكون بعد نوفمبر 2026.');
    if (a.saleDate<a.handover)bad.push('تاريخ البيع يجب أن يكون بعد الاستلام.');
    if (Math.abs(shareTotal-100)>0.01)bad.push(`مجموع نسب الملكية ${shareTotal.toFixed(1)}%، ويجب أن يساوي 100%.`);
    if (people.some(p=>p.share<0||p.budget<0||p.saved<0))bad.push('لا يمكن إدخال ملكية أو مدخرات أو ميزانية سالبة.');
    if (a.vacancy<0||a.vacancy>12||a.rentDelay<0)bad.push('راجع أشهر الشغور وتأخير التأجير.');
    if (bad.length) {
      $('alerts').innerHTML=bad.map(t=>`<div class="error">${html(t)}</div>`).join('');
      ['stats','funding','partnerFunding','partnerMonthly','scenarios','schedule','personSchedule'].forEach(id=>$(id).innerHTML='');lastResult=null;return;
    }
    const base=simulate(a);
    const good=simulate(a,{sale:numeric('goodSale'),rent:numeric('goodRent'),rentDelay:0});
    const badCase=simulate(a,{sale:numeric('badSale'),rent:numeric('badRent'),rentDelay:numeric('badDelay')});
    lastResult={base,people,good,badCase};
    $('stats').innerHTML=[
      stat('قيمة الرهن العقاري عند الاستلام',money(base.loan)),
      stat('نقد مطلوب من الأربعة (بالرسوم)',money(base.equity+a.fees)),
      stat('قسط الرهن الشهري للأربعة',money(base.installment)),
      stat('قسط الرهن لشريك 25%',money(base.installment/4)),
      stat('إجمالي الفوائد حتى موعد البيع',money(base.totalInterest)),
      stat('صافي ربح / خسارة الاستثمار',money(base.equityProfit)),
      stat('صافي حصيلة البيع بعد سداد الرهن',money(base.saleNet)),
      stat('مجموع الإيجارات المستلمة',money(base.totalRent))
    ].join('');
    const warnings=[];
    if(Math.abs(a.pre-a.price*.2)>1)warnings.push(`دفعات المطور ${money(a.pre)}، بينما 20% من السعر ${money(a.price*.2)}؛ تحققوا من العقد: هل الفرق يُخصم من الثمن أم رسوم مستقلة؟`);
    if(a.handover<monthIndex('2028-01'))warnings.push('أدخلت استلاماً قبل يناير 2028؛ تأكد من التاريخ في العقد.');
    if(a.handover<=DEVELOPER_DATES[DEVELOPER_DATES.length-1])warnings.push('تاريخ الاستلام يقع قبل أو عند آخر دفعة مطور مفترضة؛ راجع جدول الدفعات ومواعيدها.');
    if(a.ltv>65)warnings.push('نسبة الرهن المختارة أعلى من الافتراض المبدئي 65%؛ لا تعتمدها من دون تأكيد البنك.');
    warnings.push('سداد أصل الرهن محسوب ضمن القسط، لكنه ليس «مصروف خسارة» عند احتساب ربح الاستثمار؛ لذلك لا يُخصم مرتين.');
    warnings.push('إذا كانت مدخرات الشركاء غير كافية في أحد الشهور، يظهر العجز. الموافقة على القرض المشترك ورسومه ونسبة تمويل العقار قيد التحقق.');
    $('alerts').innerHTML=warnings.map(t=>`<div class="warning">${html(t)}</div>`).join('');
    $('funding').innerHTML=`<p>دفعات المطور أثناء الإنشاء: <strong>${money(base.cashBeforeHandover)}</strong>. المتبقي من ثمن العقار عند الاستلام: <strong>${money(a.price-a.pre)}</strong>؛ الرهن المفترض: <strong>${money(base.loan)}</strong>؛ نقد إضافي عند الاستلام مع الرسوم: <strong>${money(base.cashAtHandover)}</strong>. إجمالي نقد الشركاء للشراء والرسوم: <strong>${money(base.equity+a.fees)}</strong>.</p>`;
    $('partnerFunding').innerHTML=people.map(p=>{
      const ratio=p.share/100,liquidity=partnerLiquidity(p,base);
      return `<tr><td>${html(p.name)} (${p.share}%)</td><td>${format((base.equity+a.fees)*ratio)}</td><td>${format(base.cashBeforeHandover*ratio)}</td><td>${format(base.cashAtHandover*ratio)}</td><td class="${liquidity.atHandoverCash<0?'bad':'good'}">${signed(liquidity.atHandoverCash)}</td><td class="${liquidity.shortfall>0?'bad':'good'}">${format(liquidity.shortfall)}</td></tr>`;
    }).join('');
    const netRentOccupied=(a.rent-a.service)/12;
    $('partnerMonthly').innerHTML=people.map(p=>{
      const fraction=p.share/100,fromSalary=(base.installment-netRentOccupied)*fraction,empty=(base.installment+a.service/12)*fraction;
      return `<tr><td>${html(p.name)} (${p.share}%)</td><td>${format(base.installment*fraction)}</td><td>${format(netRentOccupied*fraction)}</td><td class="${fromSalary>p.budget?'bad':'good'}">${fromSalary<=0?'0 (فائض '+format(-fromSalary)+')':format(fromSalary)}</td><td class="${empty>p.budget?'bad':'good'}">${format(empty)}</td><td class="${p.budget-Math.max(0,fromSalary)<0?'bad':'good'}">${signed(p.budget-Math.max(0,fromSalary))}</td><td class="${base.equityProfit<0?'bad':'good'}">${signed(base.equityProfit*fraction)}</td></tr>`;
    }).join('');
    $('scenarios').innerHTML=[['إيجابي',good],['سلبي',badCase]].map(([label,res])=>`<tr><td>${label}</td><td>${format(res.totalRent)}</td><td>${format(res.totalInterest)}</td><td>${format(res.totalServices)}</td><td class="${res.equityProfit<0?'bad':'good'}">${signed(res.equityProfit)}</td><td class="${res.equityProfit<0?'bad':'good'}">${signed(res.equityProfit/4)}</td></tr>`).join('');
    const selected=Number($('selectedPartner').value)||0;
    const selectedPerson=people[selected]||people[0];
    let reserve=selectedPerson.saved;
    $('personSchedule').innerHTML=base.schedule.map(r=>{
      const due=r.required*selectedPerson.share/100;
      const salaryUsed=Math.min(selectedPerson.budget,Math.max(0,due));
      const savedFromSalary=selectedPerson.budget-salaryUsed;
      const drawn=Math.max(0,due-selectedPerson.budget);
      reserve+=selectedPerson.budget-due;
      return `<tr><td>${monthLabel(r.m)}</td><td>${signed(due)}</td><td>${format(salaryUsed)}</td><td>${format(savedFromSalary)}</td><td>${format(drawn)}</td><td class="${reserve<0?'bad':'good'}">${signed(reserve)}</td></tr>`;
    }).join('');
    $('schedule').innerHTML=base.schedule.map(r=>`<tr><td>${monthLabel(r.m)}</td><td>${format(r.developer)}</td><td>${format(r.atHandover)}</td><td>${format(r.mortgage)}</td><td>${format(r.rent)}</td><td>${format(r.services)}</td><td class="${r.required<0?'good':''}">${signed(r.required)}</td><td>${format(r.balance)}</td></tr>`).join('');
  }
  function csvExport() {
    if(!lastResult)return;
    const header=['Month','Developer_payment','Cash_at_handover_and_fees','Mortgage_payment','Rent_received','Annual_services_monthly','Net_cash_needed_from_partners','Outstanding_mortgage'];
    const lines=[header.join(','),...lastResult.base.schedule.map(r=>[monthLabel(r.m),r.developer,r.atHandover,r.mortgage,r.rent,r.services,r.required,r.balance].map(v=>typeof v==='number'?v.toFixed(2):v).join(','))];
    const blob=new Blob(['\ufeff'+lines.join('\r\n')],{type:'text/csv;charset=utf-8'});
    const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='alreeman-monthly-cashflow.csv';document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),3000);
    status('تم تجهيز ملف CSV.');
  }
  function status(msg){$('status').textContent=msg;}
  function save(){
    try{const values=Object.fromEntries(fieldIds.map(id=>[id,$(id).value]));localStorage.setItem(STORAGE_KEY,JSON.stringify({values,people:partners()}));status('تم حفظ المدخلات في هذا المتصفح فقط.');}
    catch(e){status('تعذر الحفظ في هذا المتصفح. الحسابات تعمل دون حفظ.');}
  }
  function restore(){
    try{
      const data=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');if(!data)return;
      for(const id of fieldIds)if(data.values&&data.values[id]!==undefined)$(id).value=data.values[id];
      if(Array.isArray(data.people))data.people.slice(0,4).forEach((p,i)=>{
        for(const k of ['name','share','saved','budget'])if(p[k]!==undefined)$(`${k}${i}`).value=p[k];
      });status('تم استرجاع البيانات المحفوظة على هذا الجهاز.');
    }catch(e){status('تعذر استرجاع البيانات المحفوظة.');}
  }
  function reset(){
    if(!window.confirm('هل تريد إعادة كل البيانات إلى القيم الافتراضية؟'))return;
    try{localStorage.removeItem(STORAGE_KEY);}catch(e){}
    window.location.reload();
  }
  makePartners();restore();
  document.addEventListener('input',render);
  document.addEventListener('change',render);
  $('saveBtn').addEventListener('click',save);
  $('resetBtn').addEventListener('click',reset);
  $('exportBtn').addEventListener('click',csvExport);
  $('printBtn').addEventListener('click',()=>window.print());
  render();
})();
