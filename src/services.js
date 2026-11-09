const pool = require('./db');

async function upsertUser(from) {
  const fullName = [from.first_name, from.last_name].filter(Boolean).join(' ') || from.username || 'Telegram user';
  const { rows } = await pool.query(
    `INSERT INTO users (telegram_id, username, full_name)
     VALUES ($1,$2,$3)
     ON CONFLICT (telegram_id) DO UPDATE SET username=EXCLUDED.username, full_name=EXCLUDED.full_name
     RETURNING *`,
    [String(from.id), from.username || null, fullName]
  );
  return rows[0];
}
async function updateUserProfile(userId,role,name,phone,region,city) {\n  const {rows}=await pool.query('UPDATE users SET account_role=$2,full_name=$3,phone=$4,region=$5,city=$6 WHERE id=$1 RETURNING id,telegram_id,username,full_name,account_role,phone,region,city',[userId,role,name,phone,region,city]);return rows[0];\n}\nasync function listBusinesses(userId) {
  const { rows } = await pool.query(
    `SELECT b.id,b.name,b.category,b.region,b.city,m.role FROM memberships m
     JOIN businesses b ON b.id=m.business_id WHERE m.user_id=$1 ORDER BY b.created_at`, [userId]
  );
  return rows;
}
async function createBusiness(user, name, category = 'other', region = null, city = null) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const { rows } = await c.query('INSERT INTO businesses(name,category,created_by,region,city) VALUES($1,$2,$3,$4,$5) RETURNING *',[name,category,user.id,region,city]);
    await c.query("INSERT INTO memberships(business_id,user_id,role) VALUES($1,$2,'owner')",[rows[0].id,user.id]);
    await c.query('UPDATE users SET selected_business_id=$1 WHERE id=$2',[rows[0].id,user.id]);
    await c.query('COMMIT');
    return rows[0];
  } catch(e) { await c.query('ROLLBACK'); throw e; }
  finally { c.release(); }
}
async function selectBusiness(userId,businessId) {
  const {rowCount}=await pool.query('UPDATE users SET selected_business_id=$1 WHERE id=$2 AND EXISTS(SELECT 1 FROM memberships WHERE user_id=$2 AND business_id=$1)',[businessId,userId]);
  return rowCount===1;
}
async function leaveBusiness(userId) {
  const {rowCount}=await pool.query('UPDATE users SET selected_business_id=NULL WHERE id=$1',[userId]);
  return rowCount===1;
}
async function currentBusiness(userId) {
  const {rows}=await pool.query(`SELECT b.*,m.role FROM users u JOIN memberships m ON m.user_id=u.id JOIN businesses b ON b.id=m.business_id WHERE u.id=$1 AND b.id=u.selected_business_id`,[userId]);
  return rows[0]||null;
}
async function addCustomer(businessId,name,phone) {
  const {rows}=await pool.query('INSERT INTO customers(business_id,name,phone) VALUES($1,$2,$3) RETURNING *',[businessId,name,phone||null]);return rows[0];
}
async function listCustomers(businessId) {
  const {rows}=await pool.query('SELECT name,phone,created_at FROM customers WHERE business_id=$1 ORDER BY created_at DESC LIMIT 15',[businessId]);return rows;
}
async function addCatalogItem(businessId,name,kind,price) {
  const {rows}=await pool.query('INSERT INTO catalog_items(business_id,name,kind,price) VALUES($1,$2,$3,$4) RETURNING *',[businessId,name,kind,price]);return rows[0];
}
async function listCatalog(businessId) {
  const {rows}=await pool.query('SELECT name,kind,price FROM catalog_items WHERE business_id=$1 AND active=true ORDER BY created_at DESC LIMIT 15',[businessId]);return rows;
}
async function addOrder(businessId,title,amount,userId) {
  const {rows}=await pool.query('INSERT INTO orders(business_id,title,amount,created_by) VALUES($1,$2,$3,$4) RETURNING *',[businessId,title,amount,userId]);return rows[0];
}
async function listOrders(businessId) {
  const {rows}=await pool.query('SELECT title,amount,status,created_at FROM orders WHERE business_id=$1 ORDER BY created_at DESC LIMIT 15',[businessId]);return rows;
}
async function addPayment(businessId,amount,method,note) {
  const {rows}=await pool.query('INSERT INTO payments(business_id,amount,method,note) VALUES($1,$2,$3,$4) RETURNING *',[businessId,amount,method,note||null]);return rows[0];
}
async function addAppointment(businessId,service,dateText) {
  const date=new Date(dateText);if(Number.isNaN(date.getTime()))throw new Error('Invalid date');
  const {rows}=await pool.query('INSERT INTO appointments(business_id,service_name,starts_at) VALUES($1,$2,$3) RETURNING *',[businessId,service,date]);return rows[0];
}
async function listAppointments(businessId) {
  const {rows}=await pool.query("SELECT service_name,starts_at,status FROM appointments WHERE business_id=$1 AND starts_at>=NOW()-INTERVAL '1 day' ORDER BY starts_at LIMIT 15",[businessId]);return rows;
}
async function addStaffByTelegramId(businessId,telegramId,role) {
  if(!['admin','staff'].includes(role))throw new Error('Invalid role');
  const c=await pool.connect();
  try {
    await c.query('BEGIN');
    const {rows:userRows}=await c.query('SELECT id FROM users WHERE telegram_id=$1',[String(telegramId)]);
    if(!userRows.length)throw new Error('USER_NOT_FOUND');
    const added = await c.query('INSERT INTO memberships(business_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT(business_id,user_id) DO NOTHING',[businessId,userRows[0].id,role]);
    if (added.rowCount === 0) throw new Error('ALREADY_MEMBER');
    await c.query('COMMIT');
    return true;
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
async function listMembers(businessId) {
  const {rows}=await pool.query('SELECT u.full_name,u.telegram_id,m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.business_id=$1 ORDER BY CASE m.role WHEN \'owner\' THEN 1 WHEN \'admin\' THEN 2 ELSE 3 END',[businessId]);return rows;
}
async function periodSummary(businessId,period) {
  const unit=period==='year'?'year':period==='month'?'month':'day';
  const [orders,payments,appointments]=await Promise.all([
    pool.query(`SELECT COUNT(*)::int count,COALESCE(SUM(amount),0) total FROM orders WHERE business_id=$1 AND created_at>=date_trunc($2,CURRENT_DATE) AND created_at<date_trunc($2,CURRENT_DATE)+('1 '||$2)::interval`,[businessId,unit]),
    pool.query(`SELECT COUNT(*)::int count,COALESCE(SUM(amount),0) total FROM payments WHERE business_id=$1 AND paid_at>=date_trunc($2,CURRENT_DATE) AND paid_at<date_trunc($2,CURRENT_DATE)+('1 '||$2)::interval`,[businessId,unit]),
    pool.query(`SELECT COUNT(*)::int count FROM appointments WHERE business_id=$1 AND starts_at>=date_trunc($2,CURRENT_DATE) AND starts_at<date_trunc($2,CURRENT_DATE)+('1 '||$2)::interval AND status='booked'`,[businessId,unit])
  ]);
  return {orders:orders.rows[0],payments:payments.rows[0],appointments:appointments.rows[0]};
}
async function summary(businessId) {
  const [o,p,a,c]=await Promise.all([
    pool.query("SELECT COUNT(*)::int count,COALESCE(SUM(amount),0) total FROM orders WHERE business_id=$1 AND created_at::date=CURRENT_DATE",[businessId]),
    pool.query("SELECT COUNT(*)::int count,COALESCE(SUM(amount),0) total FROM payments WHERE business_id=$1 AND paid_at::date=CURRENT_DATE",[businessId]),
    pool.query("SELECT COUNT(*)::int count FROM appointments WHERE business_id=$1 AND starts_at::date=CURRENT_DATE AND status='booked'",[businessId]),
    pool.query('SELECT COUNT(*)::int count FROM customers WHERE business_id=$1',[businessId])
  ]);
  return {orders:o.rows[0],payments:p.rows[0],appointments:a.rows[0],customers:c.rows[0]};
}

async function listDirectoryLocations(region=null) {
  const regions=await pool.query("SELECT DISTINCT region FROM businesses WHERE public_visible=true AND region IS NOT NULL AND city IS NOT NULL ORDER BY region");
  const cities=region?await pool.query("SELECT DISTINCT city FROM businesses WHERE public_visible=true AND region=$1 AND city IS NOT NULL ORDER BY city",[region]):{rows:[]};
  return {regions:regions.rows.map(x=>x.region),cities:cities.rows.map(x=>x.city)};
}
async function listPublicBusinesses(region,city,category=null) {
  const values=[region,city];let where="public_visible=true AND region=$1 AND city=$2";
  if(category){values.push(category);where+=" AND category=$3";}
  const {rows}=await pool.query("SELECT id,name,category,region,city,phone FROM businesses WHERE "+where+" ORDER BY name LIMIT 100",values);
  return rows;
}
async function updateBusinessLocation(userId,businessId,region,city) {
  const {rowCount}=await pool.query("UPDATE businesses b SET region=$3,city=$4 WHERE b.id=$2 AND EXISTS(SELECT 1 FROM memberships m WHERE m.business_id=b.id AND m.user_id=$1 AND m.role IN ('owner','admin'))",[userId,businessId,region,city]);
  return rowCount===1;
}

module.exports={pool,periodSummary,upsertUser,updateUserProfile,listBusinesses,createBusiness,listDirectoryLocations,listPublicBusinesses,updateBusinessLocation,selectBusiness,leaveBusiness,currentBusiness,addCustomer,listCustomers,addCatalogItem,listCatalog,addOrder,listOrders,addPayment,addAppointment,listAppointments,addStaffByTelegramId,listMembers,summary};
