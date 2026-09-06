export async function readSoftware(pool, carId) {
  try {
    const { rows } = await pool.query(`SELECT version, end_date AS "recordedAt" FROM updates
      WHERE car_id=$1 AND end_date IS NOT NULL AND trim(version)<>''
      ORDER BY end_date DESC, id DESC LIMIT 1`, [carId]);
    return rows[0] || { unavailable: 'no-record' };
  } catch (error) {
    // Older installations may still use the original eight-table read-only role.
    if (error.code === '42501') return { unavailable: 'permission' };
    if (error.code === '42P01') return { unavailable: 'no-table' };
    throw error;
  }
}
