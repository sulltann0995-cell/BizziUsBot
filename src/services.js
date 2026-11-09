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
async function listBusinesses(userId) {
  const { rows } = await pool.query(
    `SELECT b.id,b.name,b.category,m.role FROM memberships m
     JOIN businesses b ON b.id=m.business_id WHERE m.user_id=$1 ORDER BY b.created_at`, [userId]
  );
  return rows;
}
async function createBusiness(user, name, category = 'other') {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const { rows } = await c.query(
      'INSERT INTO businesses(name,category,created_by) VALUES($1,$2,$3) RETURNING *',
      [name, category, user.id]
    );
    await c.query("INSERT INTO memberships(business_id,user_id,role) VALUES($1,$2,'owner')", [rows[0].id,user.id]);
    await c.query('UPDATE users SET selected_business_id=$1 WHERE id=$2', [rows[0].id,user.id]);
    await c.query('COMMIT');
    return rows[0];
  } catch (e) { await c.query('ROLLBACK'); throw e; }
  finally { c.release(); }
}
async function selectBusiness(userId, businessId) {
  const { rowCount } = await pool.query(
    'UPDATE users SET selected_business_id=$1 WHERE id=$2 AND EXISTS (SELECT 1 FROM memberships WHERE user_id=$2 AND business_id=$1)',
    [businessId,userId]
  );
  return rowCount === 1;
}
async function currentBusiness(userId) {
  const { rows } = await pool.query(
    `SELECT b.*,m.role FROM users u JOIN memberships m ON m.user_id=u.id
     JOIN businesses b ON b.id=m.business_id WHERE u.id=$1 AND b.id=u.selected_business_id`, [userId]
  );
  return rows[0] || null;
}
async function addCustomer(businessId, name, phone) {
  const { rows } = await pool.query('INSERT INTO customers(business_id,name,phone) VALUES($1,$2,$3) RETURNING *',[businessId,name,phone||null]);
  return rows[0];
}
async function addCatalogItem(businessId, name, kind, price) {
  const { rows } = await pool.query('INSERT INTO catalog_items(business_id,name,kind,price) VALUES($1,$2,$3,$4) RETURNING *',[businessId,name,kind,price]);
  return rows[0];
}
async function addOrder(businessId, title, amount, userId) {
  const { rows } = await pool.query('INSERT INTO orders(business_id,title,amount,created_by) VALUES($1,$2,$3,$4) RETURNING *',[businessId,title,amount,userId]);
  return rows[0];
}
async function addPayment(businessId, amount, method, note) {
  const { rows } = await pool.query('INSERT INTO payments(business_id,amount,method,note) VALUES($1,$2,$3,$4) RETURNING *',[businessId,amount,method,note||null]);
  return rows[0];
}
async function addAppointment(businessId, service, dateText) {
  const date = new Date(dateText);
  if (Number.isNaN(date.getTime())) throw new Error('Invalid date');
  const { rows } = await pool.query('INSERT INTO appointments(business_id,service_name,starts_at) VALUES($1,$2,$3) RETURNING *',[businessId,service,date]);
  return rows[0];
}
async function summary(businessId) {
  const [o,p,a,c] = await Promise.all([
    pool.query("SELECT COUNT(*)::int count,COALESCE(SUM(amount),0) total FROM orders WHERE business_id=$1 AND created_at::date=CURRENT_DATE",[businessId]),
    pool.query("SELECT COUNT(*)::int count,COALESCE(SUM(amount),0) total FROM payments WHERE business_id=$1 AND paid_at::date=CURRENT_DATE",[businessId]),
    pool.query("SELECT COUNT(*)::int count FROM appointments WHERE business_id=$1 AND starts_at::date=CURRENT_DATE AND status='booked'",[businessId]),
    pool.query("SELECT COUNT(*)::int count FROM customers WHERE business_id=$1",[businessId])
  ]);
  return {orders:o.rows[0],payments:p.rows[0],appointments:a.rows[0],customers:c.rows[0]};
}
module.exports = {pool,upsertUser,listBusinesses,createBusiness,selectBusiness,currentBusiness,addCustomer,addCatalogItem,addOrder,addPayment,addAppointment,summary};
