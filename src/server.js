require('dotenv').config();
const express=require('express');
const helmet=require('helmet');
const compression=require('compression');
const crypto=require('crypto');
const path=require('path');
const fs=require('fs');
const pool=require('./db');
const db=require('./services');
const app=express();
app.use(helmet({contentSecurityPolicy:false}));
// Compress JSON, JavaScript, CSS and SVG responses to reduce mobile transfer time.
app.use(compression({threshold:1024,level:6}));
app.use(express.json({limit:'1mb'}));
app.use('/vendor',express.static(path.join(__dirname,'../node_modules/three/build'),{maxAge:'7d',etag:true}));
app.use('/vendor-examples',express.static(path.join(__dirname,'../node_modules/three/examples/js'),{maxAge:'7d',etag:true}));

const STL_ASSETS=new Set([
 'remeshy_print_50mm_1794376766321.stl',
 'remeshy_print_50mm_1794380088703.stl',
 'remeshy_print_50mm_1794397149626.stl',
 'remeshy_print_50mm_1794411339500.stl',
 'remeshy_print_50mm_1794412652001.stl'
]);
app.get('/api/models/:filename',(req,res)=>{
 const filename=String(req.params.filename||'');
 if(!STL_ASSETS.has(filename))return res.sendStatus(404);
 const filePath=path.join(__dirname,'../public/models',filename);
 fs.stat(filePath,(err,stat)=>{
  if(err||!stat.isFile())return res.status(404).json({error:'STL fayli serverda topilmadi: '+filename});
  res.setHeader('Content-Type','model/stl');
  res.setHeader('Content-Length',String(stat.size));
  res.setHeader('Cache-Control','public, max-age=86400, stale-while-revalidate=604800');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method==='HEAD')return res.end();
  const stream=fs.createReadStream(filePath);
  stream.on('error',e=>{console.error('STL stream error:',e);if(!res.headersSent)res.sendStatus(500);else res.destroy(e);});
  stream.pipe(res);
 });
});
app.use(express.static(path.join(__dirname,'../public'),{etag:true,lastModified:true,maxAge:'1d',setHeaders(res,filePath){if(filePath.endsWith('index.html')){res.setHeader('Cache-Control','no-cache');return;}res.setHeader('Cache-Control','public, max-age=86400, stale-while-revalidate=604800');}}));
function verifyTelegramInitData(initData){
  if(typeof initData!=='string'||!initData||!process.env.BOT_TOKEN)return null;
  const params=new URLSearchParams(initData);
  const hash=params.get('hash');if(!hash)return null;
  params.delete('hash');
  const dataCheckString=[...params.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>k+'='+v).join('\n');
  const secret=crypto.createHmac('sha256','WebAppData').update(process.env.BOT_TOKEN).digest();
  const calculated=crypto.createHmac('sha256',secret).update(dataCheckString).digest('hex');
  const a=Buffer.from(calculated,'hex'),b=Buffer.from(hash,'hex');
  if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return null;
  const authDate=Number(params.get('auth_date'));
  if(!Number.isFinite(authDate)||Math.abs(Date.now()/1000-authDate)>86400)return null;
  try{const user=JSON.parse(params.get('user')||'null');return user&&user.id?user:null;}catch{return null;}
}

async function sendTelegramMessage(chatId,text,replyMarkup){
 if(!process.env.BOT_TOKEN||!chatId)return false;
 try{const response=await fetch('https://api.telegram.org/bot'+process.env.BOT_TOKEN+'/sendMessage',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:String(chatId),text,parse_mode:'HTML',reply_markup:replyMarkup})});const data=await response.json();if(!data.ok)console.error('Telegram notify failed:',data.description);return !!data.ok}catch(e){console.error('Telegram notify error:',e);return false}
}
function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}

app.get('/api/health',async(_req,res)=>{
  try{await pool.query('SELECT 1');res.json({status:'ok',project:'BizziUsBot',database:'connected'});}
  catch(e){res.status(503).json({status:'error',project:'BizziUsBot',database:'disconnected'});}
});
app.post('/api/auth',async(req,res)=>{
  try{
    const telegramUser=verifyTelegramInitData(req.body?.initData);
    if(!telegramUser)return res.status(401).json({error:'Telegram sessiyasi yaroqsiz yoki muddati tugagan. Mini Appni bot ichidan qayta oching.'});
    const user=await db.upsertUser(telegramUser);
    const [business,businesses]=await Promise.all([db.currentBusiness(user.id),db.listBusinesses(user.id)]);
    if(!business)return res.json({user:{id:user.id,telegram_id:user.telegram_id,full_name:user.full_name,username:user.username,account_role:user.account_role,phone:user.phone,region:user.region,city:user.city},business:null,businesses,summary:null,customers:[],catalog:[],orders:[],appointments:[]});
    const [summary,customers,catalog,orders,appointments,team]=await Promise.all([
      db.summary(business.id),db.listCustomers(business.id),db.listCatalog(business.id),db.listOrders(business.id),db.listAppointments(business.id),db.listMembers(business.id,true)
    ]);
    return res.json({user:{id:user.id,telegram_id:user.telegram_id,full_name:user.full_name,username:user.username,account_role:user.account_role,phone:user.phone,region:user.region,city:user.city},business:{id:business.id,name:business.name,category:business.category,region:business.region,city:business.city,role:business.role},businesses,summary,customers,catalog,orders,appointments,team});
  }catch(e){console.error('Mini App auth/data error:',e);return res.status(500).json({error:'Ma’lumotlarni yuklashda server xatoligi.'});}
});


app.post('/api/profile',async(req,res)=>{
  try{
    const telegramUser=verifyTelegramInitData(req.body?.initData);
    if(!telegramUser)return res.status(401).json({error:'Telegram sessiyasi yaroqsiz. Ilovani bot ichidan qayta oching.'});
    const role=String(req.body?.role||''),name=String(req.body?.name||'').trim(),rawPhone=String(req.body?.phone||'').trim(),region=String(req.body?.region||'').trim(),city=String(req.body?.city||'').trim();
    const phone=rawPhone.replace(/[^0-9+]/g,'');
    if(!['customer','business'].includes(role)||name.length<2||name.length>100||!/^\+?998\d{9}$/.test(phone.replace(/^998/,'+998'))||!region||region.length>80||!city||city.length>80)return res.status(400).json({error:'Ma’lumotlarni to‘g‘ri kiriting.'});
    const user=await db.upsertUser(telegramUser);
    const updated=await db.updateUserProfile(user.id,role,name,phone,region,city);
    return res.json({ok:true,user:updated});
  }catch(e){console.error('Profile registration error:',e);return res.status(500).json({error:'Ro‘yxatdan o‘tishda server xatoligi.'});}
});

app.get('/api/directory/locations',async(req,res)=>{
  try{const region=String(req.query.region||'').trim()||null;res.json(await db.listDirectoryLocations(region));}
  catch(e){console.error('Directory locations error:',e);res.status(500).json({error:'Hududlarni yuklashda xatolik.'});}
});
app.get('/api/directory',async(req,res)=>{
  try{
    const region=String(req.query.region||'').trim(),city=String(req.query.city||'').trim(),category=String(req.query.category||'').trim()||null;
    if(!region||!city)return res.status(400).json({error:'Viloyat va shaharni tanlang.'});
    const allowed=['barber','dentist','education','clinic','retail','restaurant','auto_service','other'];
    if(category&&!allowed.includes(category))return res.status(400).json({error:'Yo‘nalish noto‘g‘ri.'});
    res.json({businesses:await db.listPublicBusinesses(region,city,category)});
  }catch(e){console.error('Public directory error:',e);res.status(500).json({error:'Bizneslarni yuklashda xatolik.'});}
});

app.post('/api/business',async(req,res)=>{
  try{
    const telegramUser=verifyTelegramInitData(req.body?.initData);
    if(!telegramUser)return res.status(401).json({error:'Telegram sessiyasi yaroqsiz. Ilovani bot ichidan qayta oching.'});
    const name=String(req.body?.name||'').trim();
    const category=String(req.body?.category||'other');
    const allowed=['barber','dentist','education','clinic','retail','restaurant','auto_service','other'];
    if(name.length<2||name.length>80||!allowed.includes(category))return res.status(400).json({error:'Biznes nomi yoki yo‘nalishi noto‘g‘ri.'});
    const user=await db.upsertUser(telegramUser);
    const region=String(req.body?.region||'').trim();const city=String(req.body?.city||'').trim();
    if(!region||region.length>80||!city||city.length>80)return res.status(400).json({error:'Viloyat va shaharni kiriting.'});
    const business=await db.createBusiness(user,name,category,region,city);
    return res.json({ok:true,business:{id:business.id,name:business.name,category:business.category,role:'owner'}});
  }catch(e){console.error('Business creation error:',e);return res.status(500).json({error:'Biznesni yaratishda xatolik.'});}
});


app.post('/api/business/location',async(req,res)=>{
  try{
    const telegramUser=verifyTelegramInitData(req.body?.initData);
    if(!telegramUser)return res.status(401).json({error:'Telegram sessiyasi yaroqsiz.'});
    const businessId=String(req.body?.businessId||''),region=String(req.body?.region||'').trim(),city=String(req.body?.city||'').trim();
    if(!/^[0-9a-f-]{36}$/i.test(businessId)||!region||region.length>80||!city||city.length>80)return res.status(400).json({error:'Biznes, viloyat yoki shahar noto‘g‘ri.'});
    const user=await db.upsertUser(telegramUser);
    const ok=await db.updateBusinessLocation(user.id,businessId,region,city);
    if(!ok)return res.status(403).json({error:'Bu biznes manzilini o‘zgartirish huquqi yo‘q.'});
    return res.json({ok:true});
  }catch(e){console.error('Business location update error:',e);return res.status(500).json({error:'Manzilni saqlashda xatolik.'});}
});

app.post('/api/business/select',async(req,res)=>{
  try{
    const telegramUser=verifyTelegramInitData(req.body?.initData);
    if(!telegramUser)return res.status(401).json({error:'Telegram sessiyasi yaroqsiz.'});
    const businessId=String(req.body?.businessId||'');
    if(!/^[0-9a-f-]{36}$/i.test(businessId))return res.status(400).json({error:'Biznes identifikatori noto‘g‘ri.'});
    const user=await db.upsertUser(telegramUser);
    const ok=await db.selectBusiness(user.id,businessId);
    if(!ok)return res.status(403).json({error:'Bu biznesga kirish huquqi yo‘q.'});
    return res.json({ok:true});
  }catch(e){console.error('Business selection error:',e);return res.status(500).json({error:'Biznesni almashtirishda xatolik.'});}
});
app.post('/api/business/leave',async(req,res)=>{
  try{
    const telegramUser=verifyTelegramInitData(req.body?.initData);
    if(!telegramUser)return res.status(401).json({error:'Telegram sessiyasi yaroqsiz.'});
    const user=await db.upsertUser(telegramUser);
    await db.leaveBusiness(user.id);
    return res.json({ok:true});
  }catch(e){console.error('Business exit error:',e);return res.status(500).json({error:'Biznesdan chiqishda xatolik.'});}
});

app.get('/api/business/:id/public',async(req,res)=>{
 try{if(!/^[0-9a-f-]{36}$/i.test(req.params.id))return res.status(400).json({error:'Biznes identifikatori noto‘g‘ri.'});const business=await db.getPublicBusiness(req.params.id);if(!business)return res.status(404).json({error:'Biznes topilmadi.'});res.json({business});}
 catch(e){console.error('Public business profile:',e);res.status(500).json({error:'Biznes profilini yuklashda xatolik.'})}
});

app.post('/api/team/invite',async(req,res)=>{
 try{const u=verifyTelegramInitData(req.body?.initData);if(!u)return res.status(401).json({error:'Telegram sessiyasi yaroqsiz.'});const user=await db.upsertUser(u),businessId=String(req.body?.businessId||'');if(!/^[0-9a-f-]{36}$/i.test(businessId))return res.status(400).json({error:'Biznes identifikatori noto‘g‘ri.'});const token=crypto.randomBytes(32).toString('hex'),hash=crypto.createHash('sha256').update(token).digest('hex');const invite=await db.createTeamInvite(user.id,businessId,hash);const meResponse=await fetch('https://api.telegram.org/bot'+process.env.BOT_TOKEN+'/getMe');const meData=await meResponse.json();if(!meData.ok||!meData.result?.username)throw new Error('BOT_USERNAME_UNAVAILABLE');res.json({ok:true,inviteUrl:'https://t.me/'+meData.result.username+'?start=team_'+token,expiresAt:invite.expires_at});
 }catch(e){if(e.message==='FORBIDDEN')return res.status(403).json({error:'Taklif yaratish huquqi yo‘q.'});console.error('Team invite:',e);res.status(500).json({error:'Taklif yaratilmadi.'})}
});
app.post('/api/team/claim',async(req,res)=>{
 try{const u=verifyTelegramInitData(req.body?.initData);if(!u)return res.status(401).json({error:'Telegram sessiyasi yaroqsiz.'});const user=await db.upsertUser(u),token=String(req.body?.token||'');if(!/^[a-f0-9]{64}$/i.test(token))return res.status(400).json({error:'Taklif kodi noto‘g‘ri.'});const hash=crypto.createHash('sha256').update(token).digest('hex');const result=await db.claimTeamInvite(user.id,hash);res.json({ok:true,businessId:result.businessId});
 }catch(e){if(e.message==='INVITE_INVALID')return res.status(410).json({error:'Taklif muddati tugagan yoki ishlatilgan.'});console.error('Team claim:',e);res.status(500).json({error:'Taklifni qabul qilib bo‘lmadi.'})}
});
app.post('/api/team/profile',async(req,res)=>{
 try{const u=verifyTelegramInitData(req.body?.initData);if(!u)return res.status(401).json({error:'Telegram sessiyasi yaroqsiz.'});const user=await db.upsertUser(u),businessId=String(req.body?.businessId||''),name=String(req.body?.name||'').trim(),photo=String(req.body?.photoUrl||'').trim(),bio=String(req.body?.bio||'').trim(),specialty=String(req.body?.specialty||'').trim();if(!/^[0-9a-f-]{36}$/i.test(businessId)||name.length<2||name.length>80||photo.length>500||(photo&&!/^https:\/\//i.test(photo))||bio.length>500||specialty.length>100)return res.status(400).json({error:'Profil ma’lumotlarini tekshiring.'});const ok=await db.updateStaffProfile(user.id,businessId,{name,photoUrl:photo||null,bio,specialty});if(!ok)return res.status(403).json({error:'Faol xodim profili topilmadi.'});res.json({ok:true});
 }catch(e){console.error('Team profile:',e);res.status(500).json({error:'Profilni saqlab bo‘lmadi.'})}
});
app.post('/api/team/schedule',async(req,res)=>{
 try{const u=verifyTelegramInitData(req.body?.initData);if(!u)return res.status(401).json({error:'Telegram sessiyasi yaroqsiz.'});const user=await db.upsertUser(u),businessId=String(req.body?.businessId||''),memberId=String(req.body?.memberId||''),days=req.body?.days;if(!Array.isArray(days)||days.length!==7||days.some((d,i)=>d.weekday!==(i+1)%7||typeof d.dayOff!=='boolean'||(!d.dayOff&&(!/^([01]\d|2[0-3]):[0-5]\d$/.test(d.start)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(d.end)||d.end<=d.start))))return res.status(400).json({error:'Haftalik jadval noto‘g‘ri.'});await db.saveStaffSchedule(user.id,businessId,memberId,days);res.json({ok:true});
 }catch(e){if(e.message==='FORBIDDEN')return res.status(403).json({error:'Jadvalni tahrirlash huquqi yo‘q.'});console.error('Team schedule:',e);res.status(500).json({error:'Jadvalni saqlab bo‘lmadi.'})}
});
app.post('/api/team/review',async(req,res)=>{
 try{const u=verifyTelegramInitData(req.body?.initData);if(!u)return res.status(401).json({error:'Telegram sessiyasi yaroqsiz.'});const user=await db.upsertUser(u),bookingId=String(req.body?.bookingId||''),rating=Number(req.body?.rating),comment=String(req.body?.comment||'').trim();if(!/^[0-9a-f-]{36}$/i.test(bookingId)||!Number.isInteger(rating)||rating<1||rating>5||comment.length>1000)return res.status(400).json({error:'Baho ma’lumotlari noto‘g‘ri.'});await db.addStaffReview(user.id,bookingId,rating,comment);res.json({ok:true});
 }catch(e){if(['FORBIDDEN','NOT_REVIEWABLE','ALREADY_REVIEWED'].includes(e.message))return res.status(400).json({error:e.message==='ALREADY_REVIEWED'?'Bu bron uchun baho allaqachon berilgan.':'Faqat yakunlangan va xodim biriktirilgan bron baholanadi.'});console.error('Team review:',e);res.status(500).json({error:'Bahoni saqlab bo‘lmadi.'})}
});

app.post('/api/team/add',async(req,res)=>{
 try{
  const telegramUser=verifyTelegramInitData(req.body?.initData);if(!telegramUser)return res.status(401).json({error:'Telegram sessiyasi yaroqsiz.'});
  const user=await db.upsertUser(telegramUser),businessId=String(req.body?.businessId||''),telegramId=String(req.body?.telegramId||'').trim(),name=String(req.body?.name||'').trim(),photoUrl=String(req.body?.photoUrl||'').trim();
  if(!/^[0-9a-f-]{36}$/i.test(businessId)||!/^[0-9]{5,15}$/.test(telegramId)||name.length>80||photoUrl.length>500||(photoUrl&&!/^https:\/\//i.test(photoUrl)))return res.status(400).json({error:'Xodim ma’lumotlarini tekshiring.'});
  const access=await pool.query("SELECT 1 FROM memberships WHERE business_id=$1 AND user_id=$2 AND role IN ('owner','admin')",[businessId,user.id]);if(!access.rowCount)return res.status(403).json({error:'Xodim qo‘shish huquqi yo‘q.'});
  await db.addStaffByTelegramId(businessId,telegramId,name,photoUrl);res.json({ok:true,team:await db.listMembers(businessId,true)});
 }catch(e){if(e.message==='USER_NOT_FOUND')return res.status(404).json({error:'Xodim avval BizziUs Mini Appni Telegram orqali ochib ro‘yxatdan o‘tishi kerak.'});console.error('Add team member:',e);res.status(500).json({error:'Xodimni qo‘shishda xatolik.'})}
});
app.post('/api/team/status',async(req,res)=>{
 try{
  const telegramUser=verifyTelegramInitData(req.body?.initData);if(!telegramUser)return res.status(401).json({error:'Telegram sessiyasi yaroqsiz.'});
  const user=await db.upsertUser(telegramUser),businessId=String(req.body?.businessId||''),memberId=String(req.body?.memberId||''),active=!!req.body?.active;
  if(!/^[0-9a-f-]{36}$/i.test(businessId)||!/^[0-9a-f-]{36}$/i.test(memberId))return res.status(400).json({error:'Xodim identifikatori noto‘g‘ri.'});
  const ok=await db.setMemberActive(user.id,businessId,memberId,active);if(!ok)return res.status(403).json({error:'Bu xodimni boshqarish huquqi yo‘q.'});
  res.json({ok:true,team:await db.listMembers(businessId,true)});
 }catch(e){console.error('Team status:',e);res.status(500).json({error:'Xodim holatini o‘zgartirishda xatolik.'})}
});
app.post('/api/services/save',async(req,res)=>{
 try{const telegramUser=verifyTelegramInitData(req.body?.initData);if(!telegramUser)return res.status(401).json({error:'Telegram sessiyasi yaroqsiz.'});const user=await db.upsertUser(telegramUser),businessId=String(req.body?.businessId||''),items=req.body?.items;if(!/^[0-9a-f-]{36}$/i.test(businessId)||!Array.isArray(items)||items.length>100)return res.status(400).json({error:'Xizmatlar ma’lumoti noto‘g‘ri.'});const services=await db.saveServiceCatalog(user.id,businessId,items);res.json({ok:true,services})}
 catch(e){if(e.message==='FORBIDDEN')return res.status(403).json({error:'Bu biznes xizmatlarini tahrirlash huquqi yo‘q.'});if(e.message.startsWith('INVALID_SERVICE'))return res.status(400).json({error:'Xizmat nomi, narxi yoki davomiyligi noto‘g‘ri.'});console.error('Save services:',e);res.status(500).json({error:'Xizmatlarni saqlashda xatolik.'})}
});
app.get('/api/business/:id/availability',async(req,res)=>{
 try{const id=String(req.params.id||''),date=String(req.query.date||'');if(!/^[0-9a-f-]{36}$/i.test(id)||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date))return res.status(400).json({error:'Sana yoki biznes identifikatori noto‘g‘ri.'});const business=await db.getPublicBusiness(id);if(!business)return res.status(404).json({error:'Biznes topilmadi.'});const staffId=String(req.query.staffMemberId||'');if(staffId){const result=await db.getStaffAvailability(id,staffId,date);return res.json({busy:result.busy.map(x=>({starts_at:x.starts_at,duration_minutes:x.duration_minutes})),schedule:result.schedule})}const busy=await db.getBusySlots(id,date);res.json({busy:busy.map(x=>({starts_at:x.starts_at,duration_minutes:x.duration_minutes}))})}
 catch(e){console.error('Availability:',e);res.status(500).json({error:'Bo‘sh vaqtlarni yuklashda xatolik.'})}
});
app.post('/api/bookings',async(req,res)=>{
 try{const telegramUser=verifyTelegramInitData(req.body?.initData);if(!telegramUser)return res.status(401).json({error:'Telegram sessiyasi yaroqsiz.'});const user=await db.upsertUser(telegramUser);const {businessId,serviceId,name,phone,date,time,staffMemberId}=req.body||{};const safeName=String(name||'').trim(),safePhone=String(phone||'').replace(/[^0-9+]/g,'');if(!/^[0-9a-f-]{36}$/i.test(String(businessId||''))||!/^[0-9a-f-]{36}$/i.test(String(serviceId||''))||safeName.length<2||safeName.length>80||!/^\+?998\d{9}$/.test(safePhone)||!/^\d{4}-\d{2}-\d{2}$/.test(String(date||''))||!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(time||'')))return res.status(400).json({error:'Bron ma’lumotlarini to‘g‘ri kiriting.'});const result=await db.createCustomerBooking(user,businessId,serviceId,safeName,safePhone,date,time,staffMemberId||null);const booking=result.booking;const dateLabel=new Date(booking.starts_at).toLocaleString('uz-UZ',{timeZone:'Asia/Tashkent'});for(const owner of result.owners){const text='🔔 <b>YANGI BRON SO‘ROVI</b>\n\n🏢 '+escapeHtml(result.businessName)+'\n👤 '+escapeHtml(safeName)+'\n📞 '+escapeHtml(safePhone)+'\n✂️ '+escapeHtml(result.serviceName)+'\n🗓 '+escapeHtml(dateLabel)+'\n💰 '+new Intl.NumberFormat('uz-UZ').format(Number(booking.price))+' UZS\n\nBronni tasdiqlang yoki rad eting.';await sendTelegramMessage(owner.telegram_id,text,{inline_keyboard:[[{text:'✅ Qabul qilish',callback_data:'book:confirmed:'+booking.id},{text:'✖️ Rad etish',callback_data:'book:rejected:'+booking.id}]]})}res.json({ok:true,booking:{id:booking.id,status:booking.status,service_name:booking.service_name,starts_at:booking.starts_at,price:booking.price,duration_minutes:booking.duration_minutes},notificationSent:result.owners.length>0})}
 catch(e){if(e.message==='INVALID_TIME')return res.status(400).json({error:'Sana yoki vaqt noto‘g‘ri yoki o‘tib ketgan.'});if(e.message==='SLOT_TAKEN')return res.status(409).json({error:'Bu vaqt band. Boshqa vaqtni tanlang.'});if(e.message==='SERVICE_NOT_FOUND')return res.status(404).json({error:'Xizmat topilmadi yoki faol emas.'});if(e.message==='STAFF_NOT_FOUND')return res.status(404).json({error:'Xodim faol emas yoki topilmadi.'});console.error('Create booking:',e);res.status(500).json({error:'Bron yaratishda xatolik.'})}
});
app.post('/api/bookings/status',async(req,res)=>{
 try{const telegramUser=verifyTelegramInitData(req.body?.initData);if(!telegramUser)return res.status(401).json({error:'Telegram sessiyasi yaroqsiz.'});const user=await db.upsertUser(telegramUser),bookingId=String(req.body?.bookingId||''),status=String(req.body?.status||''),asOwner=!!req.body?.asOwner;if(!/^[0-9a-f-]{36}$/i.test(bookingId))return res.status(400).json({error:'Bron identifikatori noto‘g‘ri.'});const result=await db.updateBookingStatus({bookingId,userId:user.id,status,asOwner});const b=result.booking;const msg={confirmed:'✅ <b>BRON TASDIQLANDI</b>\nBiznes: '+escapeHtml(result.businessName),rejected:'❌ <b>BRON RAD ETILDI</b>\nBiznes: '+escapeHtml(result.businessName),on_way:'🚗 <b>MIJOZ YO‘LDA</b>\nMijoz: '+escapeHtml(b.customer_name)+'\nTelefon: '+escapeHtml(b.customer_phone),arrived:'📍 <b>MIJOZ YETIB KELDI</b>\n'+escapeHtml(b.customer_name),cancelled:'⚠️ <b>BRON BEKOR QILINDI</b>\n'+escapeHtml(b.customer_name),completed:'🎉 <b>XIZMAT YAKUNLANDI</b>'}[status];if(asOwner&&b.customer_telegram_id)await sendTelegramMessage(b.customer_telegram_id,msg);if(!asOwner)for(const owner of result.owners)await sendTelegramMessage(owner.telegram_id,msg);res.json({ok:true,booking:b})}
 catch(e){if(['FORBIDDEN','BOOKING_NOT_FOUND','INVALID_TRANSITION','INVALID_STATUS'].includes(e.message))return res.status(e.message==='FORBIDDEN'?403:400).json({error:e.message==='FORBIDDEN'?'Bu bronni boshqarish huquqi yo‘q.':e.message==='BOOKING_NOT_FOUND'?'Bron topilmadi.':'Bron holatini bu tarzda o‘zgartirib bo‘lmaydi.'});console.error('Booking status:',e);res.status(500).json({error:'Bron holatini yangilashda xatolik.'})}
});
app.get('/api/customer/bookings',async(req,res)=>{
 try{const telegramUser=verifyTelegramInitData(String(req.headers['x-telegram-init-data']||''));if(!telegramUser)return res.status(401).json({error:'Telegram sessiyasi yaroqsiz.'});const user=await db.upsertUser(telegramUser);const {rows}=await pool.query('SELECT a.id,a.service_name,a.starts_at,a.status,a.price,a.duration_minutes,a.staff_member_id,COALESCE(m.display_name,u.full_name) staff_name,b.name business_name,b.id business_id,(r.id IS NOT NULL) reviewed FROM appointments a JOIN businesses b ON b.id=a.business_id LEFT JOIN memberships m ON m.id=a.staff_member_id LEFT JOIN users u ON u.id=m.user_id LEFT JOIN staff_reviews r ON r.appointment_id=a.id WHERE a.customer_telegram_id=$1 ORDER BY a.starts_at DESC LIMIT 50',[String(telegramUser.id)]);res.json({bookings:rows})}
 catch(e){console.error('Customer bookings:',e);res.status(500).json({error:'Bronlarni yuklashda xatolik.'})}
});

app.get('/',(_req,res)=>res.sendFile(path.join(__dirname,'../public/index.html')));
const port=Number(process.env.PORT||3000);
app.listen(port,'0.0.0.0',()=>console.log('BizziUsBot web server listening on '+port));
