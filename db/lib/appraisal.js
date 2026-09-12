// The Appraisal skill's slug, in its own leaf module so client components can
// import it without dragging @lifeweb/db (and PrismaClient) into the browser
// bundle — same reasoning as db/lib/dmKinds.js. Zero requires, ever.
const APPRAISAL_SLUG = "appraisal";

module.exports = { APPRAISAL_SLUG };
