require('dotenv').config();
const {Telegraf,Markup}=require('telegraf');
const fs=require('fs');
const path=require('path');
const db=require('./services');
const WEB_APP_URL=process.env.WEB_APP_URL||process.env.APP_URL||'https://bizziusbot.onrender.com';
if(!process.env.BOT_TOKEN)throw new Error('BOT_TOKEN is required');
const bot=new Telegraf(process.env.BOT_TOKEN);
const states=new Map();
const categories=[['barber','💈 Sartaroshxona'],['dentist','🦷 Stomatologiya'],['education','🎓 O‘quv markazi'],['clinic','🏥 Klinika'],['retail','🛍 Do‘kon'],['restaurant','🍽 Restoran / Kafe'],['auto_service','🔧 Avtoservis'],['other','🏢 Boshqa biznes']];
const categoryKeyboard=()=>Markup.inlineKeyboard(categories.reduce((rows,item,i)=>{if(i%2===0)rows.push([]);rows[rows.length-1].push(Markup.button.callback(item[1],'category:'+item[0]));return rows;},[]));
const money=v=>new Intl.NumberFormat('uz-UZ').format(Number(v||0))+' UZS';
const menu=()=>Markup.inlineKeyboard([
 [Markup.button.webApp('📱 Ilovani ochish',WEB_APP_URL)],
 [Markup.button.callback('📊 Kunlik hisobot','summary:day'),Markup.button.callback('🏢 Bizneslar','businesses')],
 [Markup.button.callback('📅 Oylik hisobot','summary:month'),Markup.button.callback('🗓 Yillik hisobot','summary:year')],
 [Markup.button.callback('👥 Mijoz qo‘shish','add_customer'),Markup.button.callback('📋 Mijozlar','list_customers')],
 [Markup.button.callback('📦 Katalogga qo‘shish','add_item'),Markup.button.callback('🛍 Katalog','list_catalog')],
 [Markup.button.callback('🧾 Buyurtma yaratish','add_order'),Markup.button.callback('📑 Buyurtmalar','list_orders')],
 [Markup.button.callback('💳 To‘lov','add_payment'),Markup.button.callback('📅 Qabul yozish','add_appointment')],
 [Markup.button.callback('🗓 Qabullar','list_appointments'),Markup.button.callback('👨‍💼 Xodimlar','members')]
]);
async function context(ctx){const user=await db.upsertUser(ctx.from);return{user,business:await db.currentBusiness(user.id)};}
async function ask(ctx,state,prompt){states.set(ctx.from.id,state);return ctx.reply(prompt,Markup.keyboard([['❌ Bekor qilish']]).resize());}
async function requireBusiness(ctx){const data=await context(ctx);if(!data.business){await ctx.reply('Avval /start orqali biznes yarating yoki tanlang.');return null;}return data;}
bot.start(async ctx=>{
 try{const {user}=await context(ctx);const list=await db.listBusinesses(user.id);
  if(!list.length){states.set(ctx.from.id,'new_business');return ctx.reply('👋 BizziUsBot’ga xush kelibsiz!\n\nBiznesingizni ro‘yxatdan o‘tkazing yoki ilovani oching:',Markup.inlineKeyboard([[Markup.button.webApp('📱 Ilovani ochish',WEB_APP_URL)],[Markup.button.callback('➕ Biznes yaratish','new_business')]]));}
  const current=await db.currentBusiness(user.id);
  if(current)return ctx.reply('🚀 BizziUsBot boshqaruv paneli\n🏢 '+current.name+'\n👤 Rol: '+current.role,menu());
  return ctx.reply('Biznesni tanlang:',Markup.inlineKeyboard([...list.map(b=>[Markup.button.callback(b.name,'select:'+b.id)]),[Markup.button.callback('➕ Yangi biznes','new_business')]]));
 }catch(e){console.error(e);return ctx.reply('Tizimda xatolik. Keyinroq urinib ko‘ring.');}
});
bot.command('menu',async ctx=>{const d=await requireBusiness(ctx);if(d)ctx.reply('🏢 '+d.business.name,menu());});
bot.action(/^select:(.+)$/,async ctx=>{
 try{const {user}=await context(ctx);const ok=await db.selectBusiness(user.id,ctx.match[1]);await ctx.answerCbQuery();if(!ok)return ctx.reply('Kirish huquqi topilmadi.');const b=await db.currentBusiness(user.id);return ctx.reply('🏢 '+b.name+' tanlandi.',menu());}
 catch(e){console.error(e);return ctx.answerCbQuery('Xatolik');}
});
bot.action('businesses',async ctx=>{
 const {user}=await context(ctx);const list=await db.listBusinesses(user.id);await ctx.answerCbQuery();
 return ctx.reply('Biznesni tanlang:',Markup.inlineKeyboard([...list.map(b=>[Markup.button.callback(b.name+' · '+b.role,'select:'+b.id)]),[Markup.button.callback('➕ Yangi biznes','new_business')]]));
});
bot.action('new_business',async ctx=>{await ctx.answerCbQuery();return ctx.reply('Qaysi yo‘nalishda ishlaysiz? Tanlang:',categoryKeyboard());});
bot.action(/^category:(barber|dentist|education|clinic|retail|restaurant|auto_service|other)$/,async ctx=>{await ctx.answerCbQuery();states.set(ctx.from.id,'new_business:'+ctx.match[1]);return ctx.reply('🏢 Biznesingiz nomini yuboring:');});
const prompts={
 add_customer:['customer','Mijoz: Ism | Telefon\nMisol: Ali Valiyev | +998901234567'],
 add_item:['item','Katalog: Nomi | product yoki service | Narxi\nMisol: Soch olish | service | 50000'],
 add_order:['order','Buyurtma: Nomi | Summa\nMisol: 2 ta futbolka | 180000'],
 add_payment:['payment','To‘lov: Summa | Usul | Izoh\nMisol: 150000 | naqd | Buyurtma #12'],
 add_appointment:['appointment','Qabul: Xizmat | Sana-vaqt\nMisol: Konsultatsiya | 2026-12-01 14:30'],
 add_staff:['staff','Xodimni qo‘shish: Telegram ID | admin yoki staff\nEslatma: xodim avval botni /start qilgan bo‘lishi kerak.']
};
for(const [action,[state,prompt]] of Object.entries(prompts))bot.action(action,async ctx=>{
 await ctx.answerCbQuery();const d=await requireBusiness(ctx);if(!d)return;
 if(action==='add_staff'&&!['owner','admin'].includes(d.business.role))return ctx.reply('Xodim qo‘shish huquqi yo‘q.');
 return ask(ctx,state,prompt);
});
async function showList(ctx,kind){
 const d=await requireBusiness(ctx);if(!d)return;const id=d.business.id;
 if(kind==='customers'){const rows=await db.listCustomers(id);return ctx.reply(rows.length?'👥 Mijozlar:\n'+rows.map((x,i)=>(i+1)+'. '+x.name+(x.phone?' · '+x.phone:'')).join('\n'):'Hozircha mijozlar yo‘q.');}
 if(kind==='catalog'){const rows=await db.listCatalog(id);return ctx.reply(rows.length?'📦 Katalog:\n'+rows.map((x,i)=>(i+1)+'. '+x.name+' · '+(x.kind==='service'?'xizmat':'mahsulot')+' · '+money(x.price)).join('\n'):'Katalog bo‘sh.');}
 if(kind==='orders'){const rows=await db.listOrders(id);return ctx.reply(rows.length?'🧾 Oxirgi buyurtmalar:\n'+rows.map((x,i)=>(i+1)+'. '+x.title+' · '+money(x.amount)+' · '+x.status).join('\n'):'Buyurtmalar yo‘q.');}
 if(kind==='appointments'){const rows=await db.listAppointments(id);return ctx.reply(rows.length?'📅 Qabullar:\n'+rows.map((x,i)=>(i+1)+'. '+x.service_name+' · '+new Date(x.starts_at).toLocaleString('uz-UZ')+' · '+x.status).join('\n'):'Qabullar yo‘q.');}
}
for(const [action,kind] of [['list_customers','customers'],['list_catalog','catalog'],['list_orders','orders'],['list_appointments','appointments']])bot.action(action,async ctx=>{await ctx.answerCbQuery();try{return await showList(ctx,kind);}catch(e){console.error(e);return ctx.reply('Ma’lumotlarni olishda xatolik.');}});
bot.action('members',async ctx=>{
 await ctx.answerCbQuery();const d=await requireBusiness(ctx);if(!d)return;
 const rows=await db.listMembers(d.business.id);
 const list=rows.map(x=>'• '+x.full_name+' — '+x.role+' (ID: '+x.telegram_id+')').join('\n');
 return ctx.reply('👨‍💼 Jamoa:\n'+(list||'Xodimlar yo‘q.'),Markup.inlineKeyboard([[Markup.button.callback('➕ Xodim qo‘shish','add_staff')]]));
});

bot.action(/^book:(confirmed|rejected):([0-9a-f-]{36})$/i,async ctx=>{
 try{
  const {user}=await context(ctx);
  const status=ctx.match[1],bookingId=ctx.match[2];
  const result=await db.updateBookingStatus({bookingId,userId:user.id,status,asOwner:true});
  await ctx.answerCbQuery(status==='confirmed'?'Bron tasdiqlandi':'Bron rad etildi');
  const b=result.booking;
  await ctx.editMessageReplyMarkup({inline_keyboard:[]}).catch(()=>{});
  return ctx.reply((status==='confirmed'?'✅ Bron tasdiqlandi.':'❌ Bron rad etildi.')+'\n'+b.customer_name+' · '+b.service_name);
 }catch(e){console.error('Booking callback:',e);return ctx.answerCbQuery(e.message==='FORBIDDEN'?'Ruxsat yo‘q':'Bronni yangilab bo‘lmadi',{show_alert:true})}
});
bot.action(/^summary:(day|month|year)$/,async ctx=>{
 try{
  const d=await requireBusiness(ctx);await ctx.answerCbQuery();if(!d)return;
  const period=ctx.match[1],s=await db.periodSummary(d.business.id,period);
  const label={day:'Bugungi',month:'Oylik',year:'Yillik'}[period];
  const customerCount=(await db.summary(d.business.id)).customers.count;
  return ctx.reply('📊 '+label+' hisobot — '+d.business.name+'\n\n🧾 Buyurtmalar: '+s.orders.count+' ('+money(s.orders.total)+')\n💳 To‘lovlar: '+money(s.payments.total)+'\n📅 Qabullar: '+s.appointments.count+'\n👥 Jami mijozlar: '+customerCount);
 }catch(e){console.error(e);return ctx.reply('Hisobotni olishda xatolik.');}
});
bot.on('text',async ctx=>{
 const state=states.get(ctx.from.id);if(!state)return;const value=ctx.message.text.trim();
 if(value==='❌ Bekor qilish'){states.delete(ctx.from.id);return ctx.reply('Bekor qilindi.',Markup.removeKeyboard());}
 try{
  const {user,business}=await context(ctx);
  if(state.startsWith('new_business:')){
   if(value.length<2||value.length>80)return ctx.reply('Biznes nomi 2–80 belgi bo‘lsin.');
   const category=state.split(':')[1]||'other';const b=await db.createBusiness(user,value,category);states.delete(ctx.from.id);await ctx.reply('✅ '+b.name+' yaratildi. Siz biznes egasisiz.',Markup.removeKeyboard());return ctx.reply('Boshqaruv paneli:',menu());
  }
  if(!business){states.delete(ctx.from.id);return ctx.reply('Biznes tanlanmagan. /start bosing.');}
  const p=value.split('|').map(x=>x.trim());
  if(state==='customer'){if(!p[0])return ctx.reply('Mijoz ismini kiriting.');await db.addCustomer(business.id,p[0],p[1]);}
  else if(state==='item'){const price=Number(p[2]);if(!p[0]||!['product','service'].includes(p[1])||!Number.isFinite(price)||price<0)return ctx.reply('Format: Nomi | product yoki service | Narxi');await db.addCatalogItem(business.id,p[0],p[1],price);}
  else if(state==='order'){const amount=Number(p[1]);if(!p[0]||!Number.isFinite(amount)||amount<0)return ctx.reply('Format: Nomi | Summa');await db.addOrder(business.id,p[0],amount,user.id);}
  else if(state==='payment'){const amount=Number(p[0]);if(!Number.isFinite(amount)||amount<=0)return ctx.reply('Summa 0 dan katta bo‘lsin.');await db.addPayment(business.id,amount,p[1]||'naqd',p[2]);}
  else if(state==='appointment'){if(!p[0]||!p[1])return ctx.reply('Format: Xizmat | Sana-vaqt');await db.addAppointment(business.id,p[0],p[1]);}
  else if(state==='staff'){
   if(!['owner','admin'].includes(business.role))return ctx.reply('Xodim qo‘shish huquqi yo‘q.');
   const telegramId=p[0],role=p[1]||'staff';if(!/^\d{5,20}$/.test(telegramId)||!['admin','staff'].includes(role))return ctx.reply('Format: Telegram ID | admin yoki staff');
   try{await db.addStaffByTelegramId(business.id,telegramId,role);}catch(e){if(e.message==='USER_NOT_FOUND')return ctx.reply('Bu foydalanuvchi hali botni /start qilmagan.');if(e.message==='ALREADY_MEMBER')return ctx.reply('Bu foydalanuvchi ushbu biznes jamoasida allaqachon bor.');throw e;}
  }
  states.delete(ctx.from.id);await ctx.reply('✅ Ma’lumot saqlandi.',Markup.removeKeyboard());return ctx.reply('Boshqaruv paneli:',menu());
 }catch(e){console.error(e);return ctx.reply('Saqlashda xatolik. Ma’lumotlarni tekshirib qayta urinib ko‘ring.');}
});
bot.catch(e=>console.error('Telegram bot error:',e));
async function startBot(){
 try{
  const schema=fs.readFileSync(path.join(__dirname,'../db/schema.sql'),'utf8');
  await db.pool.query(schema);
  console.log('Database schema verified and migrated.');
  await bot.launch();
  console.log('BizziUsBot is running.');
 }catch(e){console.error('Bot startup failed:',e);process.exit(1);}
}
startBot();
process.once('SIGINT',()=>bot.stop('SIGINT'));process.once('SIGTERM',()=>bot.stop('SIGTERM'));
