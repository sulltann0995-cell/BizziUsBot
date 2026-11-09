require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const db = require('./services');

if (!process.env.BOT_TOKEN) throw new Error('BOT_TOKEN is required');
const bot = new Telegraf(process.env.BOT_TOKEN);
const states = new Map();
const money = v => new Intl.NumberFormat('uz-UZ').format(Number(v || 0)) + ' UZS';
const menu = () => Markup.inlineKeyboard([
  [Markup.button.callback('📊 Hisobot','summary'),Markup.button.callback('🏢 Bizneslar','businesses')],
  [Markup.button.callback('👥 Mijoz qo‘shish','add_customer'),Markup.button.callback('📦 Mahsulot/xizmat','add_item')],
  [Markup.button.callback('🧾 Buyurtma','add_order'),Markup.button.callback('💳 To‘lov','add_payment')],
  [Markup.button.callback('📅 Qabulga yozish','add_appointment')]
]);
async function context(ctx) {
  const user = await db.upsertUser(ctx.from);
  return {user,business:await db.currentBusiness(user.id)};
}
async function ask(ctx, state, message) {
  states.set(ctx.from.id,state);
  return ctx.reply(message,Markup.keyboard([['❌ Bekor qilish']]).resize());
}
bot.start(async ctx => {
  try {
    const {user} = await context(ctx);
    const businesses = await db.listBusinesses(user.id);
    if (!businesses.length) return ask(ctx,'new_business','👋 Bizzant’ga xush kelibsiz!\n\nBiznesingiz nomini yuboring:');
    const current = await db.currentBusiness(user.id);
    if (current) return ctx.reply('🚀 Bizzant boshqaruv paneli\n🏢 '+current.name,menu());
    return ctx.reply('Biznesni tanlang:',Markup.inlineKeyboard(businesses.map(b=>[Markup.button.callback(b.name,'select:'+b.id)])));
  } catch(e) { console.error(e); ctx.reply('Tizimda xatolik. Keyinroq urinib ko‘ring.'); }
});
bot.command('menu',async ctx=>{const {business}=await context(ctx);if(!business)return ctx.reply('Avval /start buyrug‘ini bosing.');return ctx.reply('🏢 '+business.name,menu());});
bot.action(/^select:(.+)$/,async ctx=>{
  try {const {user}=await context(ctx);const ok=await db.selectBusiness(user.id,ctx.match[1]);await ctx.answerCbQuery();if(!ok)return ctx.reply('Bu biznesga kirish huquqi topilmadi.');const b=await db.currentBusiness(user.id);return ctx.reply('🏢 '+b.name+' tanlandi.',menu());}
  catch(e){console.error(e);ctx.answerCbQuery('Xatolik');}
});
bot.action('businesses',async ctx=>{
  const {user}=await context(ctx);const list=await db.listBusinesses(user.id);await ctx.answerCbQuery();
  const buttons=list.map(b=>[Markup.button.callback(b.name,'select:'+b.id)]);
  buttons.push([Markup.button.callback('➕ Yangi biznes','new_business')]);
  return ctx.reply('Biznesni tanlang:',Markup.inlineKeyboard(buttons));
});
bot.action('new_business',async ctx=>{await ctx.answerCbQuery();return ask(ctx,'new_business','Yangi biznes nomini yuboring:');});
bot.action('summary',async ctx=>{
  try {const {business}=await context(ctx);await ctx.answerCbQuery();if(!business)return ctx.reply('Avval biznes yarating.');const s=await db.summary(business.id);
    return ctx.reply('📊 Bugungi hisobot — '+business.name+'\n\n🧾 Buyurtmalar: '+s.orders.count+' ('+money(s.orders.total)+')\n💳 Qabul qilingan to‘lovlar: '+money(s.payments.total)+'\n📅 Bugungi qabullar: '+s.appointments.count+'\n👥 Jami mijozlar: '+s.customers.count);
  }catch(e){console.error(e);ctx.reply('Hisobotni olishda xatolik.');}
});
const actions = {
  add_customer: ['customer','Mijoz ma’lumotini quyidagi ko‘rinishda yuboring:\nIsm | Telefon\nMasalan: Ali Valiyev | +998901234567'],
  add_item: ['item','Mahsulot yoki xizmatni quyidagicha yuboring:\nNomi | product yoki service | Narxi\nMasalan: Soch olish | service | 50000'],
  add_order: ['order','Buyurtmani quyidagicha yuboring:\nNomi | Summa\nMasalan: 2 ta futbolka | 180000'],
  add_payment: ['payment','To‘lovni quyidagicha yuboring:\nSumma | Usul | Izoh\nMasalan: 150000 | naqd | Buyurtma #12'],
  add_appointment: ['appointment','Qabulni quyidagicha yuboring:\nXizmat | Sana-vaqt\nMasalan: Konsultatsiya | 2026-12-01 14:30']
};
for (const [action,[state,prompt]] of Object.entries(actions)) bot.action(action,async ctx=>{await ctx.answerCbQuery();const {business}=await context(ctx);if(!business)return ctx.reply('Avval biznes yarating.');return ask(ctx,state,prompt);});
bot.on('text',async ctx=>{
  const state=states.get(ctx.from.id);if(!state)return;
  const text=ctx.message.text.trim();
  if(text==='❌ Bekor qilish'){states.delete(ctx.from.id);return ctx.reply('Bekor qilindi.',Markup.removeKeyboard());}
  try{
    const {user,business}=await context(ctx);
    if(state==='new_business'){
      if(text.length<2||text.length>80)return ctx.reply('Nom 2–80 belgi bo‘lishi kerak.');
      const b=await db.createBusiness(user,text);states.delete(ctx.from.id);await ctx.reply('✅ '+b.name+' biznesi yaratildi. Siz — egasisiz.',Markup.removeKeyboard());return ctx.reply('Boshqaruv paneli:',menu());
    }
    if(!business){states.delete(ctx.from.id);return ctx.reply('Biznes topilmadi. /start bosing.');}
    const parts=text.split('|').map(x=>x.trim());
    if(state==='customer'){
      if(!parts[0])return ctx.reply('Mijoz ismini kiriting.');
      await db.addCustomer(business.id,parts[0],parts[1]);await ctx.reply('✅ Mijoz saqlandi.');
    }else if(state==='item'){
      const price=Number(parts[2]);if(!parts[0]||!['product','service'].includes(parts[1])||!Number.isFinite(price)||price<0)return ctx.reply('Format xato. Nomi | product yoki service | Narxi');
      await db.addCatalogItem(business.id,parts[0],parts[1],price);await ctx.reply('✅ '+parts[0]+' katalogga qo‘shildi.');
    }else if(state==='order'){
      const amount=Number(parts[1]);if(!parts[0]||!Number.isFinite(amount)||amount<0)return ctx.reply('Format xato. Nomi | Summa');
      await db.addOrder(business.id,parts[0],amount,user.id);await ctx.reply('✅ Buyurtma saqlandi.');
    }else if(state==='payment'){
      const amount=Number(parts[0]);if(!Number.isFinite(amount)||amount<=0)return ctx.reply('To‘lov summasi 0 dan katta bo‘lsin.');
      await db.addPayment(business.id,amount,parts[1]||'cash',parts[2]);await ctx.reply('✅ To‘lov qayd etildi.');
    }else if(state==='appointment'){
      if(!parts[0]||!parts[1])return ctx.reply('Xizmat nomi va sana-vaqtni kiriting.');
      await db.addAppointment(business.id,parts[0],parts[1]);await ctx.reply('✅ Qabul yozuvi saqlandi.');
    }
    states.delete(ctx.from.id);return ctx.reply('Boshqaruv paneli:',Markup.removeKeyboard()).then(()=>ctx.reply('Menyu:',menu()));
  }catch(e){console.error(e);return ctx.reply('Saqlashda xatolik. Kiritilgan ma’lumotlarni tekshirib qayta urinib ko‘ring.');}
});
bot.catch((e)=>console.error('Telegram bot error:',e));
bot.launch().then(()=>console.log('BizziUsBot (Bizzant) is running')).catch(e=>{console.error(e);process.exit(1);});
process.once('SIGINT',()=>bot.stop('SIGINT'));
process.once('SIGTERM',()=>bot.stop('SIGTERM'));
