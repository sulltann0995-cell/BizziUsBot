require('dotenv').config();
const express=require('express');
const helmet=require('helmet');
const crypto=require('crypto');
const path=require('path');
const fs=require('fs');
const pool=require('./db');
const db=require('./services');
const app=express();
app.use(helmet({contentSecurityPolicy:false}));
app.use(express.json({limit:'1mb'}));
app.use('/vendor',express.static(path.join(__dirname,'../node_modules/three/build')));
app.use('/vendor-examples',express.static(path.join(__dirname,'../node_modules/three/examples/js')));

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
  res.setHeader('Cache-Control','public, max-age=3600');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method==='HEAD')return res.end();
  const stream=fs.createReadStream(filePath);
  stream.on('error',e=>{console.error('STL stream error:',e);if(!res.headersSent)res.sendStatus(500);else res.destroy(e);});
  stream.pipe(res);
 });
});
app.use(express.static(path.join(__dirname,'../public')));
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
    const [summary,customers,catalog,orders,appointments]=await Promise.all([
      db.summary(business.id),db.listCustomers(business.id),db.listCatalog(business.id),db.listOrders(business.id),db.listAppointments(business.id)
    ]);
    return res.json({user:{id:user.id,telegram_id:user.telegram_id,full_name:user.full_name,username:user.username,account_role:user.account_role,phone:user.phone,region:user.region,city:user.city},business:{id:business.id,name:business.name,category:business.category,region:business.region,city:business.city,role:business.role},businesses,summary,customers,catalog,orders,appointments});
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
app.get('/',(_req,res)=>res.sendFile(path.join(__dirname,'../public/index.html')));
const port=Number(process.env.PORT||3000);
app.listen(port,'0.0.0.0',()=>console.log('BizziUsBot web server listening on '+port));
