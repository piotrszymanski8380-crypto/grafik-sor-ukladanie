const { czyAdmin } = require('../lib/auth');

module.exports = async function handler(req, res) {
  res.status(200).json({ isAdmin: czyAdmin(req) });
};
