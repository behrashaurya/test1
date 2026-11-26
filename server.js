import express from "express";
import session from "express-session";
import bcrypt from "bcryptjs";
import pg from "pg";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);

const pool = new pg.Pool({
  host: process.env.PGHOST || "localhost",
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || "app",
  password: process.env.PGPASSWORD || "app",
  database: process.env.PGDATABASE || "app",
});

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-only-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: "lax", maxAge: 1000 * 60 * 60 * 24 * 7 },
  }),
);

const templates = new Map();
async function render(res, view, data = {}) {
  let html = templates.get(view);
  if (!html) {
    html = await readFile(path.join(__dirname, "views", `${view}.html`), "utf8");
    templates.set(view, html);
  }
  html = html.replace(/\{\{(\w+)\}\}/g, (_, key) => escapeHtml(data[key] ?? ""));
  res.type("html").send(html);
}

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.redirect("/login");
  next();
}

function redirectIfAuthed(req, res, next) {
  if (req.session.userId) return res.redirect("/dashboard");
  next();
}

app.get("/", (req, res) => res.redirect(req.session.userId ? "/dashboard" : "/login"));

app.get("/login", redirectIfAuthed, (req, res) => render(res, "login", { error: "" }));

app.get("/register", redirectIfAuthed, (req, res) => render(res, "register", { error: "" }));

app.post("/register", redirectIfAuthed, async (req, res, next) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    if (!EMAIL_RE.test(email)) {
      res.status(400);
      return render(res, "register", { error: "Enter a valid email address.", email });
    }
    if (password.length < 8) {
      res.status(400);
      return render(res, "register", {
        error: "Password must be at least 8 characters.",
        email,
      });
    }

    const hash = await bcrypt.hash(password, 10);
    let result;
    try {
      result = await pool.query(
        "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id",
        [email, hash],
      );
    } catch (err) {
      if (err.code === "23505") {
        res.status(409);
        return render(res, "register", {
          error: "An account with that email already exists.",
          email,
        });
      }
      throw err;
    }

    const userId = result.rows[0].id;
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.userId = userId;
      res.redirect("/dashboard");
    });
  } catch (err) {
    next(err);
  }
});

app.post("/login", redirectIfAuthed, async (req, res, next) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    const { rows } = await pool.query(
      "SELECT id, password_hash FROM users WHERE email = $1",
      [email],
    );
    const user = rows[0];
    const ok = user ? await bcrypt.compare(password, user.password_hash) : false;
    if (!ok) {
      res.status(401);
      return render(res, "login", { error: "Incorrect email or password.", email });
    }

    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.userId = user.id;
      res.redirect("/dashboard");
    });
  } catch (err) {
    next(err);
  }
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.redirect("/login");
  });
});

app.get("/dashboard", requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      "SELECT email, created_at FROM users WHERE id = $1",
      [req.session.userId],
    );
    const user = rows[0];
    if (!user) {
      return req.session.destroy(() => res.redirect("/login"));
    }
    await render(res, "dashboard", {
      email: user.email,
      joined: new Date(user.created_at).toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      }),
    });
  } catch (err) {
    next(err);
  }
});

app.use("/static", express.static(path.join(__dirname, "public")));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).type("text").send("Something went wrong.");
});

async function start() {
  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          email TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      break;
    } catch (err) {
      if (attempt === 10) throw err;
      console.log(`Database not ready (attempt ${attempt}), retrying in 2s...`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  app.listen(PORT, () => console.log(`Listening on http://localhost:${PORT}`));
}

start().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});
