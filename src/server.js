require('dotenv').config();
const express=require('express');
const helmet=require('helmet');
const crypto=require('crypto');
const path=require('path');
const pool=require('./db');
const db=require('./services');
const app=express();
app.use(helmet({contentSecurityPolicy:false}));
app.use(express.json({limit:'1mb'}));
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
    const business=await db.currentBusiness(user.id);
    if(!business)return res.json({user:{id:user.id,telegram_id:user.telegram_id,full_name:user.full_name,username:user.username},business:null,summary:null,customers:[],catalog:[],orders:[],appointments:[]});
    const [summary,customers,catalog,orders,appointments]=await Promise.all([
      db.summary(business.id),db.listCustomers(business.id),db.listCatalog(business.id),db.listOrders(business.id),db.listAppointments(business.id)
    ]);
    return res.json({user:{id:user.id,telegram_id:user.telegram_id,full_name:user.full_name,username:user.username},business:{id:business.id,name:business.name,role:business.role},summary,customers,catalog,orders,appointments});
  }catch(e){console.error('Mini App auth/data error:',e);return res.status(500).json({error:'Ma’lumotlarni yuklashda server xatoligi.'});}
});
app.get('/',(_req,res)=>res.sendFile(path.join(__dirname,'../public/index.html')));
const port=Number(process.env.PORT||3000);
app.listen(port,'0.0.0.0',()=>console.log('BizziUsBot web server listening on '+port));
