require('dotenv').config();
const express=require('express');
const helmet=require('helmet');
const pool=require('./db');
const app=express();
app.use(helmet());
app.use(express.json({limit:'1mb'}));
app.get('/api/health',async(_req,res)=>{
  try{await pool.query('SELECT 1');res.json({status:'ok',project:'Bizzant',bot:'BizziUsBot',database:'connected'});}
  catch(e){res.status(503).json({status:'error',project:'Bizzant',database:'disconnected'});}
});
app.get('/',(_req,res)=>res.type('html').send(`<!doctype html><html lang="uz"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bizzant</title><style>*{box-sizing:border-box}body{margin:0;background:#090b10;color:#f5f7fb;font:16px Inter,system-ui,sans-serif;min-height:100vh;display:grid;place-items:center}.card{max-width:680px;margin:24px;padding:42px;border:1px solid #252a35;border-radius:24px;background:linear-gradient(145deg,#151923,#0d1017);box-shadow:0 24px 80px #0008}h1{font-size:42px;margin:0 0 8px;letter-spacing:-2px}b{color:#71e0b2}.muted{color:#a5adbb;line-height:1.7}.pill{display:inline-block;margin-top:20px;padding:10px 16px;border:1px solid #315e50;border-radius:999px;color:#8be6bf}</style><main class="card"><h1>Bizzant<b>.</b></h1><div class="muted">Your Business Assistant.</div><p class="muted">Mijozlar, buyurtmalar, mahsulotlar, qabullar va tushumlarni bir joydan boshqaring.</p><span class="pill">BizziUsBot · Business assistant</span></main></html>`));
const port=Number(process.env.PORT||3000);
app.listen(port,()=>console.log('Bizzant API listening on '+port));
