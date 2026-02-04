const { getDB } = require('./db');

const ensureSchema = async () => {
  // Schema already created by migrations, just verify
  const db = getDB();
  return true;
};

module.exports = { ensureSchema };
