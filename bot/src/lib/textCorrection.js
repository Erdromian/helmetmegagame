// Moved to db/lib/textCorrection.js, because the autocorrect pass is part of
// the one write path (db/lib/say.js) now and the web sends through it too.
// This re-export stays so nothing in bot/ has to change its import.

module.exports = require("@lifeweb/db/lib/textCorrection");
