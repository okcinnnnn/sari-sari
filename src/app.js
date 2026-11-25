require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cookieSession = require('cookie-session');

const { requireAuth } = require('./middleware/auth');
const flash = require('./middleware/flash');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const posRoutes = require('./routes/pos');
const helpers = require('./utils/helpers');
const { getConnectionString, DatabaseNotConfiguredError } = require('./config/db');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1); // behind Vercel's proxy, so req.secure reflects the original https request

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// The session cookie holds the logged-in user (incl. role), so its signing key
// must be secret in production — a guessable key lets anyone forge an admin
// session. Prefer SESSION_SECRET; if it isn't set, derive a key from the
// database URL (already a secret) so a fresh Vercel deploy still works safely.
function sessionKey() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const dbUrl = getConnectionString();
  if (dbUrl) return crypto.createHash('sha256').update(`sari-sari-pos:session:${dbUrl}`).digest('hex');
  return 'dev-secret-change-me';
}

app.use(
  cookieSession({
    name: 'session',
    keys: [sessionKey()],
    maxAge: 8 * 60 * 60 * 1000, // 8-hour shift
    sameSite: 'lax',
    secure: Boolean(process.env.VERCEL), // only require https in deployed environments
  })
);

app.use(flash);
app.locals.peso = helpers.peso;

app.get('/', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  res.redirect(req.session.user.role === 'admin' ? '/admin/dashboard' : '/pos');
});

app.use('/', authRoutes);
app.use('/admin', requireAuth, adminRoutes);
app.use('/pos', requireAuth, posRoutes);

app.use((req, res) => {
  res.status(404).render('error', { title: 'Not Found', message: 'Page not found.' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  if (err instanceof DatabaseNotConfiguredError) {
    return res.status(503).render('error', {
      title: 'Database Not Configured',
      message:
        'This deployment has no database connected. In your Vercel project, open Storage, connect a Postgres ' +
        'database (e.g. Neon), make sure it is linked to this project, then redeploy.',
    });
  }
  res.status(500).render('error', { title: 'Server Error', message: 'Something went wrong. Please try again.' });
});

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Sari-sari POS running at http://localhost:${PORT}`);
  });
}

module.exports = app;
