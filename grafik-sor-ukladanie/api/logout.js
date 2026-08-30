const { wyczyscCiastkoAdmina } = require('../lib/auth');

module.exports = async function handler(req, res) {
  wyczyscCiastkoAdmina(res);
  res.status(200).json({ ok: true });
};
